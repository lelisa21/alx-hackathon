import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { sha256 } from "../src/middleware/auth.js";
import { createHelpRouter } from "../src/routes/help.js";

const secrets = [
  Buffer.alloc(32, 1).toString("base64"),
  Buffer.alloc(32, 2).toString("base64"),
  Buffer.alloc(32, 3).toString("base64"),
];

const config = parseConfig({
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: secrets[0],
  DIMTS_HASH_KEY: secrets[1],
  DIMTS_JWT_SECRET: secrets[2],
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
});

const learnerSessionId = "session-12345678";
const learnerToken = "valid-session-token-000000000000";
const helperToken = "valid-helper-token-000000000000";

function createApp(
  options: {
    rateLimited?: boolean;
    onClosed?: (requestId: string) => Promise<void> | void;
  } = {},
) {
  const calls = {
    createRequest: [] as { sessionId: string; includeSummary: boolean }[],
    listWaitingRequests: [] as { helperId: string; lang?: string }[],
    blockWaitingRequest: [] as { requestId: string; helperId: string }[],
    closeRequest: [] as {
      requestId: string;
      actor:
        | { role: "learner"; sessionId: string }
        | { role: "helper"; helperId: string };
    }[],
  };
  const store = {
    findActiveHelperByTokenHash: async (hash: string) =>
      hash === sha256(helperToken) ? { id: "helper-one" } : null,
    isHelperActive: async (id: string) => id === "helper-one",
    claimWaitingRequest: async () => true,
    createRequest: async (sessionId: string, includeSummary: boolean) => {
      calls.createRequest.push({ sessionId, includeSummary });
      return options.rateLimited
        ? null
        : { id: "help-request-123", status: "waiting" as const };
    },
    listWaitingRequests: async (helperId: string, lang?: string) => {
      calls.listWaitingRequests.push({ helperId, ...(lang ? { lang } : {}) });
      return [
        {
          id: "help-request-123",
          lang: "en",
          channel: "web",
          createdAt: "2026-11-12T06:00:00.000Z",
          summary: ["How do I plan my study?"],
        },
      ];
    },
    blockWaitingRequest: async (requestId: string, helperId: string) => {
      calls.blockWaitingRequest.push({ requestId, helperId });
      return true;
    },
    closeRequest: async (
      requestId: string,
      actor: (typeof calls.closeRequest)[number]["actor"],
    ) => {
      calls.closeRequest.push({ requestId, actor });
      return true;
    },
  };
  const repository = {
    getSessionTokenHash: async (sessionId: string) =>
      sessionId === learnerSessionId ? sha256(learnerToken) : null,
    touchSession: async () => {},
  };
  const app = express();
  app.use(express.json());
  const routerOptions = {
    config,
    store,
    repository,
    ...(options.onClosed ? { onClosed: options.onClosed } : {}),
  };
  app.use("/v1", createHelpRouter(routerOptions));
  return { app, calls };
}

async function loginHelper(app: express.Express): Promise<string> {
  const response = await request(app)
    .post("/v1/helpers/login")
    .send({ token: helperToken });
  expect(response.status).toBe(200);
  return response.body.jwt as string;
}

describe("WP07 MVP help flow", () => {
  it("creates a waiting request only for an authenticated session", async () => {
    const { app, calls } = createApp();
    const response = await request(app)
      .post("/v1/help")
      .set("authorization", `Bearer ${learnerToken}`)
      .send({ sessionId: learnerSessionId, includeSummary: true });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: "help-request-123",
      status: "waiting",
    });
    expect(calls.createRequest).toEqual([
      { sessionId: learnerSessionId, includeSummary: true },
    ]);

    const unauthorized = await request(app)
      .post("/v1/help")
      .send({ sessionId: learnerSessionId, includeSummary: true });
    expect(unauthorized.status).toBe(401);
  });

  it("rejects extra create fields and enforces the five-per-hour limit", async () => {
    const { app } = createApp();
    const headers = { authorization: `Bearer ${learnerToken}` };
    const invalid = await request(app)
      .post("/v1/help")
      .set(headers)
      .send({
        sessionId: learnerSessionId,
        includeSummary: true,
        questions: ["must not be supplied by the client"],
      });
    expect(invalid.status).toBe(400);

    const limited = await request(createApp({ rateLimited: true }).app)
      .post("/v1/help")
      .set(headers)
      .send({ sessionId: learnerSessionId, includeSummary: false });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("rate_limited");
  });

  it("returns only waiting requests matching the helper language filter", async () => {
    const { app, calls } = createApp();
    const jwt = await loginHelper(app);
    const response = await request(app)
      .get("/v1/help/queue?lang=en")
      .set("authorization", `Bearer ${jwt}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      requests: [
        {
          id: "help-request-123",
          lang: "en",
          channel: "web",
          createdAt: "2026-11-12T06:00:00.000Z",
          summary: ["How do I plan my study?"],
        },
      ],
    });
    expect(calls.listWaitingRequests).toEqual([
      { helperId: "helper-one", lang: "en" },
    ]);
  });

  it("blocks a request only for the authenticated helper", async () => {
    const { app, calls } = createApp();
    const jwt = await loginHelper(app);
    const response = await request(app)
      .post("/v1/help/help-request-123/block")
      .set("authorization", `Bearer ${jwt}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(calls.blockWaitingRequest).toEqual([
      { requestId: "help-request-123", helperId: "helper-one" },
    ]);
  });

  it("allows the learner and claimed helper to end the request", async () => {
    const closedRequests: string[] = [];
    const { app, calls } = createApp({
      onClosed: (requestId) => closedRequests.push(requestId),
    });
    const learnerClose = await request(app)
      .post("/v1/help/help-request-123/close")
      .set("authorization", `Bearer ${learnerToken}`)
      .send({ sessionId: learnerSessionId });
    expect(learnerClose.status).toBe(204);

    const jwt = await loginHelper(app);
    const helperClose = await request(app)
      .post("/v1/help/help-request-123/close")
      .set("authorization", `Bearer ${jwt}`);
    expect(helperClose.status).toBe(204);
    expect(calls.closeRequest).toEqual([
      {
        requestId: "help-request-123",
        actor: { role: "learner", sessionId: learnerSessionId },
      },
      {
        requestId: "help-request-123",
        actor: { role: "helper", helperId: "helper-one" },
      },
    ]);
    expect(closedRequests).toEqual(["help-request-123", "help-request-123"]);
  });
});
