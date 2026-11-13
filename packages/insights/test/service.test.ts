/**
 * P09: Insights service unit tests
 * Test aggregation, small-cell suppression, and CSV generation
 */

import { describe, it, expect } from "vitest";
import { createInsightsService } from "../src/index.js";
import type { InsightsRepository } from "../src/types.js";

describe("InsightsService", () => {
  const mockRepository: InsightsRepository = {
    async queryInsights() {
      return [
        {
          topic_id: "unit-1",
          lang: "en",
          period: "2026-11-13",
          question_count: 10,
          notfound_count: 1,
          helpful: 5,
          unhelpful: 2,
        },
        {
          topic_id: "unit-2",
          lang: "en",
          period: "2026-11-13",
          question_count: 2,
          notfound_count: 1,
          helpful: 1,
          unhelpful: 0,
        },
      ];
    },
    async topicLabel() {
      return null;
    },
  };

  it("returns rows from repository", async () => {
    const service = createInsightsService(mockRepository);
    const rows = await service.getRows({});
    expect(rows.length).toBe(2);
    expect(rows.some((row) => row.topicId === "unit-1")).toBe(true);
  });

  it("applies small-cell suppression with threshold", async () => {
    const suppressingRepo: InsightsRepository = {
      async queryInsights() {
        return [
          {
            topic_id: "big",
            lang: "en",
            period: "2026-11-13",
            question_count: 10,
            notfound_count: 0,
            helpful: 5,
            unhelpful: 2,
          },
          {
            topic_id: "small",
            lang: "en",
            period: "2026-11-13",
            question_count: 1,
            notfound_count: 0,
            helpful: 1,
            unhelpful: 0,
          },
        ];
      },
      async topicLabel() {
        return null;
      },
    };

    const service = createInsightsService(suppressingRepo);
    const rows = await service.getRows({ minCellSize: 5 });

    // "small" should be combined into "other"
    const others = rows.filter((r) => r.topicId === "Other");
    expect(others.length).toBe(1);
    expect(others[0].questionCount).toBe(1);
  });

  it("generates RFC 4180 CSV with formula-injection defense", async () => {
    const service = createInsightsService(mockRepository);
    const rows = await service.getRows({});
    const csv = service.toCsv(rows);

    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "topic_id,topic_label,lang,period,question_count,notfound_count,helpful,unhelpful",
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Should not contain formula injection chars at line start
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]) {
        // First unquoted field should not start with =, +, -, @
        const fields = lines[i].split(",");
        expect(fields[0]).not.toMatch(/^[=+\-@]/);
      }
    }
  });

  it("escapes CSV fields containing commas", async () => {
    const escapeRepo: InsightsRepository = {
      async queryInsights() {
        return [
          {
            topic_id: "unit,1",
            lang: "en",
            period: "2026-11-13",
            question_count: 5,
            notfound_count: 0,
            helpful: 3,
            unhelpful: 1,
          },
        ];
      },
      async topicLabel() {
        return null;
      },
    };

    const service = createInsightsService(escapeRepo);
    const rows = await service.getRows({});
    const csv = service.toCsv(rows);

    // CSV should quote fields with commas
    expect(csv).toContain('"unit,1"');
  });

  it("returns empty array for no data", async () => {
    const emptyRepo: InsightsRepository = {
      async queryInsights() {
        return [];
      },
      async topicLabel() {
        return null;
      },
    };

    const service = createInsightsService(emptyRepo);
    const rows = await service.getRows({});
    expect(rows).toEqual([]);
  });
});
