// FR-AI-02: Gemini 3+ thinking tokens count against max_output_tokens. Without
// a thinking limit, grounded answers came back status "incomplete" and were
// rejected, so every request fell through to the next provider.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerRequest } from "@dimts/engine";
import { GeminiProvider } from "../src/native.js";

const request: AnswerRequest = {
  question: "How should I choose a learning goal?",
  lang: "en",
  simple: false,
  mode: "extractive",
  systemPrompt: "Answer from supplied data.",
  passages: [
    {
      id: "p1",
      text: "Choose one learning goal.",
      label: "Goals",
      url: "https://course.example/goals",
      lang: "en",
      sourceType: "course",
    },
  ],
  glossary: [],
};

const envelope = {
  object: "interaction",
  status: "completed",
  model: "m",
  steps: [
    {
      type: "model_output",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            text: "Choose one learning goal.",
            usedPassageIds: ["p1"],
          }),
        },
      ],
    },
  ],
};

async function sentBody(model: string): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(envelope));
  vi.stubGlobal("fetch", fetchMock);
  const provider = new GeminiProvider({
    name: "gemini",
    model,
    apiKey: "test-key",
    maxTokens: 300,
    capabilities: {
      languages: ["en"],
      modes: ["extractive"],
      modalities: ["text"],
      structuredOutput: true,
    },
  });
  await provider.answer(request, new AbortController().signal);
  // health() and answer() both fetch; the Interactions call is the last one.
  const [target, init] = fetchMock.mock.calls.at(-1)!;
  const sent = target instanceof Request ? target : new Request(target, init);
  return (await sent.clone().json()) as Record<string, unknown>;
}

afterEach(() => vi.unstubAllGlobals());

describe("Gemini thinking budget", () => {
  it("asks Gemini 3+ models for minimal thinking", async () => {
    const body = await sentBody("gemini-3-flash-preview");
    expect(body.generation_config).toMatchObject({
      max_output_tokens: 300,
      thinking_level: "minimal",
    });
  });

  it("does not send thinking controls to earlier models", async () => {
    const body = await sentBody("gemini-2.0-flash");
    expect(
      (body.generation_config as Record<string, unknown>).thinking_level,
    ).toBeUndefined();
  });
});
