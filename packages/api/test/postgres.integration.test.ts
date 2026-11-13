import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { applyMigrations } from "../src/db/migrate.js";
import { provisionLocalHostKey } from "../src/db/local-bootstrap.js";
import { createPostgresHelpSocketStore } from "../src/db/help-socket-store.js";
import {
  PostgresGrounding,
  replaceContent,
} from "../../grounding/src/repository.js";
import { PostgresSourceSyncStore } from "../../grounding/src/source-store.js";
import { sourceHash, toPassages } from "../../grounding/src/ingest.js";
import {
  processTextDocument,
  synchronizeSource,
  synchronizeSourceChanges,
} from "../../grounding/src/sync.js";
import type {
  ContentSource,
  SourceDocument,
  SourceResource,
} from "../../grounding/src/sync.js";

const databaseUrl = process.env.DIMTS_TEST_DATABASE_URL;
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const localesRoot = path.join(root, "locales");
const migrationsRoot = path.join(root, "packages", "api", "migrations");
const hostId = "api-postgres-integration";
const hostKey = "api-postgres-integration-public-id";
const origin = "http://localhost:5173";
const secrets = [
  Buffer.alloc(32, 1).toString("base64"),
  Buffer.alloc(32, 2).toString("base64"),
  Buffer.alloc(32, 3).toString("base64"),
];

describe.skipIf(!databaseUrl)("PostgreSQL API integration", () => {
  let client: pg.Client;
  let app: ReturnType<typeof buildApp>;
  const sessionIds: string[] = [];
  const helperIds: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("DIMTS_TEST_DATABASE_URL is required.");
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await applyMigrations(client, migrationsRoot);
    await provisionLocalHostKey(client, {
      id: hostId,
      name: "PostgreSQL integration test",
      key: hostKey,
      origins: [origin],
    });
    app = buildApp({
      config: parseConfig({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        DIMTS_ENC_KEY: secrets[0],
        DIMTS_HASH_KEY: secrets[1],
        DIMTS_JWT_SECRET: secrets[2],
        DIMTS_CRON_SECRET: "integration-cron-secret-long-enough",
        DIMTS_HOST_ORIGINS: origin,
        DIMTS_AI_PROVIDER: "offline",
      }),
      localesRoot,
    });
  });

  afterAll(async () => {
    if (app) await app.locals.close();
    if (client) {
      for (const sessionId of sessionIds) {
        await client.query("DELETE FROM session WHERE id = $1", [sessionId]);
      }
      for (const helperId of helperIds) {
        await client.query("DELETE FROM helper WHERE id = $1", [helperId]);
      }
      await client.query("DELETE FROM host_key WHERE id = $1", [hostId]);
      await client.end();
    }
  });

  it("is migration-idempotent and creates a database-backed session", async () => {
    const pending = await applyMigrations(client, migrationsRoot);
    expect(pending).toEqual([]);

    const health = await request(app).get("/v1/health");
    expect(health.status).toBe(200);
    expect(health.body.db).toBe(true);

    const session = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", hostKey)
      .set("origin", origin)
      .send({ lang: "en", channel: "web" });
    expect(session.status).toBe(201);
    expect(session.body.sessionId).toEqual(expect.any(String));
    if (typeof session.body.sessionId !== "string") {
      throw new Error("Session response did not contain a session id.");
    }
    sessionIds.push(session.body.sessionId);

    const stored = await client.query<{ key_hash: string }>(
      "SELECT key_hash FROM host_key WHERE id = $1",
      [hostId],
    );
    expect(stored.rows[0]?.key_hash).toBe(
      createHash("sha256").update(hostKey).digest("hex"),
    );
    expect(stored.rows[0]?.key_hash).not.toBe(hostKey);

    const credentials = await client.query<{
      token_hash: string;
      resume_hash: string;
      cloud_ok: boolean;
      consent_version: string | null;
    }>(
      "SELECT token_hash, resume_hash, cloud_ok, consent_version FROM session WHERE id = $1",
      [session.body.sessionId],
    );
    expect(credentials.rows[0]?.token_hash).toBe(
      createHash("sha256").update(session.body.sessionToken).digest("hex"),
    );
    expect(credentials.rows[0]?.resume_hash).toBe(
      createHash("sha256").update(session.body.resumeToken).digest("hex"),
    );
    expect(credentials.rows[0]?.token_hash).not.toBe(session.body.sessionToken);
    expect(credentials.rows[0]).toMatchObject({
      cloud_ok: false,
      consent_version: null,
    });
  });

  it("atomically lets only one authenticated helper claim a request", async () => {
    const sessionId = `help-session-${randomUUID()}`;
    const requestId = `help-request-${randomUUID()}`;
    const firstHelperId = `helper-${randomUUID()}`;
    const secondHelperId = `helper-${randomUUID()}`;
    const firstToken = randomUUID();
    const secondToken = randomUUID();
    sessionIds.push(sessionId);
    helperIds.push(firstHelperId, secondHelperId);

    await client.query(
      `INSERT INTO session (id, channel, lang) VALUES ($1, 'web', 'en')`,
      [sessionId],
    );
    await client.query(
      `INSERT INTO helper (id, display_name, token_hash, langs)
       VALUES ($1, 'First helper', $2, ARRAY['en']),
              ($3, 'Second helper', $4, ARRAY['en'])`,
      [
        firstHelperId,
        createHash("sha256").update(firstToken).digest("hex"),
        secondHelperId,
        createHash("sha256").update(secondToken).digest("hex"),
      ],
    );
    await client.query(
      `INSERT INTO help_request (id, session_id, lang, channel, status)
       VALUES ($1, $2, 'en', 'web', 'waiting')`,
      [requestId, sessionId],
    );

    const [firstLogin, secondLogin] = await Promise.all([
      request(app).post("/v1/helpers/login").send({ token: firstToken }),
      request(app).post("/v1/helpers/login").send({ token: secondToken }),
    ]);
    expect(firstLogin.status).toBe(200);
    expect(secondLogin.status).toBe(200);

    const claims = await Promise.all([
      request(app)
        .post(`/v1/help/${requestId}/claim`)
        .set("authorization", `Bearer ${firstLogin.body.jwt}`),
      request(app)
        .post(`/v1/help/${requestId}/claim`)
        .set("authorization", `Bearer ${secondLogin.body.jwt}`),
    ]);
    expect(claims.map(({ status }) => status).sort()).toEqual([200, 409]);

    const stored = await client.query<{
      status: string;
      helper_id: string | null;
    }>("SELECT status, helper_id FROM help_request WHERE id = $1", [requestId]);
    expect(stored.rows[0]?.status).toBe("claimed");
    expect([firstHelperId, secondHelperId]).toContain(
      stored.rows[0]?.helper_id,
    );

    const credentialHashes = await client.query<{ token_hash: string }>(
      "SELECT token_hash FROM helper WHERE id = ANY($1::text[]) ORDER BY id",
      [[firstHelperId, secondHelperId]],
    );
    expect(
      credentialHashes.rows.map(({ token_hash }) => token_hash).sort(),
    ).toEqual(
      [
        createHash("sha256").update(firstToken).digest("hex"),
        createHash("sha256").update(secondToken).digest("hex"),
      ].sort(),
    );
  });

  it("persists only confirmed request context and helper-scoped blocking", async () => {
    const sessionId = `help-flow-session-${randomUUID()}`;
    const sessionToken = randomUUID();
    const helperOneId = `help-flow-helper-${randomUUID()}`;
    const helperTwoId = `help-flow-helper-${randomUUID()}`;
    const helperOneToken = randomUUID();
    const helperTwoToken = randomUUID();
    sessionIds.push(sessionId);
    helperIds.push(helperOneId, helperTwoId);

    await client.query(
      `INSERT INTO session (id, channel, lang, token_hash)
       VALUES ($1, 'web', 'en', $2)`,
      [sessionId, createHash("sha256").update(sessionToken).digest("hex")],
    );
    await client.query(
      `INSERT INTO message (id, session_id, client_msg_id, role, text, lang, kind, created_at)
       VALUES ($1, $2, 'question-1', 'learner', 'Question one', 'en', 'question', now() - interval '4 minutes'),
              ($3, $2, 'question-2', 'learner', 'Question two', 'am', 'question', now() - interval '3 minutes'),
              ($4, $2, 'question-3', 'learner', 'Question three', 'am', 'question', now() - interval '2 minutes'),
              ($5, $2, 'question-4', 'learner', 'Question four', 'am', 'question', now() - interval '1 minute')`,
      [randomUUID(), sessionId, randomUUID(), randomUUID(), randomUUID()],
    );
    await client.query(
      `INSERT INTO helper (id, display_name, token_hash, langs)
       VALUES ($1, 'First helper', $2, ARRAY['am']),
              ($3, 'Second helper', $4, ARRAY['am'])`,
      [
        helperOneId,
        createHash("sha256").update(helperOneToken).digest("hex"),
        helperTwoId,
        createHash("sha256").update(helperTwoToken).digest("hex"),
      ],
    );

    const created = await request(app)
      .post("/v1/help")
      .set("authorization", `Bearer ${sessionToken}`)
      .send({ sessionId, includeSummary: true });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: expect.any(String), status: "waiting" });
    const requestId = created.body.id as string;
    const stored = await client.query<{
      lang: string;
      channel: string;
      include_summary: boolean;
      summary: string[] | null;
    }>(
      `SELECT lang, channel, include_summary, summary
       FROM help_request WHERE id = $1`,
      [requestId],
    );
    expect(stored.rows[0]).toEqual({
      lang: "am",
      channel: "web",
      include_summary: true,
      summary: ["Question two", "Question three", "Question four"],
    });

    const [loginOne, loginTwo] = await Promise.all([
      request(app).post("/v1/helpers/login").send({ token: helperOneToken }),
      request(app).post("/v1/helpers/login").send({ token: helperTwoToken }),
    ]);
    expect(loginOne.status).toBe(200);
    expect(loginTwo.status).toBe(200);
    const firstQueue = await request(app)
      .get("/v1/help/queue?lang=am")
      .set("authorization", `Bearer ${loginOne.body.jwt}`);
    expect(firstQueue.status).toBe(200);
    expect(firstQueue.body.requests).toHaveLength(1);
    expect(firstQueue.body.requests[0]).toMatchObject({
      id: requestId,
      lang: "am",
      channel: "web",
      summary: ["Question two", "Question three", "Question four"],
    });

    const blocked = await request(app)
      .post(`/v1/help/${requestId}/block`)
      .set("authorization", `Bearer ${loginOne.body.jwt}`);
    expect(blocked.status).toBe(200);
    expect(
      (
        await request(app)
          .get("/v1/help/queue?lang=am")
          .set("authorization", `Bearer ${loginOne.body.jwt}`)
      ).body.requests,
    ).toEqual([]);
    expect(
      (
        await request(app)
          .get("/v1/help/queue?lang=am")
          .set("authorization", `Bearer ${loginTwo.body.jwt}`)
      ).body.requests.map((entry: { id: string }) => entry.id),
    ).toContain(requestId);
    expect(
      (
        await request(app)
          .post(`/v1/help/${requestId}/claim`)
          .set("authorization", `Bearer ${loginOne.body.jwt}`)
      ).status,
    ).toBe(409);

    const claimed = await request(app)
      .post(`/v1/help/${requestId}/claim`)
      .set("authorization", `Bearer ${loginTwo.body.jwt}`);
    expect(claimed.status).toBe(200);
    const helperClose = await request(app)
      .post(`/v1/help/${requestId}/close`)
      .set("authorization", `Bearer ${loginTwo.body.jwt}`);
    expect(helperClose.status).toBe(204);

    const excluded = await request(app)
      .post("/v1/help")
      .set("authorization", `Bearer ${sessionToken}`)
      .send({ sessionId, includeSummary: false });
    expect(excluded.status).toBe(201);
    const excludedSummary = await client.query<{
      include_summary: boolean;
      summary: string[] | null;
    }>("SELECT include_summary, summary FROM help_request WHERE id = $1", [
      excluded.body.id,
    ]);
    expect(excludedSummary.rows[0]).toEqual({
      include_summary: false,
      summary: null,
    });

    const learnerClose = await request(app)
      .post(`/v1/help/${excluded.body.id}/close`)
      .set("authorization", `Bearer ${sessionToken}`)
      .send({ sessionId });
    expect(learnerClose.status).toBe(204);
  });

  it("enforces five help requests per rolling hour under concurrency", async () => {
    const sessionId = `help-rate-session-${randomUUID()}`;
    const sessionToken = randomUUID();
    sessionIds.push(sessionId);
    await client.query(
      `INSERT INTO session (id, channel, lang, token_hash)
       VALUES ($1, 'web', 'en', $2)`,
      [sessionId, createHash("sha256").update(sessionToken).digest("hex")],
    );

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post("/v1/help")
          .set("authorization", `Bearer ${sessionToken}`)
          .send({ sessionId, includeSummary: false }),
      ),
    );
    expect(attempts.map(({ status }) => status).sort()).toEqual([
      201, 201, 201, 201, 201, 429,
    ]);
    const stored = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM help_request WHERE session_id = $1",
      [sessionId],
    );
    expect(stored.rows[0]?.count).toBe("5");
  });

  it("persists ordered chat and replays only messages after the cursor", async () => {
    if (!databaseUrl) throw new Error("DIMTS_TEST_DATABASE_URL is required.");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = createPostgresHelpSocketStore(pool);
    const sessionId = `socket-session-${randomUUID()}`;
    const requestId = `socket-request-${randomUUID()}`;
    const helperId = `socket-helper-${randomUUID()}`;
    const token = randomUUID();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    sessionIds.push(sessionId);
    helperIds.push(helperId);

    try {
      await client.query(
        `INSERT INTO session (id, channel, lang, token_hash)
         VALUES ($1, 'web', 'en', $2)`,
        [sessionId, tokenHash],
      );
      await client.query(
        `INSERT INTO helper (id, display_name, token_hash, langs)
         VALUES ($1, 'Socket helper', $2, ARRAY['en'])`,
        [helperId, createHash("sha256").update(randomUUID()).digest("hex")],
      );
      await client.query(
        `INSERT INTO help_request (id, session_id, lang, channel, status)
         VALUES ($1, $2, 'en', 'web', 'waiting')`,
        [requestId, sessionId],
      );

      expect(
        await store.authenticateLearner(requestId, sessionId, tokenHash),
      ).toBe(true);
      expect(
        await store.authenticateLearner(requestId, sessionId, "wrong-hash"),
      ).toBe(false);
      expect(await store.isHelperActive(helperId)).toBe(true);
      expect(await store.isHelperClaimed(requestId, helperId)).toBe(false);

      await client.query(
        `UPDATE help_request
         SET status = 'claimed', helper_id = $2
         WHERE id = $1`,
        [requestId, helperId],
      );
      expect(await store.isHelperClaimed(requestId, helperId)).toBe(true);

      expect(
        await store.persistMessage(
          requestId,
          "learner",
          "socket-message-1",
          "First message",
        ),
      ).toBe("stored");
      expect(
        await store.persistMessage(
          requestId,
          "learner",
          "socket-message-1",
          "First message",
        ),
      ).toBe("duplicate");
      expect(
        await store.persistMessage(
          requestId,
          "learner",
          "socket-message-1",
          "Changed duplicate",
        ),
      ).toBe("rejected");
      expect(
        await store.persistMessage(
          requestId,
          "helper",
          "socket-message-2",
          "Second message",
        ),
      ).toBe("stored");
      expect(
        await store.listMessagesAfter(requestId, "socket-message-1"),
      ).toEqual([
        {
          id: "socket-message-2",
          sender: "helper",
          text: "Second message",
        },
      ]);

      await client.query(
        "UPDATE help_request SET status = 'closed' WHERE id = $1",
        [requestId],
      );
      expect(
        await store.persistMessage(
          requestId,
          "learner",
          "socket-message-3",
          "After closure",
        ),
      ).toBe("rejected");
      await client.query("UPDATE helper SET active = FALSE WHERE id = $1", [
        helperId,
      ]);
      expect(await store.isHelperActive(helperId)).toBe(false);
    } finally {
      await pool.end();
    }
  });

  it("persists remote-AI consent and its revocation", async () => {
    const created = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", hostKey)
      .set("origin", origin)
      .send({
        lang: "en",
        cloudOk: true,
        consentVersion: "remote-ai-v1",
      });
    expect(created.status).toBe(201);
    sessionIds.push(created.body.sessionId);

    const optedIn = await client.query<{
      cloud_ok: boolean;
      consent_version: string | null;
    }>("SELECT cloud_ok, consent_version FROM session WHERE id = $1", [
      created.body.sessionId,
    ]);
    expect(optedIn.rows[0]).toEqual({
      cloud_ok: true,
      consent_version: "remote-ai-v1",
    });

    const resumed = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", hostKey)
      .set("origin", origin)
      .send({
        sessionId: created.body.sessionId,
        resumeToken: created.body.resumeToken,
        cloudOk: false,
      });
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({
      cloudOk: false,
      consentVersion: null,
    });

    const revoked = await client.query<{
      cloud_ok: boolean;
      consent_version: string | null;
    }>("SELECT cloud_ok, consent_version FROM session WHERE id = $1", [
      created.body.sessionId,
    ]);
    expect(revoked.rows[0]).toEqual({
      cloud_ok: false,
      consent_version: null,
    });
  });

  it("replays database-backed replies and enforces the persisted session limit", async () => {
    const session = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", hostKey)
      .set("origin", origin)
      .send({ lang: "en", channel: "web" });
    expect(session.status).toBe(201);
    sessionIds.push(session.body.sessionId);

    const body = {
      sessionId: session.body.sessionId as string,
      clientMsgId: "postgres-replay-message-1",
      lang: "en",
      text: "A question with no indexed answer",
      via: "text",
    };
    const ask = () =>
      request(app)
        .post("/v1/ask")
        .set("authorization", `Bearer ${session.body.sessionToken}`)
        .send(body);
    const first = await ask();
    const replay = await ask();

    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    await client.query(
      `INSERT INTO message (id, session_id, client_msg_id, role, text, lang, kind)
       SELECT gen_random_uuid()::text, $1, 'seeded-limit-' || n::text,
              'learner', 'test question', 'en', 'question'
       FROM generate_series(1, 19) AS n`,
      [body.sessionId],
    );
    const limited = await request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send({ ...body, clientMsgId: "postgres-replay-message-2" });
    expect(limited.status).toBe(429);

    const messageCounts = await client.query<{
      learner_count: string;
      reply_count: string;
    }>(
      `SELECT count(*) FILTER (WHERE role = 'learner')::text AS learner_count,
              count(*) FILTER (WHERE role = 'dimts')::text AS reply_count
       FROM message WHERE session_id = $1`,
      [body.sessionId],
    );
    expect(messageCounts.rows[0]).toEqual({
      learner_count: "20",
      reply_count: "1",
    });
  });

  it("retains active sessions while expiring old learner and help data", async () => {
    const expiredSessionId = `expired-${randomUUID()}`;
    const activeSessionId = `active-${randomUUID()}`;
    const expiredHelpId = `expired-help-${randomUUID()}`;
    const activeHelpId = `active-help-${randomUUID()}`;
    const stoppedSubscriptionId = randomUUID();
    const expiredAnswerKey = randomUUID();
    sessionIds.push(activeSessionId);

    await client.query(
      `INSERT INTO session (id, channel, lang, last_seen_at)
       VALUES ($1, 'web', 'en', now() - interval '25 hours'),
              ($2, 'web', 'en', now())`,
      [expiredSessionId, activeSessionId],
    );
    await client.query(
      `INSERT INTO message (id, session_id, role, text, lang, kind)
       VALUES ($1, $2, 'learner', 'expired question', 'en', 'question')`,
      [randomUUID(), expiredSessionId],
    );
    await client.query(
      `INSERT INTO help_request (id, session_id, lang, channel, status)
       VALUES ($1, $2, 'en', 'web', 'waiting'),
              ($3, $4, 'en', 'web', 'waiting')`,
      [expiredHelpId, expiredSessionId, activeHelpId, activeSessionId],
    );
    await client.query(
      `INSERT INTO help_message (id, help_request_id, sender, text)
       VALUES ($1, $2, 'learner', 'expired help message')`,
      [randomUUID(), expiredHelpId],
    );
    await client.query(
      `INSERT INTO help_image (id, help_request_id, mime, data, created_at)
       VALUES ($1, $2, 'image/png', $3, now()),
              ($4, $5, 'image/png', $3, now() - interval '3 hours')`,
      [
        randomUUID(),
        expiredHelpId,
        Buffer.from([1]),
        randomUUID(),
        activeHelpId,
      ],
    );
    await client.query(
      `INSERT INTO subscription (id, channel, contact_enc, lang, stopped_at)
       VALUES ($1, 'sms', $2, 'en', now())`,
      [stoppedSubscriptionId, Buffer.from([1])],
    );
    await client.query(
      `INSERT INTO answer_cache (cache_key, reply, created_at)
       VALUES ($1, '{}'::jsonb, now() - interval '25 hours')`,
      [expiredAnswerKey],
    );

    const response = await request(app)
      .post("/v1/internal/retention")
      .set("authorization", "Bearer integration-cron-secret-long-enough");

    expect(response.status).toBe(200);
    const retainedSessions = await client.query<{ id: string }>(
      "SELECT id FROM session WHERE id = ANY($1::text[]) ORDER BY id",
      [[expiredSessionId, activeSessionId]],
    );
    expect(retainedSessions.rows.map(({ id }) => id)).toEqual([
      activeSessionId,
    ]);
    const remainingHelp = await client.query<{
      help_count: string;
      message_count: string;
      image_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM help_request WHERE id = $1) AS help_count,
         (SELECT count(*)::text FROM help_message WHERE help_request_id = $2) AS message_count,
         (SELECT count(*)::text FROM help_image WHERE help_request_id = $3) AS image_count`,
      [expiredHelpId, expiredHelpId, activeHelpId],
    );
    expect(remainingHelp.rows[0]).toEqual({
      help_count: "0",
      message_count: "0",
      image_count: "0",
    });
    const stoppedSubscriptions = await client.query(
      "SELECT id FROM subscription WHERE id = $1",
      [stoppedSubscriptionId],
    );
    expect(stoppedSubscriptions.rowCount).toBe(0);
    const expiredAnswers = await client.query(
      "SELECT cache_key FROM answer_cache WHERE cache_key = $1",
      [expiredAnswerKey],
    );
    expect(expiredAnswers.rowCount).toBe(0);
  });

  it("uses newly ingested course content for subsequent cited answers", async () => {
    const databasePool = new pg.Pool({ connectionString: databaseUrl });
    const firstContent =
      "# Dynamic lesson\n\n## Course policy\n\nThe course policy is bronze.";
    const nextContent =
      "# Dynamic lesson\n\n## Course policy\n\nThe course policy is silver.";
    try {
      const firstPassages = toPassages({
        lessonId: "dynamic-course-policy",
        content: firstContent,
        format: "markdown",
        baseUrl: "https://course.example/lessons/",
        lang: "en",
      });
      await replaceContent(
        databasePool,
        firstPassages,
        sourceHash([
          { name: "dynamic-course-policy.md", content: firstContent },
        ]),
      );

      const session = await request(app)
        .post("/v1/sessions")
        .set("x-dimts-key", hostKey)
        .set("origin", origin)
        .send({ lang: "en", channel: "web" });
      expect(session.status).toBe(201);
      if (
        typeof session.body.sessionId !== "string" ||
        typeof session.body.sessionToken !== "string"
      ) {
        throw new Error(
          "Session response did not contain session credentials.",
        );
      }
      sessionIds.push(session.body.sessionId);

      const ask = (clientMsgId: string) =>
        request(app)
          .post("/v1/ask")
          .set("authorization", `Bearer ${session.body.sessionToken}`)
          .send({
            sessionId: session.body.sessionId,
            clientMsgId,
            lang: "en",
            via: "text",
            text: "What is the course policy?",
          });
      const firstReply = await ask("dynamic-policy-question-1");
      expect(firstReply.status, JSON.stringify(firstReply.body)).toBe(200);
      expect(firstReply.body.kind).toBe("answer");
      expect(firstReply.body.text).toContain("bronze");
      expect(firstReply.body.citations[0]?.url).toBe(
        "https://course.example/lessons/dynamic-course-policy#course-policy",
      );

      const nextPassages = toPassages({
        lessonId: "dynamic-course-policy",
        content: nextContent,
        format: "markdown",
        baseUrl: "https://course.example/lessons/",
        lang: "en",
      });
      await replaceContent(
        databasePool,
        nextPassages,
        sourceHash([
          { name: "dynamic-course-policy.md", content: nextContent },
        ]),
      );

      const nextReply = await ask("dynamic-policy-question-2");
      expect(nextReply.status).toBe(200);
      expect(nextReply.body.kind).toBe("answer");
      expect(nextReply.body.text).toContain("silver");
      expect(nextReply.body.contentVersion).not.toBe(
        firstReply.body.contentVersion,
      );
    } finally {
      await databasePool.end();
    }
  });

  it("atomically publishes source generations and preserves the last good index", async () => {
    const databasePool = new pg.Pool({ connectionString: databaseUrl });
    const sourceId = `integration-${randomUUID()}`;
    const first = {
      sourceId,
      resourceId: "archive-policy",
      revision: "revision-1",
      canonicalUrl: "https://course.example/archive-policy",
      language: "en",
      mediaType: "text/markdown",
    } satisfies SourceResource;
    const second = {
      ...first,
      resourceId: "course-room",
    } satisfies SourceResource;
    const documents = new Map<string, SourceDocument>([
      [
        first.resourceId,
        {
          ...first,
          body: "# Archive policy\n\n## Key\n\nThe archive key is amber.",
        },
      ],
      [
        second.resourceId,
        {
          ...second,
          body: "# Course room\n\n## Access\n\nThe course room is accessible.",
        },
      ],
    ]);
    const failed = new Set<string>();
    const sourceAdapter: ContentSource = {
      id: sourceId,
      auth: { authorize: async () => undefined },
      list: async () => ({
        resources: [...documents.values()],
        snapshotRevision: "snapshot-1",
      }),
      fetch: async (resourceId) => {
        if (failed.has(resourceId)) throw new Error("source unavailable");
        return documents.get(resourceId) ?? null;
      },
    };
    const store = new PostgresSourceSyncStore(databasePool);
    const grounding = new PostgresGrounding(databasePool);

    try {
      await synchronizeSource(
        sourceAdapter,
        store,
        processTextDocument,
        new AbortController().signal,
      );
      const initial = await grounding.search(
        "What color is the archive key?",
        "en",
      );
      expect(initial[0]?.text).toContain("amber");
      const initialRevision = await databasePool.query<{ revision: string }>(
        `SELECT resource.revision
         FROM active_source_generation AS active
         JOIN source_resource_revision AS resource
           ON resource.generation_id = active.generation_id
         WHERE active.source_id = $1 AND resource.resource_id = $2`,
        [sourceId, first.resourceId],
      );
      expect(initialRevision.rows[0]?.revision).toBe("revision-1");

      const updated = {
        ...first,
        revision: "revision-2",
      };
      documents.set(updated.resourceId, {
        ...updated,
        body: "# Archive policy\n\n## Key\n\nThe archive key is violet.",
      });
      documents.delete(second.resourceId);
      await synchronizeSourceChanges(
        sourceAdapter,
        store,
        [
          {
            resourceId: updated.resourceId,
            revision: updated.revision,
            operation: "upsert",
          },
          {
            resourceId: second.resourceId,
            revision: "revision-2",
            operation: "delete",
          },
        ],
        processTextDocument,
        new AbortController().signal,
        "change-cursor-1",
      );
      expect(await store.getCursor(sourceId)).toBe("change-cursor-1");
      const updatedRevision = await databasePool.query<{
        revision: string;
      }>(
        `SELECT resource.revision
         FROM active_source_generation AS active
         JOIN source_resource_revision AS resource
           ON resource.generation_id = active.generation_id
         WHERE active.source_id = $1 AND resource.resource_id = $2`,
        [sourceId, first.resourceId],
      );
      expect(updatedRevision.rows[0]?.revision).toBe("revision-2");

      const current = await grounding.search(
        "What color is the archive key?",
        "en",
      );
      expect(current[0]?.text).toContain("violet");
      expect(current.some(({ text }) => text.includes("amber"))).toBe(false);

      failed.add(updated.resourceId);
      await expect(
        synchronizeSource(
          sourceAdapter,
          store,
          processTextDocument,
          new AbortController().signal,
        ),
      ).rejects.toThrow("source unavailable");
      const afterFailure = await grounding.search(
        "What color is the archive key?",
        "en",
      );
      expect(afterFailure[0]?.text).toContain("violet");
    } finally {
      await databasePool.query(
        "DELETE FROM active_source_generation WHERE source_id = $1",
        [sourceId],
      );
      await databasePool.query(
        "DELETE FROM source_generation WHERE source_id = $1",
        [sourceId],
      );
      await databasePool.end();
    }
  });
});
