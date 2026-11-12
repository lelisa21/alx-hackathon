import type { AnswerRequest } from "@dimts/engine";

export type ProviderName = string;
export type ProviderPrivacyClass = "local" | "remote";
export type ProviderDataClass = "question" | "course-passage" | "glossary";

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
  health(): Promise<{ ok: boolean; reasonCode?: string }>;
  answer(request: AnswerRequest, signal: AbortSignal): Promise<AnswerResult>;
}

export class InvalidProviderResponseError extends Error {
  constructor() {
    super("Provider returned an invalid answer.");
    this.name = "InvalidProviderResponseError";
  }
}
