import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { FrancLanguageDetector } from "@dimts/ai";
import { loadPacks } from "@dimts/locales-tools";
import {
  PostgresGrounding,
  PostgresSourceSyncStore,
  PublicSitemapSource,
  SourceSyncManager,
  processTextDocument,
} from "@dimts/grounding";
import type { AskDependencies } from "@dimts/engine";
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
import { errorHandler, sendProblem } from "./middleware/problem.js";
import { createCoreRouter } from "./routes/core.js";
import { createHelpRouter } from "./routes/help.js";
import { createInternalRouter } from "./routes/internal.js";
import { createEngineDependencies } from "./engine.js";
import { createApiProviderRuntime } from "./provider-runtime.js";
import type { ApiConfig } from "./config.js";
import type { ApiRepository, HelpAuthStore } from "./types.js";

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
  helpStore?: HelpAuthStore;
  localesRoot?: string;
  askDependencies?: AskDependencies;
  providerSecrets?: Record<string, string | undefined>;
  grounding?: Pick<PostgresGrounding, "search" | "currentVersion">;
  sourceSync?: ApiSourceSyncOptions;
}

const defaultLocalesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../locales",
);

export function buildApp(options: BuildAppOptions = {}): express.Express {
  const config = options.config ?? parseConfig(process.env);
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
  const helpStore =
    options.helpStore ?? (pool ? createPostgresHelpAuthStore(pool) : undefined);
  const packs = loadPacks(options.localesRoot ?? defaultLocalesRoot);
  const grounding =
    options.grounding ?? (pool ? new PostgresGrounding(pool) : undefined);
  const providerRuntime = createApiProviderRuntime(
    config,
    packs,
    options.providerSecrets ?? process.env,
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
        })
      : undefined);
  const app = express();
  const logger = pino({
    level: config.NODE_ENV === "test" ? "silent" : "info",
  });
  let sourceSyncManager: SourceSyncManager | undefined;
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
  app.locals.close = async () => {
    try {
      await sourceSyncManager?.stop();
    } finally {
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
      allowedHeaders: ["content-type", "x-dimts-key", "authorization"],
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
      ...(grounding ? { grounding } : {}),
      ...(askDependencies ? { askDependencies } : {}),
    }),
  );
  if (helpStore) {
    app.use(
      "/v1",
      createHelpRouter({
        config,
        store: helpStore,
      }),
    );
  }
  app.use("/v1/internal", createInternalRouter(config, repository));
  app.use((_request, response) => {
    sendProblem(response, 404, "not_found", "error.not_found");
  });
  app.use(errorHandler);
  return app;
}
