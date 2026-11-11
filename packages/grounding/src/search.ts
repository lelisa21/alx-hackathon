import type { ScoredPassage } from "@dimts/engine";
import { confidence, queryTokens } from "./grams.js";
import { normalise } from "./normalise.js";

export interface GlossaryEntry {
  en: string;
  am?: string;
  om?: string;
}

export interface SearchCandidate {
  id: string;
  text: string;
  textNorm: string;
  label: string;
  url: string;
  lang: string;
  sourceType: "course" | "job";
  timestamp?: number;
}

export function expandTokens(
  tokens: string[],
  lang: string,
  glossary: GlossaryEntry[],
): string[] {
  const expanded = new Set(tokens);
  const original = new Set(tokens);
  const queryLanguage = lang.toLowerCase().split("-")[0] ?? lang;

  for (const entry of glossary) {
    const forms = Object.entries(entry).flatMap(([formLang, value]) => {
      if (typeof value !== "string" || !value.trim()) return [];
      return [queryTokens(normalise(value, formLang))];
    });
    const queryForm = Object.entries(entry).find(
      ([formLang]) => formLang === queryLanguage,
    )?.[1];
    const queryFormTokens =
      typeof queryForm === "string"
        ? queryTokens(normalise(queryForm, queryLanguage))
        : [];
    const matches =
      queryFormTokens.length > 0
        ? queryFormTokens.every((token) => original.has(token))
        : forms.some(
            (form) =>
              form.length > 0 && form.every((token) => original.has(token)),
          );
    if (matches) {
      for (const form of forms) {
        for (const token of form) expanded.add(token);
      }
    }
  }

  return [...expanded];
}

export function rankPassages(
  question: string,
  lang: string,
  candidates: SearchCandidate[],
  glossary: GlossaryEntry[],
  limit = 5,
): ScoredPassage[] {
  const questionTokens = queryTokens(normalise(question, lang));
  if (questionTokens.length === 0) return [];

  const terms = expandTokens(questionTokens, lang, glossary);
  const scored = candidates.map((candidate) => {
    const base = {
      id: candidate.id,
      text: candidate.text,
      label: candidate.label,
      url: candidate.url,
      lang: candidate.lang,
      sourceType: candidate.sourceType,
      score: confidence(terms, candidate.textNorm),
    };
    return candidate.timestamp === undefined
      ? base
      : { ...base, timestamp: candidate.timestamp };
  });
  const resultLimit = Math.max(0, Math.min(5, Math.trunc(limit)));
  return scored
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    )
    .slice(0, resultLimit);
}
