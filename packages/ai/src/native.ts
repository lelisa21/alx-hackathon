import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { AnswerRequest } from "@dimts/engine";
import {
  answerJsonSchema,
  HttpProvider,
  ProviderBase,
} from "./http-provider.js";
import type { HttpProviderOptions, ProviderInput } from "./http-provider.js";
import { InvalidProviderResponseError } from "./provider.js";
import type { Interactions } from "@google/genai";

type GeminiInteractionParams =
  Interactions.InteractionCreateParams.CreateModelInteractionParamsNonStreaming;
export type NativeProviderOptions = Omit<HttpProviderOptions, "baseUrl"> & {
  baseUrl?: string;
};
function remoteOptions(
  options: NativeProviderOptions,
  defaultUrl: string,
): HttpProviderOptions {
  const baseUrl = options.baseUrl ?? defaultUrl;
  if (options.privacyClass === "local")
    throw new Error(
      "Native vendor adapters require remote privacy classification.",
    );
  const url = new URL(baseUrl);
  if (url.protocol !== "https:")
    throw new Error("Native vendor endpoints require HTTPS.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Invalid provider endpoint.");
  if (!options.apiKey?.trim())
    throw new Error("Native vendor credentials are required.");
  return { ...options, baseUrl, privacyClass: "remote" };
}
const responseSchema = z.object({
  status: z.literal("completed"),
  error: z.null().optional(),
  output: z
    .array(
      z.union([
        z.object({
          type: z.literal("message"),
          role: z.literal("assistant"),
          content: z
            .array(
              z.object({ type: z.literal("output_text"), text: z.string() }),
            )
            .min(1),
        }),
        z.object({ type: z.literal("reasoning") }),
      ]),
    )
    .min(1),
});
function responsesText(response: unknown): string {
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw new InvalidProviderResponseError();
  const texts = parsed.data.output.flatMap((item) =>
    item.type === "message" ? item.content.map(({ text }) => text) : [],
  );
  if (!texts.length) throw new InvalidProviderResponseError();
  return texts.join("");
}
/** OpenAI native Responses API. No stored conversation or server-side tools. */
export class OpenAiProvider extends HttpProvider {
  constructor(options: NativeProviderOptions) {
    super(remoteOptions(options, "https://api.openai.com/v1"));
  }
  protected wireRequest(request: AnswerRequest) {
    return {
      path: "/responses",
      body: {
        model: this.model,
        max_output_tokens: this.maxTokens,
        temperature: this.temperature,
        store: false,
        input: [
          { role: "system", content: this.instructions(request) },
          { role: "user", content: JSON.stringify(this.data(request)) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "dimts_answer",
            strict: true,
            schema: answerJsonSchema,
          },
        },
      },
    };
  }
  protected responseText(response: unknown): string {
    return responsesText(response);
  }
}
/** xAI's documented Responses wire format has its own vendor registration. */
export class XaiProvider extends HttpProvider {
  constructor(options: NativeProviderOptions) {
    super(remoteOptions(options, "https://api.x.ai/v1"));
  }
  protected wireRequest(request: AnswerRequest) {
    return {
      path: "/responses",
      body: {
        model: this.model,
        max_output_tokens: this.maxTokens,
        temperature: this.temperature,
        store: false,
        input: [
          { role: "system", content: this.instructions(request) },
          { role: "user", content: JSON.stringify(this.data(request)) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "dimts_answer",
            strict: true,
            schema: answerJsonSchema,
          },
        },
      },
    };
  }
  protected responseText(response: unknown): string {
    return responsesText(response);
  }
}
const interactionSchema = z.object({
  status: z.literal("completed"),
  output_text: z.string().trim().min(1),
});

function geminiEndpointRoot(endpoint?: string): string {
  const url = new URL(endpoint ?? "https://generativelanguage.googleapis.com");
  url.pathname = url.pathname.replace(/\/v1(?:beta)?\/?$/u, "");
  return url.toString().replace(/\/$/u, "");
}

function isThinkingModel(model: string): boolean {
  const match = /^(?:models\/)?gemini-(\d+)/u.exec(model);
  return Boolean(match && Number(match[1]) >= 3);
}

function supportsTemperature(model: string): boolean {
  const match = /^(?:models\/)?gemini-(\d+)(?:\.(\d+))?/u.exec(model);
  if (!match) return true;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? "0");
  return major < 4 && (major < 3 || minor < 6);
}

function causedBySyntaxError(error: unknown): boolean {
  const seen = new Set<Error>();
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof SyntaxError) return true;
    seen.add(error);
    error = error.cause;
  }
  return false;
}

function hasHttpStatus(error: unknown): error is Error & { status: number } {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  );
}

/** Gemini's stateless Interactions API adapter. */
export class GeminiProvider extends ProviderBase {
  private readonly client: GoogleGenAI;
  private readonly endpointRoot: string;
  private readonly googleApiKey: string;
  constructor(options: NativeProviderOptions) {
    const remote = remoteOptions(
      { ...options, baseUrl: geminiEndpointRoot(options.baseUrl) },
      "https://generativelanguage.googleapis.com",
    );
    const apiKey = remote.apiKey;
    if (!apiKey) throw new Error("Native vendor credentials are required.");
    super(remote);
    this.endpointRoot = remote.baseUrl;
    this.googleApiKey = apiKey;
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        baseUrl: this.endpointRoot,
        // The Interactions API and current Gemini models are served on v1beta;
        // v1 returns 404 for them (verified against the live API).
        apiVersion: "v1beta",
        retryOptions: { attempts: 1 },
      },
    });
  }
  async health(
    signal: AbortSignal = AbortSignal.timeout(5_000),
  ): Promise<{ ok: boolean; reasonCode?: string }> {
    try {
      const model = encodeURIComponent(this.model.replace(/^models\//u, ""));
      const response = await fetch(
        `${this.endpointRoot}/v1beta/models/${model}`,
        {
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.googleApiKey,
          },
          signal,
          redirect: "error",
        },
      );
      await response.body?.cancel();
      return response.ok ? { ok: true } : { ok: false, reasonCode: "status" };
    } catch {
      return { ok: false, reasonCode: "unreachable" };
    }
  }
  protected override async generate(
    request: AnswerRequest,
    data: ProviderInput,
    signal: AbortSignal,
  ): Promise<string> {
    const params: GeminiInteractionParams = {
      model: this.model,
      input: JSON.stringify(data),
      system_instruction: this.instructions(request),
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: answerJsonSchema,
      },
      store: false,
      generation_config: {
        max_output_tokens: this.maxTokens,
        // Thinking tokens count against max_output_tokens; grounded extraction
        // needs none, and without a limit replies end "incomplete".
        ...(isThinkingModel(this.model) ? { thinking_level: "minimal" } : {}),
        ...(supportsTemperature(this.model)
          ? { temperature: this.temperature }
          : {}),
      },
    };
    let response: unknown;
    try {
      response = await this.client.interactions.create(params, {
        signal,
        redirect: "error",
        retries: { strategy: "none" },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (
        causedBySyntaxError(error) ||
        (hasHttpStatus(error) && error.status === 200)
      )
        throw new InvalidProviderResponseError();
      throw new Error("Provider request failed.", { cause: error });
    }
    return this.responseText(response);
  }
  protected responseText(response: unknown): string {
    const parsed = interactionSchema.safeParse(response);
    if (!parsed.success) throw new InvalidProviderResponseError();
    return parsed.data.output_text;
  }
}
