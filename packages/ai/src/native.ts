import { z } from "zod";
import type { AnswerRequest } from "@dimts/engine";
import { answerJsonSchema, HttpProvider } from "./http-provider.js";
import type { HttpProviderOptions } from "./http-provider.js";
import { InvalidProviderResponseError } from "./provider.js";
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
  if (new URL(baseUrl).protocol !== "https:")
    throw new Error("Native vendor endpoints require HTTPS.");
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
const geminiSchema = z.object({
  promptFeedback: z.object({ blockReason: z.never().optional() }).optional(),
  candidates: z
    .array(
      z.object({
        finishReason: z.literal("STOP"),
        content: z.object({
          role: z.literal("model"),
          parts: z
            .array(
              z.object({
                text: z.string(),
                thought: z.literal(false).optional(),
              }),
            )
            .min(1),
        }),
      }),
    )
    .length(1),
});
/** Gemini generateContent uses native contents, parts and generationConfig. */
export class GeminiProvider extends HttpProvider {
  constructor(options: NativeProviderOptions) {
    super(
      remoteOptions(
        options,
        "https://generativelanguage.googleapis.com/v1beta",
      ),
    );
  }
  protected override headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-goog-api-key": this.apiKey!,
    };
  }
  protected override healthPath(): string {
    return `/models/${encodeURIComponent(this.model.replace(/^models\//u, ""))}`;
  }
  protected wireRequest(request: AnswerRequest) {
    return {
      path: `${this.healthPath()}:generateContent`,
      body: {
        systemInstruction: { parts: [{ text: this.instructions(request) }] },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(this.data(request)) }],
          },
        ],
        generationConfig: {
          maxOutputTokens: this.maxTokens,
          temperature: this.temperature,
          responseMimeType: "application/json",
          responseJsonSchema: answerJsonSchema,
        },
      },
    };
  }
  protected responseText(response: unknown): string {
    const parsed = geminiSchema.safeParse(response);
    if (!parsed.success) throw new InvalidProviderResponseError();
    return parsed.data.candidates[0]!.content.parts.map(
      ({ text }) => text,
    ).join("");
  }
}
