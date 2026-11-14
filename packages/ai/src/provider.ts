import type { AnswerRequest } from "@dimts/engine";

export type ProviderName = string;
export type ProviderPrivacyClass = "local" | "remote";
/**
 * "job-posting" authorizes sending public job postings (from job boards) to a
 * remote provider. It is never implied by "course-passage".
 */
export type ProviderDataClass =
  "question" | "course-passage" | "job-posting" | "glossary";

/** Passages a provider may receive under its privacy class and data classes. */
export function permittedPassages<T extends { sourceType: "course" | "job" }>(
  passages: T[],
  allowed: ReadonlySet<ProviderDataClass>,
  privacyClass: "local" | "remote",
): T[] {
  if (privacyClass === "local")
    return allowed.has("course-passage") ? passages : [];
  return passages.filter(({ sourceType }) =>
    allowed.has(sourceType === "course" ? "course-passage" : "job-posting"),
  );
}

export interface ProviderCapabilities {
  languages: string[];
  modes: ("extractive" | "generative")[];
  modalities: ("text" | "image" | "audio")[];
  structuredOutput: boolean;
}

export interface AnswerResult {
  text: string;
  usedPassageIds: string[];
  providerId: ProviderName;
  latencyMs: number;
}

export interface AiProvider {
  name: ProviderName;
  privacyClass: ProviderPrivacyClass;
  allowedDataClasses: ProviderDataClass[];
  evaluatedLanguages: string[];
  capabilities(): ProviderCapabilities;
  health(signal?: AbortSignal): Promise<{ ok: boolean; reasonCode?: string }>;
  answer(request: AnswerRequest, signal: AbortSignal): Promise<AnswerResult>;
}

export class InvalidProviderResponseError extends Error {
  constructor() {
    super("Provider returned an invalid answer.");
    this.name = "InvalidProviderResponseError";
  }
}
