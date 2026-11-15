import { randomBytes } from "node:crypto";
import { ask } from "@dimts/engine";
import type {
  AnswerCache,
  AskDependencies,
  ConversationSignals,
  LanguageDetector,
} from "@dimts/engine";
import { normalise } from "@dimts/grounding";
import type { GlossaryEntry, PostgresGrounding } from "@dimts/grounding";
import { translate } from "@dimts/locales-tools";
import type { LangPack } from "@dimts/locales-tools";
import type { ApiConfig } from "./config.js";
import type { ApiProviderRuntime } from "./provider-runtime.js";

function glossaryTerms(pack: LangPack | undefined, lang: string) {
  const entries = Array.isArray(pack?.glossary)
    ? pack.glossary
    : Object.values(pack?.glossary ?? {});
  return entries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const term = record[lang] ?? record.en;
    const meaning = record.simple_definition ?? record.definition;
    return typeof term === "string" && typeof meaning === "string"
      ? [{ term, meaning }]
      : [];
  });
}

function reviewedMappings(pack: LangPack | undefined): GlossaryEntry[] {
  const meta = pack?.meta;
  if (
    !meta ||
    meta.status === "draft" ||
    typeof meta.reviewed_by !== "string" ||
    !meta.reviewed_by.trim() ||
    /^(todo|tbd|unknown|none|pending)$/iu.test(meta.reviewed_by.trim()) ||
    typeof meta.reviewed_on !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(meta.reviewed_on)
  )
    return [];
  const reviewedAt = Date.parse(`${meta.reviewed_on}T00:00:00Z`);
  if (
    !Number.isFinite(reviewedAt) ||
    reviewedAt > Date.now() ||
    new Date(reviewedAt).toISOString().slice(0, 10) !== meta.reviewed_on
  )
    return [];
  const entries = Array.isArray(pack?.glossary)
    ? pack.glossary
    : Object.values(pack?.glossary ?? {});
  const metadataKeys = new Set([
    "id",
    "simple_definition",
    "definition",
    "do_not_translate",
    "term",
    "meaning",
    "notes",
  ]);
  return entries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      return [];
    const forms: Record<string, string> = {};
    for (const [code, value] of Object.entries(entry)) {
      if (metadataKeys.has(code) || typeof value !== "string" || !value.trim())
        continue;
      try {
        if (Intl.getCanonicalLocales(code)[0] === code) forms[code] = value;
      } catch {
        /* Non-language metadata does not authorize a retrieval pair. */
      }
    }
    return forms.en ? [{ ...forms, en: forms.en }] : [];
  });
}

function containsWholeTerm(
  question: string,
  term: string,
  lang: string,
): boolean {
  const queryWords = normalise(question, lang).split(" ").filter(Boolean);
  const termWords = normalise(term, lang).split(" ").filter(Boolean);
  return (
    termWords.length > 0 &&
    queryWords.some((_word, index) =>
      termWords.every((word, offset) => queryWords[index + offset] === word),
    )
  );
}

export function createEngineDependencies(options: {
  config: ApiConfig;
  packs: Map<string, LangPack>;
  grounding: Pick<PostgresGrounding, "search" | "currentVersion">;
  providerRuntime: ApiProviderRuntime;
  answerEvent?: (event: {
    provider: string;
    latencyMs: number;
    answered: boolean;
  }) => void;
  languageDetector?: LanguageDetector;
  conversationSignals?: ConversationSignals;
  answerCache?: AnswerCache;
  cacheEvent?: AskDependencies["cacheEvent"];
}): AskDependencies {
  const { config, packs, grounding, providerRuntime, languageDetector } =
    options;

  return {
    search: (question, lang) =>
      grounding.search(question, lang, reviewedMappings(packs.get(lang))),
    answer: async (request, policy) => {
      const result = await providerRuntime.answer(request, policy);
      // Provider identity, latency and outcome only; never question or answer text.
      options.answerEvent?.({
        provider: result.provider,
        latencyMs: result.latencyMs,
        answered: result.usedPassageIds.length > 0,
      });
      return result;
    },
    glossaryFor: (question, lang) => {
      return glossaryTerms(packs.get(lang), lang).filter(({ term }) =>
        containsWholeTerm(question, term, lang),
      );
    },
    systemPrompt: (lang) => {
      const addendum = packs.get(lang)?.prompts.system_addendum;
      return typeof addendum === "string" ? addendum : "";
    },
    modeFor: (lang) =>
      packs.get(lang)?.prompts.answer_mode === "generative"
        ? "generative"
        : "extractive",
    recallFloor: (lang, policy) =>
      providerRuntime.canJudge?.(lang, policy)
        ? config.DIMTS_AI_RECALL_FLOOR
        : undefined,
    confidenceFloor: (lang) => {
      const floor = packs.get(lang)?.prompts.floor;
      return typeof floor === "number" ? floor : config.DIMTS_CONFIDENCE_FLOOR;
    },
    translate: (lang, key, vars) => {
      const sourceCode =
        key === "from.other" && typeof vars?.lang === "string"
          ? vars.lang
          : undefined;
      const sourceName = sourceCode
        ? packs.get(sourceCode)?.meta.name_native
        : undefined;
      return translate(
        packs,
        lang,
        key,
        sourceName ? { ...vars, lang: sourceName } : vars,
      ).text;
    },
    rulesFor: (lang) => {
      const prompts = packs.get(lang)?.prompts;
      const phrases = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [];
      return {
        escalation: phrases(prompts?.escalation),
        distress: phrases(prompts?.distress),
      };
    },
    ...(options.conversationSignals
      ? { conversationSignals: options.conversationSignals }
      : {}),
    ...(options.answerCache ? { answerCache: options.answerCache } : {}),
    ...(options.cacheEvent ? { cacheEvent: options.cacheEvent } : {}),
    direction: (lang) => packs.get(lang)?.meta.dir ?? "ltr",
    ...(languageDetector
      ? {
          languageDetector,
          languageDetectionConfidence:
            config.DIMTS_LANGUAGE_DETECTION_CONFIDENCE,
        }
      : {}),
    contentVersion: () => grounding.currentVersion(),
    createId: () => randomBytes(16).toString("base64url"),
  };
}

export { ask };
