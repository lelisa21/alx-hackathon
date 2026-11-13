import { z } from "zod";
import { ProblemSchema } from "./schemas.js";

/** FR-SMS-01/02: the gateway and browser simulator share this strict body. */
export const SmsInboundRequestSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    from: z.string().regex(/^\+[1-9]\d{6,14}$/u),
    text: z
      .string()
      .min(1)
      .max(2000)
      .refine((text) => Boolean(text.trim()) && Array.from(text).length <= 1000)
      .describe("Nonempty SMS text, at most 1000 Unicode code points"),
  })
  .strict();

export const SmsMessageSchema = z
  .object({
    id: z.string().min(1).max(256),
    text: z.string().min(1).max(2000),
    encoding: z.enum(["gsm7", "ucs2"]),
    units: z.number().int().nonnegative(),
    segments: z.number().int().min(1).max(3),
    status: z.enum(["queued", "sent", "delivered", "failed"]),
  })
  .strict();

export const SmsInboundResponseSchema = z
  .object({
    messages: z.array(SmsMessageSchema).max(10),
    stopped: z.boolean(),
    lang: z.string().min(2).max(35),
  })
  .strict();

export const SmsProblemSchema = ProblemSchema.extend({
  lang: z.string().min(2).max(35),
  message: z.string(),
}).strict();
