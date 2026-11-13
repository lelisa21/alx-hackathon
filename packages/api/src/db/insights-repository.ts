/**
 * P09: PostgreSQL adapter for insights queries
 * Joins feedback_counter and insight_aggregate with topic label resolution
 */

import type { Pool, QueryResult } from "pg";
import type {
  InsightQuery,
  RawInsightRow,
  InsightsRepository,
} from "@dimts/insights";

export function createInsightsRepository(pool: Pool): InsightsRepository {
  return {
    async queryInsights(query: InsightQuery): Promise<RawInsightRow[]> {
      // Build dynamic WHERE clause
      const conditions: string[] = [];
      const params: (string | Date)[] = [];

      if (query.startDate) {
        conditions.push(`fc.period >= $${params.length + 1}`);
        params.push(query.startDate);
      }

      if (query.endDate) {
        conditions.push(`fc.period <= $${params.length + 1}`);
        params.push(query.endDate);
      }

      if (query.lang) {
        conditions.push(`fc.lang = $${params.length + 1}`);
        params.push(query.lang);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Join feedback_counter and insight_aggregate
      const sql = `
        SELECT
          COALESCE(fc.topic_id, ia.topic_id) as topic_id,
          COALESCE(fc.lang, ia.lang) as lang,
          COALESCE(fc.period, ia.period) as period,
          COALESCE(ia.question_count, 0) as question_count,
          COALESCE(ia.notfound_count, 0) as notfound_count,
          COALESCE(fc.helpful, 0) as helpful,
          COALESCE(fc.unhelpful, 0) as unhelpful
        FROM feedback_counter fc
        FULL OUTER JOIN insight_aggregate ia
          ON fc.topic_id = ia.topic_id
          AND fc.lang = ia.lang
          AND fc.period = ia.period
        ${whereClause}
        ORDER BY
          COALESCE(fc.period, ia.period) DESC,
          COALESCE(fc.lang, ia.lang) ASC,
          COALESCE(fc.topic_id, ia.topic_id) ASC
      `;

      const result: QueryResult<RawInsightRow> = await pool.query(sql, params);
      return result.rows;
    },

    async topicLabel(): Promise<string | null> {
      // TODO: resolve topic label from passage table when available
      // For now, return null (topic_label will be null in response)
      return null;
    },
  };
}
