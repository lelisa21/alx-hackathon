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

/** Callers supply only reviewed mappings; an unrelated mapping grants no access. */
export function retrievalLanguages(
  question: string,
  lang: string,
  glossary: GlossaryEntry[],
): string[] {
  const base = lang.toLowerCase().split("-")[0] ?? lang;
  const tokens = new Set(queryTokens(normalise(question, lang)));
  const allowed = new Set([lang]);
  for (const entry of glossary) {
    const form = Object.entries(entry).find(([code]) => code === base)?.[1];
    const formTokens =
      typeof form === "string" ? queryTokens(normalise(form, lang)) : [];
    if (!formTokens.length || !formTokens.every((token) => tokens.has(token)))
      continue;
    for (const [code, value] of Object.entries(entry)) {
      if (typeof value === "string" && value.trim()) allowed.add(code);
    }
  }
  return [...allowed];
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

  const allowedLanguages = new Set(
    retrievalLanguages(question, lang, glossary),
  );
  const scored = candidates
    .filter((candidate) => allowedLanguages.has(candidate.lang))
    .map((candidate) => {
      // Score each source against its language's query terms, not a union
      // that penalizes every correctly translated term as an unmatched word.
      // Unmapped terms remain in the denominator; partial mappings do not
      // silently erase the rest of a learner's question.
      const terms = new Set(questionTokens);
      if (candidate.lang !== lang) {
        const base = lang.toLowerCase().split("-")[0] ?? lang;
        for (const entry of glossary) {
          const sourceForm = Object.entries(entry).find(
            ([code]) => code === base,
          )?.[1];
          const targetForm = Object.entries(entry).find(
            ([code]) => code === candidate.lang,
          )?.[1];
          if (typeof sourceForm !== "string" || typeof targetForm !== "string")
            continue;
          const sourceTokens = queryTokens(normalise(sourceForm, lang));
          if (
            !sourceTokens.length ||
            !sourceTokens.every((token) => questionTokens.includes(token))
          )
            continue;
          for (const token of sourceTokens) terms.delete(token);
          for (const token of queryTokens(
            normalise(targetForm, candidate.lang),
          ))
            terms.add(token);
        }
      }
      const base = {
        id: candidate.id,
        text: candidate.text,
        label: candidate.label,
        url: candidate.url,
        lang: candidate.lang,
        sourceType: candidate.sourceType,
        score: confidence([...terms], candidate.textNorm),
      };
      return candidate.timestamp === undefined
        ? base
        : { ...base, timestamp: candidate.timestamp };
    });
  const resultLimit = Math.max(0, Math.min(5, Math.trunc(limit)));
  return scored
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(right.lang === lang) - Number(left.lang === lang) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, resultLimit);
}
