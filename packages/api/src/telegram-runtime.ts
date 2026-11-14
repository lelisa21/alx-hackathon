import { randomBytes } from "node:crypto";
import pg from "pg";
import type { AskDependencies } from "@dimts/engine";
import { JobsError } from "@dimts/jobs";
import type { JobsDelivery } from "@dimts/jobs";
import type { LangPack } from "@dimts/locales-tools";
import {
  TelegramService,
  createTelegramTransport,
  startTelegramPolling,
} from "@dimts/telegram";
import type {
  TelegramTransport,
  TelegramVoice,
  TelegramServiceOptions,
} from "@dimts/telegram";
import type { ApiConfig } from "./config.js";
import type { ApiRepository, HelpStore } from "./types.js";
import type { HelpSocketRuntime, HelpSocketStore } from "./help-sockets.js";
import type { JobsApiService } from "./routes/jobs.js";
import { createConversationService } from "./conversation.js";
import { createTelegramHelpBridge } from "./telegram-help.js";
import { sha256 } from "./middleware/auth.js";
import { AskRequestSchema } from "./schemas.js";
import { createCareerRenderers } from "./jobs-format.js";

/** Keep channel callers on the same validated contract as the web ask route. */
export function createTelegramAsk(options: {
  conversation: ReturnType<typeof createConversationService>;
  repository: Pick<ApiRepository, "touchSession">;
}): TelegramServiceOptions["ask"] {
  return async (input) => {
    if (Array.from(input.text).length > 1000) throw new Error("too_long");
    const body = AskRequestSchema.parse({
      ...input,
      clientMsgId: sha256(input.clientMsgId),
      via: "telegram",
    });
    await options.repository.touchSession(body.sessionId);
    return options.conversation(body);
  };
}

export type TelegramApiService = Pick<
  TelegramService,
  "handleUpdate" | "sendAlert"
>;
export function telegramConfigured(config: ApiConfig) {
  return Boolean(config.DIMTS_TELEGRAM_TOKEN);
}

/** Native Telegram is the sole digest path: legacy host delivery cannot bypass
 * consent checks, permanent Stop, deduplication or the per-chat send queue. */
export function withTelegramJobsDelivery(
  host: JobsDelivery,
  service: () => TelegramApiService | undefined,
  enabled: boolean,
): JobsDelivery {
  const channels = host.channels.filter((channel) => channel !== "telegram");
  return {
    channels: enabled ? [...channels, "telegram"] : channels,
    relayAvailable: host.relayAvailable,
    async sendDigest(input) {
      if (input.channel !== "telegram") return host.sendDigest(input);
      const telegram = service();
      if (!enabled || !telegram) throw new JobsError("unavailable");
      try {
        await telegram.sendAlert({
          contact: input.contact,
          lang: input.lang,
          text: input.text,
          idempotencyKey: input.idempotencyKey,
        });
      } catch {
        throw new JobsError("delivery_failed");
      }
    },
    sendAccommodation: (input) => host.sendAccommodation(input),
  };
}

function locale(
  packs: Map<string, LangPack>,
  lang: string,
): Record<string, string> {
  const source = { ...packs.get("en")?.ui, ...packs.get(lang)?.ui };
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] =>
        (entry[0].startsWith("telegram.") || entry[0] === "jobs.all") &&
        typeof entry[1] === "string",
    ),
  );
}

/** Telegram command menus accept ISO 639-1 language codes, while learner
 * language choices and shared sessions keep their full registry BCP 47 tags. */
export function telegramCommandRegistrations(packs: Map<string, LangPack>) {
  const commands = (lang: string) => {
    const strings = locale(packs, lang);
    return [
      "start",
      "language",
      "help",
      "jobs",
      "simple",
      "stop",
      "privacy",
      "endhelp",
    ].map((command) => ({
      command,
      description: strings[`telegram.command_${command}`]!,
    }));
  };
  const aliases = [...packs.values()]
    .filter(({ meta }) => meta.status !== "draft")
    .flatMap((pack) => {
      try {
        const tag = new Intl.Locale(pack.meta.code);
        return /^[a-z]{2}$/u.test(tag.language)
          ? [
              {
                code: pack.meta.code,
                canonical: tag.toString(),
                language: tag.language,
              },
            ]
          : [];
      } catch {
        return [];
      }
    })
    .sort(
      (a, b) =>
        a.language.localeCompare(b.language, "en") ||
        Number(b.canonical === b.language) -
          Number(a.canonical === a.language) ||
        a.canonical.localeCompare(b.canonical, "en"),
    );
  const selected = new Map<string, string>();
  for (const alias of aliases)
    if (!selected.has(alias.language)) selected.set(alias.language, alias.code);
  return [
    { languageCode: "", commands: commands("en") },
    ...[...selected].map(([languageCode, code]) => ({
      languageCode,
      commands: commands(code),
    })),
  ];
}

export function createTelegramRuntime(options: {
  config: ApiConfig;
  pool: pg.Pool;
  repository: ApiRepository;
  packs: Map<string, LangPack>;
  askDependencies?: AskDependencies;
  jobs?: JobsApiService;
  transport?: TelegramTransport;
  voice?: TelegramVoice;
  helpStore?: HelpStore;
  helpSocketStore?: HelpSocketStore;
  socket(): HelpSocketRuntime | undefined;
  onError?(): void;
}) {
  const { config, pool, repository, packs } = options;
  if (!telegramConfigured(config)) return undefined;
  // Advisory locks cannot occupy the shared engine/help pool or starve STOP.
  const telegramPool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 500,
    idleTimeoutMillis: 30000,
  });
  telegramPool.on("error", () => undefined);
  const transport =
    options.transport ??
    createTelegramTransport({
      token: config.DIMTS_TELEGRAM_TOKEN!,
      hashKey: config.DIMTS_HASH_KEY,
    });
  const conversation = createConversationService({
    config,
    repository,
    packs,
    ...(options.askDependencies
      ? { askDependencies: options.askDependencies }
      : {}),
  });
  const bridge: ReturnType<typeof createTelegramHelpBridge> | undefined =
    options.helpStore && options.helpSocketStore
      ? createTelegramHelpBridge({
          help: options.helpStore,
          store: options.helpSocketStore,
          socket: options.socket,
          send: (input): Promise<void> => service.sendHelper(input),
        })
      : undefined;
  const sessions: TelegramServiceOptions["sessions"] = {
    async ensure({ contactHash, lang }) {
      const result = await pool.query<{ id: string; lang: string }>(
        `INSERT INTO session(id,channel,lang,contact_hmac,token_hash,resume_hash,cloud_ok,consent_version)
         VALUES($1,'telegram',$2,$3,$4,$5,false,NULL)
         ON CONFLICT (channel,contact_hmac) WHERE contact_hmac IS NOT NULL
         DO UPDATE SET last_seen_at=now() RETURNING id,lang`,
        [
          randomBytes(16).toString("base64url"),
          lang,
          contactHash,
          sha256(randomBytes(32).toString("base64url")),
          sha256(randomBytes(32).toString("base64url")),
        ],
      );
      return result.rows[0]!;
    },
    async setLanguage(id, lang) {
      await pool.query(
        "UPDATE session SET lang=$2,last_seen_at=now() WHERE id=$1 AND channel='telegram'",
        [id, lang],
      );
    },
    async delete(id) {
      await repository.deleteSessionData(id);
    },
  };
  const service: TelegramService = new TelegramService({
    pool: telegramPool,
    revocationPool: pool,
    hashKey: Buffer.from(config.DIMTS_HASH_KEY, "base64"),
    encryptionKey: Buffer.from(config.DIMTS_ENC_KEY, "base64"),
    transport,
    locales: (lang) => locale(packs, lang),
    languages: [...packs.values()]
      .filter(({ meta }) => meta.status !== "draft")
      .map(({ meta }) => ({ code: meta.code, label: meta.name_native })),
    sessions,
    ask: createTelegramAsk({ conversation, repository }),
    renderJobs: createCareerRenderers(packs).renderDigest,
    ...(options.jobs?.stopContact
      ? {
          jobs: {
            listJobs: (input) => options.jobs!.listJobs(input),
            listSubscriptions: (input) =>
              options.jobs!.listSubscriptions(input),
            subscribe: (input) => options.jobs!.subscribe(input),
            stopContact: (input) => options.jobs!.stopContact!(input),
          },
        }
      : {}),
    ...(bridge
      ? {
          help: {
            start: bridge.start,
            relay: bridge.relay,
            end: bridge.end,
            bind: async (input) => {
              await bridge.bind(input);
            },
            async stopSession(sessionId: string) {
              const requests = await pool.query<{ id: string }>(
                "SELECT id FROM help_request WHERE session_id=$1 AND channel='telegram' AND status IN ('waiting','claimed')",
                [sessionId],
              );
              for (const request of requests.rows)
                await bridge.end({ sessionId, requestId: request.id });
            },
          },
        }
      : {}),
    ...(options.voice ? { voice: options.voice } : {}),
  });
  const ready = (async () => {
    for (const registration of telegramCommandRegistrations(packs)) {
      await transport.setCommands(
        registration.commands,
        registration.languageCode,
      );
    }
  })().catch(() => options.onError?.());
  const polling =
    config.DIMTS_TELEGRAM_MODE === "polling"
      ? startTelegramPolling({
          transport,
          environment: config.NODE_ENV,
          handleUpdate: (update) => service.handleUpdate(update),
          onError: () => options.onError?.(),
        })
      : undefined;
  void polling?.done.catch(() => options.onError?.());
  return {
    service,
    ready,
    helpSocketStore: bridge?.store,
    forgetHelp: (requestId: string) => bridge?.forget(requestId),
    async close() {
      await polling?.stop();
      bridge?.clear();
      await transport.close();
      await telegramPool.end();
    },
  };
}
