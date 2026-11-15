import { OpenAiCompatible } from "./openai-compatible.js";
import type { HttpProviderOptions } from "./http-provider.js";

export type OpenRouterOptions = Omit<HttpProviderOptions, "baseUrl"> & {
  baseUrl?: string;
  /**
   * Models OpenRouter tries in order when the primary is rate limited or down
   * (OpenRouter "models" routing). Free models are often rate limited
   * upstream, so a short list keeps answers flowing.
   */
  fallbackModels?: string[];
  /**
   * Grounded extraction needs no hidden reasoning, and reasoning tokens count
   * against max_tokens: with reasoning on, free reasoning models return empty
   * content for Amharic. Only list models that allow turning it off; some
   * (for example ERNIE) reject `enabled:false` with HTTP 400.
   */
  reasoning?: "off" | "provider-default";
  /** Public site URL and name sent as OpenRouter app attribution headers. */
  referer?: string;
  title?: string;
};

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1";
// OpenRouter routes at most this many models per request (primary included).
const MAX_ROUTED_MODELS = 3;

/** OpenRouter's OpenAI-compatible API with its documented routing fields. */
export class OpenRouterProvider extends OpenAiCompatible {
  private readonly fallbackModels: string[];
  private readonly reasoning: "off" | "provider-default";
  private readonly referer: string | undefined;
  private readonly title: string;
  constructor(options: OpenRouterOptions) {
    const baseUrl = options.baseUrl ?? OPENROUTER_ENDPOINT;
    if (new URL(baseUrl).protocol !== "https:")
      throw new Error("OpenRouter endpoints require HTTPS.");
    if (!options.apiKey?.trim())
      throw new Error("OpenRouter credentials are required.");
    super({ ...options, baseUrl, privacyClass: "remote" });
    this.fallbackModels = [
      ...new Set(
        (options.fallbackModels ?? [])
          .map((model) => model.trim())
          .filter((model) => model && model !== this.model),
      ),
    ].slice(0, MAX_ROUTED_MODELS - 1);
    this.reasoning = options.reasoning ?? "off";
    this.referer = options.referer;
    this.title = options.title ?? "Dimts";
  }
  protected override extraHeaders(): Record<string, string> {
    return {
      "x-title": this.title,
      ...(this.referer ? { "http-referer": this.referer } : {}),
    };
  }
  protected override extraBody(): Record<string, unknown> {
    return {
      ...(this.fallbackModels.length
        ? { models: [this.model, ...this.fallbackModels] }
        : {}),
      ...(this.reasoning === "off" ? { reasoning: { enabled: false } } : {}),
    };
  }
  /** GET /key validates the credential and is a few hundred bytes. */
  protected override healthPath(): string {
    return "/key";
  }
}
