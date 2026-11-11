import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { stringify } from "yaml";
import {
  AskRequestSchema,
  HealthResponseSchema,
  LanguageListSchema,
  LocaleUiSchema,
  ProblemSchema,
  ReplySchema,
  SessionRequestSchema,
  SessionResponseSchema,
} from "./schemas.js";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
registry.register("AskRequest", AskRequestSchema);
registry.register("Reply", ReplySchema);
registry.register("Problem", ProblemSchema);
registry.register("SessionRequest", SessionRequestSchema);
registry.register("SessionResponse", SessionResponseSchema);
registry.register("HealthResponse", HealthResponseSchema);
registry.register("LanguageList", LanguageListSchema);
registry.register("LocaleUI", LocaleUiSchema);
registry.registerComponent("securitySchemes", "sessionBearer", {
  type: "http",
  scheme: "bearer",
});
registry.registerComponent("securitySchemes", "hostKey", {
  type: "apiKey",
  in: "header",
  name: "X-Dimts-Key",
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
    "200": { description: "UI strings", ...json(LocaleUiSchema) },
    "304": { description: "Not modified" },
    "404": problemResponse,
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
