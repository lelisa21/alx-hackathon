import { z } from "zod";

export const AskRequestSchema = z
  .object({
    sessionId: z.string().min(8).max(64),
    clientMsgId: z.string().min(8).max(64),
    lang: z.string().min(2).max(8),
    text: z
      .string()
      .min(1)
      .max(2000)
      .describe("At most 1000 Unicode code points"),
    via: z.enum(["text", "voice", "sms", "telegram"]),
    simple: z.boolean().default(false),
  })
  .strict();

export const CitationSchema = z
  .object({
    passageId: z.string(),
    label: z.string(),
    url: z.string().url(),
    sourceLang: z.string(),
    sourceType: z.enum(["course", "job"]),
    timestamp: z.number().optional(),
  })
  .strict();

export const ActionSchema = z
  .object({
    type: z.enum([
      "help",
      "more",
      "open_source",
      "subscribe_jobs",
      "language",
      "retry",
    ]),
    label: z.string(),
  })
  .strict();

export const ReplySchema = z
  .object({
    id: z.string(),
    kind: z.enum(["answer", "notfound", "escalation", "distress", "system"]),
    text: z.string(),
    lang: z.string(),
    dir: z.enum(["ltr", "rtl"]),
    citations: z.array(CitationSchema),
    actions: z.array(ActionSchema),
    audioUrl: z.string().url().optional(),
    contentVersion: z.string(),
  })
  .strict()
  .superRefine((reply, context) => {
    if (reply.kind === "answer" && reply.citations.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Answers must include at least one citation",
        path: ["citations"],
      });
    }
  });

export const SessionRequestSchema = z
  .object({
    lang: z.string().min(2).max(8).optional(),
    channel: z.enum(["web", "api"]).default("web"),
    sessionId: z.string().min(8).max(64).optional(),
    resumeToken: z.string().min(20).max(100).optional(),
    cloudOk: z.boolean().optional(),
    consentVersion: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if (Boolean(body.sessionId) !== Boolean(body.resumeToken)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sessionId and resumeToken must be provided together",
      });
    }
    if (body.cloudOk && !body.consentVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "consentVersion is required when cloudOk is true",
        path: ["consentVersion"],
      });
    }
    if (body.consentVersion && !body.cloudOk) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "consentVersion is only valid when cloudOk is true",
        path: ["consentVersion"],
      });
    }
  });

export const SessionResponseSchema = z
  .object({
    sessionId: z.string(),
    sessionToken: z.string(),
    resumeToken: z.string(),
    lang: z.string(),
    cloudOk: z.boolean(),
    consentVersion: z.string().nullable(),
  })
  .strict();

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number(),
    code: z.enum([
      "invalid_request",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "rate_limited",
      "payload_too_large",
      "internal",
    ]),
    messageKey: z.string(),
  })
  .strict();

export const HealthResponseSchema = z
  .object({
    ok: z.boolean(),
    db: z.boolean(),
    version: z.string(),
    contentVersion: z.string(),
    provider: z.string(),
    ladder: z.array(z.string()),
  })
  .strict();

export const LanguageSchema = z
  .object({
    code: z.string(),
    nameNative: z.string(),
    nameEn: z.string(),
    script: z.string(),
    dir: z.enum(["ltr", "rtl"]),
    status: z.enum(["live", "beta", "draft"]),
    stt: z.boolean(),
    tts: z.boolean(),
  })
  .strict();

export const LanguageListSchema = z
  .object({ languages: z.array(LanguageSchema) })
  .strict();

export const LocaleUiSchema = z.record(z.string());

export const PreviewQuerySchema = z
  .object({ lang_preview: z.enum(["0", "1"]).optional() })
  .strict();
