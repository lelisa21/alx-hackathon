import "./zod-openapi.js";
import { z } from "zod";

const id = z.string().min(8).max(128);
const lang = z.string().min(2).max(35);
const filter = z.string().trim().min(1).max(120);
export const CareerSessionQuerySchema = z.object({ sessionId: id }).strict();
export const JobsImportRequestSchema = z
  .object({
    lang,
    postings: z.unknown().refine((value) => value !== undefined),
  })
  .strict();
export const JobsImportResponseSchema = z
  .object({
    imported: z.number().int().nonnegative(),
    errors: z.array(
      z
        .object({ index: z.number().int().nonnegative(), reason: z.string() })
        .strict(),
    ),
  })
  .strict();
export const JobsQuerySchema = z
  .object({
    sessionId: id,
    lang: lang.optional(),
    region: filter.optional(),
    type: filter.optional(),
  })
  .strict();
export const PublicJobSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    organization: z.string(),
    location: z.string(),
    region: z.string().nullable(),
    jobType: z.string().nullable(),
    datePosted: z.string(),
    deadline: z.string().nullable(),
    deadlineDisplay: z.string().nullable(),
    url: z.string().url(),
    lang,
    accommodationsOffered: z.array(z.string()),
  })
  .strict();
export const JobsResponseSchema = z
  .object({
    jobs: z.array(PublicJobSchema),
    channels: z.array(z.enum(["sms", "telegram"])),
    relayAvailable: z.boolean(),
    glossary: z.array(
      z.object({ term: z.string(), meaning: z.string() }).strict(),
    ),
  })
  .strict();
export const SubscriptionRequestSchema = z
  .object({
    sessionId: id,
    clientRequestId: id,
    jobType: filter.optional(),
    region: filter.optional(),
    lang,
    channel: z.enum(["sms", "telegram"]),
    contact: z.string().trim().min(1).max(128),
    consent: z
      .object({
        accepted: z.literal(true),
        noticeVersion: z.literal("job-alerts-v1"),
      })
      .strict(),
  })
  .strict();
export const SubscriptionResponseSchema = z
  .object({ id: z.string(), status: z.enum(["active", "stopped"]) })
  .strict();
export const SubscriptionsResponseSchema = z
  .object({
    subscriptions: z.array(
      SubscriptionResponseSchema.extend({
        jobType: z.string().nullable().optional(),
        region: z.string().nullable().optional(),
        lang,
        channel: z.enum(["sms", "telegram"]),
      }),
    ),
  })
  .strict();
export const CareerOkSchema = z.object({ ok: z.literal(true) }).strict();
const need = z.enum([
  "sign_language_interpreter",
  "step_free_access",
  "written_questions",
  "extra_time",
  "screen_reader_friendly_test",
  "other",
]);
const needs = z.array(need).min(1).max(6);
const draft = z
  .object({
    action: z.literal("draft"),
    sessionId: id,
    clientRequestId: id,
    jobId: z.string().min(1).max(128),
    lang,
    needs,
    otherText: z.string().trim().min(1).max(1000).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    interviewAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export const AccommodationRequestSchema = z.discriminatedUnion("action", [
  draft,
  z.object({ action: z.literal("resume"), sessionId: id, id }).strict(),
  z.object({ action: z.literal("cancel"), sessionId: id, id }).strict(),
  z
    .object({
      action: z.literal("approve"),
      sessionId: id,
      id,
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("send"),
      sessionId: id,
      id,
      revision: z.number().int().positive(),
    })
    .strict(),
]);
const accommodationStatus = z.enum(["draft", "approved", "sent", "cancelled"]);
export const AccommodationResponseSchema = z
  .object({
    id: z.string(),
    revision: z.number().int().positive(),
    status: accommodationStatus,
    sendAttempted: z.boolean(),
    message: z.string(),
    jobId: z.string(),
    lang,
    needs: z.array(need).max(6),
    otherText: z.string().optional(),
    name: z.string().optional(),
    interviewAt: z.string().optional(),
    interviewDisplay: z.string().optional(),
  })
  .strict();
export const AccommodationListResponseSchema = z
  .object({
    requests: z.array(
      z
        .object({
          id: z.string(),
          jobId: z.string(),
          status: accommodationStatus,
        })
        .strict(),
    ),
  })
  .strict();
export const AlertsQuerySchema = z
  .object({ dry: z.enum(["0", "1"]).optional() })
  .strict();
export const AlertsResponseSchema = z
  .object({
    matched: z.number().int().nonnegative(),
    sent: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .strict();
