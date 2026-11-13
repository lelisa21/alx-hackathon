import type { AnswerRequest } from "@dimts/engine";
import { hasInstructionInjection, isAnswerLengthAllowed } from "@dimts/engine";
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
  resolveSource?: (
    source: string,
    passageIds: string[],
  ) => Promise<string | null>;
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
  const canonical = (value: string) =>
    value
      .trim()
      .normalize("NFC")
      .toLocaleLowerCase(lang)
      .replace(/[‘’]/gu, "'")
      .replace(/\s+/gu, " ");
  if (canonical(question) && canonical(question) === canonical(faqQuestion))
    return 1;
  const query = keywords(question, lang);
  const faq = keywords(faqQuestion, lang);
  if (query.size === 0 || faq.size === 0) return 0;
  const overlap = [...query].filter((word) => faq.has(word)).length;
  return overlap < 2 ? 0 : overlap / Math.max(query.size, faq.size);
}

function sourcePassage(request: AnswerRequest, source?: string) {
  if (!source) return undefined;
  return request.passages.find(
    ({ id }) => id === source || id.startsWith(`${source}#`),
  );
}

function extractSentences(
  text: string,
  question: string,
  lang: string,
): string {
  const sentences =
    text
      .replace(/\s+/gu, " ")
      .match(/[^.!?።፧。！？]+[.!?።፧。！？]?/gu)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [];
  const query = keywords(question, lang);
  let focus = 0;
  let bestScore = 0;
  for (const [index, sentence] of sentences.entries()) {
    const terms = keywords(sentence, lang);
    const score = [...query].filter((term) => terms.has(term)).length;
    if (score > bestScore) {
      bestScore = score;
      focus = index;
    }
  }
  // Keep adjacent context and qualifications. Do not reorder, clip words, or
  // manufacture punctuation to make an otherwise long sentence fit a limit.
  const start = Math.max(0, focus - 1);
  return sentences.slice(start, start + 3).join(" ");
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
  private readonly resolveSource: OfflineProviderOptions["resolveSource"];

  constructor(options: OfflineProviderOptions = {}) {
    this.name = options.name ?? "offline";
    this.languages = options.languages ?? ["*"];
    this.faqs = options.faqs ?? {};
    this.resolveSource = options.resolveSource;
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
    const safeRequest = {
      ...request,
      passages: hasInstructionInjection(request.question)
        ? []
        : request.passages.filter(({ text }) => !hasInstructionInjection(text)),
    };
    const candidates = (this.faqs[request.lang] ?? [])
      .filter(
        ({ q, a }) =>
          !hasInstructionInjection(q) &&
          !hasInstructionInjection(a) &&
          isAnswerLengthAllowed(a, request.simple),
      )
      .map((faq) => ({
        faq,
        score: faqScore(request.question, faq.q, request.lang),
      }))
      .sort((left, right) => right.score - left.score);
    let matchingFaq:
      | { faq: OfflineFaq; passage: AnswerRequest["passages"][number] }
      | undefined;
    for (const { faq, score } of candidates) {
      if (score < 0.5 || safeRequest.passages.length === 0) break;
      let passage = sourcePassage(safeRequest, faq.source);
      if (!passage && faq.source && this.resolveSource) {
        try {
          const resolved = await this.resolveSource(
            faq.source,
            safeRequest.passages.map(({ id }) => id),
          );
          // A storage adapter cannot authorize a citation outside retrieval.
          passage = safeRequest.passages.find(({ id }) => id === resolved);
        } catch {
          // Unavailable/ambiguous source resolution must never invent a citation.
          passage = undefined;
        }
        signal.throwIfAborted();
      }
      if (passage) {
        matchingFaq = { faq, passage };
        break;
      }
    }
    const passage = matchingFaq?.passage ?? safeRequest.passages[0];
    const candidateText = matchingFaq
      ? matchingFaq.faq.a.trim()
      : passage
        ? extractSentences(passage.text, request.question, request.lang)
        : "";
    const text = isAnswerLengthAllowed(candidateText, request.simple)
      ? candidateText
      : "";

    return {
      text,
      usedPassageIds: text && passage ? [passage.id] : [],
      providerId: this.name,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }
}
