import { SignJWT, jwtVerify } from "jose";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { ApiConfig } from "../config.js";
import { sha256 } from "../middleware/auth.js";
import { sendProblem } from "../middleware/problem.js";
import {
  HelperLoginRequestSchema,
  HelperLoginResponseSchema,
  HelpClaimResponseSchema,
} from "../schemas.js";
import type { HelpAuthStore } from "../types.js";

const helpRequestIdSchema = z.string().min(1).max(128);

interface HelpRouteOptions {
  config: ApiConfig;
  store: HelpAuthStore;
}

function sendUnauthorized(response: express.Response): void {
  sendProblem(response, 401, "unauthorized", "error.generic");
}

export function createHelpRouter(options: HelpRouteOptions): express.Router {
  const router = express.Router();
  const key = new TextEncoder().encode(options.config.DIMTS_JWT_SECRET);
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

  router.post("/help/:id/claim", async (request, response, next) => {
    const id = helpRequestIdSchema.safeParse(request.params.id);
    if (!id.success) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }

    const authorization = request.header("authorization") ?? "";
    const bearer = /^Bearer ([A-Za-z0-9._-]{1,2048})$/u.exec(
      authorization,
    )?.[1];
    if (!bearer) {
      sendUnauthorized(response);
      return;
    }

    let helperId: string;
    try {
      const verified = await jwtVerify(bearer, key, {
        algorithms: ["HS256"],
      });
      if (
        verified.payload.role !== "helper" ||
        typeof verified.payload.sub !== "string"
      ) {
        sendUnauthorized(response);
        return;
      }
      helperId = verified.payload.sub;
    } catch {
      sendUnauthorized(response);
      return;
    }

    try {
      if (!(await options.store.isHelperActive(helperId))) {
        sendUnauthorized(response);
        return;
      }
      const claimed = await options.store.claimWaitingRequest(
        id.data,
        helperId,
      );
      if (!claimed) {
        sendProblem(response, 409, "conflict", "error.generic");
        return;
      }
      response.json(HelpClaimResponseSchema.parse({ ok: true }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
