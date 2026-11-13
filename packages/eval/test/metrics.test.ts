// Requirements: FR-TUTOR-10, FR-TUTOR-14.
import { describe, expect, it } from "vitest";
import {
  evaluateObservations,
  renderEvaluationMarkdown,
} from "../src/metrics.js";
import type { EvalObservation } from "../src/metrics.js";

const observations: EvalObservation[] = [
  {
    lang: "en",
    expect: "answer",
    expectedPassages: ["lesson-a"],
    actualKind: "answer",
    topPassageIds: ["lesson-a", "lesson-b"],
    citationsValid: true,
    answerLanguageCorrect: true,
    text: "The answer is short.",
    simple: false,
  },
  {
    lang: "en",
    expect: "notfound",
    expectedPassages: [],
    actualKind: "notfound",
    topPassageIds: [],
    citationsValid: true,
    answerLanguageCorrect: true,
    text: "I did not find an answer.",
    simple: true,
  },
  {
    lang: "en",
    expect: "answer",
    expectedPassages: ["lesson-a"],
    actualKind: "answer",
    topPassageIds: ["lesson-a"],
    citationsValid: true,
    answerLanguageCorrect: true,
    text: "Choose one clear goal.",
    simple: true,
  },
  {
    lang: "am",
    expect: "answer",
    expectedPassages: ["lesson-c"],
    actualKind: "notfound",
    topPassageIds: ["lesson-c"],
    citationsValid: true,
    answerLanguageCorrect: true,
    text: "መልስ።",
    simple: false,
  },
];

describe("evaluation metrics", () => {
  it("reports retrieval, citations, not-found, answer language, and sentence length per language", () => {
    const reports = evaluateObservations(observations);

    expect(reports).toEqual([
      expect.objectContaining({
        lang: "am",
        questionCount: 1,
        retrievalHitRate: 1,
        citationValidity: null,
        notFoundCorrectness: null,
        answerLanguageCorrectness: null,
        averageSentenceLength: null,
      }),
      expect.objectContaining({
        lang: "en",
        questionCount: 3,
        retrievalHitRate: 1,
        citationValidity: 1,
        notFoundCorrectness: 1,
        answerLanguageCorrectness: 1,
        averageSentenceLength: 4,
        averageSimpleSentenceLength: 4,
      }),
    ]);
  });

  it("renders a stable Markdown report with an honest empty metric", () => {
    const reports = evaluateObservations(observations.slice(0, 1));
    const markdown = renderEvaluationMarkdown(reports);

    expect(markdown).toContain("| en | 1 | 100% | 100% | n/a | 100% | 4.0 |");
    expect(markdown).toContain("Sentence-length target");
  });
});
