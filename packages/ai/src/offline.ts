import { tokenize } from "@dimts/grounding";
import type { AiProvider, AnswerRequest, AnswerResult } from "./provider.js";

export interface OfflineFaqEntry {
  q: string;
  a: string;
  source?: string;
}

export class OfflineFaq implements AiProvider {
  readonly name = "offline" as const;
  private readonly faqFor: (lang: string) => OfflineFaqEntry[];

  constructor(faqFor: (lang: string) => OfflineFaqEntry[]) {
    this.faqFor = faqFor;
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async answer(
    request: AnswerRequest,
    signal: AbortSignal,
  ): Promise<AnswerResult> {
    signal.throwIfAborted();
    const questionTokens = new Set(tokenize(request.question, request.lang));
    let best:
      { score: number; answer: string; source: string | undefined } | undefined;

    for (const faq of this.faqFor(request.lang)) {
      const faqTokens = tokenize(faq.q, request.lang);
      const overlap = faqTokens.filter((token) => questionTokens.has(token));
      const score =
        overlap.length / Math.max(faqTokens.length, questionTokens.size, 1);
      if (score > (best?.score ?? 0)) {
        best = { score, answer: faq.a, source: faq.source };
      }
    }

    const validPassageIds = new Set(
      request.passages.map((passage) => passage.id),
    );
    if (
      best &&
      best.score >= 0.4 &&
      best.source &&
      validPassageIds.has(best.source)
    ) {
      return {
        text: best.answer,
        usedPassageIds: [best.source],
        provider: this.name,
        latencyMs: 0,
      };
    }

    const passage = request.passages[0];
    if (!passage) {
      return {
        text: "",
        usedPassageIds: [],
        provider: this.name,
        latencyMs: 0,
      };
    }

    return {
      text: extract(passage.text),
      usedPassageIds: [passage.id],
      provider: this.name,
      latencyMs: 0,
    };
  }
}

function extract(text: string): string {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const selected = words.slice(0, 45).join(" ");
  return words.length > 45 ? `${selected}…` : selected;
}
