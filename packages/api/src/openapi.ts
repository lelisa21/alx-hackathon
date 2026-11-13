import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { stringify } from "yaml";
import {
  SmsInboundRequestSchema,
  SmsInboundResponseSchema,
  SmsMessageSchema,
  SmsProblemSchema,
} from "./sms-schemas.js";
import {
  AccommodationListResponseSchema,
  AccommodationRequestSchema,
  AccommodationResponseSchema,
  AlertsQuerySchema,
  AlertsResponseSchema,
  CareerOkSchema,
  CareerSessionQuerySchema,
  JobsImportRequestSchema,
  JobsImportResponseSchema,
  JobsQuerySchema,
  JobsResponseSchema,
  SubscriptionRequestSchema,
  SubscriptionResponseSchema,
  SubscriptionsResponseSchema,
} from "./jobs-schemas.js";
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
  HelpAvailabilityQuerySchema,
  HelpAvailabilityResponseSchema,
  HelperProfileSchema,
  HelpMetricsSchema,
  HelpIceRequestSchema,
  HelpIceResponseSchema,
  HelpImageResponseSchema,
  HelpImageListSchema,
  HelperCloseRequestSchema,
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
registry.register("SmsInboundRequest", SmsInboundRequestSchema);
registry.register("SmsMessage", SmsMessageSchema);
registry.register("SmsInboundResponse", SmsInboundResponseSchema);
registry.register("SmsProblem", SmsProblemSchema);
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
registry.register("HelpAvailabilityResponse", HelpAvailabilityResponseSchema);
registry.register("HelperProfile", HelperProfileSchema);
registry.register("HelpMetrics", HelpMetricsSchema);
registry.register("HelpIceResponse", HelpIceResponseSchema);
registry.register("HelpImage", HelpImageResponseSchema);
registry.register("HelpImageList", HelpImageListSchema);
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
registry.registerComponent("securitySchemes", "smsGatewayBearer", {
  type: "http",
  scheme: "bearer",
  description:
    "Separately configured DIMTS_SMS_GATEWAY_SECRET; never a session, host or cron credential",
});

const json = (schema: z.ZodTypeAny) => ({
  content: { "application/json": { schema } },
});
const problemResponse = {
  description: "Problem response",
  content: { "application/problem+json": { schema: ProblemSchema } },
};

const smsProblemResponse = {
  description: "Localized SMS problem without contact or input text",
  content: { "application/problem+json": { schema: SmsProblemSchema } },
};
registry.registerPath({
  method: "post",
  path: "/v1/sms/inbound",
  summary: "Accept an authenticated SMS gateway or simulator inbound message",
  description:
    "The simulator uses this same service path. IDs are stable per pseudonymous phone identity; retries preserve the exact body, while changed payloads conflict. First contact returns a numeric language menu. STOP bypasses conversation burst/daily limits, confirms once and remains permanent. Responses are no-store; the gateway secret and phone number are never returned. At most 1000 Unicode code points are accepted. Per-phone burst limit is 30 new messages/minute and outbound limit defaults to 20/day; repeated inbound IDs do not repeat side effects.",
  security: [{ smsGatewayBearer: [] }],
  request: { body: { required: true, ...json(SmsInboundRequestSchema) } },
  responses: {
    "200": {
      description:
        "Delivered or pending SMS messages, permanent STOP state and persisted conversation language",
      ...json(SmsInboundResponseSchema),
    },
    "400": smsProblemResponse,
    "401": smsProblemResponse,
    "409": smsProblemResponse,
    "413": smsProblemResponse,
    "429": smsProblemResponse,
    "500": smsProblemResponse,
    "503": smsProblemResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/help/availability",
  summary: "Get scheduled helper availability and calm waiting threshold",
  security: [{ sessionBearer: [] }],
  request: { query: HelpAvailabilityQuerySchema },
  responses: {
    "200": {
      description: "UTC schedule, not live helper presence",
      ...json(HelpAvailabilityResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
  },
});
for (const method of ["get", "patch"] as const)
  registry.registerPath({
    method,
    path: "/v1/helpers/profile",
    summary:
      "Read or deliberately change the optional public helper first name",
    security: [{ helperBearer: [] }],
    ...(method === "patch"
      ? {
          request: {
            body: {
              content: { "application/json": { schema: HelperProfileSchema } },
            },
          },
        }
      : {}),
    responses: {
      "200": {
        description: "Null disables public name",
        ...json(HelperProfileSchema),
      },
      "400": problemResponse,
      "401": problemResponse,
    },
  });
registry.registerPath({
  method: "get",
  path: "/v1/help/metrics",
  summary: "Anonymous service totals without content or identifiers",
  description:
    "closedCount includes unclassified outcomes. Only explicit helper resolved true/false increments resolvedCount/unresolvedCount. Wait and resolution totals include only claimed requests that have closed; units are milliseconds. No per-session or helper breakdown is stored.",
  security: [{ helperBearer: [] }],
  responses: {
    "200": {
      description: "Aggregate counts and duration totals",
      ...json(HelpMetricsSchema),
    },
    "401": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/help/{id}/ice",
  summary:
    "Get short-lived ICE configuration for a claimed request participant",
  description:
    "Authenticated owning session or assigned active helper. Public STUN only when TURN is unconfigured/unavailable; application TURN secrets are never returned. Responses are no-store.",
  security: [{ sessionBearer: [] }, { helperBearer: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      required: false,
      content: { "application/json": { schema: HelpIceRequestSchema } },
    },
  },
  responses: {
    "200": { description: "ICE configuration", ...json(HelpIceResponseSchema) },
    "400": problemResponse,
    "401": problemResponse,
    "404": problemResponse,
  },
});
const participantQuery = z
  .object({ sessionId: z.string().min(8).max(64).optional() })
  .strict();
registry.registerPath({
  method: "post",
  path: "/v1/help/{id}/image",
  summary: "Upload a learner-selected screen picture",
  description:
    "Raw JPEG/PNG/WebP, maximum 2097152 bytes, fully decoded with a 16 million pixel cap, single frame, metadata stripped before database-only storage. Owning learner of a waiting or claimed request. At most five retained images per request. No filenames or data URLs. Expires after two hours or earlier close/session deletion.",
  security: [{ sessionBearer: [] }],
  request: {
    params: z.object({ id: z.string() }),
    query: HelpAvailabilityQuerySchema,
    body: {
      required: true,
      content: Object.fromEntries(
        ["image/jpeg", "image/png", "image/webp"].map((mime) => [
          mime,
          { schema: z.string().openapi({ format: "binary" }) },
        ]),
      ),
    },
  },
  responses: {
    "201": {
      description: "Stored image metadata",
      ...json(HelpImageResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
    "404": problemResponse,
    "413": problemResponse,
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/help/{id}/image",
  summary: "List unexpired help picture metadata",
  security: [{ sessionBearer: [] }, { helperBearer: [] }],
  request: { params: z.object({ id: z.string() }), query: participantQuery },
  responses: {
    "200": {
      description: "Private no-store image metadata",
      ...json(HelpImageListSchema),
    },
    "401": problemResponse,
    "404": problemResponse,
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/help/{id}/image/{imageId}",
  summary: "Retrieve an authorized unexpired help picture",
  security: [{ sessionBearer: [] }, { helperBearer: [] }],
  request: {
    params: z.object({ id: z.string(), imageId: z.string() }),
    query: participantQuery,
  },
  responses: {
    "200": {
      description:
        "Private no-store image bytes with nosniff; owner or assigned active helper only",
      content: Object.fromEntries(
        ["image/jpeg", "image/png", "image/webp"].map((mime) => [
          mime,
          { schema: z.string().openapi({ format: "binary" }) },
        ]),
      ),
    },
    "401": problemResponse,
    "404": problemResponse,
  },
});

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
  description:
    "Voice flags intersect configured browser engines with reviewed, non-draft pack approvals and a matching BCP 47 declaration. Preview never enables draft voice. Browser capabilities may further disable a direction.",
  request: {
    query: z.object({ lang_preview: z.enum(["0", "1"]).optional() }),
  },
  responses: {
    "200": { description: "Available languages", ...json(LanguageListSchema) },
    "400": problemResponse,
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
          schema: z.union([
            z.object({ sessionId: z.string().min(8).max(64) }).strict(),
            HelperCloseRequestSchema,
          ]),
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

registry.register("JobImportRequest", JobsImportRequestSchema);
registry.register("JobImportResponse", JobsImportResponseSchema);
registry.register("Jobs", JobsResponseSchema);
registry.register("SubscriptionRequest", SubscriptionRequestSchema);
registry.register("Subscription", SubscriptionResponseSchema);
registry.register("AccommodationRequest", AccommodationRequestSchema);
registry.register("Accommodation", AccommodationResponseSchema);
registry.registerPath({
  method: "post",
  path: "/v1/jobs/import",
  summary:
    "Import JSON-LD JobPosting items and atomically publish cited passages",
  description:
    "X-Dimts-Key must resolve to a host registry row with key_type secret. The public widget key is never sufficient. postings accepts an item, array or @graph. Required posting fields include url for citation provenance; unknown posting fields are ignored. Invalid indexes are returned without raw data.",
  security: [{ hostKey: [] }],
  request: { body: { required: true, ...json(JobsImportRequestSchema) } },
  responses: {
    "200": {
      description: "Partial import results",
      ...json(JobsImportResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
    "429": problemResponse,
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/jobs",
  summary:
    "Search public job details, configured delivery availability and locale glossary",
  description:
    "No employer contact is returned. Support filters remain client-session-only; unknown query parameters are rejected. deadlineDisplay uses both learner and alternate calendars.",
  security: [{ sessionBearer: [] }],
  request: { query: JobsQuerySchema },
  responses: {
    "200": { description: "Public job listing", ...json(JobsResponseSchema) },
    "400": problemResponse,
    "401": problemResponse,
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/subscriptions",
  summary: "Restore the owning session's subscriptions without contact data",
  security: [{ sessionBearer: [] }],
  request: { query: CareerSessionQuerySchema },
  responses: {
    "200": {
      description: "Subscriptions",
      ...json(SubscriptionsResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/subscriptions",
  summary: "Create an idempotent consented alert subscription",
  description:
    "UI must show localized consent before collecting contact. Contact is encrypted at rest; the response never echoes it. Unconfigured delivery channels are unavailable.",
  security: [{ sessionBearer: [] }],
  request: { body: { required: true, ...json(SubscriptionRequestSchema) } },
  responses: {
    "201": {
      description: "Subscription identity",
      ...json(SubscriptionResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
    "409": problemResponse,
    "429": problemResponse,
    "503": problemResponse,
  },
});
registry.registerPath({
  method: "delete",
  path: "/v1/subscriptions/{id}",
  summary: "Stop an owned subscription and erase its contact",
  security: [{ sessionBearer: [] }],
  request: {
    params: z.object({ id: z.string() }),
    query: CareerSessionQuerySchema,
  },
  responses: {
    "200": { description: "Stopped", ...json(CareerOkSchema) },
    "400": problemResponse,
    "401": problemResponse,
    "404": problemResponse,
  },
});
registry.registerPath({
  method: "get",
  path: "/v1/accommodation-requests",
  summary: "Find owning session's resumable request metadata",
  security: [{ sessionBearer: [] }],
  request: { query: CareerSessionQuerySchema },
  responses: {
    "200": {
      description: "Private no-store metadata",
      ...json(AccommodationListResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/accommodation-requests",
  summary:
    "Draft, resume, approve, send or cancel a private interview support request",
  description:
    "Only draft accepts needs, optional name and interview time. Draft edits create a new revision; approval freezes the exact message. Approve and send require the exact current revision; send requires explicit prior approval. sendAttempted is durable before external delivery, and blocks editing or cancellation of an uncertain send. Target comes only from the posting's hiringOrganization.contactPoint.email. Retry uses the same durable idempotency key. Responses are no-store; no diagnosis or proof fields are accepted.",
  security: [{ sessionBearer: [] }],
  request: { body: { required: true, ...json(AccommodationRequestSchema) } },
  responses: {
    "200": {
      description: "Exact private request for review",
      ...json(AccommodationResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
    "404": problemResponse,
    "409": problemResponse,
    "429": problemResponse,
    "503": problemResponse,
  },
});
registry.registerPath({
  method: "post",
  path: "/v1/internal/alerts",
  summary:
    "Run at most one daily digest per subscriber or preview without sending",
  security: [{ cronBearer: [] }],
  request: { query: AlertsQuerySchema },
  responses: {
    "200": {
      description: "Aggregate counts only",
      ...json(AlertsResponseSchema),
    },
    "400": problemResponse,
    "401": problemResponse,
    "503": problemResponse,
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
