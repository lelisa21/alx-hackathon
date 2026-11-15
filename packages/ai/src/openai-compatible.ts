import { z } from "zod";
import type { AnswerRequest } from "@bridgely/engine";
import { HttpProvider } from "./http-provider.js";
import type { HttpProviderOptions } from "./http-provider.js";
import { InvalidProviderResponseError } from "./provider.js";
export type OpenAiCompatibleOptions = HttpProviderOptions;
const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        // Vendors differ: "stop", "STOP", "eos", "end_turn" or null.
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          // Reasoning models return null content when they spend the whole
          // token budget thinking.
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
          tool_calls: z.array(z.unknown()).nullable().optional(),
        }),
      }),
    )
    .min(1),
});
/** For a host-verified compatible endpoint, including local open-model servers. */
export class OpenAiCompatible extends HttpProvider {
  /** Vendor-specific request fields; the base fields cannot be overridden. */
  protected extraBody(): Record<string, unknown> {
    return { store: false };
  }
  protected wireRequest(request: AnswerRequest) {
    return {
      path: "/chat/completions",
      body: {
        ...this.extraBody(),
        model: this.model,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: this.instructions(request) },
          { role: "user", content: JSON.stringify(this.data(request)) },
        ],
      },
    };
  }
  protected responseText(response: unknown): string {
    const completion = completionSchema.safeParse(response);
    if (!completion.success)
      throw new InvalidProviderResponseError("schema_mismatch");
    const choice = completion.data.choices[0]!;
    if (choice.message.refusal)
      throw new InvalidProviderResponseError("refused");
    if (choice.message.tool_calls?.length)
      throw new InvalidProviderResponseError("tool_call");
    if (choice.finish_reason === "length")
      throw new InvalidProviderResponseError("truncated");
    const content = choice.message.content?.trim();
    if (!content) throw new InvalidProviderResponseError("empty_content");
    return content;
  }
}
