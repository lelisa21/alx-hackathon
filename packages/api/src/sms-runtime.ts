import { randomBytes } from "node:crypto";
import pg from "pg";
import type { AskDependencies } from "@dimts/engine";
import type { JobsDelivery, JobsService } from "@dimts/jobs";
import { JobsError } from "@dimts/jobs";
import type { LangPack } from "@dimts/locales-tools";
import { createSmsGateway, SmsError, SmsService } from "@dimts/sms";
import type { SmsGateway, SmsLocale, SmsServiceOptions } from "@dimts/sms";
import type { ApiConfig } from "./config.js";
import type { ApiRepository } from "./types.js";
import { createConversationService } from "./conversation.js";
import { sha256 } from "./middleware/auth.js";

export type SmsApiService = Pick<SmsService, "inbound" | "sendAlert">;
export const SMS_CALLBACK_VERSION = "dimts.sms.callback.v1";

export function smsConfigured(config: ApiConfig): boolean {
  return Boolean(
    config.DIMTS_SMS_GATEWAY_SECRET &&
    (config.DIMTS_SMS_MODE === "simulator" ||
      (config.DIMTS_SMS_GATEWAY_URL && config.DIMTS_SMS_GATEWAY_TOKEN)),
  );
}

export function createSmsCallback(
  config: ApiConfig,
  transport: typeof fetch = fetch,
): SmsServiceOptions["callback"] {
  if (!config.DIMTS_SMS_CALLBACK_URL || !config.DIMTS_SMS_CALLBACK_SECRET)
    return undefined;
  return async (input) => {
    try {
      const response = await transport(config.DIMTS_SMS_CALLBACK_URL!, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.DIMTS_SMS_CALLBACK_SECRET!}`,
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({ version: SMS_CALLBACK_VERSION, ...input }),
      });
      if (!response.ok) throw new Error("Callback rejected");
      const receipt: unknown = await response.json();
      if (
        !receipt ||
        typeof receipt !== "object" ||
        !("version" in receipt) ||
        receipt.version !== SMS_CALLBACK_VERSION ||
        !("accepted" in receipt) ||
        receipt.accepted !== true ||
        !("idempotencyKey" in receipt) ||
        receipt.idempotencyKey !== input.idempotencyKey
      )
        throw new Error("Invalid callback receipt");
    } catch {
      throw new SmsError("unavailable", input.lang);
    }
  };
}

/** Override only the native SMS digest port; keep all host accommodation and
 * other channel behavior intact. The thunk resolves the jobs/SMS dependency. */
export function withSmsJobsDelivery(
  host: JobsDelivery,
  service: () => SmsApiService | undefined,
  enabled: boolean,
): JobsDelivery {
  const otherChannels = host.channels.filter((channel) => channel !== "sms");
  return {
    channels: enabled ? [...otherChannels, "sms"] : otherChannels,
    relayAvailable: host.relayAvailable,
    async sendDigest(input) {
      if (input.channel !== "sms") return host.sendDigest(input);
      if (!enabled) throw new JobsError("unavailable");
      const sms = service();
      if (!sms) throw new JobsError("unavailable");
      try {
        await sms.sendAlert({
          contact: input.contact,
          text: input.text,
          lang: input.lang,
          idempotencyKey: input.idempotencyKey,
        });
      } catch {
        throw new JobsError("delivery_failed");
      }
    },
    sendAccommodation: (input) => host.sendAccommodation(input),
  };
}

function smsLocale(packs: Map<string, LangPack>, lang: string): SmsLocale {
  const source = (packs.get(lang)?.sms ?? packs.get("en")?.sms ?? {}) as Record<
    string,
    unknown
  >;
  return {
    strings: Object.fromEntries(
      Object.entries(source).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    keywords: (typeof source.keywords === "object" && source.keywords !== null
      ? source.keywords
      : {}) as Record<string, string[]>,
  };
}

export function createSmsRuntime(options: {
  config: ApiConfig;
  pool: pg.Pool;
  repository: ApiRepository;
  packs: Map<string, LangPack>;
  askDependencies?: AskDependencies;
  jobs?: Pick<JobsService, "subscribe"> &
    Partial<Pick<JobsService, "stopContact">>;
  gateway?: SmsGateway;
  callbackTransport?: typeof fetch;
}): { service: SmsService; close(): Promise<void> } | undefined {
  const { config, pool, repository, packs, jobs } = options;
  if (!smsConfigured(config)) return undefined;
  // SMS holds advisory locks across application calls; a separate bounded pool
  // prevents those locks from starving tutor/jobs or priority STOP revocation.
  const smsPool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 500,
    idleTimeoutMillis: 30000,
  });
  smsPool.on("error", () => undefined);
  const gateway =
    options.gateway ??
    createSmsGateway({
      type: config.DIMTS_SMS_MODE === "simulator" ? "simulator" : "gateway",
      url: config.DIMTS_SMS_GATEWAY_URL,
      token: config.DIMTS_SMS_GATEWAY_TOKEN,
    });
  const conversation = createConversationService({
    config,
    repository,
    packs,
    ...(options.askDependencies
      ? { askDependencies: options.askDependencies }
      : {}),
  });
  const service = new SmsService({
    pool: smsPool,
    revocationPool: pool,
    hashKey: Buffer.from(config.DIMTS_HASH_KEY, "base64"),
    encryptionKey: Buffer.from(config.DIMTS_ENC_KEY, "base64"),
    gateway,
    dailyLimit: config.DIMTS_SMS_DAILY_LIMIT,
    locales: (lang) => smsLocale(packs, lang),
    sessions: {
      async create(lang) {
        const id = randomBytes(16).toString("base64url");
        await repository.createSession({
          id,
          lang,
          channel: "sms",
          cloudOk: false,
          consentVersion: null,
          tokenHash: sha256(randomBytes(32).toString("base64url")),
          resumeHash: sha256(randomBytes(32).toString("base64url")),
        });
        return id;
      },
      async setLanguage(id, lang) {
        await pool.query(
          "UPDATE session SET lang=$2,last_seen_at=now() WHERE id=$1 AND channel='sms'",
          [id, lang],
        );
      },
      async delete(id) {
        await repository.deleteSessionData(id);
      },
    },
    async ask(input) {
      await repository.touchSession(input.sessionId);
      const reply = await conversation({ ...input, via: "sms", simple: false });
      return [
        reply.text,
        ...reply.citations.map(
          (citation) => `${citation.label}: ${citation.url}`,
        ),
      ].join("\n");
    },
    ...(jobs?.stopContact
      ? {
          jobs: {
            subscribe: (input) => jobs.subscribe(input),
            stopContact: (contact) =>
              jobs.stopContact!({ channel: "sms", contact }),
          },
        }
      : {}),
    callback: createSmsCallback(config, options.callbackTransport),
  });
  gateway.onInbound(async (from, text, metadata) => {
    if (!metadata?.id) throw new SmsError("invalid");
    await service.inbound({ id: metadata.id, from, text });
  });
  return { service, close: () => smsPool.end() };
}
