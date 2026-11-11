import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const localesRoot = path.join(root, "locales");
const secrets = [
  Buffer.alloc(32, 1).toString("base64"),
  Buffer.alloc(32, 2).toString("base64"),
  Buffer.alloc(32, 3).toString("base64"),
];

const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: secrets[0],
  DIMTS_HASH_KEY: secrets[1],
  DIMTS_JWT_SECRET: secrets[2],
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
  DIMTS_HOST_ORIGINS: "https://learn.example, https://demo.example",
};

function createRepository() {
  const sessions = new Map<
    string,
    { tokenHash: string; resumeHash: string; lang: string; channel: string }
  >();
  const replies = new Map<string, Record<string, unknown>>();
  const claimed = new Set<string>();

  return {
    sessions,
    replies,
    claimed,
    ping: async () => true,
    getHostByHash: async (hash: string) =>
      hash === createHash("sha256").update("public-host").digest("hex")
        ? { origins: ["https://learn.example"] }
        : null,
    createSession: async (session: {
      id: string;
      tokenHash: string;
      resumeHash: string;
      lang: string;
      channel: string;
    }) => {
      sessions.set(session.id, session);
    },
    resumeSession: async (session: {
      id: string;
      currentResumeHash: string;
      tokenHash: string;
      resumeHash: string;
    }) => {
      const current = sessions.get(session.id);
      if (!current || current.resumeHash !== session.currentResumeHash)
        return null;
      current.tokenHash = session.tokenHash;
      current.resumeHash = session.resumeHash;
      return { id: session.id, lang: current.lang };
    },
    getSessionTokenHash: async (id: string) =>
      sessions.get(id)?.tokenHash ?? null,
    touchSession: async () => undefined,
    findReply: async (sessionId: string, clientMsgId: string) =>
      replies.get(`${sessionId}:${clientMsgId}`) ?? null,
    countRecentQuestions: async () => 0,
    claimQuestion: async (question: {
      sessionId: string;
      clientMsgId: string;
      text: string;
      lang: string;
    }) => {
      const key = `${question.sessionId}:${question.clientMsgId}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    saveReply: async (reply: {
      sessionId: string;
      clientMsgId: string;
      reply: Record<string, unknown>;
    }) => {
      replies.set(`${reply.sessionId}:${reply.clientMsgId}`, reply.reply);
    },
    releaseQuestion: async (sessionId: string, clientMsgId: string) => {
      claimed.delete(`${sessionId}:${clientMsgId}`);
    },
  };
}

function createApp(repository = createRepository(), overrides = {}) {
  return {
    app: buildApp({
      config: parseConfig(validEnv),
      repository,
      localesRoot,
      ...overrides,
    }),
    repository,
  };
}

async function createSession(app: ReturnType<typeof buildApp>) {
  return request(app)
    .post("/v1/sessions")
    .set("x-dimts-key", "public-host")
    .set("origin", "https://learn.example")
    .send({ lang: "en", channel: "web" });
}

describe("WP02 configuration and API contracts", () => {
  it("defaults to offline answers and exposes provider ladder status", async () => {
    const { app } = createApp();
    const response = await request(app).get("/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.provider).toBe("offline");
    expect(response.body.providerStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "offline",
          available: true,
          active: true,
        }),
      ]),
    );
    expect(response.body.providerStates).not.toContainEqual(
      expect.objectContaining({ name: "cloud" }),
    );
    const config = parseConfig(validEnv);
    expect(config).toMatchObject({
      DIMTS_AI_PROVIDER: "offline",
      DIMTS_AI_MAX_TOKENS: 400,
      DIMTS_AI_TEMPERATURE: 0.1,
    });
  });

  it("requires a model when a cloud endpoint is configured", () => {
    expect(() =>
      parseConfig({
        ...validEnv,
        DIMTS_CLOUD_API_URL: "https://provider.example/v1",
      }),
    ).toThrow(/DIMTS_CLOUD_MODEL/u);
  });

  it("fails fast for missing, weak, or reused secrets", () => {
    expect(() =>
      parseConfig({ ...validEnv, DIMTS_HASH_KEY: undefined }),
    ).toThrow(/DIMTS_HASH_KEY/u);
    expect(() =>
      parseConfig({
        ...validEnv,
        DIMTS_ENC_KEY: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow(/32 random bytes/u);
    expect(() =>
      parseConfig({ ...validEnv, DIMTS_HASH_KEY: secrets[0] }),
    ).toThrow(/different/u);
  });

  it("answers health even when the database is unavailable", async () => {
    const repository = createRepository();
    repository.ping = async () => {
      throw new Error("database offline");
    };
    const { app } = createApp(repository);

    const response = await request(app).get("/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, db: false });
  });

  it("lists only live and beta packs unless preview is requested", async () => {
    const { app } = createApp();
    const normal = await request(app).get("/v1/languages");
    const preview = await request(app).get("/v1/languages?lang_preview=1");
    const invalidQuery = await request(app).get("/v1/languages?unexpected=1");

    expect(normal.status).toBe(200);
    expect(
      normal.body.languages.map((language: { code: string }) => language.code),
    ).toEqual(["en"]);
    expect(
      preview.body.languages.map((language: { code: string }) => language.code),
    ).toEqual(["am", "ar-test", "en", "om"]);
    expect(invalidQuery.status).toBe(400);
  });

  it("serves locale UI with a stable ETag and honors conditional requests", async () => {
    const { app } = createApp();
    const first = await request(app).get("/v1/locales/en/ui");
    const cached = await request(app)
      .get("/v1/locales/en/ui")
      .set("if-none-match", first.headers.etag);
    const draft = await request(app).get("/v1/locales/ar-test/ui");

    expect(first.status).toBe(200);
    expect(first.headers.etag).toBeTruthy();
    expect(first.body["welcome.title"]).toBeTruthy();
    expect(cached.status).toBe(304);
    expect(draft.status).toBe(404);
  });

  it("creates pseudonymous sessions with one-time random tokens", async () => {
    const { app, repository } = createApp();
    const response = await createSession(app);

    expect(response.status).toBe(201);
    expect(response.body.sessionId).toHaveLength(22);
    expect(response.body.sessionToken).toHaveLength(43);
    expect(response.body.resumeToken).toHaveLength(43);
    expect(repository.sessions.get(response.body.sessionId)).toMatchObject({
      tokenHash: createHash("sha256")
        .update(response.body.sessionToken)
        .digest("hex"),
      resumeHash: createHash("sha256")
        .update(response.body.resumeToken)
        .digest("hex"),
    });
  });

  it("resumes a session by rotating the bearer and resume tokens", async () => {
    const { app, repository } = createApp();
    const original = await createSession(app);
    const resumed = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", "public-host")
      .set("origin", "https://learn.example")
      .send({
        sessionId: original.body.sessionId,
        resumeToken: original.body.resumeToken,
      });

    expect(resumed.status).toBe(200);
    expect(resumed.body.sessionId).toBe(original.body.sessionId);
    expect(resumed.body.sessionToken).not.toBe(original.body.sessionToken);
    expect(repository.sessions.get(original.body.sessionId)?.tokenHash).toBe(
      createHash("sha256").update(resumed.body.sessionToken).digest("hex"),
    );
  });

  it("rejects unknown origins and invalid session input", async () => {
    const { app } = createApp();
    const blockedOrigin = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", "public-host")
      .set("origin", "https://attacker.example")
      .send({ lang: "en" });
    const extraField = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", "public-host")
      .set("origin", "https://learn.example")
      .send({ lang: "en", name: "not allowed" });

    expect(blockedOrigin.status).toBe(403);
    expect(extraField.status).toBe(400);
    expect(extraField.headers["content-type"]).toMatch(
      /application\/problem\+json/u,
    );
    const invalidJson = await request(app)
      .post("/v1/sessions")
      .set("content-type", "application/json")
      .send('{"broken":');
    expect(invalidJson.status).toBe(400);
  });

  it("requires a bearer session token and rejects unknown ask fields", async () => {
    const { app } = createApp();
    const session = await createSession(app);
    const body = {
      sessionId: session.body.sessionId,
      clientMsgId: "message-000001",
      lang: "en",
      text: "hello",
      via: "text",
    };

    const unauthenticated = await request(app).post("/v1/ask").send(body);
    const unknownField = await request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send({ ...body, extra: true });

    expect(unauthenticated.status).toBe(401);
    expect(unknownField.status).toBe(400);
  });

  it("returns 413 when question text exceeds the contract limit", async () => {
    const { app } = createApp();
    const session = await createSession(app);
    const response = await request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send({
        sessionId: session.body.sessionId,
        clientMsgId: "message-too-long",
        lang: "en",
        text: "x".repeat(1001),
        via: "text",
      });

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      code: "payload_too_large",
      messageKey: "error.too_long",
    });
  });

  it("does not accept draft languages for learner replies", async () => {
    const { app } = createApp();
    const session = await createSession(app);
    const response = await request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send({
        sessionId: session.body.sessionId,
        clientMsgId: "message-draft-lang",
        lang: "om",
        text: "A question",
        via: "text",
      });

    expect(response.status).toBe(400);
  });

  it("returns schema-shaped notfound replies for questions and templates for small talk", async () => {
    const { app } = createApp();
    const session = await createSession(app);
    const auth = `Bearer ${session.body.sessionToken}`;
    const base = {
      sessionId: session.body.sessionId,
      lang: "en",
      via: "text",
    };

    const question = await request(app)
      .post("/v1/ask")
      .set("authorization", auth)
      .send({
        ...base,
        clientMsgId: "message-000002",
        text: "How do I learn?",
      });
    const greeting = await request(app)
      .post("/v1/ask")
      .set("authorization", auth)
      .send({ ...base, clientMsgId: "message-000003", text: "hello" });

    expect(question.status).toBe(200);
    expect(question.body).toMatchObject({
      kind: "notfound",
      text: expect.any(String),
      lang: "en",
      dir: "ltr",
      citations: [],
      actions: [{ type: "help" }],
      contentVersion: expect.any(String),
    });
    expect(greeting.status).toBe(200);
    expect(greeting.body.kind).toBe("system");
    expect(greeting.body.text).toBeTruthy();
    const thanks = await request(app)
      .post("/v1/ask")
      .set("authorization", auth)
      .send({ ...base, clientMsgId: "message-000004", text: "Thanks!" });
    expect(thanks.body.kind).toBe("system");
  });

  it("replays the exact reply for a repeated client message id", async () => {
    const { app, repository } = createApp();
    const session = await createSession(app);
    const body = {
      sessionId: session.body.sessionId,
      clientMsgId: "message-replay-1",
      lang: "en",
      text: "A question",
      via: "text",
    };
    const first = await request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send(body);
    const retry = await request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send(body);

    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(repository.claimed.size).toBe(1);
  });

  it("returns conflict to a concurrent duplicate and replays after retry", async () => {
    const repository = createRepository();
    let releaseSave: () => void = () => undefined;
    let enterSave: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const saveEntered = new Promise<void>((resolve) => {
      enterSave = resolve;
    });
    const save = repository.saveReply;
    let blocked = false;
    repository.saveReply = async (reply) => {
      if (!blocked) {
        blocked = true;
        enterSave();
        await saveGate;
      }
      await save(reply);
    };
    const { app } = createApp(repository);
    const session = await createSession(app);
    const body = {
      sessionId: session.body.sessionId,
      clientMsgId: "message-parallel-1",
      lang: "en",
      text: "A question",
      via: "text",
    };
    const firstRequest = request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send(body);
    const firstResponse = firstRequest.then((response) => response);
    await saveEntered;
    const duplicate = await request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send(body);
    releaseSave();
    const first = await firstResponse;
    const retry = await request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send(body);

    expect(duplicate.status).toBe(409);
    expect(retry.body).toEqual(first.body);
  });

  it("applies the restart-safe 20-per-minute session limit", async () => {
    const repository = createRepository();
    repository.countRecentQuestions = async () => 20;
    const { app } = createApp(repository);
    const session = await createSession(app);
    const response = await request(app)
      .post("/v1/ask")
      .set("authorization", `Bearer ${session.body.sessionToken}`)
      .send({
        sessionId: session.body.sessionId,
        clientMsgId: "message-limited-1",
        lang: "en",
        text: "hello",
        via: "text",
      });

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({
      code: "rate_limited",
      messageKey: "limit.reached",
    });
  });

  it("limits asks to 200 per hour per IP", async () => {
    const repository = createRepository();
    const token = "T".repeat(43);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { app } = createApp(repository);
    const asks = Array.from({ length: 201 }, (_, index) => {
      const sessionId = `session-${String(index).padStart(4, "0")}`;
      repository.sessions.set(sessionId, {
        tokenHash,
        resumeHash: "",
        lang: "en",
        channel: "web",
      });
      return request(app)
        .post("/v1/ask")
        .set("authorization", `Bearer ${token}`)
        .send({
          sessionId,
          clientMsgId: `message-${String(index).padStart(4, "0")}`,
          lang: "en",
          text: "A question",
          via: "text",
        });
    });
    const responses = await Promise.all(asks);

    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(1);
    expect(responses.at(-1)?.body.code).toBe("rate_limited");
  });

  it("ships both versioned SQL migrations and exact reply replay columns", async () => {
    const migrations = path.join(root, "packages", "api", "migrations");
    const initial = await readFile(
      path.join(migrations, "001_init.sql"),
      "utf8",
    );
    const auth = await readFile(
      path.join(migrations, "002_auth_replay_cache.sql"),
      "utf8",
    );

    expect(initial).toContain("CREATE TABLE session");
    expect(initial).toContain("CREATE TABLE message");
    expect(initial).not.toMatch(/phone|telegram_id|learner_name/iu);
    expect(initial).toContain("text_norm TEXT NOT NULL");
    expect(initial).toContain("grams TEXT[] NOT NULL");
    expect(initial).toMatch(
      /CREATE INDEX passage_grams_gin\s+ON passage USING GIN \(grams\)/iu,
    );
    expect(auth).toContain("token_hash");
    expect(auth).toContain("reply_to");
    expect(auth).toContain("CREATE UNIQUE INDEX message_reply_to_idx");
  });

  it("publishes the API contract through the OpenAPI route", async () => {
    const { app } = createApp();
    const response = await request(app).get("/v1/openapi.yaml");
    const docs = await request(app).get("/v1/docs");

    expect(response.status).toBe(200);
    expect(response.text).toContain("openapi: 3.1.0");
    expect(response.text).toContain("/v1/ask:");
    expect(docs.status).toBe(200);
    expect(docs.text).toContain("/v1/openapi.yaml");
  });
});
