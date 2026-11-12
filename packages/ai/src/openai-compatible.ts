import { z } from "zod";
import type { AnswerRequest } from "@dimts/engine";
import { InvalidProviderResponseError } from "./provider.js";
import type {
  AiProvider,
  AnswerResult,
  ProviderCapabilities,
  ProviderDataClass,
  ProviderName,
  ProviderPrivacyClass,
} from "./provider.js";

const CompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }),
    }),
  ),
});

const AnswerSchema = z.object({
  text: z.string().min(1),
  usedPassageIds: z.array(z.string()).min(1),
});

export interface OpenAiCompatibleOptions {
  name: ProviderName;
  baseUrl: string;
  model: string;
  capabilities: ProviderCapabilities;
  privacyClass?: ProviderPrivacyClass;
  allowedDataClasses?: ProviderDataClass[];
  evaluatedLanguages?: string[];
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export class OpenAiCompatible implements AiProvider {
  readonly name: ProviderName;
  readonly privacyClass: ProviderPrivacyClass;
  readonly allowedDataClasses: ProviderDataClass[];
  readonly evaluatedLanguages: string[];
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly capabilitiesValue: ProviderCapabilities;
  private readonly apiKey: string | undefined;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(options: OpenAiCompatibleOptions) {
    this.name = options.name;
    this.privacyClass = options.privacyClass ?? "remote";
    this.allowedDataClasses = options.allowedDataClasses ?? [
      "question",
      "course-passage",
    ];
    this.evaluatedLanguages = options.evaluatedLanguages ?? [];
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.model = options.model;
    this.capabilitiesValue = options.capabilities;
    this.apiKey = options.apiKey;
    this.maxTokens = options.maxTokens ?? 400;
    this.temperature = options.temperature ?? 0.1;
  }

  capabilities(): ProviderCapabilities {
    return {
      ...this.capabilitiesValue,
      languages: [...this.capabilitiesValue.languages],
      modes: [...this.capabilitiesValue.modes],
      modalities: [...this.capabilitiesValue.modalities],
    };
  }

  async health(): Promise<{ ok: boolean; reasonCode?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
      });
      return response.ok ? { ok: true } : { ok: false, reasonCode: "status" };
    } catch {
      return { ok: false, reasonCode: "unreachable" };
    }
  }

  async answer(
    request: AnswerRequest,
    signal: AbortSignal,
  ): Promise<AnswerResult> {
    const startedAt = performance.now();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      signal,
      body: JSON.stringify({
        model: this.model,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              question: request.question,
              lang: request.lang,
              passages: request.passages.map(({ id, text }) => ({ id, text })),
              glossary: request.glossary,
              simple: request.simple,
              mode: request.mode,
            }),
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error("Provider request failed.");
    }

    const completion = CompletionSchema.safeParse(await response.json());
    if (!completion.success) throw new InvalidProviderResponseError();
    const content = completion.data.choices[0]?.message.content;
    if (content === undefined) throw new InvalidProviderResponseError();

    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch {
      throw new InvalidProviderResponseError();
    }
    const answer = AnswerSchema.safeParse(decoded);
    if (!answer.success) throw new InvalidProviderResponseError();

    return {
      ...answer.data,
      providerId: this.name,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }
}
