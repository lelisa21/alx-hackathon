import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { loadPacks } from "@dimts/locales-tools";
import { PostgresGrounding } from "@dimts/grounding";
import type { AskDependencies } from "@dimts/engine";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig, configuredOrigins } from "./config.js";
import { createPool, createPostgresRepository } from "./db/repository.js";
import { errorHandler, sendProblem } from "./middleware/problem.js";
import { createCoreRouter } from "./routes/core.js";
import { createEngineDependencies } from "./engine.js";
import type { ApiConfig } from "./config.js";
import type { ApiRepository } from "./types.js";

export interface BuildAppOptions {
  config?: ApiConfig;
  repository?: ApiRepository;
  localesRoot?: string;
  askDependencies?: AskDependencies;
  grounding?: Pick<PostgresGrounding, "search" | "currentVersion">;
}

const defaultLocalesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../locales",
);

export function buildApp(options: BuildAppOptions = {}): express.Express {
  const config = options.config ?? parseConfig(process.env);
  const pool = options.repository ? undefined : createPool(config);
  const repository =
    options.repository ?? createPostgresRepository(pool ?? createPool(config));
  const packs = loadPacks(options.localesRoot ?? defaultLocalesRoot);
  const grounding =
    options.grounding ?? (pool ? new PostgresGrounding(pool) : undefined);
  const askDependencies =
    options.askDependencies ??
    (grounding
      ? createEngineDependencies({ config, packs, grounding })
      : undefined);
  const app = express();
  app.locals.close = async () => pool?.end();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger: pino({ level: config.NODE_ENV === "test" ? "silent" : "info" }),
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
      ...(grounding ? { grounding } : {}),
      ...(askDependencies ? { askDependencies } : {}),
    }),
  );
  app.use((_request, response) => {
    sendProblem(response, 404, "not_found", "error.not_found");
  });
  app.use(errorHandler);
  return app;
}
