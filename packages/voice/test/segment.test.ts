import { describe, expect, it } from "vitest";
import { segmentTextForSpeech } from "../src/browser.js";

describe("segmentTextForSpeech", () => {
  it("segments Ethiopic text by Ethiopic punctuation markers", () => {
    const text = "ሰላም ለሁላችሁ። ይህ ትምህርት የመጀመሪያው ክፍል ነው። ጥያቄ ካለዎት ይጠይቁ።";
    const segments = segmentTextForSpeech(text);
    expect(segments).toEqual([
      "ሰላም ለሁላችሁ።",
      "ይህ ትምህርት የመጀመሪያው ክፍል ነው።",
      "ጥያቄ ካለዎት ይጠይቁ።",
    ]);
  });

  it("segments Latin and Arabic text by punctuation", () => {
    const text = "Hello there! Welcome to Bridgely. How can I assist you today?";
    const segments = segmentTextForSpeech(text);
    expect(segments).toEqual([
      "Hello there!",
      "Welcome to Bridgely.",
      "How can I assist you today?",
    ]);
  });

  it("returns single segment for text without sentence breaks", () => {
    expect(segmentTextForSpeech("Akkam jirtu")).toEqual(["Akkam jirtu"]);
    expect(segmentTextForSpeech("")).toEqual([]);
  });
});
