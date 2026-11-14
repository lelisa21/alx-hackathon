import { timingSafeEqual } from "node:crypto";
import express from "express";
import type { ApiConfig } from "../config.js";
import type { ApiRepository } from "../types.js";
import { sendProblem } from "../middleware/problem.js";
import type { JobSourceSync } from "@dimts/jobs";
import type { JobsApiService } from "./jobs.js";
import { AlertsQuerySchema, AlertsResponseSchema } from "../jobs-schemas.js";

export function createInternalRouter(
  config: ApiConfig,
  repository: ApiRepository,
  jobs?: JobsApiService,
  jobSources?: Pick<JobSourceSync, "syncAll" | "status">,
): express.Router {
  const router = express.Router();

  router.use(async (request, response, next) => {
    const match = /^Bearer ([^\s]+)$/u.exec(
      request.header("authorization") ?? "",
    );
    const provided = Buffer.from(match?.[1] ?? "");
    const expected = Buffer.from(config.DIMTS_CRON_SECRET);
    if (
      !match ||
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      sendProblem(response, 401, "unauthorized", "error.generic");
      return;
    }
    next();
  });

  router.post("/retention", async (_request, response) => {
    await jobs?.cleanupExpired();
    await repository.runRetention(config.DIMTS_RETENTION_HOURS);
    response.json({ ok: true });
  });
  router.post("/alerts", async (request, response) => {
    const query = AlertsQuerySchema.parse(request.query);
    if (!jobs) {
      sendProblem(response, 503, "internal", "jobs.unavailable");
      return;
    }
    response.json(
      AlertsResponseSchema.parse(
        await jobs.runAlerts({ dryRun: query.dry === "1" }),
      ),
    );
  });

  // Re-import from the configured job platforms now (also runs on a timer).
  router.post("/jobs/sync", async (_request, response) => {
    if (!jobSources) {
      sendProblem(response, 503, "internal", "jobs.unavailable");
      return;
    }
    await jobSources.syncAll();
    response.json({ sources: jobSources.status() });
  });

  return router;
}
