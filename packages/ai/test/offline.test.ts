import { describe, expect, it } from "vitest";
import { OfflineProvider } from "../src/offline.js";
import type { AnswerRequest } from "@dimts/engine";

const request: AnswerRequest = {
  question: "How do I make a study plan?",
  lang: "en",
  passages: [
    {
      id: "study-plan#goals",
      text: "Choose one learning goal. Divide it into small weekly steps.",
      label: "Study plan / Goals",
      url: "https://course.example/study-plan#goals",
      lang: "en",
      sourceType: "course",
    },
  ],
  glossary: [],
  simple: false,
  mode: "extractive",
  systemPrompt: "",
};

describe("offline provider", () => {
  it("uses a keyword-matched FAQ answer only with its cited source passage", async () => {
    const provider = new OfflineProvider({
      faqs: {
        en: [
          {
            q: "How do I make a study plan?",
            a: "Choose one goal and divide it into weekly steps.",
            source: "study-plan",
          },
        ],
      },
    });

    await expect(
      provider.answer(request, new AbortController().signal),
    ).resolves.toMatchObject({
      text: "Choose one goal and divide it into weekly steps.",
      usedPassageIds: ["study-plan#goals"],
      providerId: "offline",
    });
  });

  it("extracts at most three sentences from the top passage and cites it", async () => {
    const provider = new OfflineProvider({});

    await expect(
      provider.answer(
        {
          ...request,
          passages: [
            {
              ...request.passages[0]!,
              text: "First sentence. Second sentence. Third sentence. Fourth sentence.",
            },
          ],
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      text: "First sentence. Second sentence. Third sentence.",
      usedPassageIds: ["study-plan#goals"],
    });
  });

  it("returns no answer without passages instead of using model memory", async () => {
    const provider = new OfflineProvider({});

    await expect(
      provider.answer(
        { ...request, passages: [] },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      text: "",
      usedPassageIds: [],
    });
  });
});
