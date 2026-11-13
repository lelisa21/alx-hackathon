import { afterEach, describe, expect, it, vi } from "vitest";
import { Ladder } from "../src/ladder.js";
import { OfflineProvider } from "../src/offline.js";
import { ProviderRegistry } from "../src/registry.js";
import { InvalidProviderResponseError } from "../src/provider.js";
import type { AiProvider, ProviderCapabilities } from "../src/provider.js";
import type { AnswerRequest } from "@dimts/engine";

const request: AnswerRequest = {
  question: "What should I learn?",
  lang: "en",
  passages: [
    {
      id: "p",
      text: "Choose one learning goal.",
      lang: "en",
      label: "Goals",
      url: "https://test/goal",
      sourceType: "course",
    },
  ],
  glossary: [],
  simple: false,
  mode: "generative",
  systemPrompt: "Source-only rules.",
};
const capabilities: ProviderCapabilities = {
  languages: ["en"],
  modes: ["generative", "extractive"],
  modalities: ["text"],
  structuredOutput: true,
};
const valid = {
  text: "Choose one learning goal.",
  usedPassageIds: ["p"],
  providerId: "candidate",
  latencyMs: 1,
};
function provider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    name: "candidate",
    privacyClass: "remote",
    allowedDataClasses: ["question", "course-passage"],
    evaluatedLanguages: ["en"],
    capabilities: () => capabilities,
    health: vi.fn(async () => ({ ok: true })),
    answer: vi.fn(async () => valid),
    ...overrides,
  };
}
afterEach(() => vi.useRealTimers());

describe("FR-AI-03/05/06 capability, retry and cooldown contract", () => {
  it("never probes remote health when consent is off", async () => {
    const candidate = provider();
    await new Ladder([candidate], {}).answer(request);
    expect(candidate.health).not.toHaveBeenCalled();
    expect(candidate.answer).not.toHaveBeenCalled();
  });
  it.each([
    { languages: ["am"] },
    { modes: [] },
    { modalities: ["audio"] },
    { structuredOutput: false },
  ])(
    "skips unsupported declared capabilities before health",
    async (change) => {
      const candidate = provider({
        capabilities: () =>
          ({ ...capabilities, ...change }) as ProviderCapabilities,
      });
      await new Ladder([candidate], {}).answer(request, { cloudOk: true });
      expect(candidate.health).not.toHaveBeenCalled();
    },
  );
  it.each([["question"], ["course-passage"], []] as const)(
    "does not call a provider missing a required data class (%s)",
    async (...allowed) => {
      const candidate = provider({ allowedDataClasses: [...allowed] });
      await new Ladder([candidate], {}).answer(request, { cloudOk: true });
      expect(candidate.health).not.toHaveBeenCalled();
    },
  );
  it("retries malformed output once and cools down for exactly 60 seconds", async () => {
    let now = 0;
    const candidate = provider({
      answer: vi.fn(async () => {
        throw new InvalidProviderResponseError();
      }),
    });
    const ladder = new Ladder(
      [candidate, new OfflineProvider()],
      {},
      () => now,
    );
    expect((await ladder.answer(request, { cloudOk: true })).providerId).toBe(
      "offline",
    );
    expect(candidate.answer).toHaveBeenCalledTimes(2);
    now = 59_999;
    await ladder.answer(request, { cloudOk: true });
    expect(candidate.answer).toHaveBeenCalledTimes(2);
    now = 60_000;
    await ladder.answer(request, { cloudOk: true });
    expect(candidate.answer).toHaveBeenCalledTimes(4);
  });
  it("retries invalid citation output once then falls back", async () => {
    const candidate = provider({
      answer: vi.fn(async () => ({ ...valid, usedPassageIds: ["invented"] })),
    });
    const result = await new Ladder(
      [candidate, new OfflineProvider()],
      {},
    ).answer(request, { cloudOk: true });
    expect(result.providerId).toBe("offline");
    expect(candidate.answer).toHaveBeenCalledTimes(2);
  });
  it("aborts killed provider work within one timeout budget and uses offline", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const candidate = provider({
      answer: vi.fn(
        async (_request, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("stopped"));
              },
              { once: true },
            ),
          ),
      ),
    });
    const pending = new Ladder([candidate, new OfflineProvider()], {
      candidate: 100,
    }).answer(request, { cloudOk: true });
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).providerId).toBe("offline");
    expect(aborted).toBe(true);
  });
  it("does not allow malformed retry to start a second full timeout budget", async () => {
    vi.useFakeTimers();
    const candidate = provider({
      answer: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 75));
        throw new InvalidProviderResponseError();
      }),
    });
    const pending = new Ladder([candidate, new OfflineProvider()], {
      candidate: 100,
    }).answer(request, { cloudOk: true });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(101);
    expect(settled).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
  });
  it("preserves local job passages and strips unknown request fields", async () => {
    const candidate = provider({ privacyClass: "local" });
    const privateRequest = Object.assign({}, request, {
      sessionId: "must-not-pass",
      transcript: "private",
    });
    privateRequest.passages = [{ ...request.passages[0]!, sourceType: "job" }];
    expect(
      (await new Ladder([candidate], {}).answer(privateRequest)).text,
    ).toBe(valid.text);
    expect(candidate.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        passages: [expect.objectContaining({ sourceType: "job" })],
      }),
      expect.any(AbortSignal),
    );
    const sent = vi.mocked(candidate.answer).mock.calls[0]![0];
    expect(sent).not.toHaveProperty("sessionId");
    expect(sent).not.toHaveProperty("transcript");
  });
});

describe("AR-01 registry declaration enforcement", () => {
  const binding = {
    id: "candidate",
    adapter: "test",
    model: "test",
    privacyClass: "remote" as const,
    enabled: true,
    priority: 10,
    timeoutMs: 100,
    allowedDataClasses: ["question", "course-passage"] as (
      "question" | "course-passage"
    )[],
    capabilities: { ...capabilities, languages: ["am"] },
    evaluatedLanguages: [],
  };
  it("rejects a factory that changes privacy classification", () => {
    const registry = new ProviderRegistry().register("test", () =>
      provider({ privacyClass: "local" }),
    );
    expect(() => registry.create([binding])).toThrow(/privacy/iu);
  });
  it("intersects actual capability and data declarations without inventing support", async () => {
    const candidate = provider();
    const registry = new ProviderRegistry().register("test", () => candidate);
    const [bound] = registry.create([binding]);
    expect(bound?.capabilities().languages).toEqual([]);
    expect(bound?.evaluatedLanguages).toEqual([]);
    await new Ladder(bound ? [bound] : [], {}).answer(request, {
      cloudOk: true,
    });
    expect(candidate.answer).not.toHaveBeenCalled();
  });
});
