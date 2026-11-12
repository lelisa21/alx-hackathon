import type { AnswerRequest } from "@dimts/engine";
import type {
  AiProvider,
  AnswerResult,
  ProviderCapabilities,
  ProviderDataClass,
} from "./provider.js";

export interface OfflineFaq {
  q: string;
  a: string;
  source?: string;
}

export interface OfflineProviderOptions {
  name?: string;
  languages?: string[];
  faqs?: Record<string, OfflineFaq[]>;
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "do",
  "for",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "the",
  "to",
  "what",
  "where",
  "which",
  "who",
  "why",
]);

function keywords(value: string, lang: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase(lang)
      .normalize("NFC")
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => word.length > 2 && !stopWords.has(word)) ?? [],
  );
}

function faqScore(question: string, faqQuestion: string, lang: string): number {
  const query = keywords(question, lang);
  const faq = keywords(faqQuestion, lang);
  if (query.size === 0 || faq.size === 0) return 0;
  const overlap = [...query].filter((word) => faq.has(word)).length;
  return overlap < 2 ? 0 : overlap / Math.max(query.size, faq.size);
}

function sourcePassage(request: AnswerRequest, source?: string) {
  if (!source) return request.passages[0];
  return request.passages.find(
    ({ id }) => id === source || id.startsWith(`${source}#`),
  );
}

function extractSentences(text: string): string {
  return (
    text
      .replace(/\s+/gu, " ")
      .match(/[^.!?።]+[.!?።]?/gu)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" ") ?? ""
  );
}

export class OfflineProvider implements AiProvider {
  readonly name: string;
  readonly privacyClass = "local" as const;
  readonly allowedDataClasses: ProviderDataClass[] = [
    "question",
    "course-passage",
    "glossary",
  ];
  readonly evaluatedLanguages: string[] = [];
  private readonly languages: string[];
  private readonly faqs: Record<string, OfflineFaq[]>;

  constructor(options: OfflineProviderOptions = {}) {
    this.name = options.name ?? "offline";
    this.languages = options.languages ?? ["*"];
    this.faqs = options.faqs ?? {};
  }

  capabilities(): ProviderCapabilities {
    return {
      languages: [...this.languages],
      modes: ["extractive"],
      modalities: ["text"],
      structuredOutput: true,
    };
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async answer(
    request: AnswerRequest,
    signal: AbortSignal,
  ): Promise<AnswerResult> {
    if (signal.aborted) throw signal.reason ?? new Error("Request aborted.");
    const startedAt = performance.now();
    const matchingFaq = (this.faqs[request.lang] ?? [])
      .map((faq) => ({
        faq,
        score: faqScore(request.question, faq.q, request.lang),
      }))
      .sort((left, right) => right.score - left.score)
      .find(
        ({ faq, score }) => score >= 0.5 && sourcePassage(request, faq.source),
      );
    const faqPassage = matchingFaq
      ? sourcePassage(request, matchingFaq.faq.source)
      : undefined;
    const passage = faqPassage ?? request.passages[0];
    const text = matchingFaq
      ? matchingFaq.faq.a.trim()
      : passage
        ? extractSentences(passage.text)
        : "";

    return {
      text,
      usedPassageIds: text && passage ? [passage.id] : [],
      providerId: this.name,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }
}
