import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobsService } from "@dimts/jobs";
import { loadPacks } from "@dimts/locales-tools";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import {
  createHostJobsDelivery,
  JOBS_DELIVERY_VERSION,
} from "../src/jobs-delivery.js";
import { createCareerRenderers } from "../src/jobs-format.js";
import { applyMigrations } from "../src/db/migrate.js";
import { createPostgresRepository } from "../src/db/repository.js";
import { sha256 } from "../src/middleware/auth.js";

const url = process.env.DIMTS_TEST_DATABASE_URL;
describe.skipIf(!url)(
  "P06 real PostgreSQL, authenticated REST and synthetic HTTP host delivery",
  () => {
    let admin: pg.Client;
    let pool: pg.Pool;
    let host: Server;
    let app: ReturnType<typeof buildApp>;
    let jobs: JobsService;
    const accepted = new Map<string, Record<string, unknown>>();
    const attempts: Record<string, unknown>[] = [];
    let loseNextReceipt = false;
    const schema = `p06api_${randomUUID().replaceAll("-", "")}`;
    const token = "synthetic-session-token-long-enough";
    const secret = "synthetic-relay-secret-long-enough";
    const cron = "synthetic-cron-secret-long-enough";
    const posting = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Synthetic trainee",
      description:
        "This synthetic trainee job needs no English. Written questions are available.",
      datePosted: "2026-11-01",
      validThrough: "2099-12-31",
      url: "https://jobs.example.org/trainee",
      hiringOrganization: {
        "@type": "Organization",
        name: "Synthetic organization",
        contactPoint: { email: "employer@example.org" },
      },
      jobLocation: {
        "@type": "Place",
        address: { addressLocality: "Addis", addressRegion: "Addis" },
      },
      employmentType: "PART_TIME",
      accommodationsOffered: ["written_questions"],
      ignoredExtension: "ignored",
    };
    beforeAll(async () => {
      admin = new pg.Client({ connectionString: url });
      await admin.connect();
      await admin.query(`CREATE SCHEMA ${schema}`);
      const scoped = new URL(url!);
      scoped.searchParams.set("options", `-c search_path=${schema}`);
      pool = new pg.Pool({ connectionString: scoped.toString() });
      const migrationClient = new pg.Client({
        connectionString: scoped.toString(),
      });
      await migrationClient.connect();
      try {
        await applyMigrations(
          migrationClient,
          resolve("packages/api/migrations"),
        );
      } finally {
        await migrationClient.end();
      }
      await pool.query(
        "INSERT INTO session(id,lang,channel,token_hash,resume_hash) VALUES('session-owner','en','web',$1,'resume'),('session-other','en','web',$1,'resume')",
        [sha256(token)],
      );
      await pool.query(
        "INSERT INTO host_key(id,name,key_hash,key_type) VALUES('secret-host','Synthetic importer',$1,'secret'),('public-host','Synthetic public widget',$2,'public')",
        [sha256("secret-host-key"), sha256("public-widget-key")],
      );
      host = createServer(async (incoming, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const payload = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as Record<string, unknown>;
        if (
          incoming.headers.authorization !== `Bearer ${secret}` ||
          incoming.headers["idempotency-key"] !== payload.idempotencyKey ||
          payload.version !== JOBS_DELIVERY_VERSION
        ) {
          response.writeHead(400).end();
          return;
        }
        attempts.push(payload);
        const key = String(payload.idempotencyKey);
        if (!accepted.has(key)) accepted.set(key, payload);
        if (loseNextReceipt) {
          loseNextReceipt = false;
          response.destroy();
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            version: JOBS_DELIVERY_VERSION,
            accepted: true,
            idempotencyKey: key,
          }),
        );
      });
      await new Promise<void>((done) => host.listen(0, "127.0.0.1", done));
      const address = host.address();
      if (!address || typeof address === "string")
        throw new Error("Synthetic host did not start");
      const config = parseConfig({
        NODE_ENV: "test",
        DATABASE_URL: scoped.toString(),
        DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
        DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
        DIMTS_JWT_SECRET: "synthetic-jwt-secret-long-enough-characters",
        DIMTS_CRON_SECRET: cron,
        DIMTS_JOBS_RELAY_URL: "https://synthetic-host.example/delivery",
        DIMTS_JOBS_RELAY_SECRET: secret,
        DIMTS_JOBS_RELAY_CHANNELS: "sms,telegram",
      });
      // Only this injected test transport rewrites the configured HTTPS URL to loopback.
      const delivery = createHostJobsDelivery(config, (_input, init) =>
        fetch(`http://127.0.0.1:${address.port}/delivery`, init),
      );
      jobs = new JobsService({
        pool,
        encryptionKey: Buffer.from(config.DIMTS_ENC_KEY, "base64"),
        hashKey: Buffer.from(config.DIMTS_HASH_KEY, "base64"),
        delivery,
        ...createCareerRenderers(loadPacks(resolve("locales"))),
      });
      app = buildApp({
        config,
        repository: createPostgresRepository(pool),
        jobsService: jobs,
        jobsDelivery: delivery,
      });
    }, 30000);
    afterAll(async () => {
      await app?.locals.close();
      if (host) await new Promise<void>((done) => host.close(() => done()));
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });
    const auth = () => `Bearer ${token}`;
    const run = (dry = false) =>
      request(app)
        .post(`/v1/internal/alerts${dry ? "?dry=1" : ""}`)
        .set("Authorization", `Bearer ${cron}`);

    it("imports with a secret host key, returns partial errors and lists source details without employer contact", async () => {
      await request(app)
        .post("/v1/jobs/import")
        .set("X-Dimts-Key", "public-widget-key")
        .send({ lang: "en", postings: posting })
        .expect(401);
      const imported = await request(app)
        .post("/v1/jobs/import")
        .set("X-Dimts-Key", "secret-host-key")
        .send({
          lang: "en",
          postings: { "@graph": [posting, { "@type": "JobPosting" }] },
        })
        .expect(200);
      expect(imported.body).toMatchObject({
        imported: 1,
        errors: [{ index: 1 }],
      });
      const listed = await request(app)
        .get("/v1/jobs?sessionId=session-owner&region=Addis&type=PART_TIME")
        .set("Authorization", auth())
        .expect(200);
      expect(listed.body.jobs).toHaveLength(1);
      expect(listed.body.jobs[0]).toMatchObject({
        title: posting.title,
        url: posting.url,
        accommodationsOffered: ["written_questions"],
      });
      expect(listed.body.jobs[0].deadlineDisplay).toContain("(");
      expect(JSON.stringify(listed.body)).not.toContain("employer@example.org");
      expect(listed.body.channels).toEqual(["sms", "telegram"]);
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM passage WHERE source_type='job'",
            )
          ).rows[0].count,
        ),
      ).toBe(1);
    });
    it("consents before encrypted contact, dry-runs then sends one digest and durably stops", async () => {
      const subscription = {
        sessionId: "session-owner",
        clientRequestId: "subscription-one",
        lang: "en",
        channel: "sms",
        contact: "+251911111111",
        region: "Addis",
        jobType: "PART_TIME",
      };
      await request(app)
        .post("/v1/subscriptions")
        .set("Authorization", auth())
        .send(subscription)
        .expect(400);
      expect(
        Number(
          (await pool.query("SELECT count(*) FROM subscription")).rows[0].count,
        ),
      ).toBe(0);
      const created = await request(app)
        .post("/v1/subscriptions")
        .set("Authorization", auth())
        .send({
          ...subscription,
          consent: { accepted: true, noticeVersion: "job-alerts-v1" },
        })
        .expect(201);
      const stored = (
        await pool.query(
          "SELECT contact_enc,contact_hash FROM subscription WHERE id=$1",
          [created.body.id],
        )
      ).rows[0];
      expect(Buffer.isBuffer(stored.contact_enc)).toBe(true);
      expect(stored.contact_enc.toString()).not.toContain(subscription.contact);
      expect(stored.contact_hash).not.toBe(subscription.contact);
      expect((await run(true).expect(200)).body).toMatchObject({
        matched: 1,
        sent: 0,
      });
      expect(attempts).toHaveLength(0);
      expect(
        Number(
          (await pool.query("SELECT count(*) FROM job_digest")).rows[0].count,
        ),
      ).toBe(0);
      expect((await run().expect(200)).body.sent).toBe(1);
      expect((await run().expect(200)).body.sent).toBe(0);
      const digests = [...accepted.values()].filter(
        (item) => item.kind === "digest",
      );
      expect(digests).toHaveLength(1);
      expect(String(digests[0]?.text)).toContain(posting.title);
      expect(String(digests[0]?.text)).toContain(
        posting.hiringOrganization.name,
      );
      expect(String(digests[0]?.text)).toContain(posting.url);
      await request(app)
        .delete(`/v1/subscriptions/${created.body.id}?sessionId=session-other`)
        .set("Authorization", auth())
        .expect(404);
      await request(app)
        .delete(`/v1/subscriptions/${created.body.id}?sessionId=session-owner`)
        .set("Authorization", auth())
        .expect(200);
      expect(
        (
          await pool.query(
            "SELECT contact_enc,contact_hash,stopped_at FROM subscription WHERE id=$1",
            [created.body.id],
          )
        ).rows[0],
      ).toMatchObject({
        contact_enc: null,
        contact_hash: null,
        stopped_at: expect.any(Date),
      });
      expect((await run().expect(200)).body.sent).toBe(0);
    });
    it("keeps an anonymous exact draft private, requires approval, and retries lost receipts without duplicate sending", async () => {
      const job = (await jobs.listJobs({ lang: "en" }))[0]!;
      const create = {
        action: "draft",
        sessionId: "session-owner",
        clientRequestId: "accommodation-one",
        jobId: job.id,
        lang: "en",
        needs: ["written_questions"],
        interviewAt: "2026-11-20T09:30:00Z",
      };
      const draft = await request(app)
        .post("/v1/accommodation-requests")
        .set("Authorization", auth())
        .send(create)
        .expect(200);
      expect(draft.body.message).toContain(posting.title);
      expect(draft.body.name).toBeUndefined();
      expect(draft.body.sendAttempted).toBe(false);
      expect(draft.body.interviewDisplay).toContain("(");
      expect(draft.headers["cache-control"]).toBe("no-store");
      const input = {
        sessionId: "session-owner",
        id: draft.body.id,
        revision: draft.body.revision,
      };
      await request(app)
        .post("/v1/accommodation-requests")
        .set("Authorization", auth())
        .send({ action: "send", ...input })
        .expect(409);
      expect(
        [...accepted.values()].filter((item) => item.kind === "accommodation"),
      ).toHaveLength(0);
      await request(app)
        .post("/v1/accommodation-requests")
        .set("Authorization", auth())
        .send({ action: "resume", sessionId: "session-other", id: input.id })
        .expect(404);
      const encrypted = (
        await pool.query(
          "SELECT private_enc,needs FROM accommodation_request WHERE id=$1",
          [input.id],
        )
      ).rows[0];
      expect(encrypted.private_enc.toString()).not.toContain(
        draft.body.message,
      );
      expect(encrypted.needs).toEqual([]);
      await request(app)
        .post("/v1/accommodation-requests")
        .set("Authorization", auth())
        .send({ action: "approve", ...input })
        .expect(200);
      loseNextReceipt = true;
      await request(app)
        .post("/v1/accommodation-requests")
        .set("Authorization", auth())
        .send({ action: "send", ...input })
        .expect(503);
      const uncertain = await request(app)
        .post("/v1/accommodation-requests")
        .set("Authorization", auth())
        .send({ action: "resume", sessionId: input.sessionId, id: input.id })
        .expect(200);
      expect(uncertain.body.sendAttempted).toBe(true);
      expect(uncertain.body.message).toBe(draft.body.message);
      await request(app)
        .post("/v1/accommodation-requests")
        .set("Authorization", auth())
        .send({
          ...create,
          otherText: "Changed after send attempt",
          needs: ["other"],
        })
        .expect(409);
      const sent = await request(app)
        .post("/v1/accommodation-requests")
        .set("Authorization", auth())
        .send({ action: "send", ...input })
        .expect(200);
      expect(sent.body.status).toBe("sent");
      expect(sent.body.sendAttempted).toBe(true);
      const delivered = [...accepted.values()].filter(
        (item) => item.kind === "accommodation",
      );
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        to: "employer@example.org",
        message: draft.body.message,
        lang: "en",
      });
      const requestAttempts = attempts.filter(
        (item) => item.kind === "accommodation",
      );
      expect(requestAttempts).toHaveLength(2);
      expect(requestAttempts[0]).toEqual(requestAttempts[1]);
    });
  },
);
