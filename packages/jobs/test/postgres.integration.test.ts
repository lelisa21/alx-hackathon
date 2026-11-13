import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../../api/src/db/migrate.js";
import { JobsService, type JobsDelivery } from "../src/index.js";
import {
  PostgresGrounding,
  replaceContent,
  toPassages,
} from "../../grounding/src/index.js";

const url = process.env.DIMTS_TEST_DATABASE_URL;
const schema = `jobs_${randomUUID().replaceAll("-", "")}`;
const posting = {
  "@type": "JobPosting",
  title: "Accessible developer",
  description: "Build accessible software for everyone.",
  datePosted: "2026-11-01",
  validThrough: "2026-12-31",
  hiringOrganization: {
    name: "Example",
    contactPoint: { email: "jobs@example.org" },
  },
  jobLocation: { address: { addressRegion: "Addis Ababa" } },
  url: "https://example.org/jobs/1",
  employmentType: "FULL_TIME",
  accommodationsOffered: ["written_questions"],
};

describe.skipIf(!url)("P06 durable jobs gateway", () => {
  let pool: pg.Pool;
  let service: JobsService;
  let now = new Date("2026-11-13T12:00:00Z");
  const delivery: JobsDelivery = {
    channels: ["sms", "telegram"],
    relayAvailable: true,
    sendDigest: vi.fn(async () => {}),
    sendAccommodation: vi.fn(async () => {}),
  };
  const session = "jobs-session";
  let jobId: string;
  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
      max: 6,
    });
    const client = await pool.connect();
    try {
      await applyMigrations(client, resolve("packages/api/migrations"));
    } finally {
      client.release();
    }
    await pool.query(
      "INSERT INTO session(id,channel,lang) VALUES($1,'web','en'),('other-session','web','en')",
      [session],
    );
    service = new JobsService({
      pool,
      encryptionKey: Buffer.alloc(32, 1),
      hashKey: Buffer.alloc(32, 2),
      delivery,
      now: () => now,
      renderDigest: ({ lang, jobs }) =>
        `${lang}: ${jobs.map((job) => [job.title, job.organization, job.deadline, job.url].join(" ")).join("\n")}`,
      renderAccommodation: ({ needs, name, interviewAt }) =>
        ["Interview support", ...needs, name ?? "", interviewAt ?? ""]
          .filter(Boolean)
          .join("\n"),
    });
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  });
  it("P07 STOP revokes every consented subscription for one transient channel contact", async () => {
    const originalConsentIds = (
      await pool.query<{ id: string }>("SELECT id FROM consent_log")
    ).rows.map((row) => row.id);
    const contact = "+251911223344";
    const first = await service.subscribe({
      sessionId: session,
      clientRequestId: "sms-stop-a",
      channel: "sms",
      contact,
      lang: "en",
      consent: { accepted: true, noticeVersion: "job-alerts-v1" },
    });
    const second = await service.subscribe({
      sessionId: "other-session",
      clientRequestId: "sms-stop-b",
      channel: "sms",
      contact,
      lang: "om",
      consent: { accepted: true, noticeVersion: "job-alerts-v1" },
    });
    await service.stopContact({ channel: "sms", contact });
    const rows = await pool.query(
      "SELECT contact_enc,contact_hash,stopped_at FROM subscription WHERE id=ANY($1::text[])",
      [[first.id, second.id]],
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.contact_enc).toBeNull();
      expect(row.contact_hash).toBeNull();
      expect(row.stopped_at).not.toBeNull();
    }
    await pool.query("DELETE FROM subscription WHERE id=ANY($1::text[])", [
      [first.id, second.id],
    ]);
    await pool.query("DELETE FROM consent_log WHERE NOT(id=ANY($1::text[]))", [
      originalConsentIds,
    ]);
  });
  it("imports valid items atomically without replacing existing course/source generations; filters and grounded citations work", async () => {
    await replaceContent(
      pool,
      toPassages({
        lessonId: "course",
        format: "markdown",
        baseUrl: "https://example.org/course",
        lang: "en",
        content: "# Course\n\nCourse foundations.",
      }),
      "a".repeat(64),
    );
    const course = await pool.query(
      "SELECT generation_id FROM active_source_generation WHERE source_id='legacy'",
    );
    const result = await service.importJobs({
      lang: "en",
      postings: { "@graph": [posting, { ...posting, title: "" }] },
    });
    expect(result).toEqual({
      imported: 1,
      errors: [{ index: 1, reason: "invalid_job_posting" }],
    });
    const jobs = await service.listJobs({
      region: "Addis Ababa",
      type: "FULL_TIME",
      lang: "en",
    });
    jobId = jobs[0]!.id;
    expect(jobs).toHaveLength(1);
    expect(JSON.stringify(jobs)).not.toContain("jobs@example.org");
    expect(await service.listJobs({ region: "Elsewhere" })).toEqual([]);
    await service.importJobs({
      lang: "am",
      postings: { ...posting, title: "ሥራ" },
    });
    await service.importJobs({
      lang: "en",
      postings: {
        ...posting,
        description: "Updated accessible software role.",
      },
    });
    expect((await service.listJobs({ lang: "en" }))[0]?.id).toBe(jobId);
    expect(
      (
        await pool.query(
          "SELECT generation_id FROM active_source_generation WHERE source_id='legacy'",
        )
      ).rows,
    ).toEqual(course.rows);
    const hits = await new PostgresGrounding(pool).search(
      "accessible developer",
      "en",
      [],
      ["job"],
    );
    expect(hits[0]).toMatchObject({
      sourceType: "job",
      url: posting.url,
      lang: "en",
    });
    expect(await service.listJobs({ lang: "am" })).toHaveLength(1);
    const versions = await pool.query("SELECT count(*) FROM content_version");
    await pool.query(
      "ALTER TABLE job ADD CONSTRAINT reject_import CHECK(title <> 'Rollback')",
    );
    await expect(
      service.importJobs({
        lang: "en",
        postings: { ...posting, title: "Rollback" },
      }),
    ).rejects.toThrow();
    expect(
      (await pool.query("SELECT count(*) FROM content_version")).rows,
    ).toEqual(versions.rows);
    expect((await service.listJobs({ lang: "en" }))[0]?.title).toBe(
      posting.title,
    );
  });
  it("requires consent, encrypts contacts, atomically deduplicates subscriptions and records minimal consent metadata", async () => {
    const input = {
      sessionId: session,
      clientRequestId: "sub-1",
      channel: "sms" as const,
      contact: "+251900000001",
      lang: "en",
      region: "Addis Ababa",
      jobType: "FULL_TIME",
      consent: {
        accepted: true as const,
        noticeVersion: "job-alerts-v1" as const,
      },
    };
    await expect(
      service.subscribe({
        ...input,
        consent: { ...input.consent, accepted: false as true },
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    const [first, second] = await Promise.all([
      service.subscribe(input),
      service.subscribe(input),
    ]);
    expect(first.id).toBe(second.id);
    const stored = (
      await pool.query("SELECT * FROM subscription WHERE id=$1", [first.id])
    ).rows[0];
    expect(stored.contact_enc.includes(Buffer.from(input.contact))).toBe(false);
    expect(stored.contact_hash).toMatch(/^[a-f0-9]{64}$/u);
    const consent = (
      await pool.query("SELECT * FROM consent_log WHERE purpose='job_alerts'")
    ).rows;
    expect(consent).toHaveLength(1);
    expect(JSON.stringify(consent)).not.toContain(input.contact);
  });
  it("dry run is read-only; concurrent daily runners send once; stop wipes contact immediately and rejects other sessions", async () => {
    expect(await service.runAlerts({ dryRun: true })).toMatchObject({
      matched: 1,
      sent: 0,
    });
    expect(delivery.sendDigest).not.toHaveBeenCalled();
    expect(
      (await pool.query("SELECT count(*) FROM job_digest")).rows[0].count,
    ).toBe("0");
    const results = await Promise.all([
      service.runAlerts({ dryRun: false }),
      service.runAlerts({ dryRun: false }),
    ]);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(delivery.sendDigest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(delivery.sendDigest).mock.calls[0]![0]).toMatchObject({
      lang: "en",
      contact: "+251900000001",
    });
    await service.importJobs({
      lang: "en",
      postings: { ...posting, url: "https://example.org/jobs/2" },
    });
    expect(await service.runAlerts({ dryRun: false })).toMatchObject({
      sent: 0,
    });
    const sub = (await service.listSubscriptions({ sessionId: session }))[0]!;
    expect(
      await service.stopSubscription({
        sessionId: "other-session",
        id: sub.id,
      }),
    ).toBe(false);
    expect(
      await service.stopSubscription({ sessionId: session, id: sub.id }),
    ).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT contact_enc,contact_hash FROM subscription WHERE id=$1",
          [sub.id],
        )
      ).rows[0],
    ).toEqual({ contact_enc: null, contact_hash: null });
    now = new Date("2026-11-14T12:00:00Z");
    expect(await service.runAlerts({ dryRun: false })).toMatchObject({
      sent: 0,
    });
  });
  it("keeps drafts encrypted, requires exact revision approval, retries exact approved text without duplicate send and supports cancellation", async () => {
    const draft = await service.accommodation({
      action: "draft",
      sessionId: session,
      clientRequestId: "request-1",
      jobId,
      lang: "en",
      needs: ["written_questions"],
      name: "Optional learner",
      interviewAt: "2026-11-20T10:00:00Z",
    });
    expect(draft.sendAttempted).toBe(false);
    const stored = (
      await pool.query("SELECT * FROM accommodation_request WHERE id=$1", [
        draft.id,
      ])
    ).rows[0];
    expect(stored.needs).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain("Optional learner");
    await expect(
      service.accommodation({
        action: "send",
        sessionId: session,
        id: draft.id,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.accommodation({
        action: "resume",
        sessionId: "other-session",
        id: draft.id,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      await service.accommodation({
        action: "resume",
        sessionId: session,
        id: draft.id,
      }),
    ).toEqual(draft);
    const revised = await service.accommodation({
      action: "draft",
      sessionId: session,
      clientRequestId: "request-1",
      jobId,
      lang: "en",
      needs: ["extra_time"],
    });
    expect(revised.revision).toBe(2);
    await expect(
      service.accommodation({
        action: "approve",
        sessionId: session,
        id: draft.id,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await service.accommodation({
      action: "approve",
      sessionId: session,
      id: draft.id,
      revision: 2,
    });
    await expect(
      service.accommodation({
        action: "draft",
        sessionId: session,
        clientRequestId: "request-1",
        jobId,
        lang: "en",
        needs: ["extra_time"],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    vi.mocked(delivery.sendAccommodation).mockRejectedValueOnce(
      new Error("offline"),
    );
    await expect(
      service.accommodation({
        action: "send",
        sessionId: session,
        id: draft.id,
        revision: 2,
      }),
    ).rejects.toMatchObject({ code: "delivery_failed" });
    await expect(
      service.accommodation({
        action: "cancel",
        sessionId: session,
        id: draft.id,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.accommodation({
        action: "draft",
        sessionId: session,
        clientRequestId: "replacement",
        jobId,
        lang: "en",
        needs: ["extra_time"],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const sent = await service.accommodation({
      action: "send",
      sessionId: session,
      id: draft.id,
      revision: 2,
    });
    expect(sent.status).toBe("sent");
    expect(sent.sendAttempted).toBe(true);
    await service.accommodation({
      action: "send",
      sessionId: session,
      id: draft.id,
      revision: 2,
    });
    const calls = vi.mocked(delivery.sendAccommodation).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toEqual(calls[1]![0]);
    expect(calls[1]![0]).toMatchObject({
      to: "jobs@example.org",
      message: revised.message,
    });
    expect(revised.message).not.toContain("Optional learner");
  });
  it("retries an uncertain digest after midnight with the same key and checks the daily budget", async () => {
    const sub = await service.subscribe({
      sessionId: session,
      clientRequestId: "retry-sub",
      channel: "sms",
      contact: "+251900000002",
      lang: "en",
      consent: { accepted: true, noticeVersion: "job-alerts-v1" },
    });
    vi.mocked(delivery.sendDigest).mockRejectedValueOnce(
      new Error("acknowledgement lost"),
    );
    expect(await service.runAlerts({ dryRun: false })).toMatchObject({
      sent: 0,
      failed: 1,
    });
    const first = vi.mocked(delivery.sendDigest).mock.calls.at(-1)![0];
    await service.importJobs({
      lang: "en",
      postings: { ...posting, title: "Changed after an uncertain delivery" },
    });
    now = new Date("2026-11-15T12:00:00Z");
    expect(await service.runAlerts({ dryRun: false })).toMatchObject({
      sent: 1,
    });
    const second = vi.mocked(delivery.sendDigest).mock.calls.at(-1)![0];
    expect(second).toEqual(first);
    expect(await service.runAlerts({ dryRun: false })).toMatchObject({
      sent: 0,
    });
    await service.stopSubscription({ sessionId: session, id: sub.id });
  });
  it("serializes Stop with an in-flight delivery, wipes within ten seconds, and never sends afterward", async () => {
    const sub = await service.subscribe({
      sessionId: session,
      clientRequestId: "stop-race",
      channel: "sms",
      contact: "+251900000003",
      lang: "en",
      consent: { accepted: true, noticeVersion: "job-alerts-v1" },
    });
    let entered!: () => void;
    let release!: () => void;
    const entering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releasing = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(delivery.sendDigest).mockImplementationOnce(async () => {
      entered();
      await releasing;
    });
    const running = service.runAlerts({ dryRun: false });
    await entering;
    const started = Date.now();
    let stopped = false;
    const stopping = service
      .stopSubscription({ sessionId: session, id: sub.id })
      .then((result) => {
        stopped = result;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);
    release();
    await running;
    expect(await stopping).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(
      (
        await pool.query(
          "SELECT contact_enc,contact_hash FROM subscription WHERE id=$1",
          [sub.id],
        )
      ).rows[0],
    ).toEqual({ contact_enc: null, contact_hash: null });
    now = new Date("2026-11-16T12:00:00Z");
    expect(await service.runAlerts({ dryRun: false })).toMatchObject({
      sent: 0,
    });
  });
  it("preserves prepared digest and accommodation identities when SQL fails after transport accepts", async () => {
    const sub = await service.subscribe({
      sessionId: session,
      clientRequestId: "commit-failure",
      channel: "sms",
      contact: "+251900000004",
      lang: "en",
      consent: { accepted: true, noticeVersion: "job-alerts-v1" },
    });
    await pool.query(
      "CREATE FUNCTION reject_digest_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='sent' THEN RAISE EXCEPTION 'simulated receipt persistence failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_digest_receipt BEFORE UPDATE ON job_digest FOR EACH ROW EXECUTE FUNCTION reject_digest_receipt()",
    );
    try {
      await expect(service.runAlerts({ dryRun: false })).rejects.toThrow();
    } finally {
      await pool.query(
        "DROP TRIGGER reject_digest_receipt ON job_digest; DROP FUNCTION reject_digest_receipt()",
      );
    }
    const first = vi.mocked(delivery.sendDigest).mock.calls.at(-1)![0];
    expect(
      (
        await pool.query(
          "SELECT status FROM job_digest WHERE subscription_id=$1",
          [sub.id],
        )
      ).rows,
    ).toEqual([{ status: "pending" }]);
    await service.importJobs({
      lang: "en",
      postings: { ...posting, title: "Changed after SQL failure" },
    });
    now = new Date("2026-11-17T12:00:00Z");
    expect(await service.runAlerts({ dryRun: false })).toMatchObject({
      sent: 1,
    });
    expect(vi.mocked(delivery.sendDigest).mock.calls.at(-1)![0]).toEqual(first);
    await service.stopSubscription({ sessionId: session, id: sub.id });
    const request = await service.accommodation({
      action: "draft",
      sessionId: "other-session",
      clientRequestId: "receipt-failure",
      jobId,
      lang: "en",
      needs: ["written_questions"],
    });
    await service.accommodation({
      action: "approve",
      sessionId: "other-session",
      id: request.id,
      revision: request.revision,
    });
    await pool.query(
      "CREATE FUNCTION reject_request_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='sent' THEN RAISE EXCEPTION 'simulated receipt persistence failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_request_receipt BEFORE UPDATE ON accommodation_request FOR EACH ROW EXECUTE FUNCTION reject_request_receipt()",
    );
    try {
      await expect(
        service.accommodation({
          action: "send",
          sessionId: "other-session",
          id: request.id,
          revision: request.revision,
        }),
      ).rejects.toThrow();
    } finally {
      await pool.query(
        "DROP TRIGGER reject_request_receipt ON accommodation_request; DROP FUNCTION reject_request_receipt()",
      );
    }
    expect(
      (
        await pool.query(
          "SELECT delivery_attempted FROM accommodation_request WHERE id=$1",
          [request.id],
        )
      ).rows[0].delivery_attempted,
    ).toBe(true);
    await expect(
      service.accommodation({
        action: "cancel",
        sessionId: "other-session",
        id: request.id,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await service.accommodation({
      action: "send",
      sessionId: "other-session",
      id: request.id,
      revision: request.revision,
    });
    expect(vi.mocked(delivery.sendAccommodation).mock.calls.at(-1)![0]).toEqual(
      vi.mocked(delivery.sendAccommodation).mock.calls.at(-2)![0],
    );
  });
  it("cancels private drafts, refuses jobs without an employer contact, and cascades session deletion", async () => {
    const request = await service.accommodation({
      action: "draft",
      sessionId: "other-session",
      clientRequestId: "cancel-me",
      jobId,
      lang: "en",
      needs: ["other"],
      otherText: "Quiet interview room",
    });
    await service.accommodation({
      action: "cancel",
      sessionId: "other-session",
      id: request.id,
    });
    expect(
      (
        await pool.query(
          "SELECT private_enc,needs FROM accommodation_request WHERE id=$1",
          [request.id],
        )
      ).rows[0],
    ).toEqual({ private_enc: null, needs: [] });
    await expect(
      service.accommodation({
        action: "approve",
        sessionId: "other-session",
        id: request.id,
        revision: request.revision,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await service.importJobs({
      lang: "en",
      postings: {
        ...posting,
        url: "https://example.org/no-contact",
        hiringOrganization: { name: "Example" },
      },
    });
    const missing = (await service.listJobs({ lang: "en" })).find((job) =>
      job.url.endsWith("no-contact"),
    )!;
    await expect(
      service.accommodation({
        action: "draft",
        sessionId: session,
        clientRequestId: "missing-contact",
        jobId: missing.id,
        lang: "en",
        needs: ["extra_time"],
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    await service.subscribe({
      sessionId: "other-session",
      clientRequestId: "cascade",
      channel: "telegram",
      contact: "23456",
      lang: "en",
      consent: { accepted: true, noticeVersion: "job-alerts-v1" },
    });
    await pool.query("DELETE FROM session WHERE id='other-session'");
    expect(
      await service.listSubscriptions({ sessionId: "other-session" }),
    ).toEqual([]);
    expect(
      await service.listAccommodationRequests({ sessionId: "other-session" }),
    ).toEqual([]);
    const columns = (
      await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('subscription','accommodation_request','consent_log')",
        [schema],
      )
    ).rows.map((row) => row.column_name);
    expect(columns).not.toContain("diagnosis");
    expect(columns).not.toContain("disability");
    expect(columns).not.toContain("medical_proof");
  });
  it("expires consent, enforces secret import keys, deletes all linked contacts and private requests", async () => {
    await pool.query(
      "INSERT INTO host_key(id,name,key_hash,origins,key_type) VALUES('public','Public test','public','{}','public'),('secret','Secret test','secret','{}','secret')",
    );
    expect(await service.authorizeImporter("public")).toBe(false);
    expect(await service.authorizeImporter("secret")).toBe(true);
    await service.subscribe({
      sessionId: session,
      clientRequestId: "expired",
      channel: "telegram",
      contact: "12345",
      lang: "am",
      consent: { accepted: true, noticeVersion: "job-alerts-v1" },
    });
    now = new Date("2027-01-20T12:00:00Z");
    expect(
      await service.listAccommodationRequests({ sessionId: session }),
    ).toEqual([]);
    const expiredRequest = (
      await pool.query(
        "SELECT id,revision FROM accommodation_request WHERE session_id=$1 LIMIT 1",
        [session],
      )
    ).rows[0];
    await expect(
      service.accommodation({
        action: "resume",
        sessionId: session,
        id: expiredRequest.id,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.accommodation({
        action: "draft",
        sessionId: session,
        clientRequestId: "past-interview",
        jobId,
        lang: "en",
        needs: ["extra_time"],
        interviewAt: "2026-01-01T10:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await service.runAlerts({ dryRun: false })).toMatchObject({
      sent: 0,
    });
    await service.cleanupExpired();
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM subscription WHERE contact_enc IS NOT NULL",
        )
      ).rows[0].count,
    ).toBe("0");
    await service.deleteData({ sessionId: session });
    expect(await service.listSubscriptions({ sessionId: session })).toEqual([]);
    expect(
      await service.listAccommodationRequests({ sessionId: session }),
    ).toEqual([]);
  });
});
