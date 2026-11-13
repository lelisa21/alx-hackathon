import compression from "compression";
import cors from "cors";
import express from "express";
import type { Server } from "node:http";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { FrancLanguageDetector } from "@dimts/ai";
import { JobsService } from "@dimts/jobs";
import type { JobsDelivery } from "@dimts/jobs";
import { loadPacks } from "@dimts/locales-tools";
import {
  PostgresGrounding,
  PostgresSourceSyncStore,
  PublicSitemapSource,
  SourceSyncManager,
  processTextDocument,
} from "@dimts/grounding";
import type { AnswerCache, AskDependencies } from "@dimts/engine";
import type {
  ContentSource,
  SourceDocumentProcessor,
  SourceSyncManagerOptions,
  SourceSyncStore,
} from "@dimts/grounding";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig, configuredOrigins } from "./config.js";
import { createPool, createPostgresRepository } from "./db/repository.js";
import { createPostgresHelpAuthStore } from "./db/help-auth-store.js";
import { createPostgresHelpSocketStore } from "./db/help-socket-store.js";
import { errorHandler, sendProblem } from "./middleware/problem.js";
import { createCoreRouter } from "./routes/core.js";

import { createHelpRouter } from "./routes/help.js";
import { createInsightsRouter } from "./routes/insights.js";
import { attachHelpWebSockets } from "./help-sockets.js";
import type { HelpSocketRuntime, HelpSocketStore } from "./help-sockets.js";
import { createInternalRouter } from "./routes/internal.js";
import { createEngineDependencies } from "./engine.js";
import { createApiProviderRuntime } from "./provider-runtime.js";
import type { ApiConfig } from "./config.js";
import type { ApiRepository, HelpStore } from "./types.js";
import { createPostgresAnswerCache } from "./db/answer-cache.js";
import { createPostgresConversationStore } from "./db/conversation-state.js";
import type { ConversationStateStore } from "./db/conversation-state.js";
import { createJobsRouter } from "./routes/jobs.js";
import type { JobsApiService } from "./routes/jobs.js";
import { createHostJobsDelivery } from "./jobs-delivery.js";
import { createCareerRenderers } from "./jobs-format.js";
import { generateOpenApiDocument, generateOpenApiYaml } from "./openapi.js";
import type { SmsGateway } from "@dimts/sms";
import { createSmsRouter } from "./routes/sms.js";
import {
  createSmsRuntime,
  smsConfigured,
  withSmsJobsDelivery,
} from "./sms-runtime.js";
import type { SmsApiService } from "./sms-runtime.js";
import {
  createTelegramRuntime,
  telegramConfigured,
  withTelegramJobsDelivery,
} from "./telegram-runtime.js";
import type { TelegramApiService } from "./telegram-runtime.js";
import type { TelegramTransport, TelegramVoice } from "@dimts/telegram";
import { createTelegramRouter } from "./routes/telegram.js";
import { createLtiRouter } from "./routes/lti.js";

export interface ApiSourceSyncOptions {
  sources?: readonly ContentSource[];
  store?: SourceSyncStore;
  process?: SourceDocumentProcessor;
  intervalMs?: number;
  onError?: SourceSyncManagerOptions["onError"];
}

export interface BuildAppOptions {
  config?: ApiConfig;
  repository?: ApiRepository;
  helpStore?: HelpStore;
  helpSocketStore?: HelpSocketStore;
  localesRoot?: string;
  askDependencies?: AskDependencies;
  providerSecrets?: Record<string, string | undefined>;
  grounding?: Pick<PostgresGrounding, "search" | "currentVersion"> &
    Partial<
      Pick<PostgresGrounding, "resolveFaqSource" | "resolveFaqCitations">
    >;
  sourceSync?: ApiSourceSyncOptions;
  conversationStore?: ConversationStateStore;
  answerCache?: AnswerCache;
  logDestination?: pino.DestinationStream;
  jobsService?: JobsApiService;
  jobsDelivery?: JobsDelivery;
  smsService?: SmsApiService;
  smsGateway?: SmsGateway;
  smsCallbackTransport?: typeof fetch;
  telegramService?: TelegramApiService;
  telegramTransport?: TelegramTransport;
  telegramVoice?: TelegramVoice;
}

const defaultLocalesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../locales",
);

export function buildApp(options: BuildAppOptions = {}): express.Express {
  const config = options.config ?? parseConfig(process.env);
  const logger = pino(
    { level: config.NODE_ENV === "test" ? "silent" : "info" },
    options.logDestination,
  );
  const sources = [
    ...config.DIMTS_PUBLIC_SOURCES.map(
      ({ pageSize, ...source }) =>
        new PublicSitemapSource({
          ...source,
          ...(pageSize === undefined ? {} : { pageSize }),
        }),
    ),
    ...(options.sourceSync?.sources ?? []),
  ];
  const pool = options.repository ? undefined : createPool(config);
  const repository =
    options.repository ?? createPostgresRepository(pool ?? createPool(config));
  const conversationStore =
    options.conversationStore ??
    (pool ? createPostgresConversationStore(pool) : undefined);
  const answerCache =
    options.answerCache ?? (pool ? createPostgresAnswerCache(pool) : undefined);
  const helpStore =
    options.helpStore ?? (pool ? createPostgresHelpAuthStore(pool) : undefined);
  let helpSocketStore =
    options.helpSocketStore ??
    (pool ? createPostgresHelpSocketStore(pool) : undefined);
  const packs = loadPacks(options.localesRoot ?? defaultLocalesRoot);
  let smsService = options.smsService;
  let telegramService = options.telegramService;
  const nativeTelegramEnabled =
    Boolean(telegramService) || (Boolean(pool) && telegramConfigured(config));
  const nativeSmsEnabled =
    Boolean(smsService) || (Boolean(pool) && smsConfigured(config));
  const smsJobsDelivery =
    options.jobsDelivery && !nativeSmsEnabled
      ? options.jobsDelivery
      : withSmsJobsDelivery(
          options.jobsDelivery ?? createHostJobsDelivery(config),
          () => smsService,
          nativeSmsEnabled,
        );
  const jobsDelivery =
    options.jobsDelivery && !nativeTelegramEnabled
      ? smsJobsDelivery
      : withTelegramJobsDelivery(
          smsJobsDelivery,
          () => telegramService,
          nativeTelegramEnabled,
        );
  const jobsService =
    options.jobsService ??
    (pool
      ? new JobsService({
          pool,
          encryptionKey: Buffer.from(config.DIMTS_ENC_KEY, "base64"),
          hashKey: Buffer.from(config.DIMTS_HASH_KEY, "base64"),
          delivery: jobsDelivery,
          ...createCareerRenderers(packs),
        })
      : undefined);
  const grounding =
    options.grounding ?? (pool ? new PostgresGrounding(pool) : undefined);
  const providerRuntime = createApiProviderRuntime(
    config,
    packs,
    options.providerSecrets ?? process.env,
    grounding?.resolveFaqSource?.bind(grounding),
  );
  const languageDetector = new FrancLanguageDetector(
    [...packs.values()]
      .filter(({ meta }) => meta.status !== "draft")
      .map(({ meta }) => meta.code),
  );
  const askDependencies =
    options.askDependencies ??
    (grounding
      ? createEngineDependencies({
          config,
          packs,
          grounding,
          providerRuntime,
          languageDetector,
          ...(conversationStore
            ? { conversationSignals: conversationStore }
            : {}),
          ...(answerCache ? { answerCache } : {}),
          cacheEvent: ({ result }) =>
            logger.info({ event: "answer_cache", result }),
        })
      : undefined);
  const smsRuntime =
    !smsService && pool
      ? createSmsRuntime({
          config,
          pool,
          repository,
          packs,
          ...(askDependencies ? { askDependencies } : {}),
          ...(jobsService ? { jobs: jobsService } : {}),
          ...(options.smsGateway ? { gateway: options.smsGateway } : {}),
          ...(options.smsCallbackTransport
            ? { callbackTransport: options.smsCallbackTransport }
            : {}),
        })
      : undefined;
  smsService ??= smsRuntime?.service;
  const app = express();
  let sourceSyncManager: SourceSyncManager | undefined;
  let helpSocketRuntime: HelpSocketRuntime | undefined;
  const telegramRuntime =
    !telegramService && pool
      ? createTelegramRuntime({
          config,
          pool,
          repository,
          packs,
          ...(askDependencies ? { askDependencies } : {}),
          ...(jobsService ? { jobs: jobsService } : {}),
          ...(helpStore ? { helpStore } : {}),
          ...(helpSocketStore ? { helpSocketStore } : {}),
          ...(options.telegramTransport
            ? { transport: options.telegramTransport }
            : {}),
          ...(options.telegramVoice ? { voice: options.telegramVoice } : {}),
          socket: () => helpSocketRuntime,
          onError: () => logger.error({ event: "telegram_setup_failed" }),
        })
      : undefined;
  telegramService ??= telegramRuntime?.service;
  helpSocketStore = telegramRuntime?.helpSocketStore ?? helpSocketStore;
  app.locals.telegramReady = telegramRuntime?.ready ?? Promise.resolve();
  let mediaCleanupRunning = false;
  let careerCleanupRunning = false;
  const cleanupCareer = async () => {
    if (careerCleanupRunning || !jobsService) return;
    careerCleanupRunning = true;
    try {
      await jobsService.cleanupExpired();
    } catch {
      logger.error({ event: "jobs_cleanup_failed" });
    } finally {
      careerCleanupRunning = false;
    }
  };
  const careerCleanupTimer = jobsService
    ? setInterval(() => {
        void cleanupCareer();
      }, 60000)
    : undefined;
  careerCleanupTimer?.unref();
  void cleanupCareer();
  let alertsRunning = false;
  const alertsTimer =
    jobsService && config.DIMTS_JOBS_ALERT_INTERVAL_MS > 0
      ? setInterval(() => {
          if (alertsRunning) return;
          alertsRunning = true;
          void jobsService
            .runAlerts({ dryRun: false })
            .catch(() => logger.error({ event: "jobs_alert_run_failed" }))
            .finally(() => {
              alertsRunning = false;
            });
        }, config.DIMTS_JOBS_ALERT_INTERVAL_MS)
      : undefined;
  alertsTimer?.unref();
  const cleanupHelpImages = async () => {
    if (mediaCleanupRunning || !helpStore?.deleteExpiredImages) return;
    mediaCleanupRunning = true;
    try {
      await helpStore.deleteExpiredImages();
    } catch {
      logger.error({ event: "help_image_cleanup_failed" });
    } finally {
      mediaCleanupRunning = false;
    }
  };
  const imageCleanupTimer = helpStore?.deleteExpiredImages
    ? setInterval(() => {
        void cleanupHelpImages();
      }, 60000)
    : undefined;
  imageCleanupTimer?.unref();
  void cleanupHelpImages();
  if (sources.length > 0) {
    const store =
      options.sourceSync?.store ??
      (pool ? new PostgresSourceSyncStore(pool) : undefined);
    if (!store) {
      throw new Error(
        "Source synchronization requires PostgreSQL or an injected SourceSyncStore.",
      );
    }
    sourceSyncManager = new SourceSyncManager({
      sources,
      store,
      process: options.sourceSync?.process ?? processTextDocument,
      intervalMs:
        options.sourceSync?.intervalMs ?? config.DIMTS_SOURCE_SYNC_INTERVAL_MS,
      onError:
        options.sourceSync?.onError ??
        (() => {
          logger.error(
            { event: "source_sync_failed" },
            "Content source synchronization failed",
          );
        }),
    });
  }
  app.locals.sourceSyncManager = sourceSyncManager;
  app.locals.sourceSyncReady = sourceSyncManager?.start() ?? Promise.resolve();
  app.locals.attachHelpWebSockets = (server: Server) => {
    if (!helpSocketStore) {
      throw new Error(
        "Help WebSockets require PostgreSQL or an injected HelpSocketStore.",
      );
    }
    if (helpSocketRuntime) {
      throw new Error("Help WebSockets are already attached.");
    }
    helpSocketRuntime = attachHelpWebSockets(server, {
      config,
      store: helpSocketStore,
      onError(error) {
        logger.error(
          {
            event: "help_websocket_failed",
            errorType: error instanceof Error ? error.name : typeof error,
          },
          "Help WebSocket operation failed",
        );
      },
    });
  };
  app.locals.closeHelpWebSockets = () => helpSocketRuntime?.close();
  app.locals.close = async () => {
    if (careerCleanupTimer) clearInterval(careerCleanupTimer);
    if (alertsTimer) clearInterval(alertsTimer);
    if (imageCleanupTimer) clearInterval(imageCleanupTimer);
    helpSocketRuntime?.close();
    try {
      await sourceSyncManager?.stop();
    } finally {
      await smsRuntime?.close();
      await telegramRuntime?.close();
      await pool?.end();
    }
  };
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-dimts-key",
        "req.headers.x-telegram-bot-api-secret-token",
      ],
      serializers: {
        req: (request) => ({
          method: request.method,
          url: String(request.url).split("?")[0],
        }),
        res: (response) => ({ statusCode: response.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(compression());
  const origins = new Set(configuredOrigins(config));
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || origins.has(origin));
      },
      allowedHeaders: [
        "content-type",
        "x-dimts-key",
        "authorization",
        "if-none-match",
      ],
      exposedHeaders: ["ETag", "X-Dimts-Locale-Fallback"],
    }),
  );
  app.use(
    "/v1",
    createSmsRouter({
      config,
      packs,
      ...(smsService ? { service: smsService } : {}),
    }),
  );
  app.use(
    "/v1",
    createTelegramRouter({
      config,
      packs,
      ...(telegramService ? { service: telegramService } : {}),
    }),
  );
  app.use(express.json({ limit: "100kb", strict: true }));

  app.use(
    "/v1/ask",
    rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: 200,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_request, response) => {
        sendProblem(response, 429, "rate_limited", "limit.reached");
      },
    }),
  );

  app.use(
    "/v1",
    createCoreRouter({
      config,
      repository,
      packs,
      providerRuntime,
      ...(conversationStore ? { conversationStore } : {}),
      ...(grounding ? { grounding } : {}),
      ...(askDependencies ? { askDependencies } : {}),
    }),
  );
  if (helpStore) {
    app.use(
      "/v1",
      createHelpRouter({
        config,
        repository,
        store: helpStore,
        onClosed: (requestId) => {
          telegramRuntime?.forgetHelp(requestId);
          return helpSocketRuntime?.closeRequest(requestId);
        },
        onProfileChanged: (helperId) =>
          helpSocketRuntime?.refreshHelper(helperId),
      }),
    );
  }
  if (jobsService) {
    app.use(
      "/v1",
      createJobsRouter({
        service: jobsService,
        delivery: jobsDelivery,
        repository,
        packs,
        defaultLang: config.DIMTS_DEFAULT_LANG,
      }),
    );
  }
  app.use("/v1", createInsightsRouter(repository));
  app.use(
    "/v1",
    createLtiRouter({
      repository,
      logger,
    }),
  );
  app.use(
    "/v1/internal",
    createInternalRouter(config, repository, jobsService),
  );

  // OpenAPI documentation
  app.get("/v1/openapi.yaml", (req, res) => {
    res.setHeader("Content-Type", "application/yaml");
    res.send(generateOpenApiYaml());
  });

  app.get("/v1/openapi.json", (req, res) => {
    res.json(generateOpenApiDocument());
  });

  app.use((_request, response) => {
    sendProblem(response, 404, "not_found", "error.not_found");
  });
  app.use(errorHandler);
  return app;
}
