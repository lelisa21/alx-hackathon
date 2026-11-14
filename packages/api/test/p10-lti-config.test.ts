import type { ApiRepository } from "../src/types.js";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createHash } from "node:crypto";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";

const platform = {
  platformId: "savanna",
  issuer: "https://lms.example.org",
  clientId: "dimts-client",
  authLoginUrl: "https://lms.example.org/oidc/login",
  authTokenUrl: "https://lms.example.org/oidc/token",
  jwksUri: "https://lms.example.org/.well-known/jwks.json",
  deploymentId: "savanna-production",
};

const environment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: Buffer.alloc(32, 3).toString("base64"),
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function createRepository(): ApiRepository {
  return {
    ping: async () => true,
    runRetention: async () => undefined,
    deleteSessionData: async () => undefined,
    getHostByHash: async () => null,
    verifyHostKey: async () => null,
    createSession: async () => undefined,
    resumeSession: async () => null,
    getCloudConsent: async () => null,
    getSessionTokenHash: async () => null,
    touchSession: async () => undefined,
    storeLtiState: vi.fn(async () => undefined),
    findReply: async () => null,
    countRecentQuestions: async () => 0,
    claimQuestion: async () => true,
    saveReply: async () => undefined,
    releaseQuestion: async () => undefined,
  };
}

describe("P10 static LTI platform configuration", () => {
  it("defaults to no registered LTI platforms", () => {
    expect(parseConfig(environment).DIMTS_LTI_PLATFORMS).toEqual([]);
  });

  it("parses strict platform metadata from host configuration", () => {
    const config = parseConfig({
      ...environment,
      DIMTS_LTI_PLATFORMS: JSON.stringify([platform]),
    });

    expect(config.DIMTS_LTI_PLATFORMS).toEqual([platform]);
  });

  it.each([
    ["invalid JSON", "{"],
    [
      "non-HTTPS endpoint",
      JSON.stringify([{ ...platform, jwksUri: "http://lms.example.org/jwks" }]),
    ],
    [
      "unknown field",
      JSON.stringify([
        { ...platform, privateKey: "must-not-be-configured-here" },
      ]),
    ],
    [
      "duplicate platform",
      JSON.stringify([platform, { ...platform, deploymentId: "other" }]),
    ],
  ])("rejects %s", (_description, value) => {
    expect(() =>
      parseConfig({ ...environment, DIMTS_LTI_PLATFORMS: value }),
    ).toThrow(/DIMTS_LTI_PLATFORMS/u);
  });

  it("wires configured platforms into the API and matches both issuer and client", async () => {
    const config = parseConfig({
      ...environment,
      DIMTS_LTI_PLATFORMS: JSON.stringify([platform]),
    });
    const app = buildApp({ config, repository: createRepository() });
    const login = {
      iss: platform.issuer,
      client_id: platform.clientId,
      login_hint: "opaque-platform-hint",
      target_link_uri: "https://learn.example.org/dimts",
    };

    try {
      const registered = await request(app).post("/v1/lti/login").send(login);
      expect(registered.status).toBe(200);
      expect(registered.body.authLoginUrl).toBe(platform.authLoginUrl);
      expect(registered.body.state).toEqual(expect.any(String));
      expect(registered.body.nonce).toEqual(expect.any(String));

      const mismatchedClient = await request(app)
        .post("/v1/lti/login")
        .send({ ...login, client_id: "unregistered-client" });
      expect(mismatchedClient.status).toBe(404);
    } finally {
      await app.locals.close();
    }
  });

  it("does not issue a login state when persistent state storage is unavailable", async () => {
    const config = parseConfig({
      ...environment,
      DIMTS_LTI_PLATFORMS: JSON.stringify([platform]),
    });
    const repository = createRepository();
    repository.storeLtiState = undefined;
    const app = buildApp({ config, repository });

    try {
      const response = await request(app).post("/v1/lti/login").send({
        iss: platform.issuer,
        client_id: platform.clientId,
        login_hint: "platform-hint",
        target_link_uri: "https://learn.example.org/dimts",
      });

      expect(response.status).toBe(500);
      expect(response.body).not.toHaveProperty("state");
      expect(response.body).not.toHaveProperty("nonce");
    } finally {
      await app.locals.close();
    }
  });

  it("validates a signed instructor launch and persists its LTI session", async () => {
    const config = parseConfig({
      ...environment,
      DIMTS_LTI_PLATFORMS: JSON.stringify([platform]),
    });
    const states = new Map<
      string,
      { platformId: string; nonce: string; expiresAt: Date }
    >();
    let createdSession:
      Parameters<ApiRepository["createSession"]>[0] | undefined;
    const repository = createRepository();
    repository.storeLtiState = async (state, platformId, nonce, expiresAt) => {
      states.set(state, { platformId, nonce, expiresAt });
    };
    repository.getLtiStateAndNonce = async (state) => states.get(state) ?? null;
    repository.deleteLtiState = async (state) => {
      states.delete(state);
    };
    repository.checkAndMarkTokenReplayed = vi.fn(async () => false);
    repository.checkAndMarkNonceUsed = async () => false;
    repository.createSession = async (session) => {
      createdSession = session;
    };
    const app = buildApp({ config, repository });

    try {
      const login = await request(app).post("/v1/lti/login").send({
        iss: platform.issuer,
        client_id: platform.clientId,
        login_hint: "platform-hint",
        target_link_uri: "https://learn.example.org/dimts",
      });
      expect(login.status).toBe(200);

      const { state, nonce } = login.body as {
        state: string;
        nonce: string;
      };
      const { privateKey, publicKey } = await generateKeyPair("RS256");
      const jwk = await exportJWK(publicKey);
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                keys: [
                  { ...jwk, kid: "savanna-test", use: "sig", alg: "RS256" },
                ],
              }),
              { headers: { "content-type": "application/json" } },
            ),
        ),
      );
      const idToken = await new SignJWT({
        nonce,
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id":
          platform.deploymentId,
        "https://purl.imsglobal.org/spec/lti/claim/roles": [
          "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor",
        ],
      })
        .setProtectedHeader({ alg: "RS256", kid: "savanna-test" })
        .setIssuer(platform.issuer)
        .setAudience(platform.clientId)
        .setSubject("opaque-platform-user")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);

      const launch = await request(app)
        .post("/v1/lti/launch")
        .send({ id_token: idToken, state });

      expect(launch.status).toBe(200);
      expect(repository.checkAndMarkTokenReplayed).toHaveBeenCalledWith(
        createHash("sha256").update(idToken).digest("hex"),
        "savanna",
        null,
      );
      expect(launch.body.roles).toContain("Instructor");
      expect(launch.body.insightsAccess).toBe(true);
      expect(createdSession).toMatchObject({
        channel: "lti",
        token: launch.body.sessionToken,
        ltiContext: {
          platformId: "savanna",
          insightsAccess: true,
        },
      });
      expect(createdSession?.expiresAt).toBeInstanceOf(Date);
      expect(createdSession?.id).not.toContain("opaque-platform-user");
      expect(states.has(state)).toBe(false);
    } finally {
      await app.locals.close();
    }
  });
});
