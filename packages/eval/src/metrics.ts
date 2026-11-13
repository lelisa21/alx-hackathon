import { sentenceWordCounts } from "@dimts/engine";

export interface EvalObservation {
  lang: string;
  expect: string;
  expectedPassages: string[];
  actualKind: string;
  topPassageIds: string[];
  citationsValid: boolean;
  answerLanguageCorrect: boolean;
  text: string;
  simple: boolean;
  caseId?: string;
  sourcePairs?: { sourceType: string; sourceLang: string }[];
}

export interface LanguageEvalReport {
  lang: string;
  questionCount: number;
  runCount: number;
  expectedAnswerCount: number;
  answerCount: number;
  answerRecall: number | null;
  kindAccuracy: number | null;
  retrievalHitRate: number | null;
  citationValidity: number | null;
  notFoundCorrectness: number | null;
  answerLanguageCorrectness: number | null;
  averageSentenceLength: number | null;
  averageSimpleSentenceLength: number | null;
  maxSentenceLength: number | null;
  maxSimpleSentenceLength: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function percentile95(values: number[]): number | null {
  if (values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error("Invalid timing sample.");
  return (
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ??
    null
  );
}

export function evaluateObservations(
  observations: EvalObservation[],
): LanguageEvalReport[] {
  const grouped = new Map<string, EvalObservation[]>();
  for (const observation of observations) {
    const current = grouped.get(observation.lang) ?? [];
    current.push(observation);
    grouped.set(observation.lang, current);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([lang, records]) => {
      const retrieval = records.filter(
        ({ expectedPassages }) => expectedPassages.length > 0,
      );
      const expectedNotFound = records.filter(
        ({ expect }) => expect === "notfound",
      );
      const answers = records.filter(
        ({ actualKind }) => actualKind === "answer",
      );
      const expectedAnswers = records.filter(
        ({ expect }) => expect === "answer",
      );
      const simpleAnswers = answers.filter(({ simple }) => simple);
      const answerLengths = answers
        .filter(({ simple }) => !simple)
        .flatMap(({ text }) => sentenceWordCounts(text));
      const simpleLengths = simpleAnswers.flatMap(({ text }) =>
        sentenceWordCounts(text),
      );
      return {
        lang,
        questionCount: new Set(
          records.map((record, index) => record.caseId ?? String(index)),
        ).size,
        runCount: records.length,
        expectedAnswerCount: expectedAnswers.length,
        answerCount: answers.length,
        answerRecall: expectedAnswers.length
          ? expectedAnswers.filter(({ actualKind }) => actualKind === "answer")
              .length / expectedAnswers.length
          : null,
        kindAccuracy: records.length
          ? records.filter(({ actualKind, expect }) => actualKind === expect)
              .length / records.length
          : null,
        retrievalHitRate:
          retrieval.length === 0
            ? null
            : retrieval.filter(({ expectedPassages, topPassageIds }) =>
                expectedPassages.some((id) => topPassageIds.includes(id)),
              ).length / retrieval.length,
        citationValidity:
          answers.length === 0
            ? null
            : answers.filter(({ citationsValid }) => citationsValid).length /
              answers.length,
        notFoundCorrectness:
          expectedNotFound.length === 0
            ? null
            : expectedNotFound.filter(
                ({ actualKind }) => actualKind === "notfound",
              ).length / expectedNotFound.length,
        answerLanguageCorrectness:
          answers.length === 0
            ? null
            : answers.filter(
                ({ answerLanguageCorrect }) => answerLanguageCorrect,
              ).length / answers.length,
        averageSentenceLength: average(answerLengths),
        averageSimpleSentenceLength: average(simpleLengths),
        maxSentenceLength: answerLengths.length
          ? Math.max(...answerLengths)
          : null,
        maxSimpleSentenceLength: simpleLengths.length
          ? Math.max(...simpleLengths)
          : null,
      };
    });
}

export function evaluateSourcePairs(
  observations: EvalObservation[],
): (LanguageEvalReport & { sourceType: string; sourceLang: string })[] {
  const grouped = new Map<
    string,
    { sourceType: string; sourceLang: string; records: EvalObservation[] }
  >();
  for (const observation of observations) {
    const pairs = observation.sourcePairs?.length
      ? observation.sourcePairs
      : [{ sourceType: "none", sourceLang: "none" }];
    for (const pair of pairs) {
      const key = JSON.stringify([
        observation.lang,
        pair.sourceType,
        pair.sourceLang,
      ]);
      const group = grouped.get(key) ?? { ...pair, records: [] };
      group.records.push(observation);
      grouped.set(key, group);
    }
  }
  return [...grouped.values()].flatMap(({ sourceType, sourceLang, records }) =>
    evaluateObservations(records).map((report) => ({
      ...report,
      sourceType,
      sourceLang,
    })),
  );
}

function percentage(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

function length(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(1);
}

export function renderEvaluationMarkdown(
  reports: LanguageEvalReport[],
): string {
  const rows = reports.map(
    ({
      lang,
      questionCount,
      retrievalHitRate,
      citationValidity,
      notFoundCorrectness,
      answerLanguageCorrectness,
      averageSentenceLength,
    }) =>
      `| ${lang} | ${questionCount} | ${percentage(retrievalHitRate)} | ${percentage(citationValidity)} | ${percentage(notFoundCorrectness)} | ${percentage(answerLanguageCorrectness)} | ${length(averageSentenceLength)} |`,
  );
  return [
    "# Evaluation results",
    "",
    "| Language | Questions | Retrieval hit rate | Citation validity | Not-found correctness | Answer-language correctness | Average sentence length (words) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    "Sentence-length target: average at most 15 words, or 12 words in Simple mode. Normal and Simple measurements are separate.",
    "A value of n/a means the fixture set contains no applicable observations; it is not a pass.",
    "",
  ].join("\n");
}
