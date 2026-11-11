import { describe, expect, it, vi } from "vitest";
import { Ladder } from "../src/ladder.js";
import { OfflineFaq } from "../src/offline.js";
import { OpenAiCompatible } from "../src/openai-compatible.js";
import type {
  AiProvider,
  AnswerRequest,
  AnswerResult,
} from "../src/provider.js";
import { modeFor } from "../src/mode.js";

const request: AnswerRequest = {
  question: "How do I make a study plan?",
  lang: "en",
  passages: [
    {
      id: "study-plan#goals",
      text: "Choose one topic to learn this week. Write the goal in a short sentence.",
      label: "Study plan / Choose one goal",
      url: "https://course.example/study-plan#choose-one-goal",
      lang: "en",
      sourceType: "course",
    },
  ],
  glossary: [],
  simple: false,
  mode: "generative",
  systemPrompt: "Use only the supplied passages.",
};

function result(
  provider: AnswerResult["provider"],
  text = "Choose one topic to learn this week.",
): AnswerResult {
  return {
    text,
    usedPassageIds: [request.passages[0]!.id],
    provider,
    latencyMs: 1,
  };
}

function provider(
  name: AiProvider["name"],
  answer: AiProvider["answer"] = vi.fn(async () => result(name)),
  health: AiProvider["health"] = vi.fn(async () => ({ ok: true })),
): AiProvider {
  return { name, answer, health };
}

describe("WP04 provider adapters", () => {
  it.each(["cloud", "local"] as const)(
    "%s adapter implements the shared provider contract",
    async (name) => {
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/models")) {
          return new Response("{}", { status: 200 });
        }
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "Choose one topic to learn this week.",
                  usedPassageIds: ["study-plan#goals"],
                }),
              },
            },
          ],
        });
      });
      const adapter = new OpenAiCompatible({
        name,
        baseUrl: "https://provider.example/v1/",
        model: "small-model",
        apiKey: name === "cloud" ? "test-key" : undefined,
        fetcher,
      });

      expect(await adapter.health()).toEqual({ ok: true });
      await expect(
        adapter.answer(request, new AbortController().signal),
      ).resolves.toMatchObject({
        text: "Choose one topic to learn this week.",
        usedPassageIds: ["study-plan#goals"],
        provider: name,
      });

      const call = fetcher.mock.calls.find(([url]) =>
        String(url).endsWith("/chat/completions"),
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit;
      const body = JSON.parse(String(init.body)) as {
        model: string;
        temperature: number;
        max_tokens: number;
        messages: { role: string; content: string }[];
      };
      expect(body).toMatchObject({
        model: "small-model",
        temperature: 0.1,
        max_tokens: 400,
      });
      expect(JSON.stringify(body)).toContain(request.question);
      expect(JSON.stringify(body)).toContain(request.passages[0]!.text);
      expect(JSON.stringify(body)).not.toContain("sessionId");
    },
  );

  it("retries malformed provider JSON once and rejects a second malformed response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: "not json" } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: '{"text":4}' } }],
        }),
      );
    const adapter = new OpenAiCompatible({
      name: "cloud",
      baseUrl: "https://provider.example/v1",
      model: "small-model",
      fetcher,
    });

    await expect(
      adapter.answer(request, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses a matching FAQ only when its citation is among supplied passages", async () => {
    const offline = new OfflineFaq(() => [
      {
        q: "How do I make a study plan?",
        a: "Choose one topic and write it down.",
        source: "study-plan#goals",
      },
    ]);

    await expect(
      offline.answer(request, new AbortController().signal),
    ).resolves.toMatchObject({
      text: "Choose one topic and write it down.",
      usedPassageIds: ["study-plan#goals"],
      provider: "offline",
    });
    await expect(
      offline.answer(
        {
          ...request,
          passages: [{ ...request.passages[0]!, id: "other#section" }],
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      usedPassageIds: ["other#section"],
      provider: "offline",
    });
  });

  it("honors an aborted request before searching offline FAQs", async () => {
    const faqFor = vi.fn(() => [
      {
        q: "How do I make a study plan?",
        a: "Choose one topic and write it down.",
        source: "study-plan#goals",
      },
    ]);
    const offline = new OfflineFaq(faqFor);
    const controller = new AbortController();
    controller.abort();

    await expect(offline.answer(request, controller.signal)).rejects.toThrow();
    expect(faqFor).not.toHaveBeenCalled();
  });
});

describe("WP04 provider ladder", () => {
  it("tries providers in order and cools down a provider that fails", async () => {
    const cloud = provider(
      "cloud",
      vi.fn(async () => {
        throw new Error("unavailable");
      }),
    );
    const local = provider("local");
    const ladder = new Ladder([cloud, local, provider("offline")]);

    await expect(ladder.answer(request)).resolves.toMatchObject({
      provider: "local",
    });
    await expect(ladder.answer(request)).resolves.toMatchObject({
      provider: "local",
    });
    expect(cloud.answer).toHaveBeenCalledTimes(1);
    expect(local.answer).toHaveBeenCalledTimes(2);
    expect(ladder.status()).toMatchObject({
      activeProvider: "local",
      providers: [
        { name: "cloud", available: false },
        { name: "local", available: true },
        { name: "offline", available: true },
      ],
    });
  });

  it("retries a failed provider after the 60-second cooldown", async () => {
    let now = 0;
    const cloud = provider(
      "cloud",
      vi
        .fn<AiProvider["answer"]>()
        .mockRejectedValueOnce(new Error("unavailable"))
        .mockResolvedValueOnce(result("cloud")),
    );
    const local = provider("local");
    const ladder = new Ladder([cloud, local], {}, () => now);

    await expect(ladder.answer(request)).resolves.toMatchObject({
      provider: "local",
    });
    now = 59_999;
    await ladder.answer(request);
    expect(cloud.answer).toHaveBeenCalledTimes(1);

    now = 60_000;
    await expect(ladder.answer(request)).resolves.toMatchObject({
      provider: "cloud",
    });
    expect(cloud.answer).toHaveBeenCalledTimes(2);
  });

  it("skips an unhealthy provider and falls through", async () => {
    const cloud = provider(
      "cloud",
      vi.fn(async () => result("cloud")),
      vi.fn(async () => ({ ok: false, reason: "unreachable" })),
    );
    const local = provider("local");
    const ladder = new Ladder([cloud, local]);

    await expect(ladder.answer(request)).resolves.toMatchObject({
      provider: "local",
    });
    expect(cloud.answer).not.toHaveBeenCalled();
    expect(local.answer).toHaveBeenCalledOnce();
  });

  it("falls through on timeout and aborts the timed-out request", async () => {
    let aborted = false;
    const slowCloud = provider(
      "cloud",
      vi.fn(
        (_answerRequest, signal) =>
          new Promise<AnswerResult>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("aborted"));
              },
              { once: true },
            );
          }),
      ),
    );
    const local = provider("local");
    const ladder = new Ladder([slowCloud, local], {
      cloud: 5,
      local: 20,
    });

    await expect(ladder.answer(request)).resolves.toMatchObject({
      provider: "local",
    });
    expect(aborted).toBe(true);
  });

  it("forces extractive answers until a provider and language pair is proven", () => {
    expect(modeFor("cloud", "en", () => false)).toBe("extractive");
    expect(
      modeFor(
        "cloud",
        "en",
        (providerName, lang) => providerName === "cloud" && lang === "en",
      ),
    ).toBe("generative");
    expect(modeFor("offline", "am", () => true)).toBe("extractive");
  });

  it("passes extractive mode to unproven providers and generative mode only to proven pairs", async () => {
    const cloudAnswer = vi.fn(async () => result("cloud"));
    const unproven = new Ladder([provider("cloud", cloudAnswer)]);
    await unproven.answer(request);
    expect(cloudAnswer.mock.calls[0]?.[0].mode).toBe("extractive");

    const proven = new Ladder(
      [provider("cloud", cloudAnswer)],
      {},
      Date.now,
      (providerName, lang) => providerName === "cloud" && lang === "en",
    );
    await proven.answer(request);
    expect(cloudAnswer.mock.calls[1]?.[0].mode).toBe("generative");
  });
});
