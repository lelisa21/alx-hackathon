// FR-TUTOR grounding: lexical retrieval cannot separate paraphrases from
// off-topic questions with one threshold. With an eligible AI provider the
// engine sends top passages under a lower recall floor and lets the model judge
// relevance; the offline extractor keeps the strict floor.
import { describe, expect, it, vi } from "vitest";
import { ask } from "../src/ask.js";
import type {
  AskDependencies,
  AskRequest,
  ScoredPassage,
} from "../src/types.js";

const question: AskRequest = {
  sessionId: "session-12345678",
  clientMsgId: "message-12345678",
  lang: "en",
  text: "Where should I record my study times?",
  via: "text",
};

const passage: ScoredPassage = {
  id: "study-plan#schedule",
  text: "Put each time on a calendar.",
  label: "Study plan / Schedule",
  url: "https://course.example/study-plan#schedule",
  lang: "en",
  sourceType: "course",
  score: 0.37,
};

function dependencies(
  overrides: Partial<AskDependencies> = {},
): AskDependencies {
  return {
    search: vi.fn(async () => [passage]),
    answer: vi.fn(async () => ({
      text: "Put each study time on a calendar.",
      usedPassageIds: [passage.id],
      provider: "gemini",
      latencyMs: 1,
    })),
    glossaryFor: () => [],
    systemPrompt: () => "",
    modeFor: () => "extractive",
    translate: (_lang, key) => key,
    confidenceFloor: () => 0.6,
    direction: () => "ltr",
    contentVersion: () => "version-1",
    createId: () => "reply-12345678",
    ...overrides,
  };
}

describe("AI recall floor", () => {
  it("keeps the strict floor when no AI provider is eligible", async () => {
    const deps = dependencies({ recallFloor: () => undefined });
    const reply = await ask(question, deps, { cloudOk: false });
    expect(deps.answer).not.toHaveBeenCalled();
    expect(reply.kind).toBe("notfound");
  });

  it("lets an eligible AI provider answer a paraphrase below the strict floor", async () => {
    const recallFloor = vi.fn(() => 0.3);
    const deps = dependencies({ recallFloor });
    const reply = await ask(question, deps, { cloudOk: true });
    expect(recallFloor).toHaveBeenCalledWith("en", { cloudOk: true });
    expect(reply.kind).toBe("answer");
    expect(reply.citations[0]?.passageId).toBe(passage.id);
  });

  it("does not let the offline fallback answer below the strict floor", async () => {
    const deps = dependencies({
      recallFloor: () => 0.3,
      answer: vi.fn(async () => ({
        text: "Put each time on a calendar.",
        usedPassageIds: [passage.id],
        provider: "offline",
        latencyMs: 1,
      })),
    });
    const reply = await ask(question, deps, { cloudOk: true });
    expect(reply.kind).toBe("notfound");
  });

  it("returns notfound when the AI declines with no passages used", async () => {
    const deps = dependencies({
      recallFloor: () => 0.3,
      answer: vi.fn(async () => ({
        text: "The course does not cover this.",
        usedPassageIds: [],
        provider: "gemini",
        latencyMs: 1,
      })),
    });
    const reply = await ask(question, deps, { cloudOk: true });
    expect(reply.kind).toBe("notfound");
  });

  it("still rejects questions below the recall floor without calling the AI", async () => {
    const deps = dependencies({
      recallFloor: () => 0.3,
      search: vi.fn(async () => [{ ...passage, score: 0.1 }]),
    });
    const reply = await ask(question, deps, { cloudOk: true });
    expect(deps.answer).not.toHaveBeenCalled();
    expect(reply.kind).toBe("notfound");
  });

  it("tells the AI how to decline", async () => {
    const deps = dependencies({ recallFloor: () => 0.3 });
    await ask(question, deps, { cloudOk: true });
    const request = vi.mocked(deps.answer).mock.calls[0]![0];
    expect(request.systemPrompt).toMatch(/empty usedPassageIds/u);
  });
});
