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
      // Build dynamic WHERE clause using COALESCE so filters apply to both
      // sides of the FULL OUTER JOIN (not just the feedback_counter side).
      const conditions: string[] = [];
      const params: (string | Date)[] = [];

      if (query.startDate) {
        conditions.push(
          `COALESCE(fc.period, ia.period) >= $${params.length + 1}`,
        );
        params.push(query.startDate);
      }

      if (query.endDate) {
        conditions.push(
          `COALESCE(fc.period, ia.period) <= $${params.length + 1}`,
        );
        params.push(query.endDate);
      }

      if (query.lang) {
        conditions.push(
          `COALESCE(fc.lang, ia.lang) = $${params.length + 1}`,
        );
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

    async topicLabel(topicId: string): Promise<string | null> {
      // Resolve a human-readable label from the passage table using the
      // passageId stored as topic_id. Since passage has composite key
      // (content_version_id, id), select from the latest content version only
      // to ensure we get current, not stale, labels.
      if (!topicId || topicId === "uncategorized" || topicId === "Other") {
        return null;
      }
      const result = await pool.query<{ lesson_title: string; section_title: string | null }>(
        `SELECT p.lesson_title, p.section_title
         FROM passage p
         WHERE p.id = $1
           AND p.content_version_id = (
             SELECT id FROM content_version ORDER BY created_at DESC LIMIT 1
           )
         LIMIT 1`,
        [topicId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return row.section_title
        ? `${row.lesson_title} — ${row.section_title}`
        : row.lesson_title;
    },
  };
}
