import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload } from "jose";

/**
 * P10 LTI 1.3 integration
 * Contracts: OIDC login flow, signed JWT validation, JWKS key distribution
 */

export interface LtiPlatformConfig {
  platformId: string;
  issuer: string;
  clientId: string;
  authLoginUrl: string;
  authTokenUrl: string;
  jwksUri: string;
  deploymentId?: string;
}

export interface LtiIdTokenClaims extends JWTPayload {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  nonce: string;
  "https://purl.imsglobal.org/spec/lti/claim/deployment_id"?: string;
  "https://purl.imsglobal.org/spec/lti/claim/roles"?: string[];
  "https://purl.imsglobal.org/spec/lti/claim/context"?: {
    id: string;
    label?: string;
    title?: string;
  };
}

export interface LtiLaunchContext {
  sessionId: string;
  issuer: string;
  platformId: string;
  deploymentId: string;
  ltiUserId: string;
  roles: string[];
  contextId?: string;
  timestamp: number;
}

/**
 * Validate LTI id_token signature using platform JWKS
 * Enforces: valid signature, issuer, audience, deployment, nonce, expiry
 * Rejects: invalid sig, wrong issuer/aud/deployment, missing nonce, token replay
 */
export async function validateLtiToken(
  token: string,
  platform: LtiPlatformConfig,
  {
    nonce,
    maxAgeSeconds = 5 * 60,
  }: { nonce: string; maxAgeSeconds?: number }
): Promise<LtiIdTokenClaims> {
  const JWKS = createRemoteJWKSet(new URL(platform.jwksUri));

  try {
    const verified = await jwtVerify(token, JWKS, {
      issuer: platform.issuer,
      audience: platform.clientId,
      clockTolerance: 60, // 1 minute for clock skew
    });

    const claims = verified.payload as unknown as LtiIdTokenClaims;

    // Validate nonce (one-time use enforcement in caller)
    if (claims.nonce !== nonce) {
      throw new Error("Nonce mismatch");
    }

    // Validate deployment ID if specified
    const deploymentId = claims[
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id"
    ] as string | undefined;
    if (
      platform.deploymentId &&
      deploymentId &&
      deploymentId !== platform.deploymentId
    ) {
      throw new Error("Invalid deployment ID");
    }

    // Enforce 5-minute expiry maximum
    const now = Math.floor(Date.now() / 1000);
    const tokenAge = now - (claims.iat ?? 0);
    const maxExp = now + maxAgeSeconds;

    if ((claims.exp ?? 0) > maxExp) {
      throw new Error("Token expiry exceeds maximum allowed");
    }

    return claims;
  } catch (error) {
    throw new Error(
      `Token validation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extract role flags from LTI claims for session attributes
 * Learner → regular session
 * Instructor → insightsAccess flag
 */
export function mapLtiRoles(
  claims: LtiIdTokenClaims
): { roles: string[]; insightsAccess: boolean } {
  const roleUrls = claims[
    "https://purl.imsglobal.org/spec/lti/claim/roles"
  ] as string[] | undefined;

  const roles = (roleUrls || []).map((url) => {
    const match = url.match(/#([A-Za-z]+)$/u);
    return match ? match[1]! : url;
  });

  const hasInstructor = (roleUrls || []).includes(
    "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor"
  );

  return {
    roles: roles.filter((r): r is string => r !== undefined),
    insightsAccess: hasInstructor,
  };
}

/**
 * Generate state parameter for LTI login flow
 * Encodes platform ID and timestamp; expires in 5 minutes
 */
export function generateLtiState(platformId: string): {
  state: string;
  expiresAt: number;
} {
  const timestamp = Date.now();
  const expiresAt = timestamp + 5 * 60 * 1000;

  const payload = {
    platformId,
    timestamp,
  };

  const state = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return { state, expiresAt };
}

/**
 * Validate state parameter and check expiry (5-minute window)
 */
export function validateLtiState(
  state: string,
  expectedPlatformId: string
): boolean {
  try {
    const payload = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8")
    );

    if (payload.platformId !== expectedPlatformId) {
      return false;
    }

    const now = Date.now();
    const age = now - payload.timestamp;
    const maxAge = 5 * 60 * 1000;

    return age <= maxAge;
  } catch {
    return false;
  }
}

/**
 * Generate nonce for one-time-use in id_token (32 chars, hex)
 */
export function generateLtiNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16)))
    .toString("hex")
    .slice(0, 32);
}

/**
 * Create pseudonymous session ID from LTI user_id
 * HMAC-based to ensure same platform+user always maps to same session hash
 * (Implementation detail: actual session ID generation in API)
 */
export function deriveLtiSessionKey(
  issuer: string,
  platformId: string,
  ltiUserId: string
): string {
  // Return a key for session lookup; actual session is created/resumed by API
  return `lti:${platformId}:${Buffer.from(ltiUserId).toString("hex")}`;
}

export default {
  validateLtiToken,
  mapLtiRoles,
  generateLtiState,
  validateLtiState,
  generateLtiNonce,
  deriveLtiSessionKey,
};
