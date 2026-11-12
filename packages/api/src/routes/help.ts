import { SignJWT, jwtVerify } from "jose";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { ApiConfig } from "../config.js";
import { sha256 } from "../middleware/auth.js";
import { sendProblem } from "../middleware/problem.js";
import {
  HelpBlockResponseSchema,
  HelpCreateRequestSchema,
  HelpCreateResponseSchema,
  HelpQueueQuerySchema,
  HelpQueueResponseSchema,
  HelperLoginRequestSchema,
  HelperLoginResponseSchema,
  HelpClaimResponseSchema,
} from "../schemas.js";
import { createSessionAuth } from "../middleware/auth.js";
import type { ApiRepository, HelpStore } from "../types.js";

interface HelpRouteOptions {
  config: ApiConfig;
  repository: Pick<ApiRepository, "getSessionTokenHash" | "touchSession">;
  store: HelpStore;
  onClosed?(requestId: string): Promise<void> | void;
}

function sendUnauthorized(response: express.Response): void {
  sendProblem(response, 401, "unauthorized", "error.generic");
}

async function getHelperId(
  authorization: string,
  key: Uint8Array,
): Promise<string | null> {
  const bearer = /^Bearer ([A-Za-z0-9._-]{1,4096})$/u.exec(authorization)?.[1];
  if (!bearer) return null;
  try {
    const verified = await jwtVerify(bearer, key, { algorithms: ["HS256"] });
    if (
      verified.payload.role !== "helper" ||
      typeof verified.payload.sub !== "string"
    ) {
      return null;
    }
    return verified.payload.sub;
  } catch {
    return null;
  }
}

function helpRequestId(value: unknown): string | null {
  const parsed = z.string().min(1).max(128).safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createHelpRouter(options: HelpRouteOptions): express.Router {
  const router = express.Router();
  const key = new TextEncoder().encode(options.config.DIMTS_JWT_SECRET);
  const requireSession = createSessionAuth(options.repository);
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_request, response) => {
      sendProblem(response, 429, "rate_limited", "limit.reached");
    },
  });

  router.post("/helpers/login", loginLimit, async (request, response) => {
    const parsed = HelperLoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }

    const helper = await options.store.findActiveHelperByTokenHash(
      sha256(parsed.data.token),
    );
    if (!helper) {
      sendUnauthorized(response);
      return;
    }

    const token = await new SignJWT({ role: "helper" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(helper.id)
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(key);
    response.json(HelperLoginResponseSchema.parse({ jwt: token }));
  });

  router.post("/help", requireSession, async (request, response, next) => {
    const parsed = HelpCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }
    try {
      const created = await options.store.createRequest(
        parsed.data.sessionId,
        parsed.data.includeSummary,
      );
      if (!created) {
        sendProblem(response, 429, "rate_limited", "limit.reached");
        return;
      }
      response.status(201).json(HelpCreateResponseSchema.parse(created));
    } catch (error) {
      next(error);
    }
  });

  router.get("/help/queue", async (request, response, next) => {
    const parsed = HelpQueueQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }
    try {
      const helperId = await getHelperId(
        request.header("authorization") ?? "",
        key,
      );
      if (!helperId || !(await options.store.isHelperActive(helperId))) {
        sendUnauthorized(response);
        return;
      }
      const requests = await options.store.listWaitingRequests(
        helperId,
        parsed.data.lang,
      );
      response.json(HelpQueueResponseSchema.parse({ requests }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/help/:id/block", async (request, response, next) => {
    const id = helpRequestId(request.params.id);
    if (!id) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }
    try {
      const helperId = await getHelperId(
        request.header("authorization") ?? "",
        key,
      );
      if (!helperId || !(await options.store.isHelperActive(helperId))) {
        sendUnauthorized(response);
        return;
      }
      const blocked = await options.store.blockWaitingRequest(id, helperId);
      if (!blocked) {
        sendProblem(response, 404, "not_found", "error.not_found");
        return;
      }
      response.json(HelpBlockResponseSchema.parse({ ok: true }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/help/:id/claim", async (request, response, next) => {
    const id = helpRequestId(request.params.id);
    if (!id) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }

    try {
      const helperId = await getHelperId(
        request.header("authorization") ?? "",
        key,
      );
      if (!helperId || !(await options.store.isHelperActive(helperId))) {
        sendUnauthorized(response);
        return;
      }

      const claimed = await options.store.claimWaitingRequest(id, helperId);
      if (!claimed) {
        sendProblem(response, 409, "conflict", "error.generic");
        return;
      }
      response.json(HelpClaimResponseSchema.parse({ ok: true }));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/help/:id/close",
    async (request, response, next) => {
      const id = helpRequestId(request.params.id);
      if (!id) {
        sendProblem(response, 400, "invalid_request", "error.invalid");
        return;
      }
      try {
        const helperId = await getHelperId(
          request.header("authorization") ?? "",
          key,
        );
        if (!helperId) {
          next();
          return;
        }
        if (!(await options.store.isHelperActive(helperId))) {
          sendUnauthorized(response);
          return;
        }
        const closed = await options.store.closeRequest(id, {
          role: "helper",
          helperId,
        });
        if (!closed) {
          sendProblem(response, 404, "not_found", "error.not_found");
          return;
        }
        await options.onClosed?.(id);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
    requireSession,
    async (request, response, next) => {
      const id = helpRequestId(request.params.id);
      if (!id) {
        sendProblem(response, 400, "invalid_request", "error.invalid");
        return;
      }
      const sessionIdSchema = z
        .object({ sessionId: z.string().min(8).max(64) })
        .strict();
      const parsed = sessionIdSchema.safeParse(request.body);
      if (!parsed.success) {
        sendProblem(response, 400, "invalid_request", "error.invalid");
        return;
      }
      try {
        const closed = await options.store.closeRequest(id, {
          role: "learner",
          sessionId: parsed.data.sessionId,
        });
        if (!closed) {
          sendProblem(response, 404, "not_found", "error.not_found");
          return;
        }
        await options.onClosed?.(id);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
