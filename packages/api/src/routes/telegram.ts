import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { parseTelegramUpdate } from "@dimts/telegram";
import { loadPacks, type LangPack } from "@dimts/locales-tools";
import type { ApiConfig } from "../config.js";
import { TelegramProblemSchema } from "../telegram-schemas.js";

export function createTelegramRouter(options: {
  config: ApiConfig;
  service?: { handleUpdate(update: unknown): Promise<unknown> };
  packs?: Map<string, LangPack>;
}): express.Router {
  const router = express.Router();
  const packs =
    options.packs ??
    loadPacks(fileURLToPath(new URL("../../../../locales", import.meta.url)));
  function problem(response: express.Response, status: number, code: string) {
    response
      .status(status)
      .type("application/problem+json")
      .json(
        TelegramProblemSchema.parse({
          type: "about:blank",
          title: code,
          status,
          code,
          messageKey: "telegram.error",
          lang: "en",
          message: packs.get("en")!.ui["telegram.error"],
        }),
      );
  }
  const authenticate: express.RequestHandler = (request, response, next) => {
    response.set("Cache-Control", "no-store").set("Content-Language", "en");
    const { config } = options;
    if (
      !options.service ||
      !config.DIMTS_TELEGRAM_TOKEN ||
      !config.DIMTS_TELEGRAM_SECRET ||
      config.DIMTS_TELEGRAM_MODE !== "webhook"
    ) {
      problem(response, 503, "internal");
      return;
    }
    const supplied = Buffer.from(
      request.header("X-Telegram-Bot-Api-Secret-Token") ?? "",
    );
    const expected = Buffer.from(config.DIMTS_TELEGRAM_SECRET);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      problem(response, 401, "unauthorized");
      return;
    }
    next();
  };
  router.post(
    "/telegram/webhook",
    authenticate,
    express.json({ limit: "64kb", strict: true }),
    async (request, response) => {
      let input;
      try {
        input = parseTelegramUpdate(request.body);
      } catch {
        problem(response, 400, "invalid_request");
        return;
      }
      if (!input) {
        response.json({ ok: true });
        return;
      }
      try {
        // The same service parses and handles raw updates supplied by local polling.
        await options.service!.handleUpdate(request.body);
        response.json({ ok: true });
      } catch {
        // Neither upstream API errors nor request content may reach logs or callers.
        problem(response, 503, "internal");
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
        problem(response, 413, "payload_too_large");
      else if (kind === "entity.parse.failed")
        problem(response, 400, "invalid_request");
      else problem(response, 500, "internal");
    },
  );
  return router;
}
