import { createHash } from "node:crypto";
import type { ApiRepository } from "../src/types.js";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";

const signingKey = Buffer.alloc(32, 3).toString("base64");
const config = parseConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: signingKey,
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
  DIMTS_HOST_ORIGINS: "https://learn.example",
});
const sessionId = "session-to-delete";
const sessionToken = "session-token-with-at-least-20-chars";

function createRepository(deleteSessionData = vi.fn(async () => undefined)) {
  let sessionExists = true;
  const repository: ApiRepository = {
    ping: async () => true,
    runRetention: async () => undefined,
    deleteSessionData: async (id) => {
      await deleteSessionData(id);
      sessionExists = false;
    },
    getHostByHash: async () => null,
    verifyHostKey: async () => null,
    createSession: async () => undefined,
    resumeSession: async () => null,
    getCloudConsent: async () => null,
    getSessionTokenHash: async (id) =>
      sessionExists && id === sessionId
        ? createHash("sha256").update(sessionToken).digest("hex")
        : null,
    touchSession: async () => undefined,
    findReply: async () => null,
    countRecentQuestions: async () => 0,
    claimQuestion: async () => true,
    saveReply: async () => undefined,
    releaseQuestion: async () => undefined,
  };
  return { repository, deleteSessionData };
}

describe("P11 privacy and configuration contracts", () => {
  it("requires the JWT signing secret to be at least 32 characters", () => {
    expect(() =>
      parseConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
        DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
        DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
        DIMTS_JWT_SECRET: "too-short",
        DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
      }),
    ).toThrow(/DIMTS_JWT_SECRET/u);
  });

  it("requires an authorized session and idempotently deletes its data", async () => {
    const { repository, deleteSessionData } = createRepository();
    const app = buildApp({ config, repository });

    const unauthorized = await request(app)
      .post("/v1/data/delete")
      .send({ sessionId });
    expect(unauthorized.status).toBe(401);
    expect(deleteSessionData).not.toHaveBeenCalled();

    const authorization = `Bearer ${sessionToken}`;
    const first = await request(app)
      .post("/v1/data/delete")
      .set("authorization", authorization)
      .send({ sessionId });
    const retry = await request(app)
      .post("/v1/data/delete")
      .set("authorization", authorization)
      .send({ sessionId });

    expect(first.status).toBe(204);
    expect(retry.status).toBe(204);
    expect(deleteSessionData).toHaveBeenCalledTimes(1);
    expect(deleteSessionData).toHaveBeenCalledWith(sessionId);
  });

  it("does not return success when deletion storage fails", async () => {
    const deleteSessionData = vi.fn(async () => {
      throw new Error("database detail");
    });
    const { repository } = createRepository(deleteSessionData);
    const app = buildApp({ config, repository });

    const response = await request(app)
      .post("/v1/data/delete")
      .set("authorization", `Bearer ${sessionToken}`)
      .send({ sessionId });

    expect(response.status).toBe(500);
    expect(response.text).not.toContain("database detail");
  });

  it("serves the generated OpenAPI contract over both documented routes", async () => {
    const { repository } = createRepository();
    const app = buildApp({ config, repository });

    const json = await request(app).get("/v1/openapi.json");
    const yaml = await request(app).get("/v1/openapi.yaml");

    expect(json.status).toBe(200);
    expect(json.body.paths["/v1/data/delete"]).toBeDefined();
    expect(yaml.status).toBe(200);
    expect(yaml.text).toContain("/v1/data/delete:");
  });
});
