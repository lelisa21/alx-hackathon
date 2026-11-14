import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  mapLtiRoles,
  validateLtiToken,
  type LtiPlatformConfig,
} from "@dimts/lti";

const mockIssuer = "https://platform.example.com";
const mockClientId = "dimts-client-123";
const mockDeploymentId = "deployment-001";
const mockNonce = "test-nonce";

async function createSignedToken(
  claims: Record<string, unknown> = {},
  options: {
    issuer?: string;
    audience?: string;
    expiration?: string;
  } = {},
): Promise<string> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            keys: [{ ...jwk, kid: "test-key", use: "sig", alg: "RS256" }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );

  return new SignJWT({
    nonce: mockNonce,
    "https://purl.imsglobal.org/spec/lti/claim/deployment_id": mockDeploymentId,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(options.issuer ?? mockIssuer)
    .setAudience(options.audience ?? mockClientId)
    .setSubject("user-123")
    .setIssuedAt()
    .setExpirationTime(options.expiration ?? "5m")
    .sign(privateKey);
}

const validationPlatform: LtiPlatformConfig = {
  platformId: "platform-001",
  issuer: mockIssuer,
  clientId: mockClientId,
  authLoginUrl: "https://platform.example.com/auth/login",
  authTokenUrl: "https://platform.example.com/auth/token",
  jwksUri: "https://platform.example.com/.well-known/jwks.json",
  deploymentId: mockDeploymentId,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("P10 FR-INT-05/06 LTI JWT validation", () => {
  it("rejects a token with an invalid RS256 signature", async () => {
    const token = await createSignedToken();
    const [header, payload, signature] = token.split(".");
    const signaturePart = signature ?? "";
    const replacement = signaturePart.startsWith("a") ? "b" : "a";
    const badToken = `${header}.${payload}.${replacement}${signaturePart.slice(1)}`;

    await expect(
      validateLtiToken(badToken, validationPlatform, { nonce: mockNonce }),
    ).rejects.toThrow("Token validation failed");
  });

  it("rejects a token missing the registered deployment ID", async () => {
    const token = await createSignedToken({
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id": undefined,
    });

    await expect(
      validateLtiToken(token, validationPlatform, { nonce: mockNonce }),
    ).rejects.toThrow("Invalid deployment ID");
  });

  it("rejects a token with the wrong issuer", async () => {
    const token = await createSignedToken(
      {},
      { issuer: "https://wrong.example" },
    );

    await expect(
      validateLtiToken(token, validationPlatform, { nonce: mockNonce }),
    ).rejects.toThrow("Token validation failed");
  });

  it("rejects a token with the wrong audience", async () => {
    const token = await createSignedToken({}, { audience: "another-client" });

    await expect(
      validateLtiToken(token, validationPlatform, { nonce: mockNonce }),
    ).rejects.toThrow("Token validation failed");
  });

  it("rejects a token with the wrong deployment ID", async () => {
    const token = await createSignedToken({
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id":
        "wrong-deployment-id",
    });

    await expect(
      validateLtiToken(token, validationPlatform, { nonce: mockNonce }),
    ).rejects.toThrow("Invalid deployment ID");
  });

  it("rejects a token with an expiry beyond the five-minute launch window", async () => {
    const token = await createSignedToken({}, { expiration: "10m" });

    await expect(
      validateLtiToken(token, validationPlatform, { nonce: mockNonce }),
    ).rejects.toThrow("Token expiry exceeds maximum allowed");
  });

  it("rejects a token with a missing nonce", async () => {
    const token = await createSignedToken({ nonce: undefined });

    await expect(
      validateLtiToken(token, validationPlatform, { nonce: mockNonce }),
    ).rejects.toThrow("Nonce mismatch");
  });

  it("validates a signed token with all registered claims", async () => {
    const token = await createSignedToken();
    const claims = await validateLtiToken(token, validationPlatform, {
      nonce: mockNonce,
    });

    expect(claims.iss).toBe(mockIssuer);
    expect(claims.aud).toBe(mockClientId);
    expect(claims.sub).toBe("user-123");
    expect(claims.nonce).toBe(mockNonce);
    expect(
      claims["https://purl.imsglobal.org/spec/lti/claim/deployment_id"],
    ).toBe(mockDeploymentId);
  });

  it("maps signed learner claims without instructor insights access", async () => {
    const token = await createSignedToken({
      "https://purl.imsglobal.org/spec/lti/claim/roles": [
        "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Learner",
      ],
    });
    const claims = await validateLtiToken(token, validationPlatform, {
      nonce: mockNonce,
    });

    expect(mapLtiRoles(claims)).toEqual({
      roles: ["Learner"],
      insightsAccess: false,
    });
  });
});
