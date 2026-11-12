import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { FrancLanguageDetector } from "@dimts/ai";
import { buildApp } from "../src/app.js";
import type { BuildAppOptions } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { AskRequestSchema } from "../src/schemas.js";

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
    {
      tokenHash: string;
      resumeHash: string;
      lang: string;
      channel: string;
      cloudOk: boolean;
      consentVersion: string | null;
    }
  >();
  const replies = new Map<string, Record<string, unknown>>();
  const claimed = new Set<string>();

  return {
    sessions,
    replies,
    claimed,
    ping: async () => true,
    runRetention: async () => undefined,
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
      cloudOk: boolean;
      consentVersion: string | null;
    }) => {
      sessions.set(session.id, session);
    },
    resumeSession: async (session: {
      id: string;
      currentResumeHash: string;
      tokenHash: string;
      resumeHash: string;
      cloudOk?: boolean;
      consentVersion?: string | null;
    }) => {
      const current = sessions.get(session.id);
      if (!current || current.resumeHash !== session.currentResumeHash)
        return null;
      current.tokenHash = session.tokenHash;
      current.resumeHash = session.resumeHash;
      if (session.cloudOk !== undefined) {
        current.cloudOk = session.cloudOk;
        current.consentVersion = session.cloudOk
          ? (session.consentVersion ?? null)
          : null;
      }
      return {
        id: session.id,
        lang: current.lang,
        cloudOk: current.cloudOk,
        consentVersion: current.consentVersion,
      };
    },
    getCloudConsent: async (id: string) => {
      const current = sessions.get(id);
      return current
        ? {
            cloudOk: current.cloudOk,
            consentVersion: current.consentVersion,
          }
        : null;
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

function createApp(
  repository = createRepository(),
  overrides: BuildAppOptions = {},
) {
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

  it("bounds health when the database or content-version check stalls", async () => {
    const repository = createRepository();
    repository.ping = () => new Promise<boolean>(() => undefined);
    const { app } = createApp(repository, {
      grounding: {
        currentVersion: () => new Promise<string>(() => undefined),
      },
    });
    const startedAt = performance.now();

    const response = await request(app)
      .get("/v1/health")
      .timeout({ response: 1900, deadline: 2000 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      db: false,
      contentVersion: "unavailable",
    });
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });

  it("requires the cron secret for the retention endpoint", async () => {
    const repository = createRepository();
    const runRetention = vi.fn(async () => undefined);
    repository.runRetention = runRetention;
    const { app } = createApp(repository);

    const missingSecret = await request(app).post("/v1/internal/retention");
    const wrongSecret = await request(app)
      .post("/v1/internal/retention")
      .set("authorization", "Bearer wrong-secret");
    const authorized = await request(app)
      .post("/v1/internal/retention")
      .set("authorization", `Bearer ${validEnv.DIMTS_CRON_SECRET}`);

    expect(missingSecret.status).toBe(401);
    expect(wrongSecret.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({ ok: true });
    expect(runRetention).toHaveBeenCalledOnce();
    expect(runRetention).toHaveBeenCalledWith(24);
  });

  it("defaults the optional simple-mode flag to false", () => {
    const body = AskRequestSchema.parse({
      sessionId: "session-000001",
      clientMsgId: "message-000001",
      lang: "en",
      text: "A question",
      via: "text",
    });

    expect(body.simple).toBe(false);
  });

  it("validates the per-question language detection threshold", () => {
    expect(parseConfig(validEnv).DIMTS_LANGUAGE_DETECTION_CONFIDENCE).toBe(
      0.25,
    );
    expect(() =>
      parseConfig({
        ...validEnv,
        DIMTS_LANGUAGE_DETECTION_CONFIDENCE: "1.01",
      }),
    ).toThrow(/DIMTS_LANGUAGE_DETECTION_CONFIDENCE/u);
  });

  it("wires the local detector into the default API ask pipeline", async () => {
    const detected = vi
      .spyOn(FrancLanguageDetector.prototype, "detect")
      .mockResolvedValue({
        language: "en",
        confidence: 0.99,
        alternatives: [],
      });
    const questionText = "How do I make a study plan?";
    const { app } = createApp(createRepository(), {
      grounding: {
        search: async () => [
          {
            id: "study-plan#goals",
            text: "Choose one learning goal.",
            label: "Study plan / Goals",
            url: "https://course.example/study-plan#goals",
            lang: "en",
            sourceType: "course",
            score: 0.9,
          },
        ],
        currentVersion: async () => "version-1",
      },
    });

    try {
      const session = await createSession(app);
      const reply = await request(app)
        .post("/v1/ask")
        .set("authorization", `Bearer ${session.body.sessionToken}`)
        .send({
          sessionId: session.body.sessionId,
          clientMsgId: "language-detect-0001",
          lang: "en",
          text: questionText,
          via: "text",
        });

      expect(reply.status).toBe(200);
      expect(detected).toHaveBeenCalledWith(questionText);
    } finally {
      detected.mockRestore();
    }
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
    expect(response.body.cloudOk).toBe(false);
    expect(response.body.consentVersion).toBeNull();
    expect(repository.sessions.get(response.body.sessionId)).toMatchObject({
      tokenHash: createHash("sha256")
        .update(response.body.sessionToken)
        .digest("hex"),
      resumeHash: createHash("sha256")
        .update(response.body.resumeToken)
        .digest("hex"),
      cloudOk: false,
      consentVersion: null,
    });
  });

  it("persists remote-AI opt-in and permits revoking it when resuming", async () => {
    const { app, repository } = createApp();
    const invalidOptIn = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", "public-host")
      .set("origin", "https://learn.example")
      .send({ lang: "en", cloudOk: true });
    const original = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", "public-host")
      .set("origin", "https://learn.example")
      .send({
        lang: "en",
        cloudOk: true,
        consentVersion: "remote-ai-v1",
      });

    expect(invalidOptIn.status).toBe(400);
    expect(original.status).toBe(201);
    expect(original.body).toMatchObject({
      cloudOk: true,
      consentVersion: "remote-ai-v1",
    });

    const resumed = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", "public-host")
      .set("origin", "https://learn.example")
      .send({
        sessionId: original.body.sessionId,
        resumeToken: original.body.resumeToken,
        cloudOk: false,
      });

    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({
      cloudOk: false,
      consentVersion: null,
    });
    expect(repository.sessions.get(original.body.sessionId)).toMatchObject({
      cloudOk: false,
      consentVersion: null,
    });
  });

  it("uses configured remote providers only for consenting sessions", async () => {
    const config = parseConfig({
      ...validEnv,
      DIMTS_AI_PROVIDER: "remote-test",
      DIMTS_AI_LADDER: "remote-test,offline",
      DIMTS_AI_PROVIDERS: JSON.stringify([
        {
          id: "remote-test",
          adapter: "openai-compatible",
          model: "test-model",
          endpoint: "https://provider.example/v1",
          credentialRef: "REMOTE_TEST_KEY",
          privacyClass: "remote",
          enabled: true,
          priority: 1,
          timeoutMs: 8_000,
          allowedDataClasses: ["question", "course-passage"],
          capabilities: {
            languages: ["en"],
            modes: ["extractive"],
            modalities: ["text"],
            structuredOutput: true,
          },
        },
      ]),
      REMOTE_TEST_KEY: "server-only-provider-key",
    });
    const grounding = {
      search: async () => [
        {
          id: "study-plan#goals",
          text: "Choose one learning goal. Divide it into small weekly steps.",
          label: "Study plan / Goals",
          url: "https://course.example/study-plan#goals",
          lang: "en",
          sourceType: "course" as const,
          score: 0.9,
        },
      ],
      currentVersion: async () => "version-1",
    };
    const { app } = createApp(createRepository(), {
      config,
      providerSecrets: { REMOTE_TEST_KEY: "server-only-provider-key" },
      grounding,
    });
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith("/models")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string }[];
      };
      const userMessage = body.messages.find(
        ({ role }) => role === "user",
      )?.content;
      expect(userMessage).toContain("How do I make a study plan?");
      expect(userMessage).toContain("Choose one learning goal.");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "Choose one learning goal.",
                  usedPassageIds: ["study-plan#goals"],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const anonymous = await createSession(app);
      const firstAnswer = await request(app)
        .post("/v1/ask")
        .set("authorization", `Bearer ${anonymous.body.sessionToken}`)
        .send({
          sessionId: anonymous.body.sessionId,
          clientMsgId: "offline-without-consent",
          lang: "en",
          text: "How do I make a study plan?",
          via: "text",
        });
      expect(firstAnswer.status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();

      const consenting = await request(app)
        .post("/v1/sessions")
        .set("x-dimts-key", "public-host")
        .set("origin", "https://learn.example")
        .send({
          lang: "en",
          cloudOk: true,
          consentVersion: config.DIMTS_AI_CONSENT_VERSION,
        });
      const remoteAnswer = await request(app)
        .post("/v1/ask")
        .set("authorization", `Bearer ${consenting.body.sessionToken}`)
        .send({
          sessionId: consenting.body.sessionId,
          clientMsgId: "remote-with-consent",
          lang: "en",
          text: "How do I make a study plan?",
          via: "text",
        });

      expect(remoteAnswer.status).toBe(200);
      expect(remoteAnswer.body.kind).toBe("answer");
      expect(remoteAnswer.body).not.toHaveProperty("provider");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
        authorization: "Bearer server-only-provider-key",
      });
      const health = await request(app).get("/v1/health");
      expect(health.body.provider).toBe("remote-test");
      expect(JSON.stringify(remoteAnswer.body)).not.toContain(
        "server-only-provider-key",
      );
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("ships the consent migration and exact reply replay columns", async () => {
    const migrations = path.join(root, "packages", "api", "migrations");
    const initial = await readFile(
      path.join(migrations, "001_init.sql"),
      "utf8",
    );
    const auth = await readFile(
      path.join(migrations, "002_auth_replay_cache.sql"),
      "utf8",
    );
    const consent = await readFile(
      path.join(migrations, "004_remote_ai_consent.sql"),
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
    expect(consent).toContain("cloud_ok SET DEFAULT FALSE");
    expect(consent).toContain("consent_version = NULL");
    expect(auth).toContain("CREATE UNIQUE INDEX message_reply_to_idx");
  });

  it("publishes the API contract through the OpenAPI route", async () => {
    const { app } = createApp();
    const response = await request(app).get("/v1/openapi.yaml");
    const docs = await request(app).get("/v1/docs");

    expect(response.status).toBe(200);
    expect(response.text).toContain("openapi: 3.1.0");
    expect(response.text).toContain("/v1/ask:");
    expect(response.text).toContain("/v1/helpers/login:");
    expect(response.text).toContain("/v1/help/{id}/claim:");
    expect(response.text).toContain("/v1/internal/retention:");
    expect(docs.status).toBe(200);
    expect(docs.text).toContain("/v1/openapi.yaml");
  });
});
