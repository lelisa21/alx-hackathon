import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  validateLtiToken,
  mapLtiRoles,
  generateLtiState,
  generateLtiNonce,
  type LtiPlatformConfig,
  type LtiIdTokenClaims,
} from "@dimts/lti";
import type { ApiRepository } from "../types.js";
import { sendProblem } from "../middleware/problem.js";
import pino from "pino";

/**
 * P10 LTI 1.3 routes: login, launch, JWKS key distribution
 */

const LtiLoginRequestSchema = z
  .object({
    iss: z.string().url(),
    client_id: z.string().min(1).max(256),
    login_hint: z.string().min(1).max(256),
    target_link_uri: z.string().url(),
    lti_message_hint: z.string().optional(),
  })
  .strict();

const LtiLaunchRequestSchema = z
  .object({
    id_token: z.string().min(100).max(10000),
    state: z.string().min(1).max(1000),
  })
  .strict();

const LtiLaunchResponseSchema = z
  .object({
    sessionId: z.string(),
    sessionToken: z.string(),
    roles: z.array(z.string()),
    insightsAccess: z.boolean(),
    contextId: z.string().optional(),
  })
  .strict();

export function createLtiRouter(options: {
  repository: ApiRepository;
  logger?: pino.Logger;
  jwtSecret?: string;
  platformConfigs?: Map<string, LtiPlatformConfig>;
  nonceSeen?: Set<string>;
  tokenHashSeen?: Set<string>;
}): Router {
  const router = Router();
  const logger = options.logger || pino();
  const platformConfigs = options.platformConfigs || new Map();
  const nonceSeen = options.nonceSeen || new Set();
  const tokenHashSeen = options.tokenHashSeen || new Set();

  // Store for state-to-nonce mapping (in-memory for single instance; use Redis for multi-instance)
  const stateToNonce = new Map<
    string,
    { nonce: string; expiresAt: number; platformId: string }
  >();

  /**
   * POST /v1/lti/login - OIDC login initiation
   * Platform calls this with login_hint, receives state/nonce to include in token request
   */
  router.post("/login", async (req: Request, res: Response) => {
    try {
      const payload = LtiLoginRequestSchema.parse(req.body);

      // Find platform config by issuer
      let platformConfig: LtiPlatformConfig | undefined;
      let platformId: string | undefined;

      for (const [id, config] of platformConfigs) {
        if (config.issuer === payload.iss) {
          platformConfig = config;
          platformId = id;
          break;
        }
      }

      if (!platformConfig || !platformId) {
        return sendProblem(
          res,
          404,
          "not_found",
          "lti.login.unregistered"
        );
      }

      // Generate state (expires in 5 min) and nonce
      const { state } = generateLtiState(platformId);
      const nonce = generateLtiNonce();

      // Store nonce for later validation
      stateToNonce.set(state, {
        nonce,
        expiresAt: Date.now() + 5 * 60 * 1000,
        platformId,
      });

      // In production: redirect to platform's auth_login_url with state/client_id/redirect_uri
      res.json({
        state,
        nonce,
        authLoginUrl: platformConfig.authLoginUrl,
        redirectUri: "https://api.example.com/v1/lti/launch",
      });

      logger.info(
        { platformId, state: state.slice(0, 8) },
        "LTI login initiated"
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendProblem(res, 400, "invalid_request", "error.invalid");
      }
      logger.error(error, "LTI login failed");
      sendProblem(res, 500, "internal", "error.server");
    }
  });

  /**
   * POST /v1/lti/launch - Receive and validate signed id_token
   * Creates or resumes session with LTI context stored for audit
   */
  router.post("/launch", async (req: Request, res: Response) => {
    try {
      const payload = LtiLaunchRequestSchema.parse(req.body);

      // Validate state
      const stateData = stateToNonce.get(payload.state);
      if (!stateData) {
        return sendProblem(res, 403, "forbidden", "lti.launch.state_invalid");
      }

      if (Date.now() > stateData.expiresAt) {
        stateToNonce.delete(payload.state);
        return sendProblem(
          res,
          403,
          "forbidden",
          "lti.launch.state_expired"
        );
      }

      // Get platform config
      const platformConfig = platformConfigs.get(stateData.platformId);
      if (!platformConfig) {
        return sendProblem(res, 400, "invalid_request", "error.not_found");
      }

      // Validate JWT signature, issuer, audience, nonce, expiry, deployment
      let claims: LtiIdTokenClaims;
      try {
        claims = await validateLtiToken(payload.id_token, platformConfig, {
          nonce: stateData.nonce,
        });
      } catch (error) {
        logger.warn(
          { error: String(error), platformId: stateData.platformId },
          "Token validation failed"
        );
        return sendProblem(res, 401, "unauthorized", "lti.launch.invalid_token");
      }

      // Check for token replay (hash the signature)
      const tokenHash = Buffer.from(payload.id_token.split(".")[2] || "")
        .toString("hex")
        .slice(0, 64);
      if (tokenHashSeen.has(tokenHash)) {
        logger.warn({ platformId: stateData.platformId }, "Token replay detected");
        return sendProblem(res, 403, "forbidden", "lti.launch.replay");
      }
      tokenHashSeen.add(tokenHash);
      nonceSeen.add(stateData.nonce);

      // Check nonce one-time use
      if (nonceSeen.has(stateData.nonce)) {
        // Already saw this nonce in a previous request
        logger.warn("Nonce replay detected");
        return sendProblem(res, 403, "forbidden", "lti.launch.nonce_replay");
      }

      // Map roles and determine insights access
      const { roles, insightsAccess } = mapLtiRoles(claims);

      // Create or resume session (pseudonymous, no account creation)
      // Generate session ID from key (in production, use HMAC)
      const sessionId =
        "session-" +
        Buffer.from(claims.sub).toString("hex").slice(0, 12).padEnd(12, "0");

      // Generate session token (short-lived, httpOnly cookie)
      const sessionToken = Buffer.from(
        crypto.getRandomValues(new Uint8Array(32))
      ).toString("hex");

      // Store session with LTI context
      try {
        await options.repository.createSession({
          id: sessionId,
          token: sessionToken,
          lang: "en",
          channel: "lti",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          ltiContext: {
            issuer: platformConfig.issuer,
            platformId: stateData.platformId,
            deploymentId:
              claims[
                "https://purl.imsglobal.org/spec/lti/claim/deployment_id"
              ] || "unknown",
            ltiUserId: claims.sub,
            roles,
            contextId: claims[
              "https://purl.imsglobal.org/spec/lti/claim/context"
            ]?.id,
            insightsAccess,
            timestamp: Date.now(),
          },
        });
      } catch (error) {
        logger.error(error, "Failed to create session");
        return sendProblem(res, 500, "internal", "error.session");
      }

      // Clean up state
      stateToNonce.delete(payload.state);

      res.json(
        LtiLaunchResponseSchema.parse({
          sessionId,
          sessionToken,
          roles,
          insightsAccess,
          contextId: claims[
            "https://purl.imsglobal.org/spec/lti/claim/context"
          ]?.id,
        })
      );

      logger.info(
        { sessionId: sessionId.slice(0, 12), platformId: stateData.platformId },
        "LTI launch successful"
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendProblem(res, 400, "invalid_request", "error.invalid");
      }
      logger.error(error, "LTI launch failed");
      sendProblem(res, 500, "internal", "error.server");
    }
  });

  /**
   * GET /v1/lti/jwks - Publish platform's public key for JWT verification
   * (Stub for testing; real implementation would fetch from configured key store)
   */
  router.get("/jwks", (req: Request, res: Response) => {
    // Return empty JWKS for testing (platform would use their own keys)
    res.json({
      keys: [],
    });
  });

  return router;
}
