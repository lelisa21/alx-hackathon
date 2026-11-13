/**
 * P09: GET /v1/insights route
 * Access control: host secret key (X-Dimts-Key) or LTI instructor (P10)
 * Returns aggregated feedback data with privacy protections
 */

import { Router, type Request, type Response } from "express";
import { createInsightsService } from "@dimts/insights";
import { InsightsQuerySchema, InsightsResponseSchema } from "../schemas.js";
import type { ApiRepository } from "../types.js";
import { sendProblem } from "../middleware/problem.js";

export function createInsightsRouter(repository: ApiRepository): Router {
  const router = Router();

  router.get("/insights", async (req: Request, res: Response) => {
    try {
      // Authentication: X-Dimts-Key (host) or LTI instructor (P10)
      const hostKey = req.headers["x-dimts-key"] as string | undefined;
      const _authHeader = req.headers.authorization as string | undefined;

      // Check authorization
      let isAuthorized = false;

      // Path 1: Host key (X-Dimts-Key)
      if (hostKey) {
        const hostKeyRecord = await repository.verifyHostKey(hostKey);
        if (hostKeyRecord) {
          isAuthorized = true;
        }
      }

      // Path 2: LTI instructor session (bearer token with insightsAccess)
      // In production, extract and verify session from bearer token
      // For now, require host key; LTI path implemented in P10
      if (!isAuthorized) {
        return sendProblem(res, 401, "unauthorized", "error.auth");
      }

      // Parse and validate query parameters
      const queryResult = InsightsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return sendProblem(res, 400, "invalid_request", "error.invalid");
      }

      const query = queryResult.data;

      // Query insights data
      const insightsRepo = repository.getInsightsRepository?.();
      if (!insightsRepo) {
        return sendProblem(res, 501, "internal", "error.not_implemented");
      }

      const insightsService = createInsightsService(insightsRepo);
      const rows = await insightsService.getRows(query);

      // Determine period range
      const dates = rows.map((r: { period: string }) => r.period);
      const startDate =
        dates.length > 0
          ? dates[dates.length - 1]
          : query.startDate ?? new Date().toISOString().split("T")[0];
      const endDate =
        dates.length > 0
          ? dates[0]
          : query.endDate ?? new Date().toISOString().split("T")[0];

      // Return response based on format
      if (query.format === "csv") {
        const csv = insightsService.toCsv(rows);
        const filename = `dimts-insights-${new Date().toISOString().split("T")[0]}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        return res.send(csv);
      }

      // JSON response (default)
      const responseData = {
        insights: rows,
        period: {
          start: startDate,
          end: endDate,
        },
        exportedAt: new Date().toISOString(),
      };

      const validated = InsightsResponseSchema.safeParse(responseData);
      if (!validated.success) {
        return sendProblem(res, 500, "internal", "error.response");
      }

      res.json(validated.data);
    } catch (error) {
      console.error("[insights] error:", error);
      sendProblem(res, 500, "internal", "error.server");
    }
  });

  return router;
}
