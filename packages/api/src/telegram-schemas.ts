import { z } from "zod";
import { ProblemSchema } from "./schemas.js";
export { TelegramUpdateSchema } from "@dimts/telegram";
export const TelegramAckSchema = z.object({ ok: z.literal(true) }).strict();
export const TelegramProblemSchema = ProblemSchema.extend({
  lang: z.string(),
  message: z.string(),
}).strict();
