import { z } from "zod";
import type { AiProvider, AnswerRequest, ProviderName } from "./provider.js";

const providerResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }),
    }),
  ),
});

const answerSchema = z.object({
  text: z.string(),
  usedPassageIds: z.array(z.string()),
});

export interface OpenAiCompatibleOptions {
  name: Exclude<ProviderName, "offline">;
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  fetcher?: typeof fetch;
}

export class OpenAiCompatible implements AiProvider {
  readonly name: Exclude<ProviderName, "offline">;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly options: OpenAiCompatibleOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.options = options;
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.fetcher = options.fetcher ?? globalThis.fetch;
  }

  async health(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/models`, {
        headers: this.headers(),
      });
      return response.ok
        ? { ok: true }
        : { ok: false, reason: "unhealthy" };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  }

  async answer(
    request: AnswerRequest,
    signal: AbortSignal,
  ): Promise<{
    text: string;
    usedPassageIds: string[];
    provider: ProviderName;
    latencyMs: number;
  }> {
    const startedAt = Date.now();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.fetcher(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: this.headers(),
          signal,
          body: JSON.stringify({
            model: this.options.model,
            temperature: this.options.temperature ?? 0.1,
            max_tokens: this.options.maxTokens ?? 400,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: request.systemPrompt },
              {
                role: "user",
                content: JSON.stringify({
                  question: request.question,
                  lang: request.lang,
                  passages: request.passages,
                  glossary: request.glossary,
                  simple: request.simple,
                  mode: request.mode,
                }),
              },
            ],
          }),
        },
      );
      if (!response.ok) {
        throw new Error("AI provider request failed");
      }

      const responseJson = await response.json().catch(() => undefined);
      const providerResponse = providerResponseSchema.safeParse(responseJson);
      const content = providerResponse.data?.choices[0]?.message.content;
      const answer = content ? parseAnswer(content) : null;
      if (answer) {
        return {
          ...answer,
          provider: this.name,
          latencyMs: Date.now() - startedAt,
        };
      }
    }

    throw new Error("AI provider returned malformed JSON");
  }

  private headers(): HeadersInit {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey
        ? { authorization: `Bearer ${this.options.apiKey}` }
        : {}),
    };
  }
}

function parseAnswer(content: string) {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = answerSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
