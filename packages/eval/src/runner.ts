import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { OfflineProvider } from "@dimts/ai";
import type { AnswerRequest, AskDependencies, ReplyKind } from "@dimts/engine";
import { ask, isAnswerInLanguage } from "@dimts/engine";
import {
  parseJobPostingPassages,
  rankPassages,
  sourceHash,
  toPassages,
} from "@dimts/grounding";
import type { SearchCandidate } from "@dimts/grounding";
import { loadPacks, translate, validatePacks } from "@dimts/locales-tools";
import type { LangPack } from "@dimts/locales-tools";
import {
  evaluateObservations,
  evaluateSourcePairs,
  percentile95,
  renderEvaluationMarkdown,
} from "./metrics.js";
import type { EvalObservation } from "./metrics.js";

interface EvalCheck {
  id: string;
  question: string;
  expect: ReplyKind;
  expectPassages: string[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function checksFor(pack: LangPack): EvalCheck[] {
  if (!Array.isArray(pack.checks)) return [];
  return pack.checks.flatMap((value) => {
    const entry = record(value);
    const id = typeof entry.id === "string" ? entry.id : "";
    const question = typeof entry.question === "string" ? entry.question : "";
    const expect = entry.expect;
    if (
      !id ||
      !question ||
      !["answer", "notfound", "escalation", "distress", "system"].includes(
        String(expect),
      )
    ) {
      return [];
    }
    return [
      {
        id,
        question,
        expect: expect as ReplyKind,
        expectPassages: Array.isArray(entry.expect_passages)
          ? entry.expect_passages.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
      },
    ];
  });
}

export function glossaryEntries(pack: LangPack, lang: string) {
  if (
    pack.meta.status === "draft" ||
    !pack.meta.reviewed_by ||
    !pack.meta.reviewed_on
  )
    return [];
  const entries = Array.isArray(pack.glossary)
    ? pack.glossary
    : Object.values(record(pack.glossary));
  return entries.flatMap((entry) => {
    const value = record(entry);
    const en = typeof value.en === "string" ? value.en : "";
    const term = value[lang];
    if (typeof term !== "string" || !term.trim() || !en) return [];
    const metadataKeys = new Set([
      "id",
      "simple_definition",
      "definition",
      "do_not_translate",
      "term",
      "meaning",
      "notes",
    ]);
    const forms: Record<string, string> = {};
    for (const [code, form] of Object.entries(value)) {
      if (metadataKeys.has(code) || typeof form !== "string" || !form.trim())
        continue;
      try {
        if (Intl.getCanonicalLocales(code)[0] === code) forms[code] = form;
      } catch {
        /* Non-language metadata is not a mapping. */
      }
    }
    return [{ ...forms, en }];
  });
}

function promptGlossary(pack: LangPack, lang: string) {
  const entries = Array.isArray(pack.glossary)
    ? pack.glossary
    : Object.values(record(pack.glossary));
  return entries.flatMap((entry) => {
    const value = record(entry);
    const term = value[lang] ?? value.en;
    const meaning = value.simple_definition ?? value.definition;
    return typeof term === "string" && typeof meaning === "string"
      ? [{ term, meaning }]
      : [];
  });
}

function faqsFor(pack: LangPack) {
  if (!Array.isArray(pack.faq)) return [];
  return pack.faq.flatMap((entry) => {
    const value = record(entry);
    if (typeof value.q !== "string" || typeof value.a !== "string") return [];
    return [
      {
        q: value.q,
        a: value.a,
        ...(typeof value.source === "string" ? { source: value.source } : {}),
      },
    ];
  });
}

function ruleWords(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function sourcePaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .filter((filePath) =>
      [".md", ".html", ".htm"].includes(path.extname(filePath).toLowerCase()),
    )
    .sort();
}

async function passagesFromContent(root: string) {
  const coursePaths = await sourcePaths(
    path.join(root, "content", "sample-course"),
  );
  const passages = [];
  const sourceDocuments: { name: string; content: string }[] = [];
  for (const filePath of coursePaths) {
    const content = await readFile(filePath, "utf8");
    const extension = path.extname(filePath).toLowerCase();
    const name = path.relative(root, filePath);
    sourceDocuments.push({ name, content });
    passages.push(
      ...toPassages({
        lessonId: path.basename(filePath, extension),
        content,
        format: extension === ".md" ? "markdown" : "html",
        baseUrl: "https://course.example/lessons/",
        lang: "en",
      }),
    );
  }

  const jobDirectory = path.join(root, "content", "sample-jobs");
  const jobFiles = (await readdir(jobDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonld"))
    .map((entry) => entry.name)
    .sort();
  for (const name of jobFiles) {
    const content = await readFile(path.join(jobDirectory, name), "utf8");
    sourceDocuments.push({
      name: path.join("content", "sample-jobs", name),
      content,
    });
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON-LD in content/sample-jobs/${name}.`);
    }
    const result = parseJobPostingPassages(json, { lang: "en" });
    if (result.errors.length > 0) {
      throw new Error(
        `Invalid JobPosting fixture in content/sample-jobs/${name}.`,
      );
    }
    passages.push(...result.passages);
  }

  if (passages.length === 0) {
    throw new Error("Evaluation has no course or job passages.");
  }
  return { passages, sourceDocuments };
}

function candidatesFor(
  passages: Awaited<ReturnType<typeof passagesFromContent>>["passages"],
): SearchCandidate[] {
  return passages.map((passage) => ({
    id: passage.id,
    text: passage.text,
    textNorm: passage.textNorm,
    label: `${passage.lessonTitle} / ${passage.sectionTitle}`,
    url: passage.url,
    lang: passage.lang,
    sourceType: passage.sourceType,
  }));
}

function offlineFaqs(packs: Map<string, LangPack>) {
  return Object.fromEntries(
    [...packs.entries()].map(([lang, pack]) => [lang, faqsFor(pack)]),
  );
}

async function evaluatePack(
  lang: string,
  pack: LangPack,
  packs: Map<string, LangPack>,
  candidates: SearchCandidate[],
  contentVersion: string,
) {
  const nextId = { value: 0 };
  const provider = new OfflineProvider({
    languages: ["*"],
    faqs: offlineFaqs(packs),
  });
  const glossary = glossaryEntries(pack, lang);
  const observations: EvalObservation[] = [];
  const offlineTimes: number[] = [];
  const cacheTimes: number[] = [];
  let providerCalls = 0;
  for (const check of checksFor(pack)) {
    for (const simple of [false, true]) {
      let found: ReturnType<typeof rankPassages> = [];
      const request = {
        sessionId: `eval-${lang}`,
        clientMsgId: check.id,
        lang,
        text: check.question,
        via: "text" as const,
        simple,
      };
      const deps: AskDependencies = {
        search: async () => {
          found = rankPassages(check.question, lang, candidates, glossary);
          return found;
        },
        answer: async (request: AnswerRequest) => {
          providerCalls += 1;
          const result = await provider.answer(
            request,
            new AbortController().signal,
          );
          return {
            text: result.text,
            usedPassageIds: result.usedPassageIds,
            provider: result.providerId,
            latencyMs: result.latencyMs,
          };
        },
        glossaryFor: () => promptGlossary(pack, lang),
        systemPrompt: () =>
          typeof pack.prompts.system_addendum === "string"
            ? pack.prompts.system_addendum
            : "",
        modeFor: () =>
          pack.prompts.answer_mode === "generative"
            ? "generative"
            : "extractive",
        confidenceFloor: () =>
          typeof pack.prompts.floor === "number" ? pack.prompts.floor : 0.6,
        rulesFor: () => ({
          escalation: ruleWords(pack.prompts.escalation),
          distress: ruleWords(pack.prompts.distress),
        }),
        translate: (requestedLang, key, vars) =>
          translate(packs, requestedLang, key, vars).text,
        direction: (requestedLang) =>
          packs.get(requestedLang)?.meta.dir ?? "ltr",
        contentVersion: () => contentVersion,
        createId: () => `eval-reply-${++nextId.value}`,
      };
      const startedAt = performance.now();
      const reply = await ask(request, deps);
      offlineTimes.push(performance.now() - startedAt);
      if (reply.kind === "answer") {
        for (let repeatIndex = 0; repeatIndex < 20; repeatIndex += 1) {
          const before = providerCalls;
          const repeatStarted = performance.now();
          const repeat = await ask(
            { ...request, clientMsgId: `${check.id}-repeat-${repeatIndex}` },
            deps,
          );
          const elapsed = performance.now() - repeatStarted;
          if (repeat.kind === "answer" && providerCalls === before)
            cacheTimes.push(elapsed);
        }
      }
      observations.push({
        caseId: check.id,
        lang,
        expect: check.expect,
        expectedPassages: check.expectPassages,
        actualKind: reply.kind,
        topPassageIds: found.slice(0, 3).map(({ id }) => id),
        citationsValid:
          reply.kind !== "answer" ||
          (reply.citations.length > 0 &&
            reply.citations.every(
              ({ passageId, url, sourceLang, sourceType }) =>
                found.some(
                  (passage) =>
                    passage.id === passageId &&
                    passage.url === url &&
                    passage.lang === sourceLang &&
                    passage.sourceType === sourceType,
                ),
            )),
        answerLanguageCorrect:
          reply.kind !== "answer" || isAnswerInLanguage(reply.text, lang),
        text: reply.text,
        simple,
        sourcePairs: [
          ...new Map(
            [
              ...check.expectPassages,
              ...reply.citations.map((c) => c.passageId),
            ].flatMap((id) => {
              const source = candidates.find((p) => p.id === id);
              return source
                ? [
                    [
                      `${source.sourceType}:${source.lang}`,
                      {
                        sourceType: source.sourceType,
                        sourceLang: source.lang,
                      },
                    ] as const,
                  ]
                : [];
            }),
          ).values(),
        ],
      });
    }
  }
  return { observations, offlineTimes, cacheTimes };
}

export async function runEvaluation(root: string) {
  if (validatePacks(path.join(root, "locales")).length)
    throw new Error("Invalid language packs.");
  const packs = loadPacks(path.join(root, "locales"));
  const targetPacks = [...packs.entries()]
    .filter(([code]) => code !== "ar-test")
    .sort(([left], [right]) => left.localeCompare(right));
  if (targetPacks.length === 0)
    throw new Error("No language packs were loaded.");
  const { passages, sourceDocuments } = await passagesFromContent(root);
  const version = sourceHash(sourceDocuments);
  const observations: EvalObservation[] = [];
  const issues: string[] = [];
  const blockers: string[] = [];
  const offlineTimes: number[] = [];
  const cacheTimes: number[] = [];
  const faqReports: {
    lang: string;
    count: number;
    hits: number;
    reviewed: boolean;
  }[] = [];

  if (targetPacks.length < 3)
    issues.push("Need at least three language packs.");

  for (const [lang, pack] of targetPacks) {
    const checks = checksFor(pack);
    if (checks.length < 10) {
      issues.push(
        `${lang}: ${checks.length}/10 evaluation checks; need at least 10.`,
      );
    }
    if (!pack.meta.reviewed_by || !pack.meta.reviewed_on)
      blockers.push(
        `${lang}: pack and evaluation questions require human review; status ${pack.meta.status}.`,
      );
    const evaluated = await evaluatePack(
      lang,
      pack,
      packs,
      candidatesFor(passages),
      version,
    );
    observations.push(...evaluated.observations);
    offlineTimes.push(...evaluated.offlineTimes);
    cacheTimes.push(...evaluated.cacheTimes);
    const faqs = faqsFor(pack);
    const provider = new OfflineProvider({ faqs: { [lang]: faqs } });
    let hits = 0;
    for (const faq of faqs) {
      const source = candidatesFor(passages).find((p) => p.id === faq.source);
      const result = await provider.answer(
        {
          question: faq.q,
          lang,
          passages: source ? [source] : [],
          glossary: [],
          simple: false,
          mode: "extractive",
          systemPrompt: "",
        },
        new AbortController().signal,
      );
      if (
        source &&
        result.text === faq.a.trim() &&
        result.usedPassageIds.includes(source.id)
      )
        hits += 1;
    }
    faqReports.push({
      lang,
      count: faqs.length,
      hits,
      reviewed: Boolean(pack.meta.reviewed_by && pack.meta.reviewed_on),
    });
    if (lang === "en" && (!faqs.length || hits / faqs.length < 0.7))
      issues.push("en: offline FAQ adapter hit rate below 70%.");
  }

  const reports = evaluateObservations(observations);
  for (const report of reports) {
    if (report.citationValidity !== null && report.citationValidity < 1) {
      issues.push(`${report.lang}: citation validity is below 100%.`);
    }
    if (
      report.notFoundCorrectness !== null &&
      report.notFoundCorrectness < 0.9
    ) {
      issues.push(`${report.lang}: not-found correctness is below 90%.`);
    }
    if (
      report.averageSentenceLength !== null &&
      report.averageSentenceLength > 15
    ) {
      issues.push(`${report.lang}: average sentence length exceeds 15 words.`);
    }
    if (report.maxSentenceLength !== null && report.maxSentenceLength > 15)
      issues.push(`${report.lang}: a normal answer sentence exceeds 15 words.`);
    if (
      report.maxSimpleSentenceLength !== null &&
      report.maxSimpleSentenceLength > 12
    )
      issues.push(`${report.lang}: a Simple answer sentence exceeds 12 words.`);
    if (
      report.averageSimpleSentenceLength !== null &&
      report.averageSimpleSentenceLength > 12
    ) {
      issues.push(
        `${report.lang}: Simple-mode sentence length exceeds 12 words.`,
      );
    }
    if (
      report.answerLanguageCorrectness !== null &&
      report.answerLanguageCorrectness < 1
    )
      issues.push(`${report.lang}: some answers have the wrong language.`);
    if (report.citationValidity === null)
      blockers.push(
        `${report.lang}: no answers; citation and answer-language correctness remain unverified.`,
      );
    if (report.averageSimpleSentenceLength === null)
      blockers.push(
        `${report.lang}: no Simple answers; sentence-length acceptance unverified.`,
      );
  }

  const offlineP95 = percentile95(offlineTimes);
  const cacheP95 = percentile95(cacheTimes);
  if (offlineP95 !== null && offlineP95 > 1000)
    issues.push("Offline reply p95 exceeds 1000 ms.");
  if (cacheP95 !== null && cacheP95 >= 50)
    issues.push("Repeat-answer p95 is not below 50 ms.");
  if (cacheP95 === null)
    blockers.push("No validated cache hits; repeat-answer latency unverified.");
  blockers.push(
    "No real local open-model or cloud adapter configured in this offline harness: 15 s / 6 s p95 targets are unverified.",
  );
  const pairReports = evaluateSourcePairs(observations);

  const report = [
    renderEvaluationMarkdown(reports),
    "## Answer and Simple-mode coverage",
    "",
    ...reports.map(
      (r) =>
        `- ${r.lang}: ${r.questionCount} distinct questions / ${r.runCount} normal+Simple runs; ${r.answerCount}/${r.expectedAnswerCount} actual/expected answers; answer recall ${r.answerRecall === null ? "n/a" : `${(r.answerRecall * 100).toFixed(1)}%`}; reply-kind accuracy ${r.kindAccuracy === null ? "n/a" : `${(r.kindAccuracy * 100).toFixed(1)}%`}; normal average/max ${r.averageSentenceLength?.toFixed(1) ?? "n/a"}/${r.maxSentenceLength ?? "n/a"}, Simple average/max ${r.averageSimpleSentenceLength?.toFixed(1) ?? "n/a"}/${r.maxSimpleSentenceLength ?? "n/a"} words.`,
    ),
    "",
    "No-answer outcomes remain in retrieval and answer-recall denominators. Null answer metrics are not passes.",
    "",
    "## Source and language pairs",
    "",
    ...pairReports.map(
      (r) =>
        `- ${r.sourceType}, ${r.sourceLang} → ${r.lang}: ${r.runCount} runs; retrieval ${r.retrievalHitRate === null ? "n/a" : `${(r.retrievalHitRate * 100).toFixed(1)}%`}; citations ${r.citationValidity === null ? "n/a" : `${(r.citationValidity * 100).toFixed(1)}%`}; notfound ${r.notFoundCorrectness === null ? "n/a" : `${(r.notFoundCorrectness * 100).toFixed(1)}%`}; answer language ${r.answerLanguageCorrectness === null ? "n/a" : `${(r.answerLanguageCorrectness * 100).toFixed(1)}%`}; normal/Simple average sentence words ${r.averageSentenceLength?.toFixed(1) ?? "n/a"}/${r.averageSimpleSentenceLength?.toFixed(1) ?? "n/a"}.`,
    ),
    "",
    "Pairs use expected passages even when retrieval misses, plus actual citations; no-source negative cases use none. Questions may appear in more than one relevant source pair.",
    "",
    "## Offline FAQ adapter",
    "",
    ...faqReports.map(
      (r) =>
        `- ${r.lang}: ${r.hits}/${r.count} expected FAQ answers (${r.count ? ((r.hits / r.count) * 100).toFixed(1) : "n/a"}%); ${r.count - r.hits} misses; ${r.reviewed ? "review metadata present" : "unreviewed draft set"}.`,
    ),
    "",
    "FAQ matching is measured separately at the adapter boundary with each FAQ's actual source passage. This does not bypass the engine retrieval/confidence gate; no cross-language acceptance is inferred. The English target is at least 70% on a reviewed set, which remains unavailable.",
    "",
    "## Latency conditions",
    "",
    `Node ${process.version}; ${process.platform}/${process.arch}; offline in-process ask service boundary, sample content and warm dependencies; no database or learner network. ${offlineTimes.length} uncached normal+Simple requests: p95 ${offlineP95?.toFixed(2) ?? "n/a"} ms (target <=1000 ms). ${cacheTimes.length} repeated answers with zero additional provider calls: p95 ${cacheP95?.toFixed(2) ?? "n/a"} ms (target <50 ms).`,
    "",
    "Timings include retrieval, language/citation validation and reply construction. They do not establish deployed HTTP/PostgreSQL or real-model performance.",
    "",
    "## Gate findings",
    "",
    ...(issues.length === 0
      ? [
          "Measured citation, notfound, language, sentence-length, FAQ and latency gates passed where applicable. This is not final language acceptance; answer recall and unmeasured cases remain visible above.",
        ]
      : issues.map((issue) => `- ${issue}`)),
    "",
    "## Acceptance blockers",
    "",
    ...blockers.map((blocker) => `- ${blocker}`),
    "",
    "Run `pnpm eval` from the repository root. Each checks.yaml question runs in both normal and Simple mode; floors and expected outcomes are unchanged. Glossary expansion requires actual review metadata. The checked-in sources are English sample course/job fixtures, not a multilingual production corpus. Counts and status are evidence, not a release sign-off.",
    "",
    "This offline run uses only local sample content and does not make provider network requests.",
    "",
  ].join("\n");
  return {
    report,
    issues,
    blockers,
    reports,
    pairReports,
    faqReports,
    offlineP95,
    cacheP95,
  };
}
