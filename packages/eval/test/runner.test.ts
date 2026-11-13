// FR-TUTOR-10/14, FR-AI-04/08, NFR-PERF-03: actual checked-in sources, no provider network.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runEvaluation } from "../src/runner.js";

describe("offline evaluation service boundary", () => {
  it("runs every language in both modes, preserves review blockers and measures actual FAQ/cache results", async () => {
    const result = await runEvaluation(path.resolve("."));
    expect(result.issues).toEqual([]);
    expect(result.reports).toHaveLength(3);
    for (const report of result.reports) {
      expect(report.questionCount).toBeGreaterThanOrEqual(10);
      expect(report.runCount).toBe(report.questionCount * 2);
    }
    expect(result.blockers.join(" ")).toContain("human review");
    expect(result.pairReports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "job",
          sourceLang: "en",
          lang: "en",
        }),
      ]),
    );
    const englishFaq = result.faqReports.find(({ lang }) => lang === "en");
    expect(englishFaq?.reviewed).toBe(false);
    expect(englishFaq!.hits / englishFaq!.count).toBeGreaterThanOrEqual(0.7);
    expect(result.offlineP95).not.toBeNull();
    expect(result.offlineP95!).toBeLessThanOrEqual(1000);
    expect(result.cacheP95).not.toBeNull();
    expect(result.cacheP95!).toBeLessThan(50);
    expect(result.report).not.toContain("How many topics should I choose");
    expect(result.report).not.toContain("q-en-001");
  }, 30000);
});
