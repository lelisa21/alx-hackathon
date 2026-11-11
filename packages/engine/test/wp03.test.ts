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
  text: "How do I make a study plan?",
  via: "text",
};

const passage: ScoredPassage = {
  id: "study-plan#goals",
  text: "Choose one learning goal.",
  label: "Study plan / Goals",
  url: "https://course.example/study-plan#goals",
  lang: "en",
  sourceType: "course",
  score: 0.9,
};

function dependencies(
  overrides: Partial<AskDependencies> = {},
): AskDependencies {
  return {
    search: vi.fn(async () => [passage]),
    answer: vi.fn(async () => ({
      text: "Choose one learning goal.",
      usedPassageIds: [passage.id],
      provider: "offline",
      latencyMs: 1,
    })),
    glossaryFor: () => [],
    systemPrompt: () => "",
    modeFor: () => "extractive",
    translate: (_lang, key) => key,
    confidenceFloor: () => 0.35,
    direction: () => "ltr",
    contentVersion: () => "version-1",
    createId: () => "reply-12345678",
    ...overrides,
  };
}

describe("WP03 grounded ask", () => {
  it("does not call the answer provider below the confidence floor", async () => {
    const deps = dependencies({
      search: vi.fn(async () => [{ ...passage, score: 0.34 }]),
    });

    const reply = await ask(question, deps);

    expect(deps.answer).not.toHaveBeenCalled();
    expect(reply.kind).toBe("notfound");
    expect(reply.actions).toContainEqual({
      type: "help",
      label: "help.button",
    });
  });

  it("returns an answer only with citations from supplied passages", async () => {
    const deps = dependencies();

    const reply = await ask(question, deps);

    expect(reply.kind).toBe("answer");
    expect(reply.citations).toEqual([
      {
        passageId: passage.id,
        label: passage.label,
        url: passage.url,
        sourceLang: passage.lang,
        sourceType: passage.sourceType,
      },
    ]);
  });

  it("replaces a provider answer with not-found when no valid citation is used", async () => {
    const deps = dependencies({
      answer: vi.fn(async () => ({
        text: "Unsupported answer.",
        usedPassageIds: ["invented-passage"],
        provider: "offline",
        latencyMs: 1,
      })),
    });

    const reply = await ask(question, deps);

    expect(reply.kind).toBe("notfound");
    expect(reply.citations).toEqual([]);
  });

  it("returns not-found with a help action when the index is empty", async () => {
    const deps = dependencies({ search: vi.fn(async () => []) });

    const reply = await ask(question, deps);

    expect(deps.answer).not.toHaveBeenCalled();
    expect(reply.kind).toBe("notfound");
    expect(reply.actions).toContainEqual({
      type: "help",
      label: "help.button",
    });
  });

  it("returns localized not-found when every AI provider is unavailable", async () => {
    const deps = dependencies({
      answer: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    });

    const reply = await ask(question, deps);

    expect(reply.kind).toBe("notfound");
    expect(reply.actions).toContainEqual({
      type: "help",
      label: "help.button",
    });
  });
});
