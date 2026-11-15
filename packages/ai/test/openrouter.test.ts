import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerRequest } from "@bridgely/engine";
import { OpenRouterProvider } from "../src/openrouter.js";
import { decodeAnswerJson } from "../src/http-provider.js";
import { Ladder } from "../src/ladder.js";
import type { ProviderFailureEvent } from "../src/ladder.js";
import type { ProviderCapabilities } from "../src/provider.js";

const capabilities: ProviderCapabilities = {
  languages: ["en", "am"],
  modes: ["extractive"],
  modalities: ["text"],
  structuredOutput: true,
};

const request: AnswerRequest = {
  question: "What score do I need to pass?",
  lang: "en",
  passages: [
    {
      id: "p1",
      text: "You need a score of 70% or higher.",
      label: "Scores",
      url: "https://course.example/scores",
      lang: "en",
      sourceType: "course",
    },
  ],
  glossary: [],
  simple: false,
  mode: "extractive",
  systemPrompt: "Use only the supplied passages.",
};

const completion = (content: string | null, finish = "stop") =>
  Response.json({
    choices: [{ finish_reason: finish, message: { content } }],
  });

function provider() {
  return new OpenRouterProvider({
    name: "openrouter",
    model: "particle-ai/particle-1:free",
    fallbackModels: [
      "inclusionai/ling-3.2-flash:free",
      "nvidia/nemotron-3.5-super-vl:free",
      "extra/ignored:free",
    ],
    apiKey: "sk-or-test",
    capabilities,
    referer: "https://Bridgely.example",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter provider", () => {
  it("routes through at most three free models with reasoning off", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      completion(
        JSON.stringify({
          text: "You need a score of 70% or higher.",
          usedPassageIds: ["p1"],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await provider().answer(
      request,
      new AbortController().signal,
    );
    expect(result.usedPassageIds).toEqual(["p1"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe("particle-ai/particle-1:free");
    expect(body.models).toEqual([
      "particle-ai/particle-1:free",
      "inclusionai/ling-3.2-flash:free",
      "nvidia/nemotron-3.5-super-vl:free",
    ]);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(init?.headers).toMatchObject({
      authorization: "Bearer sk-or-test",
      "x-title": "Bridgely",
      "http-referer": "https://Bridgely.example",
    });
  });

  it("checks health against the small /key endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().health()).resolves.toEqual({
      ok: false,
      reasonCode: "status_401",
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://openrouter.ai/api/v1/key",
    );
  });

  it("rejects empty content from a model that spent its budget reasoning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => completion(null, "length")),
    );
    await expect(
      provider().answer(request, new AbortController().signal),
    ).rejects.toMatchObject({ reason: "truncated" });
  });

  it("surfaces the vendor status and message on HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(
          {
            error: {
              code: 429,
              message: "Provider returned error",
              metadata: { raw: "model is temporarily rate-limited upstream" },
            },
          },
          { status: 429 },
        ),
      ),
    );
    await expect(
      provider().answer(request, new AbortController().signal),
    ).rejects.toMatchObject({
      status: 429,
      vendorCode: "429",
      vendorMessage:
        "Provider returned error model is temporarily rate-limited upstream",
    });
  });
});

describe("answer JSON decoding", () => {
  it("accepts a fenced or wrapped JSON object", () => {
    expect(
      decodeAnswerJson('```json\n{"text":"a","usedPassageIds":[]}\n```'),
    ).toEqual({
      text: "a",
      usedPassageIds: [],
    });
    expect(
      decodeAnswerJson('Here it is: {"text":"","usedPassageIds":[]} done'),
    ).toEqual({ text: "", usedPassageIds: [] });
  });

  it("rejects text that holds no JSON object", () => {
    expect(() => decodeAnswerJson("I cannot help with that.")).toThrow(
      "Provider returned an invalid answer.",
    );
  });
});

describe("ladder failure reporting", () => {
  it("reports a rejected key once and cools the provider down for 15 minutes", async () => {
    let now = 0;
    const events: ProviderFailureEvent[] = [];
    const failing = provider();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(
          { error: { code: 401, message: "No auth credentials found" } },
          { status: 401 },
        ),
      ),
    );
    const ladder = new Ladder(
      [failing],
      { openrouter: 1_000 },
      () => now,
      (event) => events.push(event),
    );
    const first = await ladder.answer(request, { cloudOk: true });
    expect(first.providerId).toBe("offline");
    expect(events).toEqual([
      expect.objectContaining({
        provider: "openrouter",
        reason: "unauthorized",
        status: 401,
        cooldownMs: 15 * 60_000,
      }),
    ]);
    now += 60_001;
    await ladder.answer(request, { cloudOk: true });
    expect(events).toHaveLength(1);
  });
});

describe("verbatim check", () => {
  it("accepts a copied sentence without its final period, never new words", async () => {
    const { parseAnswer } = await import("../src/http-provider.js");
    const jobs: AnswerRequest = {
      ...request,
      passages: [
        {
          ...request.passages[0]!,
          id: "job",
          sourceType: "job",
          text: "Senior Welder.\nMeseret Mare Solar Import and Installation.\nAddis Ababa, Ethiopia.",
        },
      ],
    };
    expect(
      parseAnswer(
        JSON.stringify({
          text: "Senior Welder\nMeseret Mare Solar Import and Installation.",
          usedPassageIds: ["job"],
        }),
        jobs,
      ).text,
    ).toContain("Senior Welder");
    expect(() =>
      parseAnswer(
        JSON.stringify({
          text: "Senior Welder needed urgently.",
          usedPassageIds: ["job"],
        }),
        jobs,
      ),
    ).toThrow("Provider returned an invalid answer.");
  });
});

describe("quota-aware cooldown", () => {
  it("parks a provider until the reset time Gemini reports", async () => {
    const { parseRetryDelay } = await import("../src/provider.js");
    expect(
      parseRetryDelay(
        "Rate limit exceeded for model gemini-3.8-flash (limit: 20 requests per day on Free Tier). Please retry in 7h49m58s or upgrade",
      ),
    ).toBe((7 * 3600 + 49 * 60 + 58) * 1000);
    expect(parseRetryDelay("Please retry in 26.5s.")).toBe(26_500);
    expect(parseRetryDelay("28s")).toBe(28_000);
    expect(parseRetryDelay("Rate limit exceeded: free-models-per-day")).toBe(
      undefined,
    );

    let now = 0;
    const events: ProviderFailureEvent[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/key")
        ? Response.json({ data: {} })
        : Response.json(
            {
              error: {
                code: 429,
                message: "Rate limit exceeded. Please retry in 2h0m0s",
              },
            },
            { status: 429 },
          ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ladder = new Ladder(
      [provider()],
      { openrouter: 1_000 },
      () => now,
      (event) => events.push(event),
    );
    await ladder.answer(request, { cloudOk: true });
    expect(events[0]).toMatchObject({
      reason: "rate_limited",
      status: 429,
      retryAfterMs: 7_200_000,
      cooldownMs: 7_200_000,
    });
    const calls = fetchMock.mock.calls.length;
    now = 7_199_999;
    await ladder.answer(request, { cloudOk: true });
    expect(fetchMock.mock.calls.length).toBe(calls);
    now = 7_200_000;
    await ladder.answer(request, { cloudOk: true });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe("in-depth requests", () => {
  it("are served extractively by a provider that can only quote", async () => {
    const { OfflineProvider } = await import("../src/offline.js");
    const ladder = new Ladder([new OfflineProvider()], {});
    const result = await ladder.answer(
      { ...request, mode: "generative" },
      { cloudOk: false },
    );
    expect(result.providerId).toBe("offline");
    expect(result.usedPassageIds).toEqual(["p1"]);
  });
});
