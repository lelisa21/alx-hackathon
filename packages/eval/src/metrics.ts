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
}

export interface LanguageEvalReport {
  lang: string;
  questionCount: number;
  retrievalHitRate: number | null;
  citationValidity: number | null;
  notFoundCorrectness: number | null;
  answerLanguageCorrectness: number | null;
  averageSentenceLength: number | null;
  averageSimpleSentenceLength: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sentenceLengths(text: string): number[] {
  return (
    text
      .match(/[^.!?።]+[.!?።]?/gu)
      ?.map((sentence) => sentence.trim().split(/\s+/u).filter(Boolean).length)
      .filter((length) => length > 0) ?? []
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
      const answers = records.filter(({ actualKind }) => actualKind === "answer");
      const simpleAnswers = answers.filter(({ simple }) => simple);
      const answerLengths = answers.flatMap(({ text }) => sentenceLengths(text));
      const simpleLengths = simpleAnswers.flatMap(({ text }) =>
        sentenceLengths(text),
      );
      return {
        lang,
        questionCount: records.length,
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
            : answers.filter(({ answerLanguageCorrect }) => answerLanguageCorrect)
                .length / answers.length,
        averageSentenceLength: average(answerLengths),
        averageSimpleSentenceLength: average(simpleLengths),
      };
    });
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
    "Sentence-length target: average at most 15 words, or 12 words in Simple mode.",
    "A value of n/a means the fixture set contains no applicable observations; it is not a pass.",
    "",
  ].join("\n");
}
