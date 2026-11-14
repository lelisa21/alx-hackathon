import express, { Router, type Request, type Response } from "express";
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
import { sha256 } from "../middleware/auth.js";
import pino from "pino";
import { randomBytes } from "node:crypto";

/**
 * P10 LTI 1.3 routes: login, launch, JWKS key distribution
 */

// LMSs send further OIDC/LTI parameters (lti_deployment_id, ...); they are
// ignored rather than rejected. client_id is optional in LTI 1.3 login.
const LtiLoginRequestSchema = z.object({
  iss: z.string().url(),
  client_id: z.string().min(1).max(256).optional(),
  login_hint: z.string().min(1).max(256),
  target_link_uri: z.string().url(),
  lti_message_hint: z.string().max(2048).optional(),
});

const LtiLaunchRequestSchema = z.object({
  id_token: z.string().min(100).max(10000),
  state: z.string().min(1).max(1000),
});

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

/** Browser requests from an LMS are forms or GETs; API clients send JSON. */
const isBrowserRequest = (req: Request) =>
  req.method === "GET" || !req.is("application/json");

const launchUrl = (req: Request) =>
  `${req.protocol}://${req.get("host")}${req.baseUrl}/launch`;

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
  /** Widget served inside the LMS frame after a browser launch. */
  launchPage?: { widgetUrl: string; hostKey: string };
}): Router {
  const router = Router();
  const form = express.urlencoded({ extended: false, limit: "16kb" });
  const logger = options.logger || pino();
  const platformConfigs = options.platformConfigs || new Map();

  /**
   * POST /v1/lti/login - OIDC login initiation
   * Platform calls this with login_hint, receives state/nonce to include in token request
   */
  const login = async (req: Request, res: Response) => {
    try {
      const payload = LtiLoginRequestSchema.parse(
        req.method === "GET" ? req.query : req.body,
      );

      // Match the registered OIDC client for this issuer. Without client_id,
      // the issuer must identify exactly one registration.
      const matches = [...platformConfigs].filter(
        ([, config]) =>
          config.issuer === payload.iss &&
          (payload.client_id === undefined ||
            config.clientId === payload.client_id),
      );
      const [platformId, platformConfig] =
        matches.length === 1 ? matches[0]! : [undefined, undefined];

      if (!platformConfig || !platformId) {
        return sendProblem(res, 404, "not_found", "lti.login.unregistered");
      }

      if (!options.repository.storeLtiState) {
        logger.error(
          "LTI login unavailable (state storage is not implemented)",
        );
        return sendProblem(res, 500, "internal", "error.server");
      }

      // Generate state (expires in 5 min) and nonce
      const { state } = generateLtiState(platformId);
      const nonce = generateLtiNonce();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      // Store nonce for later validation using database (persistent across restarts)
      await options.repository.storeLtiState(
        state,
        platformId,
        nonce,
        expiresAt,
      );

      // The launch URL is this deployment's own; `trust proxy` makes
      // req.protocol honour the TLS-terminating proxy's X-Forwarded-Proto.
      // The platform still only redirects to its registered redirect URIs.
      const redirectUri = launchUrl(req);
      if (isBrowserRequest(req)) {
        const target = new URL(platformConfig.authLoginUrl);
        for (const [key, value] of Object.entries({
          scope: "openid",
          response_type: "id_token",
          response_mode: "form_post",
          prompt: "none",
          client_id: platformConfig.clientId,
          redirect_uri: redirectUri,
          login_hint: payload.login_hint,
          state,
          nonce,
          ...(payload.lti_message_hint
            ? { lti_message_hint: payload.lti_message_hint }
            : {}),
        }))
          target.searchParams.set(key, value);
        res.redirect(302, target.toString());
      } else {
        res.json({
          state,
          nonce,
          authLoginUrl: platformConfig.authLoginUrl,
          redirectUri,
        });
      }

      logger.info(
        { platformId, state: state.slice(0, 8) },
        "LTI login initiated",
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendProblem(res, 400, "invalid_request", "error.invalid");
      }
      logger.error(error, "LTI login failed");
      sendProblem(res, 500, "internal", "error.server");
    }
  };
  router.get("/login", login);
  router.post("/login", form, login);

  /**
   * POST /v1/lti/launch - Receive and validate signed id_token
   * Creates or resumes session with LTI context stored for audit
   */
  router.post("/launch", form, async (req: Request, res: Response) => {
    try {
      const payload = LtiLaunchRequestSchema.parse(req.body);

      // Validate state using database
      const stateData = await options.repository.getLtiStateAndNonce?.(
        payload.state,
      );
      if (!stateData) {
        return sendProblem(res, 403, "forbidden", "lti.launch.state_invalid");
      }

      // Check state expiry
      if (Date.now() > new Date(stateData.expiresAt).getTime()) {
        return sendProblem(res, 403, "forbidden", "lti.launch.state_expired");
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
          "Token validation failed",
        );
        return sendProblem(
          res,
          401,
          "unauthorized",
          "lti.launch.invalid_token",
        );
      }

      // Check for token replay (using database for persistence)
      const tokenHash = sha256(payload.id_token);

      const isReplayed = await options.repository.checkAndMarkTokenReplayed?.(
        tokenHash,
        stateData.platformId,
        null,
      );
      if (isReplayed === true) {
        logger.warn(
          { platformId: stateData.platformId },
          "Token replay detected",
        );
        return sendProblem(res, 403, "forbidden", "lti.launch.replay");
      }
      if (isReplayed === undefined) {
        logger.error(
          "Token replay check unavailable (repository method not implemented)",
        );
        return sendProblem(res, 500, "internal", "error.token_check");
      }

      // Check nonce one-time use (using database for persistence)
      // Check nonce one-time use (checkAndMarkNonceUsed returns true if ALREADY used = replay)
      const nonceAlreadyUsed = await options.repository.checkAndMarkNonceUsed?.(
        stateData.nonce,
        null,
      );
      if (nonceAlreadyUsed === true) {
        logger.warn("Nonce replay detected");
        return sendProblem(res, 403, "forbidden", "lti.launch.nonce_replay");
      }
      if (nonceAlreadyUsed === undefined) {
        logger.error(
          "Nonce validation unavailable (repository method not implemented)",
        );
        return sendProblem(res, 500, "internal", "error.nonce_check");
      }

      // Map roles and determine insights access
      const { roles, insightsAccess } = mapLtiRoles(claims);

      // Create or resume session (pseudonymous, no account creation)
      const sessionId = randomBytes(16).toString("base64url");

      // Generate session token (short-lived, httpOnly cookie)
      const sessionToken = randomBytes(32).toString("hex");

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
            ...(claims["https://purl.imsglobal.org/spec/lti/claim/context"]
              ?.id === undefined
              ? {}
              : {
                  contextId:
                    claims["https://purl.imsglobal.org/spec/lti/claim/context"]
                      .id,
                }),
            insightsAccess,
            timestamp: Date.now(),
          },
        });
      } catch (error) {
        logger.error(error, "Failed to create session");
        return sendProblem(res, 500, "internal", "error.session");
      }

      // Clean up state (database record will expire naturally after 5 minutes)
      await options.repository.deleteLtiState?.(payload.state);

      if (isBrowserRequest(req)) {
        if (!options.launchPage) {
          return sendProblem(res, 503, "internal", "lti.launch.unconfigured");
        }
        const widget = new URL(options.launchPage.widgetUrl);
        // Only the registering platform may frame the tutor.
        res.removeHeader("X-Frame-Options");
        res.setHeader(
          "Content-Security-Policy",
          [
            "default-src 'none'",
            `script-src ${widget.origin}`,
            `connect-src 'self' ${widget.origin}`,
            `font-src ${widget.origin}`,
            "img-src 'self' data:",
            "style-src 'unsafe-inline'",
            "base-uri 'none'",
            "form-action 'none'",
            `frame-ancestors ${new URL(platformConfig.issuer).origin}`,
          ].join("; "),
        );
        res
          .type("html")
          .send(
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dimts</title><style>body{margin:0;padding:1rem}</style></head><body><dimts-assistant data-api="${escapeHtml(`${req.protocol}://${req.get("host")}/v1`)}" data-host-key="${escapeHtml(options.launchPage.hostKey)}"></dimts-assistant><script type="module" src="${escapeHtml(widget.href)}"></script></body></html>`,
          );
      } else
        res.json(
          LtiLaunchResponseSchema.parse({
            sessionId,
            sessionToken,
            roles,
            insightsAccess,
            contextId:
              claims["https://purl.imsglobal.org/spec/lti/claim/context"]?.id,
          }),
        );

      logger.info(
        { sessionId: sessionId.slice(0, 12), platformId: stateData.platformId },
        "LTI launch successful",
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
