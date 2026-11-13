/**
 * P09: GET /v1/insights route
 * Access control: host secret key (X-Dimts-Key) or LTI instructor (P10)
 * Returns aggregated feedback data with privacy protections
 */

import { Router, type Request, type Response } from "express";
import { createInsightsService } from "@dimts/insights";
import { InsightsQuerySchema, InsightsResponseSchema } from "../schemas.js";
import type { ApiRepository } from "../types.js";
import { sendProblem } from "../send-problem.js";

export function createInsightsRouter(repository: ApiRepository): Router {
  const router = Router();

  router.get("/insights", async (req: Request, res: Response) => {
    try {
      // Authentication: X-Dimts-Key (host) or LTI instructor (future)
      const hostKey = req.headers["x-dimts-key"] as string | undefined;

      // Check host key authorization
      if (!hostKey) {
        return sendProblem(res, 401, "unauthorized", "auth_required");
      }

      // Validate host key
      const hostKeyRecord = await repository.verifyHostKey(hostKey);
      if (!hostKeyRecord) {
        return sendProblem(res, 403, "forbidden", "invalid_key");
      }

      // Parse and validate query parameters
      const queryResult = InsightsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return sendProblem(res, 400, "invalid_request", "bad_query");
      }

      const query = queryResult.data;

      // Query insights data
      const insightsRepo = repository.getInsightsRepository?.();
      if (!insightsRepo) {
        return sendProblem(res, 501, "internal", "not_implemented");
      }

      const insightsService = createInsightsService(insightsRepo);
      const rows = await insightsService.getRows(query);

      // Determine period range
      const dates = rows.map((r) => r.period);
      const startDate = dates.length > 0 ? dates[dates.length - 1] : query.startDate ?? new Date().toISOString().split("T")[0];
      const endDate = dates.length > 0 ? dates[0] : query.endDate ?? new Date().toISOString().split("T")[0];

      // Return response based on format
      if (query.format === "csv") {
        const csv = insightsService.toCsv(rows);
        const filename = `dimts-insights-${new Date().toISOString().split("T")[0]}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
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
        return sendProblem(res, 500, "internal", "invalid_response");
      }

      res.json(validated.data);
    } catch (error) {
      console.error("[insights] error:", error);
      sendProblem(res, 500, "internal", "processing_error");
    }
  });

  return router;
}
