/**
 * P09: Insights service implementation
 * Aggregates feedback and question data with privacy protections
 */

import type {
  InsightQuery,
  InsightRow,
  InsightsRepository,
  InsightsService,
  RawInsightRow,
} from "./types.js";

export function createInsightsService(
  repository: InsightsRepository,
): InsightsService {
  return {
    async getRows(query: InsightQuery): Promise<InsightRow[]> {
      const raw = await repository.queryInsights(query);

      // Group rows by (topic, lang, period) for small-cell suppression
      const grouped = new Map<string, RawInsightRow[]>();

      for (const row of raw) {
        const key = `${row.topic_id}|${row.lang}|${row.period}`;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(row);
      }

      // Apply small-cell suppression: combine rows with total count < minCellSize into "Other"
      const minCellSize = query.minCellSize ?? 5;
      const result: InsightRow[] = [];
      const otherRows: RawInsightRow[] = [];

      for (const rows of grouped.values()) {
        const totalCount = rows.reduce(
          (sum, r) =>
            sum + r.question_count + r.notfound_count + r.helpful + r.unhelpful,
          0,
        );

        if (totalCount < minCellSize) {
          // Accumulate for "Other" category
          otherRows.push(...rows);
        } else {
          // Regular row
          for (const row of rows) {
            const label = await repository.topicLabel(row.topic_id);
            result.push({
              topicId: row.topic_id,
              topicLabel: label,
              lang: row.lang,
              period: row.period,
              questionCount: row.question_count,
              notfoundCount: row.notfound_count,
              helpfulCount: row.helpful,
              unhelpfulCount: row.unhelpful,
            });
          }
        }
      }

      // Add "Other" aggregate if there are suppressed rows
      if (otherRows.length > 0) {
        const otherAgg: RawInsightRow = {
          topic_id: "Other",
          lang: otherRows[0]?.lang ?? "unknown",
          period: otherRows[0]?.period ?? new Date().toISOString().slice(0, 10),
          question_count: otherRows.reduce((s, r) => s + r.question_count, 0),
          notfound_count: otherRows.reduce((s, r) => s + r.notfound_count, 0),
          helpful: otherRows.reduce((s, r) => s + r.helpful, 0),
          unhelpful: otherRows.reduce((s, r) => s + r.unhelpful, 0),
        };

        result.push({
          topicId: otherAgg.topic_id,
          topicLabel: "Other",
          lang: otherAgg.lang,
          period: otherAgg.period,
          questionCount: otherAgg.question_count,
          notfoundCount: otherAgg.notfound_count,
          helpfulCount: otherAgg.helpful,
          unhelpfulCount: otherAgg.unhelpful,
        });
      }

      // Sort by period (descending), then language, then topic
      result.sort((a, b) => {
        const periodCmp = b.period.localeCompare(a.period);
        if (periodCmp !== 0) return periodCmp;
        const langCmp = a.lang.localeCompare(b.lang);
        if (langCmp !== 0) return langCmp;
        return a.topicId.localeCompare(b.topicId);
      });

      return result;
    },

    toCsv(rows: InsightRow[]): string {
      // RFC 4180 CSV with formula-injection defense
      const headers = [
        "topic_id",
        "topic_label",
        "lang",
        "period",
        "question_count",
        "notfound_count",
        "helpful",
        "unhelpful",
      ];

      const escapeCsv = (value: string | number | null): string => {
        if (value === null || value === undefined) return "";
        const str = String(value);

        // Escape formula-injection characters
        if (str.match(/^[=+\-@]/)) {
          return `"=${str.replace(/"/g, '""')}"`;
        }

        // Quote if contains comma, quote, or newline
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }

        return str;
      };

      const lines: string[] = [headers.join(",")];

      for (const row of rows) {
        const values = [
          row.topicId,
          row.topicLabel ?? "",
          row.lang,
          row.period,
          row.questionCount,
          row.notfoundCount,
          row.helpfulCount,
          row.unhelpfulCount,
        ];
        lines.push(values.map(escapeCsv).join(","));
      }

      return lines.join("\r\n");
    },
  };
}
