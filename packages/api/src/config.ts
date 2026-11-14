import { z } from "zod";
import type { ProviderBinding } from "@dimts/ai";

const publicSourceSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u),
    sitemapUrl: z
      .string()
      .url()
      .refine(
        (value) => value.toLowerCase().startsWith("https://"),
        "must use HTTPS",
      ),
    language: z.string().min(1).max(64),
    pageSize: z.number().int().min(1).max(100).optional(),
  })
  .strict();

type PublicSourceConfig = z.infer<typeof publicSourceSchema>;

const publicSourcesSchema = z
  .string()
  .default("[]")
  .transform((value, context): PublicSourceConfig[] | typeof z.NEVER => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must contain valid JSON",
      });
      return z.NEVER;
    }

    const parsed = z.array(publicSourceSchema).safeParse(decoded);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
          return `${path}${issue.message}`;
        })
        .join("; ");
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: details,
      });
      return z.NEVER;
    }

    const ids = new Set<string>();
    for (const [index, source] of parsed.data.entries()) {
      if (ids.has(source.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `source ID at index ${index} must be unique`,
        });
        return z.NEVER;
      }
      ids.add(source.id);
    }
    return parsed.data;
  });

const ltiPlatformUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "must use HTTPS without credentials, query or fragment");

const ltiPlatformSchema = z
  .object({
    platformId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u),
    issuer: ltiPlatformUrlSchema,
    clientId: z.string().min(1).max(256),
    authLoginUrl: ltiPlatformUrlSchema,
    authTokenUrl: ltiPlatformUrlSchema,
    jwksUri: ltiPlatformUrlSchema,
    deploymentId: z.string().min(1).max(256),
  })
  .strict();

const ltiPlatformsSchema = z
  .string()
  .default("[]")
  .transform((value, context) => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must contain valid JSON",
      });
      return z.NEVER;
    }

    const parsed = z.array(ltiPlatformSchema).safeParse(decoded);
    if (!parsed.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: parsed.error.issues
          .map((issue) => {
            const key =
              issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
            return `${key}${issue.message}`;
          })
          .join("; "),
      });
      return z.NEVER;
    }

    const platformIds = new Set<string>();
    const issuerClientPairs = new Set<string>();
    for (const [index, platform] of parsed.data.entries()) {
      const issuerClientPair = `${platform.issuer}\u0000${platform.clientId}`;
      if (
        platformIds.has(platform.platformId) ||
        issuerClientPairs.has(issuerClientPair)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `platform ID and issuer/client pair at index ${index} must be unique`,
        });
        return z.NEVER;
      }
      platformIds.add(platform.platformId);
      issuerClientPairs.add(issuerClientPair);
    }

    return parsed.data;
  });

const providerCapabilitiesSchema = z
  .object({
    languages: z.array(z.string().min(1)).min(1),
    modes: z.array(z.enum(["extractive", "generative"])).min(1),
    modalities: z.array(z.enum(["text", "image", "audio"])).min(1),
    structuredOutput: z.boolean(),
  })
  .strict();

const providerBindingSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
    adapter: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
    model: z.string().min(1).max(256),
    endpoint: z.string().url().optional(),
    credentialRef: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/u)
      .optional(),
    privacyClass: z.enum(["local", "remote"]),
    enabled: z.boolean(),
    priority: z.number().int().min(0).max(100_000),
    timeoutMs: z.number().int().min(100).max(120_000),
    allowedDataClasses: z
      .array(z.enum(["question", "course-passage", "glossary"]))
      .refine((values) => new Set(values).size === values.length),
    evaluatedLanguages: z.array(z.string().min(1)).default([]),
    capabilities: providerCapabilitiesSchema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (["openai", "gemini", "xai"].includes(binding.adapter)) {
      if (binding.privacyClass !== "remote")
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "native vendor adapters require remote privacy",
          path: ["privacyClass"],
        });
      if (binding.enabled && !binding.credentialRef)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "native vendor adapters require a credential reference",
          path: ["credentialRef"],
        });
    }
    if (binding.privacyClass === "remote" && binding.endpoint) {
      if (new URL(binding.endpoint).protocol !== "https:") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "remote provider endpoints must use HTTPS",
          path: ["endpoint"],
        });
      }
    }
  });

const providerBindingsSchema = z
  .string()
  .default("[]")
  .transform((value, context): ProviderBinding[] | typeof z.NEVER => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must contain valid JSON",
      });
      return z.NEVER;
    }
    const parsed = z.array(providerBindingSchema).safeParse(decoded);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
          return `${path}${issue.message}`;
        })
        .join("; ");
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: details,
      });
      return z.NEVER;
    }
    return parsed.data;
  });

const helperHoursIntervalSchema = z
  .object({
    day: z.number().int().min(1).max(7),
    start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  })
  .strict()
  .refine((interval) => interval.start < interval.end, {
    message: "interval start must be before end",
  });

const helperHoursSchema = z
  .string()
  .optional()
  .transform((value, context) => {
    if (value === undefined || value === "") return undefined;
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must contain valid JSON",
      });
      return z.NEVER;
    }

    const parsed = z.array(helperHoursIntervalSchema).safeParse(decoded);
    if (!parsed.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: parsed.error.issues
          .map((issue) => {
            const key =
              issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
            return `${key}${issue.message}`;
          })
          .join("; "),
      });
      return z.NEVER;
    }

    const intervalsByDay = new Map<
      number,
      Array<{ start: string; end: string }>
    >();
    for (const interval of parsed.data) {
      const intervals = intervalsByDay.get(interval.day) ?? [];
      if (
        intervals.some(
          ({ start, end }) => interval.start < end && interval.end > start,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `intervals overlap on ISO weekday ${interval.day}`,
        });
        return z.NEVER;
      }
      intervals.push(interval);
      intervalsByDay.set(interval.day, intervals);
    }
    return parsed.data;
  });

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

const optionalSmsSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(24).regex(/^\S+$/u).optional(),
);
const optionalSmsUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, "must use HTTPS without credentials, query or fragment")
    .optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_DIRECT: z.string().optional(),
    DIMTS_PUBLIC_SOURCES: publicSourcesSchema,
    DIMTS_LTI_PLATFORMS: ltiPlatformsSchema,
    // LTI launch page: the widget module URL and its public host key.
    DIMTS_LTI_WIDGET_URL: optionalSmsUrl,
    DIMTS_LTI_WIDGET_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).max(256).optional(),
    ),
    DIMTS_SOURCE_SYNC_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(86_400_000)
      .default(300_000),
    DIMTS_ENC_KEY: base64Key(32),
    DIMTS_HASH_KEY: base64Key(32),
    DIMTS_JWT_SECRET: z.string().min(32),
    DIMTS_CRON_SECRET: z.string().min(24),
    DIMTS_JOBS_RELAY_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        }, "must use HTTPS without credentials, query or fragment")
        .optional(),
    ),
    DIMTS_JOBS_RELAY_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(24).optional(),
    ),
    DIMTS_JOBS_ALERT_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(86400000)
      .default(0)
      .refine(
        (value) => value === 0 || value >= 60000,
        "must be zero or at least 60000",
      ),
    DIMTS_JOBS_RELAY_CHANNELS: z
      .string()
      .default("")
      .transform((value, context) => {
        const channels = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        if (
          channels.some(
            (channel) => channel !== "sms" && channel !== "telegram",
          ) ||
          new Set(channels).size !== channels.length
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "must contain unique sms and/or telegram channels",
          });
          return z.NEVER;
        }
        return channels as Array<"sms" | "telegram">;
      }),
    DIMTS_HOST_ORIGINS: z.string().default(""),
    DIMTS_DEFAULT_LANG: z.string().min(2).default("en"),
    DIMTS_STT_ENGINE: z.enum(["none", "browser"]).default("none"),
    DIMTS_TTS_ENGINE: z.enum(["none", "browser"]).default("none"),
    // Development only: try browser voice before the device review protocol.
    DIMTS_VOICE_PREVIEW: z
      .enum(["true", "false", ""])
      .default("false")
      .transform((value) => value === "true"),
    DIMTS_LANGUAGE_DETECTION_CONFIDENCE: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(0.25),
    DIMTS_AI_PROVIDER: z.string().min(1).default("offline"),
    DIMTS_AI_LADDER: z.string().default("cloud,local,offline"),
    DIMTS_AI_PROVIDERS: providerBindingsSchema,
    DIMTS_AI_MAX_TOKENS: z.coerce.number().int().min(16).max(8192).default(400),
    DIMTS_AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
    DIMTS_AI_CONSENT_VERSION: z.string().min(1).max(64).default("remote-ai-v1"),
    DIMTS_CONFIDENCE_FLOOR: z.coerce.number().min(0).max(1).default(0.35),
    // Retrieval floor when a consented AI provider judges passage relevance.
    DIMTS_AI_RECALL_FLOOR: z.coerce.number().min(0).max(1).default(0.2),
    DIMTS_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
    DIMTS_TELEGRAM_TOKEN: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .max(256)
        .regex(/^\d{1,20}:[A-Za-z0-9_-]{20,}$/u)
        .optional(),
    ),
    DIMTS_TELEGRAM_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .min(24)
        .max(256)
        .regex(/^[A-Za-z0-9_-]+$/u)
        .optional(),
    ),
    // Unset or empty: polling in development, webhook otherwise (see
    // telegramMode). Production always rejects polling.
    DIMTS_TELEGRAM_MODE: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["webhook", "polling"]).optional(),
    ),
    DIMTS_SMS_MODE: z
      .enum(["simulator", "gateway", "smsethiopia"])
      .default("simulator"),
    DIMTS_SMS_GATEWAY_SECRET: optionalSmsSecret,
    DIMTS_SMS_GATEWAY_URL: optionalSmsUrl,
    DIMTS_SMS_GATEWAY_TOKEN: optionalSmsSecret,
    DIMTS_SMS_CALLBACK_URL: optionalSmsUrl,
    DIMTS_SMS_CALLBACK_SECRET: optionalSmsSecret,
    DIMTS_SMS_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
    DIMTS_TURN_API_KEY: z.string().optional(),
    DIMTS_TURN_APP: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u)
        .optional(),
    ),
    DIMTS_HELPER_HOURS: helperHoursSchema,
    DIMTS_HELP_WAIT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(3600000)
      .default(300000),
    DIMTS_DB_BUDGET_MB: z.coerce.number().positive().default(600),
  })
  .superRefine((config, context) => {
    if (
      Boolean(config.DIMTS_LTI_WIDGET_URL) !==
      Boolean(config.DIMTS_LTI_WIDGET_KEY)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIMTS_LTI_WIDGET_URL"],
        message:
          "DIMTS_LTI_WIDGET_URL and DIMTS_LTI_WIDGET_KEY must be configured together",
      });
    if (config.DIMTS_VOICE_PREVIEW && config.NODE_ENV !== "development")
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIMTS_VOICE_PREVIEW"],
        message:
          "Unreviewed voice preview is allowed only with NODE_ENV=development",
      });
    if (telegramMode(config) === "polling" && config.NODE_ENV === "production")
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIMTS_TELEGRAM_MODE"],
        message:
          "Telegram polling is allowed only locally; production requires webhook mode",
      });
    if (
      config.DIMTS_TELEGRAM_TOKEN &&
      telegramMode(config) === "webhook" &&
      !config.DIMTS_TELEGRAM_SECRET
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIMTS_TELEGRAM_SECRET"],
        message: "Enabled Telegram webhooks require a separate secret",
      });
    if (
      config.DIMTS_TELEGRAM_SECRET &&
      [
        config.DIMTS_ENC_KEY,
        config.DIMTS_HASH_KEY,
        config.DIMTS_JWT_SECRET,
        config.DIMTS_CRON_SECRET,
        config.DIMTS_SMS_GATEWAY_SECRET,
        config.DIMTS_SMS_GATEWAY_TOKEN,
        config.DIMTS_SMS_CALLBACK_SECRET,
        config.DIMTS_JOBS_RELAY_SECRET,
      ].includes(config.DIMTS_TELEGRAM_SECRET)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIMTS_TELEGRAM_SECRET"],
        message:
          "Telegram webhook secret must differ from other configured credentials",
      });
    if (
      config.DIMTS_SMS_MODE === "smsethiopia" &&
      !config.DIMTS_SMS_GATEWAY_TOKEN
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIMTS_SMS_GATEWAY_TOKEN"],
        message: "SMS Ethiopia mode requires the campaign API key",
      });
    if (
      config.DIMTS_SMS_MODE !== "smsethiopia" &&
      (Boolean(config.DIMTS_SMS_GATEWAY_URL) !==
        Boolean(config.DIMTS_SMS_GATEWAY_TOKEN) ||
        (config.DIMTS_SMS_MODE === "gateway" && !config.DIMTS_SMS_GATEWAY_URL))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIMTS_SMS_GATEWAY_URL"],
        message:
          "SMS gateway URL and token must be configured together; gateway mode requires both",
      });
    if (
      Boolean(config.DIMTS_SMS_CALLBACK_URL) !==
      Boolean(config.DIMTS_SMS_CALLBACK_SECRET)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIMTS_SMS_CALLBACK_URL"],
        message: "SMS callback URL and secret must be configured together",
      });
    if (
      config.DIMTS_SMS_GATEWAY_SECRET &&
      [
        config.DIMTS_ENC_KEY,
        config.DIMTS_HASH_KEY,
        config.DIMTS_JWT_SECRET,
        config.DIMTS_CRON_SECRET,
        config.DIMTS_JOBS_RELAY_SECRET,
        config.DIMTS_SMS_GATEWAY_TOKEN,
        config.DIMTS_SMS_CALLBACK_SECRET,
        config.DIMTS_TELEGRAM_SECRET,
      ].includes(config.DIMTS_SMS_GATEWAY_SECRET)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DIMTS_SMS_GATEWAY_SECRET"],
        message:
          "SMS inbound secret must differ from other configured credentials",
      });
    if (
      Boolean(config.DIMTS_JOBS_RELAY_URL) !==
        Boolean(config.DIMTS_JOBS_RELAY_SECRET) ||
      (config.DIMTS_JOBS_RELAY_CHANNELS.length > 0 &&
        !config.DIMTS_JOBS_RELAY_URL)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Job relay URL and secret must be configured together; relay channels require both",
      });
    }
    if (Boolean(config.DIMTS_TURN_API_KEY) !== Boolean(config.DIMTS_TURN_APP)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "DIMTS_TURN_API_KEY and DIMTS_TURN_APP must be configured together",
      });
    }
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
    const ids = new Set<string>();
    const bindings = Array.isArray(config.DIMTS_AI_PROVIDERS)
      ? config.DIMTS_AI_PROVIDERS
      : [];
    for (const [index, binding] of bindings.entries()) {
      if (binding.id === "offline" || ids.has(binding.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `DIMTS_AI_PROVIDERS[${index}].id must be unique and cannot be "offline"`,
        });
      }
      ids.add(binding.id);
    }
  });

type ParsedConfig = z.infer<typeof environmentSchema>;
export type ApiConfig = Omit<ParsedConfig, "DIMTS_TELEGRAM_MODE"> & {
  DIMTS_TELEGRAM_MODE: "webhook" | "polling";
};

function telegramMode(config: {
  NODE_ENV: string;
  DIMTS_TELEGRAM_MODE?: "webhook" | "polling" | undefined;
}): "webhook" | "polling" {
  return (
    config.DIMTS_TELEGRAM_MODE ??
    (config.NODE_ENV === "development" ? "polling" : "webhook")
  );
}

export function parseConfig(
  environment: NodeJS.ProcessEnv | Record<string, unknown>,
): ApiConfig {
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
  const values = environment as Record<string, unknown>;
  for (const binding of parsed.data.DIMTS_AI_PROVIDERS) {
    if (
      binding.enabled &&
      binding.credentialRef &&
      (typeof values[binding.credentialRef] !== "string" ||
        !String(values[binding.credentialRef]).trim())
    ) {
      throw new Error(
        `Invalid API configuration: credential reference ${binding.credentialRef} is not set`,
      );
    }
  }
  if (
    parsed.data.DIMTS_AI_PROVIDER !== "offline" &&
    !parsed.data.DIMTS_AI_PROVIDERS.some(
      ({ id, enabled }) => id === parsed.data.DIMTS_AI_PROVIDER && enabled,
    )
  ) {
    throw new Error(
      `Invalid API configuration: DIMTS_AI_PROVIDER ${parsed.data.DIMTS_AI_PROVIDER} is not an enabled provider`,
    );
  }
  return {
    ...parsed.data,
    DIMTS_TELEGRAM_MODE: telegramMode(parsed.data),
  } as ApiConfig;
}

export function configuredOrigins(config: ApiConfig): string[] {
  return config.DIMTS_HOST_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
