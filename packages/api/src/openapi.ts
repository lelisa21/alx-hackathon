import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { stringify } from "yaml";
import {
  AskRequestSchema,
  FeedbackRequestSchema,
  FeedbackResponseSchema,
  HealthResponseSchema,
  HelpBlockResponseSchema,
  HelpCreateRequestSchema,
  HelpCreateResponseSchema,
  HelpQueueQuerySchema,
  HelpQueueResponseSchema,
  HelperLoginRequestSchema,
  HelperLoginResponseSchema,
  HelpClaimResponseSchema,
  LanguageListSchema,
  LocaleUiSchema,
  LocaleFaqSchema,
  ProblemSchema,
  ReplySchema,
  SessionRequestSchema,
  SessionResponseSchema,
} from "./schemas.js";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
registry.register("AskRequest", AskRequestSchema);
registry.register("FeedbackRequest", FeedbackRequestSchema);
registry.register("FeedbackResponse", FeedbackResponseSchema);
registry.register("Reply", ReplySchema);
registry.register("Problem", ProblemSchema);
registry.register("SessionRequest", SessionRequestSchema);
registry.register("SessionResponse", SessionResponseSchema);
registry.register("HealthResponse", HealthResponseSchema);
registry.register("HelperLoginRequest", HelperLoginRequestSchema);
registry.register("HelperLoginResponse", HelperLoginResponseSchema);
registry.register("HelpCreateRequest", HelpCreateRequestSchema);
registry.register("HelpCreateResponse", HelpCreateResponseSchema);
registry.register("HelpQueueResponse", HelpQueueResponseSchema);
registry.register("HelpBlockResponse", HelpBlockResponseSchema);
registry.register("HelpClaimResponse", HelpClaimResponseSchema);
registry.register("LanguageList", LanguageListSchema);
registry.register("LocaleUI", LocaleUiSchema);
registry.register("LocaleFAQ", LocaleFaqSchema);
registry.registerComponent("securitySchemes", "sessionBearer", {
  type: "http",
  scheme: "bearer",
});
registry.registerComponent("securitySchemes", "helperBearer", {
  type: "http",
  scheme: "bearer",
});
registry.registerComponent("securitySchemes", "hostKey", {
  type: "apiKey",
  in: "header",
  name: "X-Dimts-Key",
});
registry.registerComponent("securitySchemes", "cronBearer", {
  type: "http",
  scheme: "bearer",
});

const json = (schema: z.ZodTypeAny) => ({
  content: { "application/json": { schema } },
});
const problemResponse = {
  description: "Problem response",
  content: { "application/problem+json": { schema: ProblemSchema } },
};

registry.registerPath({
  method: "get",
  path: "/v1/docs",
  summary: "Open API documentation",
  responses: {
    "200": {
      description: "API documentation page",
      content: { "text/html": { schema: z.string() } },
    },
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/health",
  summary: "Health and dependency status",
  responses: {
    "200": { description: "Health status", ...json(HealthResponseSchema) },
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/languages",
  summary: "List available language packs",
  responses: {
    "200": { description: "Available languages", ...json(LanguageListSchema) },
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/locales/{code}/ui",
  summary: "Get localized UI strings",
  request: {
    params: z.object({ code: z.string() }),
    query: z.object({ lang_preview: z.enum(["0", "1"]).optional() }),
  },
  responses: {
    "200": {
      description: "UI strings resolved through the configured fallback chain",
      headers: {
        "X-Dimts-Locale-Fallback": {
          description:
            "1 when any UI string came from a fallback pack, otherwise 0",
          schema: { type: "string", enum: ["0", "1"] },
        },
        ETag: {
          description: "Validator for the resolved strings and fallback signal",
          schema: { type: "string" },
        },
      },
      ...json(LocaleUiSchema),
    },
    "304": {
      description: "Not modified; retains the X-Dimts-Locale-Fallback header",
      headers: {
        "X-Dimts-Locale-Fallback": {
          schema: { type: "string", enum: ["0", "1"] },
        },
      },
    },
    "404": problemResponse,
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/locales/{code}/faq",
  summary: "Get reviewed, actively cited offline FAQ content",
  description:
    "Draft or unreviewed packs return an empty list. Preview never authorizes draft answers. Unresolved or ambiguous source references are omitted. No identity or session is required.",
  request: {
    params: z.object({ code: z.string() }),
    query: z.object({ lang_preview: z.enum(["0", "1"]).optional() }),
    headers: z.object({ "if-none-match": z.string().optional() }),
  },
  responses: {
    "200": {
      description:
        "Reviewed FAQ with canonical active passage citations, or an honest empty list",
      headers: {
        ETag: {
          description:
            "Validator for the complete representation including content version",
          schema: { type: "string" },
        },
        "Cache-Control": {
          schema: {
            type: "string",
            const: "public, max-age=0, must-revalidate",
          },
        },
      },
      ...json(LocaleFaqSchema),
    },
    "304": {
      description: "Not modified; reuse the previously reviewed representation",
    },
    "400": {
      ...problemResponse,
      headers: {
        "Cache-Control": { schema: { type: "string", const: "no-store" } },
      },
    },
    "404": {
      ...problemResponse,
      headers: {
        "Cache-Control": { schema: { type: "string", const: "no-store" } },
      },
    },
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/sessions",
  summary: "Create or resume a learner session",
  security: [{ hostKey: [] }],
  request: {
    body: { content: { "application/json": { schema: SessionRequestSchema } } },
  },
  responses: {
    "201": {
      description: "Created session",
      ...json(SessionResponseSchema),
    },
    "200": {
      description: "Resumed session",
      ...json(SessionResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
    "403": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/ask",
  summary: "Ask a question",
  security: [{ sessionBearer: [] }],
  request: {
    body: { content: { "application/json": { schema: AskRequestSchema } } },
  },
  responses: {
    "200": { description: "Structured reply", ...json(ReplySchema) },
    "400": problemResponse,
    "401": problemResponse,
    "409": problemResponse,
    "413": problemResponse,
    "429": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/feedback",
  summary: "Record anonymous helpfulness and bounded session streak",
  description:
    "Only replyId/helpful are accepted. The bearer must belong to the reply's current session. No per-tap event or session identifier is retained in aggregates.",
  security: [{ sessionBearer: [] }],
  request: {
    body: {
      content: { "application/json": { schema: FeedbackRequestSchema } },
    },
  },
  responses: {
    "200": { description: "Counter recorded", ...json(FeedbackResponseSchema) },
    "400": problemResponse,
    "401": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/helpers/login",
  summary: "Exchange a helper token for a helper JWT",
  request: {
    body: {
      content: { "application/json": { schema: HelperLoginRequestSchema } },
    },
  },
  responses: {
    "200": {
      description: "Helper JWT",
      ...json(HelperLoginResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
    "429": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/help",
  summary: "Create a confirmed human help request",
  security: [{ sessionBearer: [] }],
  request: {
    body: {
      content: { "application/json": { schema: HelpCreateRequestSchema } },
    },
  },
  responses: {
    "201": {
      description: "Help request is waiting",
      ...json(HelpCreateResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
    "429": problemResponse,
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/help/queue",
  summary: "List waiting requests in the helper's supported languages",
  security: [{ helperBearer: [] }],
  request: { query: HelpQueueQuerySchema },
  responses: {
    "200": {
      description: "Waiting help requests ordered by creation time",
      ...json(HelpQueueResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/help/{id}/block",
  summary: "Hide a waiting request from this helper's queue",
  security: [{ helperBearer: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": {
      description: "Request hidden for this helper",
      ...json(HelpBlockResponseSchema),
    },
    "401": problemResponse,
    "404": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/help/{id}/claim",
  summary: "Claim a waiting help request",
  security: [{ helperBearer: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": {
      description: "Claim accepted",
      ...json(HelpClaimResponseSchema),
    },
    "401": problemResponse,
    "409": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/help/{id}/close",
  summary: "End a help request",
  security: [{ sessionBearer: [] }, { helperBearer: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      required: false,
      content: {
        "application/json": {
          schema: z.object({ sessionId: z.string().min(8).max(64) }).strict(),
        },
      },
    },
  },
  responses: {
    "204": { description: "Help request ended" },
    "400": problemResponse,
    "401": problemResponse,
    "404": problemResponse,
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/help/ws",
  summary: "Upgrade to the help chat WebSocket",
  description:
    "The first client frame must authenticate with a learner session token or a helper JWT within five seconds.",
  responses: {
    "101": { description: "WebSocket protocol upgrade" },
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/internal/retention",
  summary: "Delete expired session and retention data",
  security: [{ cronBearer: [] }],
  responses: {
    "200": {
      description: "Retention completed",
      ...json(z.object({ ok: z.boolean() }).strict()),
    },
    "401": problemResponse,
  },
});

const document = new OpenApiGeneratorV31(registry.definitions).generateDocument(
  {
    openapi: "3.1.0",
    info: {
      title: "Dimts API",
      version: "0.1.0",
    },
  },
);

export function generateOpenApiYaml(): string {
  return stringify(document);
}
