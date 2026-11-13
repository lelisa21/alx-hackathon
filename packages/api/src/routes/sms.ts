import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { SmsError, type SmsService } from "@dimts/sms";
import { loadPacks, type LangPack } from "@dimts/locales-tools";
import type { ApiConfig } from "../config.js";
import type { ProblemCode } from "../middleware/problem.js";
import {
  SmsInboundRequestSchema,
  SmsInboundResponseSchema,
  SmsProblemSchema,
} from "../sms-schemas.js";

export function createSmsRouter(options: {
  config: ApiConfig;
  service?: Pick<SmsService, "inbound" | "sendAlert">;
  packs?: Map<string, LangPack>;
}): express.Router {
  const router = express.Router();
  const packs =
    options.packs ??
    loadPacks(fileURLToPath(new URL("../../../../locales", import.meta.url)));
  function problem(
    response: express.Response,
    status: number,
    code: ProblemCode,
    messageKey: string,
    template: string,
    requestedLang = "en",
  ): void {
    const pack = packs.get(requestedLang) ?? packs.get("en")!;
    const messages = pack.sms as Record<string, unknown>;
    const fallback = packs.get("en")!.sms as Record<string, unknown>;
    const message = messages[template] ?? fallback[template] ?? fallback.error;
    response
      .set("Content-Language", pack.meta.code)
      .status(status)
      .type("application/problem+json")
      .json(
        SmsProblemSchema.parse({
          type: "about:blank",
          title: code,
          status,
          code,
          messageKey,
          lang: pack.meta.code,
          message,
        }),
      );
  }
  const authenticate: express.RequestHandler = (request, response, next) => {
    response.set("Cache-Control", "no-store");
    const { config, service } = options;
    if (!config.DIMTS_SMS_GATEWAY_SECRET || !service) {
      problem(response, 503, "internal", "sms.unavailable", "unavailable");
      return;
    }
    const match = /^Bearer ([^\s]+)$/u.exec(
      request.header("authorization") ?? "",
    );
    const provided = Buffer.from(match?.[1] ?? "");
    const expected = Buffer.from(config.DIMTS_SMS_GATEWAY_SECRET);
    if (
      !match ||
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      problem(response, 401, "unauthorized", "error.generic", "error");
      return;
    }
    next();
  };
  router.post(
    "/sms/inbound",
    authenticate,
    express.json({ limit: "16kb", strict: true }),
    async (request, response) => {
      const service = options.service!;
      const input = SmsInboundRequestSchema.safeParse(request.body);
      if (!input.success) {
        problem(response, 400, "invalid_request", "error.invalid", "invalid");
        return;
      }
      try {
        const result = SmsInboundResponseSchema.safeParse(
          await service.inbound(input.data),
        );
        if (!result.success) {
          problem(response, 500, "internal", "sms.error", "error");
          return;
        }
        response.set("Content-Language", result.data.lang).json(result.data);
      } catch (error) {
        if (!(error instanceof SmsError)) {
          // Do not serialize, log or echo transport errors that may include contact/text.
          problem(response, 500, "internal", "sms.error", "error");
          return;
        }
        const status = {
          invalid: 400,
          conflict: 409,
          rate_limited: 429,
          unavailable: 503,
          delivery_failed: 503,
        }[error.code];
        const code =
          error.code === "invalid"
            ? "invalid_request"
            : error.code === "unavailable" || error.code === "delivery_failed"
              ? "internal"
              : error.code;
        const template =
          error.code === "rate_limited"
            ? "limit"
            : error.code === "delivery_failed" || error.code === "unavailable"
              ? "error"
              : error.code;
        if (error.code === "rate_limited") response.set("Retry-After", "60");
        problem(
          response,
          status,
          code,
          error.code === "invalid" ? "error.invalid" : `sms.${template}`,
          template,
          error.lang,
        );
      }
    },
  );
  router.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      const kind =
        typeof error === "object" && error !== null && "type" in error
          ? error.type
          : undefined;
      if (kind === "entity.too.large")
        problem(
          response,
          413,
          "payload_too_large",
          "error.too_long",
          "invalid",
        );
      else if (kind === "entity.parse.failed")
        problem(response, 400, "invalid_request", "error.invalid", "invalid");
      else problem(response, 500, "internal", "sms.error", "error");
    },
  );
  return router;
}
