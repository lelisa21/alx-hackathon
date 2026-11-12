import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { sha256 } from "../src/middleware/auth.js";
import { createHelpRouter } from "../src/routes/help.js";
import type { HelpAuthStore } from "../src/types.js";

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

function createApp() {
  const claims = new Map<string, string>();
  const store: HelpAuthStore = {
    findActiveHelperByTokenHash: async (hash) =>
      hash === sha256("valid-helper-token-000000000000")
        ? { id: "helper-one" }
        : hash === sha256("second-helper-token-000000000000")
          ? { id: "helper-two" }
          : hash === sha256("revoked-helper-token-000000000000")
            ? { id: "helper-revoked" }
            : null,
    isHelperActive: async (id) => id === "helper-one" || id === "helper-two",
    claimWaitingRequest: async (requestId, helperId) => {
      if (claims.has(requestId)) return false;
      claims.set(requestId, helperId);
      return true;
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/v1", createHelpRouter({ config, store }));
  return { app, claims };
}

describe("WP07 helper authentication and claiming", () => {
  it("returns only a short-lived bearer JWT for an active helper token", async () => {
    const { app } = createApp();
    const response = await request(app)
      .post("/v1/helpers/login")
      .send({ token: "valid-helper-token-000000000000" });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body)).toEqual(["jwt"]);
    expect(response.body.jwt).toMatch(/^[A-Za-z0-9._-]+$/u);
  });

  it("rejects invalid helper tokens without reflecting the secret", async () => {
    const { app } = createApp();
    const response = await request(app)
      .post("/v1/helpers/login")
      .send({ token: "wrong-helper-token-000000000000" });

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain(
      "wrong-helper-token-000000000000",
    );
  });

  it("allows exactly one helper to claim a waiting request", async () => {
    const { app, claims } = createApp();
    const [firstLogin, secondLogin] = await Promise.all([
      request(app)
        .post("/v1/helpers/login")
        .send({ token: "valid-helper-token-000000000000" }),
      request(app)
        .post("/v1/helpers/login")
        .send({ token: "second-helper-token-000000000000" }),
    ]);

    const results = await Promise.all([
      request(app)
        .post("/v1/help/request-123/claim")
        .set("authorization", `Bearer ${firstLogin.body.jwt}`),
      request(app)
        .post("/v1/help/request-123/claim")
        .set("authorization", `Bearer ${secondLogin.body.jwt}`),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(claims.size).toBe(1);
  });

  it("requires a valid helper JWT to claim a request", async () => {
    const { app } = createApp();
    const response = await request(app)
      .post("/v1/help/request-123/claim")
      .set("authorization", "Bearer invalid");

    expect(response.status).toBe(401);
  });

  it("revokes helper access when the helper is deactivated", async () => {
    const { app } = createApp();
    const login = await request(app)
      .post("/v1/helpers/login")
      .send({ token: "revoked-helper-token-000000000000" });
    expect(login.status).toBe(200);

    const claim = await request(app)
      .post("/v1/help/request-123/claim")
      .set("authorization", `Bearer ${login.body.jwt}`);

    expect(claim.status).toBe(401);
  });
});
