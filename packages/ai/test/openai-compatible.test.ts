import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatible } from "../src/openai-compatible.js";
import type { AnswerRequest, ProviderCapabilities } from "../src/provider.js";

const capabilities: ProviderCapabilities = {
  languages: ["en"],
  modes: ["extractive", "generative"],
  modalities: ["text"],
  structuredOutput: true,
};

const request: AnswerRequest = {
  question: "How do I make a study plan?",
  lang: "en",
  passages: [
    {
      id: "passage-1",
      text: "Choose one learning goal.",
      label: "Study plan / Goals",
      url: "https://course.example/study-plan#goals",
      lang: "en",
      sourceType: "course",
    },
  ],
  glossary: [],
  simple: false,
  mode: "extractive",
  systemPrompt: "Use only the supplied passages.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible provider", () => {
  it("sends a bounded answer request and validates the structured reply", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    text: "Choose one learning goal.",
                    usedPassageIds: ["passage-1"],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatible({
      name: "custom-cloud",
      baseUrl: "https://provider.example/v1/",
      model: "model-name",
      apiKey: "server-secret",
      capabilities,
    });

    const result = await provider.answer(request, new AbortController().signal);

    expect(result).toMatchObject({
      text: "Choose one learning goal.",
      usedPassageIds: ["passage-1"],
      providerId: "custom-cloud",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer server-secret",
        }),
      }),
    );
    expect(provider.capabilities()).toEqual(capabilities);
  });

  it("reports an unavailable health endpoint without exposing credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("network unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatible({
      name: "local-model",
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "model-name",
      apiKey: "server-secret",
      capabilities,
    });

    await expect(provider.health()).resolves.toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer server-secret",
        }),
      }),
    );
  });

  it("rejects malformed structured provider output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"text":""}' } }],
            }),
            { status: 200 },
          ),
      ),
    );
    const provider = new OpenAiCompatible({
      name: "custom-cloud",
      baseUrl: "https://provider.example/v1",
      model: "model-name",
      capabilities,
    });

    await expect(
      provider.answer(request, new AbortController().signal),
    ).rejects.toThrow();
  });
});
