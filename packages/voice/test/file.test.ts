import { describe, expect, it } from "vitest";
import { createFileVoiceAdapters } from "../src/file.js";

describe("FR-VOICE-02/10 shared file voice ports", () => {
  it("truthfully defaults to unsupported for browser/none server capabilities", async () => {
    const adapters = createFileVoiceAdapters();
    expect(adapters.speechToText.supported("en")).toBe(false);
    expect(adapters.textToSpeech.supported("am")).toBe(false);
    await expect(
      adapters.speechToText.transcribe({
        audio: new Uint8Array(),
        mimeType: "audio/ogg",
        lang: "en",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("unavailable");
  });
});
