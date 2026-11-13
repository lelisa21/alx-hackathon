// FR-SMS-01--12: real PostgreSQL + HTTP boundary, shared tutor and P06 runner.
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AskDependencies } from "@dimts/engine";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { applyMigrations } from "../src/db/migrate.js";
import { SMS_CALLBACK_VERSION } from "../src/sms-runtime.js";
import { sha256 } from "../src/middleware/auth.js";

const url = process.env.DIMTS_TEST_DATABASE_URL;
describe.skipIf(!url)("P07 real SMS API, PostgreSQL and callback host", () => {
  const schema = `p07api_${randomUUID().replaceAll("-", "")}`;
  const secret = "synthetic-sms-inbound-secret-only";
  const cron = "synthetic-cron-secret-long-enough";
  const callbackSecret = "synthetic-callback-secret-long-enough";
  const hashKey = Buffer.alloc(32, 2);
  let pool: pg.Pool;
  let admin: pg.Pool;
  let app: ReturnType<typeof buildApp>;
  let host: Server;
  const callbacks: Record<string, unknown>[] = [];
  let counter = 0;
  const answer = vi.fn(async () => ({
    text: "Choose one learning goal.",
    usedPassageIds: ["goals"],
    provider: "offline",
    latencyMs: 0,
  }));
  const dependencies: AskDependencies = {
    search: async () => [
      {
        id: "goals",
        text: "Choose one learning goal.",
        label: "Goals",
        url: "https://course.example/goals",
        lang: "en",
        sourceType: "course",
        score: 1,
      },
    ],
    answer,
    glossaryFor: () => [],
    systemPrompt: () => "Synthetic grounded fixture",
    modeFor: () => "extractive",
    confidenceFloor: () => 0.35,
    translate: (_lang, key) => key,
    direction: () => "ltr",
    contentVersion: () => "test-v1",
    createId: () => randomUUID(),
  };
  const hash = (phone: string) =>
    createHmac("sha256", hashKey)
      .update(JSON.stringify(["sms", phone]))
      .digest("hex");
  const inbound = (from: string, text: string, id = `api-in-${++counter}`) =>
    request(app)
      .post("/v1/sms/inbound")
      .set("Authorization", `Bearer ${secret}`)
      .send({ id, from, text });
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(url!);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: scoped.toString() });
    const migration = new pg.Client({ connectionString: scoped.toString() });
    await migration.connect();
    try {
      await applyMigrations(migration, resolve("packages/api/migrations"));
    } finally {
      await migration.end();
    }
    host = createServer(async (incoming, response) => {
      expect(incoming.headers.authorization).toBe(`Bearer ${callbackSecret}`);
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as Record<string, unknown>;
      callbacks.push(payload);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          version: SMS_CALLBACK_VERSION,
          accepted: true,
          idempotencyKey: payload.idempotencyKey,
        }),
      );
    });
    await new Promise<void>((done) => host.listen(0, "127.0.0.1", done));
    const address = host.address();
    if (!address || typeof address === "string")
      throw new Error("Missing synthetic host port");
    const config = parseConfig({
      NODE_ENV: "test",
      DATABASE_URL: scoped.toString(),
      DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
      DIMTS_HASH_KEY: hashKey.toString("base64"),
      DIMTS_JWT_SECRET: "synthetic-jwt-secret-long-enough-for-test",
      DIMTS_CRON_SECRET: cron,
      DIMTS_SMS_GATEWAY_SECRET: secret,
      DIMTS_SMS_MODE: "simulator",
      DIMTS_SMS_CALLBACK_URL: "https://host.example/callback",
      DIMTS_SMS_CALLBACK_SECRET: callbackSecret,
    });
    app = buildApp({
      config,
      askDependencies: dependencies,
      smsCallbackTransport: (_input, init) =>
        fetch(`http://127.0.0.1:${address.port}/callback`, init),
    });
    await pool.query(
      "INSERT INTO host_key(id,name,key_hash,key_type) VALUES('sms-host','Synthetic host',$1,'secret')",
      [sha256("synthetic-host-key")],
    );
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
  it("persists language and replays the same tutor answer without duplicate model calls or cloud consent", async () => {
    const phone = "+251900000011";
    const menu = await inbound(phone, "hello").expect(200);
    expect(menu.body.messages[0].text).toContain("1 English");
    await inbound(phone, "1").expect(200);
    const first = await inbound(
      phone,
      "What learning goal can I choose?",
      "same-question",
    ).expect(200);
    expect(first.body.messages[0].text).toContain(
      "https://course.example/goals",
    );
    const replay = await inbound(
      phone,
      "What learning goal can I choose?",
      "same-question",
    ).expect(200);
    expect(replay.body).toEqual(first.body);
    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0]?.[1]).toEqual({ cloudOk: false });
    await inbound(phone, "changed replay", "same-question").expect(409);
    const row = (
      await pool.query(
        "SELECT s.cloud_ok,s.channel,s.lang,c.private_enc FROM session s JOIN sms_conversation c ON c.session_id=s.id WHERE c.phone_hash=$1",
        [hash(phone)],
      )
    ).rows[0];
    expect(row).toMatchObject({ cloud_ok: false, channel: "sms", lang: "en" });
    expect(row.private_enc).toBeInstanceOf(Buffer);
    expect(row.private_enc.toString("utf8")).not.toContain(phone);
  });
  it("exposes a transient callback number only after separate Y and deduplicates host delivery", async () => {
    const phone = "+251900000012";
    await inbound(phone, "hello").expect(200);
    await inbound(phone, "1").expect(200);
    await inbound(phone, "HELP").expect(200);
    expect(callbacks).toHaveLength(0);
    await inbound(phone, "Y", "callback-y").expect(200);
    await inbound(phone, "Y", "callback-y").expect(200);
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toMatchObject({
      from: phone,
      lang: "en",
      version: SMS_CALLBACK_VERSION,
    });
    const consent = (
      await pool.query(
        "SELECT channel,notice_version,purpose FROM consent_log WHERE purpose='callback'",
      )
    ).rows;
    expect(consent).toEqual([
      {
        channel: "sms",
        notice_version: "sms-callback-v1",
        purpose: "callback",
      },
    ]);
    const persisted = JSON.stringify(
      (await pool.query("SELECT * FROM sms_conversation")).rows,
    );
    expect(persisted).not.toContain(phone);
    expect(
      (await pool.query("SELECT count(*) FROM help_request")).rows[0].count,
    ).toBe("0");
  });
  it("caps 20 daily sends and rejects inbound 31 while STOP still succeeds and remains stopped", async () => {
    const phone = "+251900000013";
    for (let index = 0; index < 20; index++)
      await inbound(phone, "LANG").expect(200);
    for (let index = 20; index < 30; index++)
      await inbound(phone, "LANG").expect(429);
    await inbound(phone, "LANG").expect(429);
    expect(
      (
        await pool.query(
          "SELECT outbound_count FROM sms_conversation WHERE phone_hash=$1",
          [hash(phone)],
        )
      ).rows[0].outbound_count,
    ).toBe(20);
    // Isolate the minute cap from the already exhausted daily budget.
    await pool.query(
      "UPDATE sms_conversation SET outbound_count=0 WHERE phone_hash=$1",
      [hash(phone)],
    );
    await inbound(phone, "LANG").expect(429);
    expect(
      (
        await pool.query(
          "SELECT window_count,outbound_count FROM sms_conversation WHERE phone_hash=$1",
          [hash(phone)],
        )
      ).rows[0],
    ).toMatchObject({ window_count: 30, outbound_count: 0 });
    const stopped = await inbound(phone, "STOP").expect(200);
    expect(stopped.body.stopped).toBe(true);
    expect(stopped.body.messages).toHaveLength(1);
    const repeat = await inbound(phone, "hello").expect(200);
    expect(repeat.body).toMatchObject({ stopped: true, messages: [] });
    const row = (
      await pool.query(
        "SELECT session_id,private_enc,stopped_at FROM sms_conversation WHERE phone_hash=$1",
        [hash(phone)],
      )
    ).rows[0];
    expect(row.session_id).toBeNull();
    expect(row.private_enc).toBeNull();
    expect(row.stopped_at).not.toBeNull();
  }, 30000);
  it("creates a consented P06 subscription, sends one real SMS digest through its runner and erases contact on STOP", async () => {
    const phone = "+251900000014";
    for (const text of ["hello", "1", "JOBS", "1", "ALL", "ALL", "1"])
      await inbound(phone, text).expect(200);
    expect(
      (await pool.query("SELECT count(*) FROM subscription")).rows[0].count,
    ).toBe("0");
    await inbound(phone, "Y").expect(200);
    const subscription = (
      await pool.query(
        "SELECT contact_enc,contact_hash,session_id FROM subscription WHERE stopped_at IS NULL",
      )
    ).rows[0];
    expect(subscription.contact_enc).toBeInstanceOf(Buffer);
    expect(subscription.contact_hash).toMatch(/^[a-f0-9]{64}$/u);
    await request(app)
      .post("/v1/jobs/import")
      .set("X-Dimts-Key", "synthetic-host-key")
      .send({
        lang: "en",
        postings: {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          title: "Synthetic trainee",
          description: "Learn useful work skills.",
          datePosted: "2026-11-01",
          validThrough: "2099-12-31",
          url: "https://jobs.example/trainee",
          hiringOrganization: {
            "@type": "Organization",
            name: "Synthetic organization",
          },
          jobLocation: {
            "@type": "Place",
            address: { addressLocality: "Addis" },
          },
        },
      })
      .expect(200);
    const run = () =>
      request(app)
        .post("/v1/internal/alerts")
        .set("Authorization", `Bearer ${cron}`);
    expect((await run().expect(200)).body.sent).toBe(1);
    expect((await run().expect(200)).body.sent).toBe(0);
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM sms_delivery WHERE phone_hash=$1 AND status='delivered'",
            [hash(phone)],
          )
        ).rows[0].count,
      ),
    ).toBeGreaterThan(8);
    await inbound(phone, "STOP").expect(200);
    const rows = (
      await pool.query(
        "SELECT contact_enc,contact_hash FROM subscription WHERE session_id=$1",
        [subscription.session_id],
      )
    ).rows;
    expect(
      rows.every(
        (row) => row.contact_enc === null && row.contact_hash === null,
      ),
    ).toBe(true);
    expect((await run().expect(200)).body.sent).toBe(0);
  }, 30000);
  it("retains only the stopped identity and clears expired encrypted state through the existing retention runner", async () => {
    const phone = "+251900000015";
    await inbound(phone, "hello").expect(200);
    await pool.query(
      "UPDATE sms_conversation SET expires_at=now()-interval '1 second' WHERE phone_hash=$1",
      [hash(phone)],
    );
    await pool.query(
      "UPDATE sms_delivery SET created_at=now()-interval '25 hours' WHERE phone_hash=$1",
      [hash(phone)],
    );
    await request(app)
      .post("/v1/internal/retention")
      .set("Authorization", `Bearer ${cron}`)
      .expect(200);
    expect(
      (
        await pool.query(
          "SELECT private_enc FROM sms_conversation WHERE phone_hash=$1",
          [hash(phone)],
        )
      ).rows[0].private_enc,
    ).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM sms_delivery WHERE phone_hash=$1",
          [hash(phone)],
        )
      ).rows[0].count,
    ).toBe("0");
    const stopped = (
      await pool.query(
        "SELECT stopped_at FROM sms_conversation WHERE phone_hash=$1",
        [hash("+251900000013")],
      )
    ).rows[0];
    expect(stopped.stopped_at).not.toBeNull();
  });
});
