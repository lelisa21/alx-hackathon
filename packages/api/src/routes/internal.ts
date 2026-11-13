import { timingSafeEqual } from "node:crypto";
import express from "express";
import type { ApiConfig } from "../config.js";
import type { ApiRepository } from "../types.js";
import { sendProblem } from "../middleware/problem.js";

export function createInternalRouter(
  config: ApiConfig,
  repository: ApiRepository,
): express.Router {
  const router = express.Router();

  router.post("/retention", async (request, response) => {
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

    await repository.runRetention(config.DIMTS_RETENTION_HOURS);
    response.json({ ok: true });
  });

  return router;
}
