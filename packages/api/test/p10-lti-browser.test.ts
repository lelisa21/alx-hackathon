// FR-INT-05/06: a real LMS drives LTI 1.3 through the learner's browser:
// OIDC login initiation (GET or form POST) must redirect, and the form-POSTed
// launch must return a page that can be framed by the registered platform.
import type { ApiRepository } from "../src/types.js";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
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
  DIMTS_LTI_PLATFORMS: JSON.stringify([platform]),
  DIMTS_LTI_WIDGET_URL: "https://assets.example.org/dimts-widget.js",
  DIMTS_LTI_WIDGET_KEY: "lti-widget-public-id",
};

afterEach(() => vi.unstubAllGlobals());

function statefulRepository() {
  const states = new Map<
    string,
    { platformId: string; nonce: string; expiresAt: Date }
  >();
  const repository: ApiRepository = {
    ping: async () => true,
    runRetention: async () => undefined,
    deleteSessionData: async () => undefined,
    getHostByHash: async () => null,
    verifyHostKey: async () => null,
    createSession: vi.fn(async () => undefined),
    resumeSession: async () => null,
    getCloudConsent: async () => null,
    getSessionTokenHash: async () => null,
    touchSession: async () => undefined,
    findReply: async () => null,
    countRecentQuestions: async () => 0,
    claimQuestion: async () => true,
    saveReply: async () => undefined,
    releaseQuestion: async () => undefined,
    storeLtiState: async (state, platformId, nonce, expiresAt) => {
      states.set(state, { platformId, nonce, expiresAt });
    },
    getLtiStateAndNonce: async (state) => states.get(state) ?? null,
    deleteLtiState: async (state) => {
      states.delete(state);
    },
    checkAndMarkTokenReplayed: async () => false,
    checkAndMarkNonceUsed: async () => false,
  };
  return { repository, states };
}

async function signedToken(nonce: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            keys: [{ ...jwk, kid: "k1", use: "sig", alg: "RS256" }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
  return new SignJWT({
    nonce,
    "https://purl.imsglobal.org/spec/lti/claim/deployment_id":
      platform.deploymentId,
    "https://purl.imsglobal.org/spec/lti/claim/roles": [
      "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
    ],
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(platform.issuer)
    .setAudience(platform.clientId)
    .setSubject("opaque-user")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("LTI 1.3 browser flow", () => {
  it("redirects an LMS login initiation (form POST, no client_id) to the platform", async () => {
    const { repository } = statefulRepository();
    const app = buildApp({ config: parseConfig(environment), repository });
    try {
      const response = await request(app)
        .post("/v1/lti/login")
        .set("Host", "dimts-api.example.org")
        .set("X-Forwarded-Proto", "https")
        .type("form")
        .send({
          iss: platform.issuer,
          login_hint: "hint-1",
          lti_message_hint: "msg-1",
          target_link_uri: "https://dimts-api.example.org/v1/lti/launch",
          lti_deployment_id: platform.deploymentId,
        });
      expect(response.status).toBe(302);
      const location = new URL(response.headers.location!);
      expect(location.origin + location.pathname).toBe(platform.authLoginUrl);
      expect(Object.fromEntries(location.searchParams)).toMatchObject({
        scope: "openid",
        response_type: "id_token",
        response_mode: "form_post",
        prompt: "none",
        client_id: platform.clientId,
        redirect_uri: "https://dimts-api.example.org/v1/lti/launch",
        login_hint: "hint-1",
        lti_message_hint: "msg-1",
      });
      expect(location.searchParams.get("state")).toBeTruthy();
      expect(location.searchParams.get("nonce")).toBeTruthy();
    } finally {
      await app.locals.close();
    }
  });

  it("accepts GET login initiation", async () => {
    const { repository } = statefulRepository();
    const app = buildApp({ config: parseConfig(environment), repository });
    try {
      const response = await request(app).get("/v1/lti/login").query({
        iss: platform.issuer,
        client_id: platform.clientId,
        login_hint: "hint-1",
        target_link_uri: "https://dimts-api.example.org/v1/lti/launch",
      });
      expect(response.status).toBe(302);
    } finally {
      await app.locals.close();
    }
  });

  it("answers a form-POSTed launch with a frameable tutor page", async () => {
    const { repository } = statefulRepository();
    const app = buildApp({ config: parseConfig(environment), repository });
    try {
      const login = await request(app).get("/v1/lti/login").query({
        iss: platform.issuer,
        login_hint: "hint-1",
        target_link_uri: "https://dimts-api.example.org/v1/lti/launch",
      });
      const redirect = new URL(login.headers.location!);
      const state = redirect.searchParams.get("state")!;
      const idToken = await signedToken(redirect.searchParams.get("nonce")!);

      const launch = await request(app)
        .post("/v1/lti/launch")
        .type("form")
        .send({ id_token: idToken, state });

      expect(launch.status).toBe(200);
      expect(launch.headers["content-type"]).toMatch(/text\/html/u);
      expect(launch.text).toContain("<dimts-assistant");
      expect(launch.text).toContain('data-host-key="lti-widget-public-id"');
      expect(launch.text).toContain(
        'src="https://assets.example.org/dimts-widget.js"',
      );
      expect(launch.text).not.toContain(idToken);
      expect(launch.headers["x-frame-options"]).toBeUndefined();
      const csp = launch.headers["content-security-policy"]!;
      expect(csp).toContain(`frame-ancestors ${platform.issuer}`);
      expect(csp).toContain("script-src https://assets.example.org");
      expect(repository.createSession).toHaveBeenCalledOnce();
    } finally {
      await app.locals.close();
    }
  });

  it("keeps the JSON contract for API clients", async () => {
    const { repository } = statefulRepository();
    const app = buildApp({ config: parseConfig(environment), repository });
    try {
      const login = await request(app).post("/v1/lti/login").send({
        iss: platform.issuer,
        client_id: platform.clientId,
        login_hint: "hint-1",
        target_link_uri: "https://dimts-api.example.org/v1/lti/launch",
      });
      expect(login.status).toBe(200);
      expect(login.body.state).toEqual(expect.any(String));
    } finally {
      await app.locals.close();
    }
  });

  it("requires both widget settings together", () => {
    expect(() =>
      parseConfig({ ...environment, DIMTS_LTI_WIDGET_KEY: "" }),
    ).toThrow(/DIMTS_LTI_WIDGET/u);
    expect(() =>
      parseConfig({
        ...environment,
        DIMTS_LTI_WIDGET_URL: "http://assets.example.org/dimts-widget.js",
      }),
    ).toThrow(/DIMTS_LTI_WIDGET_URL/u);
  });
});
