// FR-TUTOR-10/14, FR-AI-04/08, NFR-PERF-03: honest denominators and service-boundary timing.
import { describe, expect, it } from "vitest";
import {
  evaluateObservations,
  evaluateSourcePairs,
  percentile95,
} from "../src/metrics.js";
import type { EvalObservation } from "../src/metrics.js";
import { loadPacks } from "@dimts/locales-tools";
import { resolve } from "node:path";
import { glossaryEntries } from "../src/runner.js";

const answer: EvalObservation = {
  lang: "en",
  expect: "answer",
  expectedPassages: ["p"],
  actualKind: "answer",
  topPassageIds: ["p"],
  citationsValid: true,
  answerLanguageCorrect: true,
  text: "Choose one clear goal.",
  simple: false,
  sourcePairs: [{ sourceType: "course", sourceLang: "en" }],
};

describe("P02 evaluation integrity", () => {
  it("does not authorize draft cross-language mappings and preserves reviewed added-language forms", () => {
    const pack = loadPacks(resolve("locales")).get("om")!;
    pack.glossary = [
      {
        id: "goal",
        en: "goal",
        om: "kaayyoo",
        am: "ግብ",
        fr: "objectif",
        simple_definition: "One target.",
        do_not_translate: false,
      },
    ];
    Object.assign(pack.meta, {
      reviewed_by: "Test fixture reviewer",
      reviewed_on: "2026-01-01",
      status: "draft",
    });
    expect(glossaryEntries(pack, "om")).toEqual([]);
    pack.meta.status = "beta";
    expect(glossaryEntries(pack, "om")).toEqual([
      { en: "goal", om: "kaayyoo", am: "ግብ", fr: "objectif" },
    ]);
  });
  it("keeps false negatives visible rather than awarding a refusal-only model a perfect score", () => {
    const report = evaluateObservations([
      { ...answer, actualKind: "notfound" },
    ])[0];
    expect(report).toMatchObject({
      answerRecall: 0,
      answerCount: 0,
      expectedAnswerCount: 1,
      citationValidity: null,
      answerLanguageCorrectness: null,
    });
  });
  it("measures normal and Simple answers separately and retains maximum lengths", () => {
    const report = evaluateObservations([
      answer,
      { ...answer, simple: true, text: "Choose a goal." },
    ])[0];
    expect(report).toMatchObject({
      averageSentenceLength: 4,
      averageSimpleSentenceLength: 3,
      maxSentenceLength: 4,
      maxSimpleSentenceLength: 3,
    });
  });
  it("reports missing answers against the expected source/language pair", () => {
    const reports = evaluateSourcePairs([
      { ...answer, lang: "om", actualKind: "notfound" },
      { ...answer, sourcePairs: [{ sourceType: "job", sourceLang: "en" }] },
    ]);
    expect(reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lang: "om",
          sourceType: "course",
          sourceLang: "en",
          answerRecall: 0,
        }),
        expect.objectContaining({
          lang: "en",
          sourceType: "job",
          sourceLang: "en",
          answerRecall: 1,
        }),
      ]),
    );
  });
  it("uses nearest-rank p95 and refuses invalid or missing timing samples", () => {
    expect(percentile95(Array.from({ length: 100 }, (_, i) => 100 - i))).toBe(
      95,
    );
    expect(percentile95([])).toBeNull();
    expect(() => percentile95([1, Number.NaN])).toThrow();
    expect(() => percentile95([-1])).toThrow();
  });
});
