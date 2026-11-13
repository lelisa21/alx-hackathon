import { z } from "zod";
import type { AnswerRequest } from "@dimts/engine";
import { HttpProvider } from "./http-provider.js";
import type { HttpProviderOptions } from "./http-provider.js";
import { InvalidProviderResponseError } from "./provider.js";
export type OpenAiCompatibleOptions = HttpProviderOptions;
const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.literal("stop").optional(),
        message: z.object({
          content: z.string(),
          refusal: z.null().optional(),
          tool_calls: z.array(z.never()).optional(),
        }),
      }),
    )
    .length(1),
});
/** For a host-verified compatible endpoint, including local open-model servers. */
export class OpenAiCompatible extends HttpProvider {
  protected wireRequest(request: AnswerRequest) {
    return {
      path: "/chat/completions",
      body: {
        model: this.model,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        store: false,
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
    if (!completion.success) throw new InvalidProviderResponseError();
    return completion.data.choices[0]!.message.content;
  }
}
