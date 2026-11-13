import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import type { AskDependencies } from "@dimts/engine";
import type { PostgresGrounding } from "@dimts/grounding";
import { z } from "zod";
import { getVisiblePacks, resolveUi } from "@dimts/locales-tools";
import type { LangPack } from "@dimts/locales-tools";
import type { ApiConfig } from "../config.js";
import { generateOpenApiYaml } from "../openapi.js";
import {
  AskRequestSchema,
  DataDeleteRequestSchema,
  FeedbackRequestSchema,
  FeedbackResponseSchema,
  HealthResponseSchema,
  LanguageListSchema,
  LocaleUiSchema,
  PreviewQuerySchema,
  SessionRequestSchema,
  SessionResponseSchema,
} from "../schemas.js";
import type { ApiRepository } from "../types.js";
import {
  ConversationError,
  createConversationService,
} from "../conversation.js";
import type { ApiProviderRuntime } from "../provider-runtime.js";
import {
  createSessionAuth,
  matchesSessionToken,
  sha256,
} from "../middleware/auth.js";
import { sendProblem } from "../middleware/problem.js";
import type { ConversationStateStore } from "../db/conversation-state.js";
import { buildReviewedFaq } from "../faq.js";
import { getVoiceCapabilities } from "../voice-capabilities.js";

interface CoreRouteOptions {
  config: ApiConfig;
  repository: ApiRepository;
  packs: Map<string, LangPack>;
  askDependencies?: AskDependencies;
  providerRuntime?: ApiProviderRuntime;
  grounding?: Pick<PostgresGrounding, "currentVersion"> &
    Partial<Pick<PostgresGrounding, "resolveFaqCitations">>;
  conversationStore?: ConversationStateStore;
}

function parsePreviewQuery(
  request: Request,
  response: Response,
): boolean | null {
  const parsed = PreviewQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    sendProblem(response, 400, "invalid_request", "error.invalid");
    return null;
  }
  return parsed.data.lang_preview === "1";
}

function validPublicLang(packs: Map<string, LangPack>, lang: string): boolean {
  const pack = packs.get(lang);
  return Boolean(pack && pack.meta.status !== "draft");
}

function validateResponse<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error("API response schema validation failed");
  }
  return parsed.data;
}

export function createCoreRouter(options: CoreRouteOptions): Router {
  const router = express.Router();
  const { config, packs, repository } = options;
  const conversation = createConversationService(options);
  const requireSession = createSessionAuth(repository);

  if (options.conversationStore) {
    router.post("/feedback", async (request, response) => {
      const token = /^Bearer ([A-Za-z0-9_-]{20,100})$/u.exec(
        request.header("authorization") ?? "",
      )?.[1];
      if (!token) {
        sendProblem(response, 401, "unauthorized", "error.generic");
        return;
      }
      const body = FeedbackRequestSchema.parse(request.body);
      const accepted = await options.conversationStore!.recordFeedback({
        ...body,
        tokenHash: sha256(token),
      });
      if (!accepted) {
        sendProblem(response, 401, "unauthorized", "error.generic");
        return;
      }
      response.json(FeedbackResponseSchema.parse({ ok: true }));
    });
  }

  router.post("/data/delete", async (request, response) => {
    const body = DataDeleteRequestSchema.safeParse(request.body);
    if (!body.success) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }

    const token = /^Bearer ([A-Za-z0-9_-]{20,100})$/u.exec(
      request.header("authorization") ?? "",
    )?.[1];
    if (!token) {
      sendProblem(response, 401, "unauthorized", "error.generic");
      return;
    }

    const storedHash = await repository.getSessionTokenHash(
      body.data.sessionId,
    );
    if (storedHash === null) {
      response.status(204).end();
      return;
    }
    if (!matchesSessionToken(storedHash, sha256(token))) {
      sendProblem(response, 401, "unauthorized", "error.generic");
      return;
    }

    await repository.deleteSessionData(body.data.sessionId);
    response.status(204).end();
  });

  router.get("/health", async (_request, response) => {
    let timer: NodeJS.Timeout | undefined;
    const health = await Promise.race([
      Promise.all([
        repository.ping().then(
          () => true,
          () => false,
        ),
        options.grounding
          ? options.grounding.currentVersion().catch(() => "unavailable")
          : Promise.resolve("unavailable"),
      ]).then(([database, contentVersion]) => ({
        database,
        contentVersion,
      })),
      new Promise<{ database: boolean; contentVersion: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ database: false, contentVersion: "unavailable" }),
          1500,
        );
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    response.json(
      validateResponse(HealthResponseSchema, {
        ok: true,
        db: health.database,
        version: "0.1.0",
        contentVersion: health.contentVersion,
        provider:
          options.providerRuntime?.activeProvider ?? config.DIMTS_AI_PROVIDER,
        ladder:
          options.providerRuntime?.providerOrder ??
          config.DIMTS_AI_LADDER.split(",").map((provider) => provider.trim()),
      }),
    );
  });

  router.get("/languages", (request, response) => {
    const preview = parsePreviewQuery(request, response);
    if (preview === null) return;
    const languages = getVisiblePacks(packs, preview).map((pack) => ({
      code: pack.meta.code,
      nameNative: pack.meta.name_native,
      nameEn: pack.meta.name_en,
      script: pack.meta.script,
      dir: pack.meta.dir,
      status: pack.meta.status,
      ...getVoiceCapabilities(pack, config),
    }));
    response.json(validateResponse(LanguageListSchema, { languages }));
  });

  router.get("/locales/:code/ui", (request, response) => {
    const preview = parsePreviewQuery(request, response);
    if (preview === null) return;
    const pack = packs.get(request.params.code ?? "");
    if (!pack || (pack.meta.status === "draft" && !preview)) {
      sendProblem(response, 404, "not_found", "error.not_found");
      return;
    }

    const resolved = resolveUi(packs, pack.meta.code);
    const ui = JSON.stringify(resolved.ui);
    const fallback = resolved.didFallback ? "1" : "0";
    // The notice is part of the cached representation even when text is identical.
    const etag = `"${createHash("sha256").update(`${fallback}:${ui}`).digest("base64url")}"`;
    response.setHeader("ETag", etag);
    response.setHeader("X-Dimts-Locale-Fallback", fallback);
    response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    if (request.header("if-none-match")?.split(",").includes(etag)) {
      response.status(304).end();
      return;
    }
    response.json(validateResponse(LocaleUiSchema, resolved.ui));
  });

  router.get("/locales/:code/faq", async (request, response) => {
    // Only successful reviewed representations are public cache candidates.
    response.setHeader("Cache-Control", "no-store");
    const preview = parsePreviewQuery(request, response);
    if (preview === null) return;
    const pack = packs.get(request.params.code ?? "");
    if (!pack || (pack.meta.status === "draft" && !preview)) {
      sendProblem(response, 404, "not_found", "error.not_found");
      return;
    }
    const payload = await buildReviewedFaq(
      pack,
      (await options.grounding?.currentVersion()) ?? "unavailable",
      options.grounding?.resolveFaqCitations?.bind(options.grounding),
    );
    const etag = `"${createHash("sha256").update(JSON.stringify(payload)).digest("base64url")}"`;
    response.setHeader("ETag", etag);
    response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    if (
      request
        .header("if-none-match")
        ?.split(",")
        .map((value) => value.trim().replace(/^W\//u, ""))
        .some((value) => value === etag || value === "*")
    ) {
      response.status(304).end();
      return;
    }
    response.json(payload);
  });

  router.get("/docs", (_request, response) => {
    response
      .type("html")
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Dimts API</title><main><h1>Dimts API</h1><a href="/v1/openapi.yaml">OpenAPI specification</a></main></html>',
      );
  });

  router.get("/openapi.yaml", (_request, response) => {
    response.type("application/yaml").send(generateOpenApiYaml());
  });

  router.post("/sessions", async (request, response) => {
    const body = SessionRequestSchema.parse(request.body ?? {});
    const key = request.header("x-dimts-key") ?? "";
    if (!key) {
      sendProblem(response, 401, "unauthorized", "error.generic");
      return;
    }

    const host = await repository.getHostByHash(sha256(key));
    if (!host) {
      sendProblem(response, 401, "unauthorized", "error.generic");
      return;
    }
    const origin = request.header("origin");
    if (
      host.origins.length > 0 &&
      (!origin || !host.origins.includes(origin))
    ) {
      sendProblem(response, 403, "forbidden", "error.generic");
      return;
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const resumeToken = randomBytes(32).toString("base64url");
    if (body.sessionId && body.resumeToken) {
      if (
        body.cloudOk &&
        body.consentVersion !== config.DIMTS_AI_CONSENT_VERSION
      ) {
        sendProblem(response, 400, "invalid_request", "error.invalid");
        return;
      }
      const resumed = await repository.resumeSession({
        id: body.sessionId,
        currentResumeHash: sha256(body.resumeToken),
        tokenHash: sha256(sessionToken),
        resumeHash: sha256(resumeToken),
        ...(body.cloudOk === undefined ? {} : { cloudOk: body.cloudOk }),
        ...(body.consentVersion === undefined
          ? {}
          : { consentVersion: body.consentVersion }),
      });
      if (!resumed) {
        sendProblem(response, 401, "unauthorized", "error.generic");
        return;
      }
      response.json(
        validateResponse(SessionResponseSchema, {
          sessionId: resumed.id,
          sessionToken,
          resumeToken,
          lang: resumed.lang,
          cloudOk: resumed.cloudOk,
          consentVersion: resumed.consentVersion,
        }),
      );
      return;
    }

    const lang = body.lang ?? config.DIMTS_DEFAULT_LANG;
    if (!validPublicLang(packs, lang)) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }
    const sessionId = randomBytes(16).toString("base64url");
    const cloudOk = body.cloudOk ?? false;
    if (cloudOk && body.consentVersion !== config.DIMTS_AI_CONSENT_VERSION) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }
    await repository.createSession({
      id: sessionId,
      channel: body.channel,
      lang,
      tokenHash: sha256(sessionToken),
      resumeHash: sha256(resumeToken),
      cloudOk,
      consentVersion: cloudOk ? (body.consentVersion ?? null) : null,
    });
    response.status(201).json(
      validateResponse(SessionResponseSchema, {
        sessionId,
        sessionToken,
        resumeToken,
        lang,
        cloudOk,
        consentVersion: cloudOk ? (body.consentVersion ?? null) : null,
      }),
    );
  });

  router.post("/ask", requireSession, async (request, response) => {
    if (
      typeof request.body?.text === "string" &&
      Array.from(request.body.text).length > 1000
    ) {
      sendProblem(response, 413, "payload_too_large", "error.too_long");
      return;
    }
    const body = AskRequestSchema.parse(request.body);
    if (!validPublicLang(packs, body.lang)) {
      sendProblem(response, 400, "invalid_request", "error.invalid");
      return;
    }

    try {
      response.json(await conversation(body));
    } catch (error) {
      if (!(error instanceof ConversationError)) throw error;
      sendProblem(
        response,
        error.code === "rate_limited" ? 429 : 409,
        error.code,
        error.code === "rate_limited" ? "limit.reached" : "error.generic",
      );
    }
  });

  return router;
}
