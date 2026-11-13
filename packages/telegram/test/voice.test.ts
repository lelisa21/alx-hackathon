import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramVoice } from "../src/voice.js";

describe("FR-TG-02 and FR-VOICE-02/10 voice boundaries", () => {
  afterEach(() => vi.useRealTimers());
  it("does not download when file STT is unavailable", async () => {
    const downloadVoice = vi.fn();
    const voice = createTelegramVoice({ transport: { downloadVoice } });
    expect(voice.supported("en")).toEqual({ stt: false, tts: false });
    await expect(
      voice.transcribe({ file_id: "file", duration: 3 }, "en"),
    ).rejects.toThrow("unavailable");
    expect(downloadVoice).not.toHaveBeenCalled();
  });
  it("passes transient audio to the selected adapter then erases the buffer", async () => {
    const audio = new Uint8Array([79, 103, 103, 83, 1]);
    const transcribe = vi.fn(
      async ({ audio: input }: { audio: Uint8Array }) => {
        expect(input[0]).toBe(79);
        return "fixture transcript";
      },
    );
    const voice = createTelegramVoice({
      transport: {
        downloadVoice: async () => ({ audio, mimeType: "audio/ogg" }),
      },
      adapters: { speechToText: { supported: () => true, transcribe } },
    });
    expect(await voice.transcribe({ file_id: "file", duration: 3 }, "en")).toBe(
      "fixture transcript",
    );
    expect([...audio]).toEqual([0, 0, 0, 0, 0]);
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "en",
        mimeType: "audio/ogg",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("erases failed audio and returns only safe typed errors", async () => {
    const audio = new Uint8Array([79, 103, 103, 83]);
    const voice = createTelegramVoice({
      transport: {
        downloadVoice: async () => ({ audio, mimeType: "audio/ogg" }),
      },
      adapters: {
        speechToText: {
          supported: () => true,
          transcribe: async () => {
            throw new Error("private transcript and token");
          },
        },
      },
    });
    await expect(
      voice.transcribe({ file_id: "file", duration: 3 }, "en"),
    ).rejects.toThrow(/^unavailable$/u);
    expect([...audio]).toEqual([0, 0, 0, 0]);
  });
  it("times out an unresponsive adapter and erases its audio", async () => {
    vi.useFakeTimers();
    const audio = new Uint8Array([79, 103, 103, 83]);
    const voice = createTelegramVoice({
      transport: {
        downloadVoice: async () => ({ audio, mimeType: "audio/ogg" }),
      },
      adapters: {
        speechToText: {
          supported: () => true,
          transcribe: () => new Promise(() => {}),
        },
      },
    });
    const failed = expect(
      voice.transcribe({ file_id: "file", duration: 3 }, "en"),
    ).rejects.toThrow(/^timeout$/u);
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect([...audio]).toEqual([0, 0, 0, 0]);
  });
  it.each(["", "x".repeat(1001)])(
    "rejects empty or overlong recognized text",
    async (text) => {
      const audio = new Uint8Array([79, 103, 103, 83]);
      const voice = createTelegramVoice({
        transport: {
          downloadVoice: async () => ({ audio, mimeType: "audio/ogg" }),
        },
        adapters: {
          speechToText: { supported: () => true, transcribe: async () => text },
        },
      });
      await expect(
        voice.transcribe({ file_id: "file", duration: 3 }, "en"),
      ).rejects.toThrow();
      expect([...audio]).toEqual([0, 0, 0, 0]);
    },
  );
  it("returns real TTS output only for supported languages and erases invalid output", async () => {
    const audio = new Uint8Array([79, 103, 103, 83]);
    const synthesize = vi
      .fn()
      .mockResolvedValueOnce({ audio, mimeType: "audio/ogg" })
      .mockResolvedValueOnce({ audio, mimeType: "text/html" });
    const voice = createTelegramVoice({
      transport: { downloadVoice: vi.fn() },
      adapters: {
        textToSpeech: { supported: (lang) => lang === "en", synthesize },
      },
    });
    expect(await voice.synthesize("answer", "en")).toEqual({
      audio,
      mimeType: "audio/ogg",
    });
    await expect(voice.synthesize("answer", "am")).rejects.toThrow(
      /^unavailable$/u,
    );
    await expect(voice.synthesize("answer", "en")).rejects.toThrow(
      /^unavailable$/u,
    );
    expect([...audio]).toEqual([0, 0, 0, 0]);
    expect(synthesize).toHaveBeenCalledTimes(2);
  });
});
