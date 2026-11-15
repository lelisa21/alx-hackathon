import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { AnswerRequest } from "@bridgely/engine";
import {
  answerJsonSchema,
  HttpProvider,
  ProviderBase,
} from "./http-provider.js";
import type { HttpProviderOptions, ProviderInput } from "./http-provider.js";
import {
  InvalidProviderResponseError,
  parseRetryDelay,
  ProviderHttpError,
} from "./provider.js";
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
            name: "answer",
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
            name: "answer",
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

// Gemini 3.8 and Gemini 4 reject "minimal" (400); "low" is their lowest
// supported level. Earlier Gemini 3 models accept "minimal".
function thinkingLevel(model: string): "minimal" | "low" {
  const match = /^(?:models\/)?gemini-(\d+)(?:\.(\d+))?/u.exec(model);
  const major = Number(match?.[1] ?? 0);
  const minor = Number(match?.[2] ?? 0);
  return major >= 4 || (major === 3 && minor >= 8) ? "low" : "minimal";
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

/** HTTP status of a @google/genai error (APIError.status or statusCode). */
function httpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const record = error as Error & { status?: unknown; statusCode?: unknown };
  const status = record.status ?? record.statusCode;
  return typeof status === "number" ? status : undefined;
}

function vendorError(error: unknown): {
  code?: string;
  message?: string;
  retryDelay?: string;
} {
  // SDK error classes differ: APIError.error is the vendor error object,
  // RateLimitError.error wraps it as { httpMeta, error }, and every class
  // keeps the raw response text in `body`.
  const candidates: unknown[] = [];
  const field = (error as { error?: unknown }).error;
  if (field && typeof field === "object") {
    const nested = (field as { error?: unknown }).error;
    if (nested && typeof nested === "object") candidates.push(nested);
    candidates.push(field);
  }
  const raw = (error as { body?: unknown }).body;
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw.slice(0, 8_192)) as { error?: unknown };
      if (parsed.error && typeof parsed.error === "object")
        candidates.push(parsed.error);
    } catch {
      // Not JSON: keep the status only.
    }
  }
  const body = candidates.find(
    (candidate) =>
      typeof (candidate as { message?: unknown }).message === "string",
  );
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  const code = record.status ?? record.code;
  // google.rpc.RetryInfo carries the quota reset as e.g. "28s".
  const retryDelay = Array.isArray(record.details)
    ? record.details
        .map((detail) =>
          detail && typeof detail === "object"
            ? (detail as Record<string, unknown>).retryDelay
            : undefined,
        )
        .find((value): value is string => typeof value === "string")
    : undefined;
  return {
    ...(typeof code === "string" || typeof code === "number"
      ? { code: String(code) }
      : {}),
    ...(typeof record.message === "string" ? { message: record.message } : {}),
    ...(retryDelay ? { retryDelay } : {}),
  };
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
      return response.ok
        ? { ok: true }
        : { ok: false, reasonCode: `status_${response.status}` };
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
        ...(isThinkingModel(this.model)
          ? { thinking_level: thinkingLevel(this.model) }
          : {}),
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
      const status = httpStatus(error);
      if (causedBySyntaxError(error) || status === 200)
        throw new InvalidProviderResponseError("not_json");
      if (status !== undefined) {
        const vendor = vendorError(error);
        const retryAfterMs = parseRetryDelay(vendor.retryDelay);
        throw new ProviderHttpError(status, vendor.code, vendor.message, {
          cause: error,
          ...(retryAfterMs ? { retryAfterMs } : {}),
        });
      }
      throw new Error("Provider request failed.", { cause: error });
    }
    return this.responseText(response);
  }
  protected responseText(response: unknown): string {
    const parsed = interactionSchema.safeParse(response);
    if (!parsed.success) {
      const status = (response as { status?: unknown } | null)?.status;
      throw new InvalidProviderResponseError(
        status === "incomplete" ? "truncated" : "schema_mismatch",
      );
    }
    return parsed.data.output_text;
  }
}
