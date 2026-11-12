import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { OfflineProvider } from "@dimts/ai";
import type { AnswerRequest, ReplyKind } from "@dimts/engine";
import {
  ask,
  isAnswerInLanguage,
} from "@dimts/engine";
import {
  parseJobPostingPassages,
  rankPassages,
  sourceHash,
  toPassages,
} from "@dimts/grounding";
import type { SearchCandidate } from "@dimts/grounding";
import { loadPacks, translate } from "@dimts/locales-tools";
import type { LangPack } from "@dimts/locales-tools";
import {
  evaluateObservations,
  renderEvaluationMarkdown,
} from "./metrics.js";
import type { EvalObservation } from "./metrics.js";

interface EvalCheck {
  id: string;
  question: string;
  expect: ReplyKind;
  expectPassages: string[];
  simple: boolean;
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
    const question =
      typeof entry.question === "string" ? entry.question : "";
    const expect = entry.expect;
    if (
      !id ||
      !question ||
      !["answer", "notfound", "escalation", "distress"].includes(
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
        simple: entry.simple === true,
      },
    ];
  });
}

function glossaryEntries(pack: LangPack, lang: string) {
  const entries = Array.isArray(pack.glossary)
    ? pack.glossary
    : Object.values(record(pack.glossary));
  return entries.flatMap((entry) => {
    const value = record(entry);
    const en = typeof value.en === "string" ? value.en : "";
    const am = typeof value.am === "string" ? value.am : "";
    const om = typeof value.om === "string" ? value.om : "";
    const term = lang === "am" ? am : lang === "om" ? om : en;
    return term && en
      ? [{ en, ...(am ? { am } : {}), ...(om ? { om } : {}) }]
      : [];
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
    .filter((filePath) => [".md", ".html", ".htm"].includes(path.extname(filePath).toLowerCase()))
    .sort();
}

async function passagesFromContent(root: string) {
  const coursePaths = await sourcePaths(path.join(root, "content", "sample-course"));
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
      throw new Error(`Invalid JobPosting fixture in content/sample-jobs/${name}.`);
    }
    passages.push(...result.passages);
  }

  if (passages.length === 0) {
    throw new Error("Evaluation has no course or job passages.");
  }
  return { passages, sourceDocuments };
}

function candidatesFor(passages: Awaited<ReturnType<typeof passagesFromContent>>["passages"]): SearchCandidate[] {
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
  return Object.fromEntries([...packs.entries()].map(([lang, pack]) => [lang, faqsFor(pack)]));
}

async function evaluatePack(
  lang: string,
  pack: LangPack,
  packs: Map<string, LangPack>,
  candidates: SearchCandidate[],
  contentVersion: string,
): Promise<EvalObservation[]> {
  const nextId = { value: 0 };
  const provider = new OfflineProvider({
    languages: ["*"],
    faqs: offlineFaqs(packs),
  });
  const glossary = glossaryEntries(pack, lang);
  const observations: EvalObservation[] = [];
  for (const check of checksFor(pack)) {
    const found = rankPassages(check.question, lang, candidates, glossary);
    const reply = await ask(
      {
        sessionId: `eval-${lang}`,
        clientMsgId: check.id,
        lang,
        text: check.question,
        via: "text",
        simple: check.simple,
      },
      {
        search: async () => found,
        answer: async (request: AnswerRequest) => {
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
      },
    );
    observations.push({
      lang,
      expect: check.expect,
      expectedPassages: check.expectPassages,
      actualKind: reply.kind,
      topPassageIds: found.slice(0, 3).map(({ id }) => id),
      citationsValid:
        reply.kind !== "answer" ||
        (reply.citations.length > 0 &&
          reply.citations.every(({ passageId }) =>
            found.some(({ id }) => id === passageId),
          )),
      answerLanguageCorrect:
        reply.kind !== "answer" || isAnswerInLanguage(reply.text, lang),
      text: reply.text,
      simple: check.simple,
    });
  }
  return observations;
}

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  const packs = loadPacks(path.join(root, "locales"));
  const targetPacks = [...packs.entries()]
    .filter(([code]) => code !== "ar-test")
    .sort(([left], [right]) => left.localeCompare(right));
  if (targetPacks.length === 0) throw new Error("No language packs were loaded.");
  const { passages, sourceDocuments } = await passagesFromContent(root);
  const version = sourceHash(sourceDocuments);
  const observations: EvalObservation[] = [];
  const issues: string[] = [];

  for (const [lang, pack] of targetPacks) {
    const checks = checksFor(pack);
    if (checks.length < 10) {
      issues.push(`${lang}: ${checks.length}/10 evaluation checks; need at least 10.`);
    }
    observations.push(
      ...(await evaluatePack(
        lang,
        pack,
        packs,
        candidatesFor(passages),
        version,
      )),
    );
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
    if (
      report.averageSimpleSentenceLength !== null &&
      report.averageSimpleSentenceLength > 12
    ) {
      issues.push(`${report.lang}: Simple-mode sentence length exceeds 12 words.`);
    }
  }

  const report = [
    renderEvaluationMarkdown(reports),
    "## Gate findings",
    "",
    ...(issues.length === 0 ? ["All measurable evaluation gates passed."] : issues.map((issue) => `- ${issue}`)),
    "",
    "This offline run uses only local sample content and does not make provider network requests.",
    "",
  ].join("\n");
  await writeFile(path.join(root, "docs", "EVAL.md"), report, "utf8");
  if (issues.length > 0) {
    process.stderr.write(`Evaluation gates failed (${issues.length} findings). See docs/EVAL.md.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Evaluation gates passed. See docs/EVAL.md.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Evaluation failed."}\n`,
  );
  process.exitCode = 1;
});
