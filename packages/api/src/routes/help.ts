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
  HelpAvailabilityQuerySchema,
  HelpAvailabilityResponseSchema,
  HelperProfileSchema,
  HelpMetricsSchema,
  HelpIceRequestSchema,
  HelpIceResponseSchema,
  HelpImageResponseSchema,
  HelpImageListSchema,
  HelperCloseRequestSchema,
} from "../schemas.js";
import { isHelperAvailable, nextHelperOpening } from "../help-hours.js";
import { createHelpIceProvider } from "../help-ice.js";
import { validateHelpImage } from "../help-image.js";
import { createSessionAuth } from "../middleware/auth.js";
import type { ApiRepository, HelpStore, HelpCloseActor } from "../types.js";

interface HelpRouteOptions {
  config: ApiConfig;
  repository: Pick<ApiRepository, "getSessionTokenHash" | "touchSession">;
  store: HelpStore;
  onClosed?(requestId: string): Promise<void> | void;
  onProfileChanged?(helperId: string): Promise<void> | void;
  now?(): Date;
  fetch?: typeof fetch;
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
  const now = options.now ?? (() => new Date());
  const ice = createHelpIceProvider(options.config, options.fetch, now);
  const requireHelper: express.RequestHandler = async (
    request,
    response,
    next,
  ) => {
    const id = await getHelperId(request.header("authorization") ?? "", key);
    if (!id || !(await options.store.isHelperActive(id))) {
      sendUnauthorized(response);
      return;
    }
    response.locals.helperId = id;
    next();
  };
  const participant =
    (claimedOnly: boolean): express.RequestHandler =>
    async (request, response, next) => {
      const id = helpRequestId(request.params.id);
      if (!id) {
        sendProblem(response, 400, "invalid_request", "error.invalid");
        return;
      }
      const helperId = await getHelperId(
        request.header("authorization") ?? "",
        key,
      );
      const authorize = async (actor: HelpCloseActor) => {
        if (!(await options.store.authorizeRequest?.(id, actor, claimedOnly))) {
          sendProblem(response, 404, "not_found", "error.not_found");
          return;
        }
        response.locals.helpActor = actor;
        next();
      };
      if (helperId) {
        if (!(await options.store.isHelperActive(helperId))) {
          sendUnauthorized(response);
          return;
        }
        await authorize({ role: "helper", helperId });
      } else {
        await requireSession(request, response, () => {
          const sessionId =
            typeof request.body?.sessionId === "string"
              ? request.body.sessionId
              : request.query.sessionId;
          void authorize({
            role: "learner",
            sessionId: String(sessionId),
          }).catch(next);
        });
      }
    };
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

  router.get("/help/availability", requireSession, (request, response) => {
    HelpAvailabilityQuerySchema.parse(request.query);
    const available = isHelperAvailable(
      options.config.DIMTS_HELPER_HOURS,
      now(),
    );
    const nextOpenAt = available
      ? undefined
      : nextHelperOpening(options.config.DIMTS_HELPER_HOURS, now());
    response.set("Cache-Control", "no-store").json(
      HelpAvailabilityResponseSchema.parse({
        available,
        ...(nextOpenAt ? { nextOpenAt } : {}),
        waitTimeoutMs: options.config.DIMTS_HELP_WAIT_TIMEOUT_MS,
      }),
    );
  });
  router.get("/helpers/profile", requireHelper, async (_request, response) => {
    if (!options.store.getHelperProfile) {
      sendProblem(response, 404, "not_found", "error.not_found");
      return;
    }
    response
      .set("Cache-Control", "no-store")
      .json(
        HelperProfileSchema.parse(
          await options.store.getHelperProfile(
            response.locals.helperId as string,
          ),
        ),
      );
  });
  router.patch("/helpers/profile", requireHelper, async (request, response) => {
    const profile = HelperProfileSchema.parse(request.body);
    if (!options.store.setHelperProfile) {
      sendProblem(response, 404, "not_found", "error.not_found");
      return;
    }
    const saved = await options.store.setHelperProfile(
      response.locals.helperId as string,
      profile.displayName,
    );
    await options.onProfileChanged?.(response.locals.helperId as string);
    response
      .set("Cache-Control", "no-store")
      .json(HelperProfileSchema.parse(saved));
  });
  router.get("/help/metrics", requireHelper, async (_request, response) => {
    if (!options.store.getMetrics) {
      sendProblem(response, 404, "not_found", "error.not_found");
      return;
    }
    response
      .set("Cache-Control", "no-store")
      .json(HelpMetricsSchema.parse(await options.store.getMetrics()));
  });
  router.post("/help/:id/ice", participant(true), async (request, response) => {
    HelpIceRequestSchema.parse(request.body ?? {});
    response
      .set("Cache-Control", "no-store")
      .json(HelpIceResponseSchema.parse(await ice()));
  });
  router.post(
    "/help/:id/image",
    requireSession,
    participant(false),
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: 2097152,
    }),
    async (request, response) => {
      const mime = request.header("content-type")?.split(";")[0]?.trim() ?? "";
      const normalized = Buffer.isBuffer(request.body)
        ? await validateHelpImage(request.body, mime)
        : null;
      if (!normalized) {
        sendProblem(response, 400, "invalid_request", "error.invalid");
        return;
      }
      const saved = await options.store.saveImage?.(
        String(request.params.id),
        String(request.query.sessionId),
        mime,
        normalized,
      );
      if (!saved) {
        sendProblem(response, 404, "not_found", "error.not_found");
        return;
      }
      response
        .status(201)
        .set("Cache-Control", "no-store")
        .json(HelpImageResponseSchema.parse(saved));
    },
  );
  router.get(
    "/help/:id/image",
    participant(false),
    async (request, response) => {
      if (!options.store.listImages) {
        sendProblem(response, 404, "not_found", "error.not_found");
        return;
      }
      response.set("Cache-Control", "no-store").json(
        HelpImageListSchema.parse({
          images: await options.store.listImages(
            String(request.params.id),
            response.locals.helpActor as HelpCloseActor,
          ),
        }),
      );
    },
  );
  router.get(
    "/help/:id/image/:imageId",
    participant(false),
    async (request, response) => {
      const imageId = helpRequestId(request.params.imageId);
      const image = imageId
        ? await options.store.getImage?.(
            String(request.params.id),
            imageId,
            response.locals.helpActor as HelpCloseActor,
          )
        : null;
      if (!image) {
        sendProblem(response, 404, "not_found", "error.not_found");
        return;
      }
      response
        .set({
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        })
        .type(image.mime)
        .send(image.data);
    },
  );

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

      if (!isHelperAvailable(options.config.DIMTS_HELPER_HOURS, now())) {
        sendProblem(response, 409, "conflict", "error.generic");
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
        const outcome = HelperCloseRequestSchema.parse(request.body ?? {});
        const actor: HelpCloseActor = {
          role: "helper",
          helperId,
        };
        const closed =
          outcome.resolved === undefined
            ? await options.store.closeRequest(id, actor)
            : await options.store.closeRequest(id, actor, outcome.resolved);
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
