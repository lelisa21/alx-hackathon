import { z } from "zod";

const base64Key = (length: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u)
    .refine((value) => {
      const decoded = Buffer.from(value, "base64");
      return (
        decoded.byteLength === length && decoded.toString("base64") === value
      );
    }, `must be ${length} random bytes in base64`);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_DIRECT: z.string().optional(),
    DIMTS_ENC_KEY: base64Key(32),
    DIMTS_HASH_KEY: base64Key(32),
    DIMTS_JWT_SECRET: z.string().min(32),
    DIMTS_CRON_SECRET: z.string().min(24),
    DIMTS_HOST_ORIGINS: z.string().default(""),
    DIMTS_DEFAULT_LANG: z.string().min(2).default("en"),
    DIMTS_AI_PROVIDER: z.string().optional(),
    DIMTS_AI_LADDER: z.string().default("cloud,local,offline"),
    DIMTS_CLOUD_API_URL: z.string().optional(),
    DIMTS_CLOUD_API_KEY: z.string().optional(),
    DIMTS_CLOUD_MODEL: z.string().optional(),
    DIMTS_LOCAL_API_URL: z.string().optional(),
    DIMTS_CONFIDENCE_FLOOR: z.coerce.number().min(0).max(1).default(0.35),
    DIMTS_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
    DIMTS_TELEGRAM_TOKEN: z.string().optional(),
    DIMTS_TELEGRAM_SECRET: z.string().optional(),
    DIMTS_SMS_MODE: z.string().default("simulator"),
    DIMTS_TURN_API_KEY: z.string().optional(),
    DIMTS_TURN_APP: z.string().optional(),
    DIMTS_HELPER_HOURS: z.string().optional(),
    DIMTS_DB_BUDGET_MB: z.coerce.number().positive().default(600),
  })
  .superRefine((config, context) => {
    const secrets = [
      config.DIMTS_ENC_KEY,
      config.DIMTS_HASH_KEY,
      config.DIMTS_JWT_SECRET,
    ];
    if (new Set(secrets).size !== secrets.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "DIMTS_ENC_KEY, DIMTS_HASH_KEY, and DIMTS_JWT_SECRET must be different",
      });
    }
  });

export type ApiConfig = z.infer<typeof environmentSchema>;

export function parseConfig(
  environment: NodeJS.ProcessEnv | Record<string, unknown>,
) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const key = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${key}${issue.message}`;
      })
      .join("; ");
    throw new Error(`Invalid API configuration: ${details}`);
  }
  return parsed.data;
}

export function configuredOrigins(config: ApiConfig): string[] {
  return config.DIMTS_HOST_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
