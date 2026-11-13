import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { sha256 } from "../src/middleware/auth.js";
import { errorHandler } from "../src/middleware/problem.js";
import { createHelpRouter } from "../src/routes/help.js";
import type { HelpStore } from "../src/types.js";
import sharp from "sharp";

const sessionId = "session-12345678";
const token = "valid-session-token-000000000000";
const env = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://localhost/dimts",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "test-secret-longer-than-thirty-two-characters",
  DIMTS_CRON_SECRET: "test-cron-secret-longer-than-twenty-four",
};
const png = await sharp({
  create: { width: 2, height: 2, channels: 3, background: "red" },
})
  .png()
  .toBuffer();
function fixture(extra: Record<string, string> = {}) {
  let displayName: string | null = null;
  const store: HelpStore = {
    findActiveHelperByTokenHash: async () => ({ id: "helper-one" }),
    isHelperActive: async () => true,
    claimWaitingRequest: vi.fn(async () => true),
    createRequest: async () => ({ id: "help-one", status: "waiting" }),
    listWaitingRequests: async () => [],
    blockWaitingRequest: async () => true,
    closeRequest: vi.fn(async () => true),
    authorizeRequest: async (id, actor, claimedOnly) =>
      id === "help-one" &&
      (!claimedOnly || extra.claimed !== "false") &&
      (actor.role === "helper" || actor.sessionId === sessionId),
    getHelperProfile: async () => ({ displayName }),
    setHelperProfile: async (_id, name) => {
      displayName = name;
      return { displayName };
    },
    getMetrics: async () => ({
      closedCount: 3,
      resolvedCount: 1,
      unresolvedCount: 1,
      totalWaitMs: 4000,
      totalResolutionMs: 9000,
    }),
    saveImage: vi.fn(async () => ({
      id: "picture-one",
      expiresAt: "2026-11-13T12:00:00.000Z",
    })),
    listImages: async () => [
      { id: "picture-one", expiresAt: "2026-11-13T12:00:00.000Z" },
    ],
    getImage: async (_requestId, id) =>
      id === "picture-one" ? { mime: "image/png", data: png } : null,
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/v1",
    createHelpRouter({
      config: parseConfig({ ...env, ...extra }),
      store,
      now: () => new Date("2026-11-13T10:00:00.000Z"),
      repository: {
        getSessionTokenHash: async (id) =>
          id === sessionId ? sha256(token) : null,
        touchSession: async () => {},
      },
    }),
  );
  app.use(errorHandler);
  return { app, store };
}
async function helper(app: express.Express) {
  const login = await request(app)
    .post("/v1/helpers/login")
    .send({ token: "helper-token-long-enough-for-login" });
  return `Bearer ${login.body.jwt}`;
}
describe("P05 FR-HELP-04/05/11/12/15/16/18 REST contracts", () => {
  it("authenticates availability and reports next UTC opening plus configured wait", async () => {
    const { app, store } = fixture({
      DIMTS_HELPER_HOURS: '[{"day":1,"start":"09:00","end":"17:00"}]',
      DIMTS_HELP_WAIT_TIMEOUT_MS: "120000",
    });
    expect(
      (await request(app).get(`/v1/help/availability?sessionId=${sessionId}`))
        .status,
    ).toBe(401);
    const result = await request(app)
      .get(`/v1/help/availability?sessionId=${sessionId}`)
      .set("authorization", `Bearer ${token}`);
    expect(result.body).toEqual({
      available: false,
      nextOpenAt: "2026-11-16T09:00:00.000Z",
      waitTimeoutMs: 120000,
    });
    expect(
      (
        await request(app)
          .post("/v1/help/help-one/claim")
          .set("authorization", await helper(app))
      ).status,
    ).toBe(409);
    expect(store.claimWaitingRequest).not.toHaveBeenCalled();
    expect(
      (
        await request(app)
          .post("/v1/help")
          .set("authorization", `Bearer ${token}`)
          .send({ sessionId, includeSummary: false })
      ).status,
    ).toBe(201);
  });
  it("returns STUN only with no key, only to participants of a claimed request", async () => {
    const { app } = fixture();
    const ice = await request(app)
      .post("/v1/help/help-one/ice")
      .set("authorization", `Bearer ${token}`)
      .send({ sessionId });
    expect(ice.status).toBe(200);
    expect(ice.body).toEqual({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    expect(ice.headers["cache-control"]).toBe("no-store");
    expect(
      (
        await request(app)
          .post("/v1/help/other/ice")
          .set("authorization", await helper(app))
          .send({})
      ).status,
    ).toBe(404);
    expect(
      (
        await request(fixture({ claimed: "false" }).app)
          .post("/v1/help/help-one/ice")
          .set("authorization", `Bearer ${token}`)
          .send({ sessionId })
      ).status,
    ).toBe(404);
  });
  it("requires actual image content, type and byte limit before persistence", async () => {
    const { app, store } = fixture();
    for (const [mime, body] of [
      ["image/png", Buffer.from("not a png")],
      ["image/svg+xml", Buffer.from("<svg/>")],
      ["image/jpeg", png],
    ] as const) {
      const invalid = await request(app)
        .post(`/v1/help/help-one/image?sessionId=${sessionId}`)
        .set("authorization", `Bearer ${token}`)
        .set("content-type", mime)
        .send(body);
      expect(invalid.status).toBe(400);
    }
    const large = await request(app)
      .post(`/v1/help/help-one/image?sessionId=${sessionId}`)
      .set("authorization", `Bearer ${token}`)
      .set("content-type", "image/png")
      .send(Buffer.alloc(2097153));
    expect(large.status).toBe(413);
    expect(store.saveImage).not.toHaveBeenCalled();
  });
  it("stores a selected decoded image and exposes authorized private list/retrieval", async () => {
    const { app } = fixture();
    const saved = await request(app)
      .post(`/v1/help/help-one/image?sessionId=${sessionId}`)
      .set("authorization", `Bearer ${token}`)
      .set("content-type", "image/png")
      .send(png);
    expect(saved.status).toBe(201);
    expect(Object.keys(saved.body).sort()).toEqual(["expiresAt", "id"]);
    const auth = await helper(app);
    const listed = await request(app)
      .get("/v1/help/help-one/image")
      .set("authorization", auth);
    expect(listed.body.images).toEqual([saved.body]);
    const fetched = await request(app)
      .get("/v1/help/help-one/image/picture-one")
      .set("authorization", auth);
    expect(fetched.status).toBe(200);
    expect(fetched.headers["cache-control"]).toBe("no-store");
    expect(fetched.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      (
        await request(app)
          .get("/v1/help/other/image/picture-one")
          .set("authorization", auth)
      ).status,
    ).toBe(404);
  });
  it("makes helper name explicit opt-in, validates it, and keeps metrics content-free", async () => {
    const { app, store } = fixture();
    const auth = await helper(app);
    expect(
      (await request(app).get("/v1/helpers/profile").set("authorization", auth))
        .body,
    ).toEqual({ displayName: null });
    expect(
      (
        await request(app)
          .patch("/v1/helpers/profile")
          .set("authorization", auth)
          .send({ displayName: "  Ada  " })
      ).body,
    ).toEqual({ displayName: "Ada" });
    expect(
      (
        await request(app)
          .patch("/v1/helpers/profile")
          .set("authorization", auth)
          .send({ displayName: "" })
      ).status,
    ).toBe(400);
    expect((await request(app).get("/v1/help/metrics")).status).toBe(401);
    const metrics = await request(app)
      .get("/v1/help/metrics")
      .set("authorization", auth);
    expect(metrics.body).toEqual({
      closedCount: 3,
      resolvedCount: 1,
      unresolvedCount: 1,
      totalWaitMs: 4000,
      totalResolutionMs: 9000,
    });
    expect(
      (
        await request(app)
          .post("/v1/help/help-one/close")
          .set("authorization", auth)
          .send({ resolved: true })
      ).status,
    ).toBe(204);
    expect(store.closeRequest).toHaveBeenCalledWith(
      "help-one",
      { role: "helper", helperId: "helper-one" },
      true,
    );
  });
});
