import { randomBytes } from "node:crypto";
import { ask } from "@dimts/engine";
import type { AskDependencies, LanguageDetector } from "@dimts/engine";
import type { PostgresGrounding } from "@dimts/grounding";
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

export function createEngineDependencies(options: {
  config: ApiConfig;
  packs: Map<string, LangPack>;
  grounding: Pick<PostgresGrounding, "search" | "currentVersion">;
  providerRuntime: ApiProviderRuntime;
  languageDetector?: LanguageDetector;
}): AskDependencies {
  const { config, packs, grounding, providerRuntime, languageDetector } =
    options;

  return {
    search: (question, lang) => grounding.search(question, lang),
    answer: (request, policy) => providerRuntime.answer(request, policy),
    glossaryFor: (question, lang) => {
      const tokens = question.toLocaleLowerCase().split(/\s+/u);
      return glossaryTerms(packs.get(lang), lang).filter(({ term }) =>
        tokens.some((token) => term.toLocaleLowerCase().includes(token)),
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
    confidenceFloor: (lang) => {
      const floor = packs.get(lang)?.prompts.floor;
      return typeof floor === "number" ? floor : config.DIMTS_CONFIDENCE_FLOOR;
    },
    translate: (lang, key) => translate(packs, lang, key).text,
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
