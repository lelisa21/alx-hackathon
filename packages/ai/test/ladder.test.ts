import { describe, expect, it, vi } from "vitest";
import type { AnswerRequest } from "@dimts/engine";
import { Ladder } from "../src/ladder.js";
import type {
  AiProvider,
  AnswerResult,
  ProviderCapabilities,
} from "../src/provider.js";

const request: AnswerRequest = {
  question: "How do I make a study plan?",
  lang: "en",
  passages: [
    {
      id: "passage-1",
      text: "Choose one learning goal.",
      label: "Study plan",
      url: "https://course.example/study-plan",
      lang: "en",
      sourceType: "course",
    },
  ],
  glossary: [],
  simple: false,
  mode: "extractive",
  systemPrompt: "",
};

const capabilities: ProviderCapabilities = {
  languages: ["en"],
  modes: ["extractive", "generative"],
  modalities: ["text"],
  structuredOutput: true,
};

function provider(
  name: string,
  answer: AiProvider["answer"],
  health: AiProvider["health"] = async () => ({ ok: true }),
  policy: Partial<
    Pick<
      AiProvider,
      "privacyClass" | "allowedDataClasses" | "evaluatedLanguages"
    >
  > = {},
): AiProvider {
  return {
    name,
    capabilities: () => capabilities,
    answer,
    health,
    privacyClass: policy.privacyClass ?? "local",
    allowedDataClasses: policy.allowedDataClasses ?? [
      "question",
      "course-passage",
      "glossary",
    ],
    evaluatedLanguages: policy.evaluatedLanguages ?? [],
  };
}

describe("provider ladder", () => {
  it("skips a failed provider and returns the next successful answer", async () => {
    const cloud = provider(
      "cloud",
      vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    );
    const localAnswer: AnswerResult = {
      text: "Choose one learning goal.",
      usedPassageIds: ["passage-1"],
      providerId: "local",
      latencyMs: 1,
    };
    const local = provider(
      "local",
      vi.fn(async () => localAnswer),
    );

    const result = await new Ladder([cloud, local], {
      cloud: 8_000,
      local: 20_000,
    }).answer(request);

    expect(result).toEqual(localAnswer);
    expect(local.answer).toHaveBeenCalledOnce();
  });

  it("returns an empty result when every provider is unavailable", async () => {
    const unavailable = provider(
      "cloud",
      vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
      async () => ({ ok: false, reasonCode: "unavailable" }),
    );

    await expect(
      new Ladder([unavailable], { cloud: 8_000 }).answer(request),
    ).resolves.toMatchObject({
      text: "",
      usedPassageIds: [],
      providerId: "offline",
    });
  });

  it("never tries a remote provider without per-session consent", async () => {
    const remote = provider(
      "remote-inference",
      vi.fn(async () => ({
        text: "Remote answer",
        usedPassageIds: ["passage-1"],
        providerId: "remote-inference",
        latencyMs: 1,
      })),
      async () => ({ ok: true }),
      { privacyClass: "remote" },
    );
    const localAnswer: AnswerResult = {
      text: "Local answer",
      usedPassageIds: ["passage-1"],
      providerId: "local",
      latencyMs: 1,
    };
    const local = provider(
      "local",
      vi.fn(async () => localAnswer),
    );

    await expect(
      new Ladder([remote, local], {}).answer(request, { cloudOk: false }),
    ).resolves.toEqual(localAnswer);

    expect(remote.answer).not.toHaveBeenCalled();
    expect(local.answer).toHaveBeenCalledOnce();
  });

  it("sends only configured data classes to a consenting remote provider", async () => {
    const answer = vi.fn(async () => ({
      text: "A cited answer.",
      usedPassageIds: ["passage-1"],
      providerId: "remote",
      latencyMs: 1,
    }));
    const remote = provider("remote", answer, async () => ({ ok: true }), {
      privacyClass: "remote",
      allowedDataClasses: ["question", "course-passage", "glossary"],
    });

    await new Ladder([remote], {}).answer(
      {
        ...request,
        passages: [
          {
            id: "passage-1",
            text: "Grounded course material.",
            label: "Lesson",
            url: "https://learn.example/lesson",
            lang: "en",
            sourceType: "course",
          },
        ],
        glossary: [{ term: "term", meaning: "definition" }],
      },
      { cloudOk: true },
    );

    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0]?.[0]).toMatchObject({
      question: request.question,
      passages: [{ id: "passage-1", text: "Grounded course material." }],
      glossary: [],
    });
  });

  it("forces extractive mode for an unevaluated provider-language pair", async () => {
    const answer = vi.fn(async () => ({
      text: "A cited answer.",
      usedPassageIds: ["passage-1"],
      providerId: "not-yet-evaluated",
      latencyMs: 1,
    }));
    const candidate = provider(
      "not-yet-evaluated",
      answer,
      async () => ({ ok: true }),
      { evaluatedLanguages: [] },
    );

    await new Ladder([candidate], {}).answer(
      { ...request, mode: "generative" },
      { cloudOk: false },
    );

    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0]?.[0].mode).toBe("extractive");
  });
});

describe("provider declines", () => {
  it("returns a well-formed decline without cooldown or fallback", async () => {
    const decline = vi.fn(async () => ({
      text: "The course does not cover this.",
      usedPassageIds: [],
    }));
    const backup = vi.fn(async () => ({
      text: "Choose one learning goal.",
      usedPassageIds: ["passage-1"],
    }));
    const ladder = new Ladder(
      [provider("first", decline), provider("second", backup)],
      {},
    );

    const first = await ladder.answer(request);
    expect(first.usedPassageIds).toEqual([]);
    expect(first.providerId).toBe("first");
    expect(backup).not.toHaveBeenCalled();
    expect(decline).toHaveBeenCalledTimes(1);

    // Not cooled down: the next question goes to the same provider again.
    await ladder.answer(request);
    expect(decline).toHaveBeenCalledTimes(2);
  });
});

describe("structured decline parsing", () => {
  it("accepts an empty usedPassageIds decline in extractive mode", async () => {
    const { parseAnswer } = await import("../src/http-provider.js");
    expect(
      parseAnswer(
        JSON.stringify({ text: "Not in the course.", usedPassageIds: [] }),
        request,
      ),
    ).toEqual({ text: "Not in the course.", usedPassageIds: [] });
  });
});

describe("health probe caching", () => {
  it("reuses a healthy result for a minute instead of probing every answer", async () => {
    let clock = 1_000_000;
    const health = vi.fn(async () => ({ ok: true }));
    const answer = vi.fn(async () => ({
      text: "Choose one learning goal.",
      usedPassageIds: ["passage-1"],
    }));
    const ladder = new Ladder([provider("p", answer, health)], {}, () => clock);
    await ladder.answer(request);
    await ladder.answer(request);
    expect(health).toHaveBeenCalledTimes(1);
    clock += 61_000;
    await ladder.answer(request);
    expect(health).toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenCalledTimes(3);
  });
});

describe("terse declines", () => {
  it("accepts an empty-text decline but still requires text when citing", async () => {
    const { parseAnswer } = await import("../src/http-provider.js");
    const { InvalidProviderResponseError } = await import("../src/provider.js");
    expect(
      parseAnswer(JSON.stringify({ text: "", usedPassageIds: [] }), request),
    ).toEqual({ text: "", usedPassageIds: [] });
    expect(() =>
      parseAnswer(
        JSON.stringify({ text: " ", usedPassageIds: ["passage-1"] }),
        request,
      ),
    ).toThrow(InvalidProviderResponseError);
  });
});
