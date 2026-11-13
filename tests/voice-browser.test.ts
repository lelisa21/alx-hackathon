// FR-VOICE-01–04/06–09: local-only, learner-initiated browser adapters.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserVoiceAdapters,
  MAX_RECORDING_MS,
} from "../packages/voice/src/index.js";

const languages = [
  {
    code: "en",
    stt: true,
    tts: true,
    voice: { engine: "browser" as const, bcp_tag: "en-GB" },
  },
  { code: "am", stt: false, tts: false, voice: null },
];

class Recognition {
  static instances: Recognition[] = [];
  static available = vi.fn(async () => "available");
  static install = vi.fn();
  processLocally = false;
  lang = "";
  continuous = false;
  interimResults = true;
  maxAlternatives = 0;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    Recognition.instances.push(this);
  }
  result(text: string, confidence = 0.9, isFinal = true) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text, confidence }], { isFinal })],
    });
  }
}

class Utterance {
  text: string;
  lang = "";
  rate = 1;
  voice: unknown;
  onend: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

let voices: { lang: string; localService: boolean; name: string }[];
let spoken: Utterance[];
let voicesChanged: (() => void) | undefined;
const synthesis = {
  getVoices: vi.fn(() => voices),
  speak: vi.fn((utterance: Utterance) => {
    spoken.push(utterance);
  }),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  addEventListener: vi.fn((_name: string, callback: () => void) => {
    voicesChanged = callback;
  }),
  removeEventListener: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Recognition.instances = [];
  Recognition.available.mockResolvedValue("available");
  voices = [{ lang: "en-GB", localService: true, name: "local" }];
  spoken = [];
  voicesChanged = undefined;
  vi.stubGlobal("SpeechRecognition", Recognition);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", synthesis);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("network forbidden");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const current = () => Recognition.instances.at(-1)!;

describe("browser voice capabilities (FR-VOICE-01/02/03/09)", () => {
  it("probes declared local languages without recording, downloads, or network", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    expect(adapters.speechToText.supported("en")).toBe(true);
    expect(adapters.textToSpeech.supported("en")).toBe(true);
    expect(adapters.speechToText.supported("am")).toBe(false);
    expect(adapters.textToSpeech.supported("unknown")).toBe(false);
    expect(Recognition.available).toHaveBeenCalledWith({
      langs: ["en-GB"],
      processLocally: true,
    });
    for (const instance of Recognition.instances)
      expect(instance.start).not.toHaveBeenCalled();
    expect(Recognition.install).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    adapters.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["downloadable", "downloading", "unavailable"])(
    "fails closed for %s local packs",
    async (availability) => {
      Recognition.available.mockResolvedValue(availability);
      const adapters = await createBrowserVoiceAdapters({ languages });
      expect(adapters.speechToText.supported("en")).toBe(false);
      await expect(adapters.speechToText.start("en")).rejects.toMatchObject({
        code: "unavailable",
      });
      adapters.dispose();
    },
  );
  it("fails closed if local recognition cannot be proven", async () => {
    vi.stubGlobal(
      "SpeechRecognition",
      class {
        static available = Recognition.available;
      },
    );
    const adapters = await createBrowserVoiceAdapters({ languages });
    expect(adapters.speechToText.supported("en")).toBe(false);
    expect(Recognition.available).not.toHaveBeenCalled();
    adapters.dispose();
  });
  it("handles absent browser APIs", async () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("speechSynthesis", undefined);
    const adapters = await createBrowserVoiceAdapters({ languages });
    expect(adapters.speechToText.supported("en")).toBe(false);
    expect(adapters.textToSpeech.supported("en")).toBe(false);
    adapters.dispose();
  });
  it("bounds availability checks and ignores late answers", async () => {
    let finish!: (value: string) => void;
    Recognition.available.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = createBrowserVoiceAdapters({ languages });
    await vi.advanceTimersByTimeAsync(2_001);
    const adapters = await pending;
    expect(adapters.speechToText.supported("en")).toBe(false);
    finish("available");
    await Promise.resolve();
    expect(adapters.speechToText.supported("en")).toBe(false);
    adapters.dispose();
  });
  it("handles probe rejection", async () => {
    Recognition.available.mockRejectedValue(new Error("private native detail"));
    const adapters = await createBrowserVoiceAdapters({ languages });
    expect(adapters.speechToText.supported("en")).toBe(false);
    adapters.dispose();
  });
  it("fails closed when the native capability property throws", async () => {
    class Restricted extends Recognition {}
    Object.defineProperty(Restricted, "available", {
      get() {
        throw new Error("native capability restricted");
      },
    });
    vi.stubGlobal("SpeechRecognition", Restricted);
    const adapters = await createBrowserVoiceAdapters({ languages });
    expect(adapters.speechToText.supported("en")).toBe(false);
    adapters.dispose();
  });
  it("fails closed when voice enumeration throws", async () => {
    synthesis.getVoices.mockImplementationOnce(() => {
      throw new Error("restricted");
    });
    const adapters = await createBrowserVoiceAdapters({ languages });
    expect(adapters.textToSpeech.supported("en")).toBe(false);
    adapters.dispose();
  });
  it("does not enable undeclared or disabled capabilities", async () => {
    const adapters = await createBrowserVoiceAdapters({
      languages: [
        {
          code: "en",
          stt: false,
          tts: false,
          voice: { engine: "browser", bcp_tag: "en-GB" },
        },
        { code: "unknown", stt: true, tts: true },
      ],
    });
    expect(adapters.speechToText.supported("en")).toBe(false);
    expect(adapters.textToSpeech.supported("en")).toBe(false);
    expect(adapters.speechToText.supported("unknown")).toBe(false);
    expect(adapters.textToSpeech.supported("unknown")).toBe(false);
    expect(Recognition.available).not.toHaveBeenCalled();
    adapters.dispose();
  });
  it("requires a local voice with the exact declared tag and refreshes on voiceschanged", async () => {
    voices = [
      { lang: "en-GB", localService: false, name: "remote" },
      { lang: "en-US", localService: true, name: "other" },
    ];
    const changed = vi.fn();
    const adapters = await createBrowserVoiceAdapters({
      languages,
      onCapabilitiesChanged: changed,
    });
    expect(adapters.textToSpeech.supported("en")).toBe(false);
    voices = [{ lang: "en-GB", localService: true, name: "local" }];
    voicesChanged?.();
    expect(adapters.textToSpeech.supported("en")).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    adapters.dispose();
    expect(synthesis.removeEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function),
    );
  });
});

describe("browser recognition (FR-VOICE-04/06/07/09)", () => {
  it("starts locally only on start and stop finalizes an editable plain transcript", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.speechToText.start("en");
    const native = current();
    expect(native.start).toHaveBeenCalledOnce();
    expect(native).toMatchObject({
      lang: "en-GB",
      processLocally: true,
      interimResults: false,
    });
    native.result("  A learner question  ");
    adapters.speechToText.stop();
    expect(native.stop).toHaveBeenCalledOnce();
    native.onend?.();
    await expect(pending).resolves.toBe("A learner question");
    expect(native.onresult).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    adapters.dispose();
  });
  it.each([
    ["not-allowed", "permission-denied"],
    ["service-not-allowed", "permission-denied"],
    ["audio-capture", "microphone-unavailable"],
    ["no-speech", "no-speech"],
    ["network", "unavailable"],
    ["aborted", "cancelled"],
    ["language-not-supported", "unavailable"],
  ])("maps %s safely to %s", async (nativeError, code) => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.speechToText.start("en");
    const check = expect(pending).rejects.toMatchObject({
      code,
      message: code,
    });
    current().onerror?.({ error: nativeError, message: "private detail" });
    await check;
    expect(current().abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    adapters.dispose();
  });
  it.each([0, 0.49, Number.NaN])(
    "rejects low or unknown confidence %s",
    async (confidence) => {
      const adapters = await createBrowserVoiceAdapters({ languages });
      const pending = adapters.speechToText.start("en");
      current().result("uncertain", confidence);
      current().onend?.();
      await expect(pending).rejects.toMatchObject({ code: "low-confidence" });
      adapters.dispose();
    },
  );
  it("ignores interim results and rejects silence", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.speechToText.start("en");
    current().result("not final", 0.9, false);
    current().onend?.();
    await expect(pending).rejects.toMatchObject({ code: "no-speech" });
    adapters.dispose();
  });
  it("caps transcript length without duplicate final results", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.speechToText.start("en");
    current().result("a".repeat(1_050));
    current().result("a".repeat(1_050));
    current().onend?.();
    await expect(pending).resolves.toBe("a".repeat(1_000));
    adapters.dispose();
  });
  it("stops at 60 seconds then aborts a native end-event hang", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.speechToText.start("en");
    const check = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS);
    expect(current().stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_001);
    await check;
    expect(current().abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    adapters.dispose();
  });
  it("cancels old starts and ignores their stale callbacks", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const first = adapters.speechToText.start("en");
    const check = expect(first).rejects.toMatchObject({ code: "cancelled" });
    const old = current();
    const staleEnd = old.onend;
    const second = adapters.speechToText.start("en");
    await check;
    staleEnd?.();
    current().result("second");
    current().onend?.();
    await expect(second).resolves.toBe("second");
    expect(old.abort).toHaveBeenCalledOnce();
    adapters.dispose();
  });
  it("cancel and dispose abort and settle pending work", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.speechToText.start("en");
    adapters.speechToText.cancel?.();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    const next = adapters.speechToText.start("en");
    adapters.dispose();
    await expect(next).rejects.toMatchObject({ code: "cancelled" });
    expect(adapters.speechToText.supported("en")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("maps synchronous permission failures and cleans timers", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    class Denied extends Recognition {
      override start = vi.fn(() => {
        throw Object.assign(new Error("private detail"), {
          name: "NotAllowedError",
        });
      });
    }
    // A fresh factory captures this browser implementation.
    adapters.dispose();
    vi.stubGlobal("SpeechRecognition", Denied);
    const denied = await createBrowserVoiceAdapters({ languages });
    await expect(denied.speechToText.start("en")).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(current().onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    denied.dispose();
  });
  it("settles a throwing stop and tolerates throwing native cleanup", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.speechToText.start("en");
    current().stop.mockImplementationOnce(() => {
      throw new Error("stop failed");
    });
    current().abort.mockImplementationOnce(() => {
      throw new Error("abort failed");
    });
    adapters.speechToText.stop();
    await expect(pending).rejects.toMatchObject({ code: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
    adapters.dispose();
  });
  it("checks every final segment's confidence", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.speechToText.start("en");
    current().onresult?.({
      results: [
        Object.assign([{ transcript: "first", confidence: 0.9 }], {
          isFinal: true,
        }),
        Object.assign([{ transcript: "second", confidence: 0.2 }], {
          isFinal: true,
        }),
      ],
    });
    current().onend?.();
    await expect(pending).rejects.toMatchObject({ code: "low-confidence" });
    adapters.dispose();
  });
  it("does not record if local enforcement disappears after the probe", async () => {
    let creations = 0;
    class ReadOnly extends Recognition {
      constructor() {
        super();
        if (++creations > 1)
          Object.defineProperty(this, "processLocally", {
            value: false,
            writable: false,
          });
      }
    }
    vi.stubGlobal("SpeechRecognition", ReadOnly);
    const blocked = await createBrowserVoiceAdapters({ languages });
    expect(blocked.speechToText.supported("en")).toBe(true);
    await expect(blocked.speechToText.start("en")).rejects.toMatchObject({
      code: "unavailable",
    });
    for (const instance of Recognition.instances)
      expect(instance.start).not.toHaveBeenCalled();
    blocked.dispose();
  });
});

describe("browser synthesis (FR-VOICE-08/09)", () => {
  it.each([0.75, 1, 1.25] as const)(
    "speaks a local voice at rate %s with pause/resume",
    async (rate) => {
      const adapters = await createBrowserVoiceAdapters({ languages });
      const pending = adapters.textToSpeech.speak("Visible answer", "en", rate);
      const utterance = spoken[0]!;
      expect(utterance).toMatchObject({
        text: "Visible answer",
        lang: "en-GB",
        rate,
        voice: voices[0],
      });
      adapters.textToSpeech.pause();
      adapters.textToSpeech.resume();
      expect(synthesis.pause).toHaveBeenCalledOnce();
      expect(synthesis.resume).toHaveBeenCalledOnce();
      utterance.onend?.();
      await expect(pending).resolves.toBeUndefined();
      expect(utterance.onend).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      adapters.dispose();
    },
  );
  it("stops overlapping utterances and ignores stale callbacks", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const first = adapters.textToSpeech.speak("First", "en", 1);
    const check = expect(first).rejects.toMatchObject({ code: "cancelled" });
    const staleEnd = spoken[0]!.onend;
    const second = adapters.textToSpeech.speak("Second", "en", 1);
    await check;
    staleEnd?.();
    spoken[1]!.onend?.();
    await expect(second).resolves.toBeUndefined();
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    adapters.dispose();
  });
  it("bounds native synthesis hangs and releases callbacks", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.textToSpeech.speak("Answer", "en", 1);
    const check = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(120_001);
    await check;
    expect(spoken[0]!.onend).toBeNull();
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    adapters.dispose();
  });
  it("maps errors without leaking native details", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.textToSpeech.speak("Answer", "en", 1);
    spoken[0]!.onerror?.({
      error: "synthesis-failed",
      message: "private detail",
    });
    await expect(pending).rejects.toMatchObject({
      code: "unavailable",
      message: "unavailable",
    });
    adapters.dispose();
  });
  it("settles a throwing speak and tolerates throwing native cleanup", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    synthesis.speak.mockImplementationOnce(() => {
      throw new Error("speak failed");
    });
    synthesis.cancel.mockImplementationOnce(() => {
      throw new Error("cancel failed");
    });
    await expect(
      adapters.textToSpeech.speak("Answer", "en", 1),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
    adapters.dispose();
  });
  it("rejects unsupported languages and cancels on dispose", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    await expect(
      adapters.textToSpeech.speak("Answer", "am", 1),
    ).rejects.toMatchObject({ code: "unavailable" });
    const pending = adapters.textToSpeech.speak("Answer", "en", 1);
    adapters.dispose();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(adapters.textToSpeech.supported("en")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears a paused state when replacing or stopping an utterance", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const first = adapters.textToSpeech.speak("First", "en", 1);
    const check = expect(first).rejects.toMatchObject({ code: "cancelled" });
    adapters.textToSpeech.pause();
    const next = adapters.textToSpeech.speak("Second", "en", 1);
    await check;
    expect(synthesis.resume).toHaveBeenCalledOnce();
    spoken[1]!.onend?.();
    await next;
    adapters.dispose();
  });
  it("cancels playback when the local voice is removed", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const pending = adapters.textToSpeech.speak("Answer", "en", 1);
    const check = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    voices = [];
    voicesChanged?.();
    await check;
    expect(adapters.textToSpeech.supported("en")).toBe(false);
    adapters.dispose();
  });
  it("cancels speech before recognition and recognition before speech", async () => {
    const adapters = await createBrowserVoiceAdapters({ languages });
    const spokenAnswer = adapters.textToSpeech.speak("Answer", "en", 1);
    const speechCheck = expect(spokenAnswer).rejects.toMatchObject({
      code: "cancelled",
    });
    const recording = adapters.speechToText.start("en");
    await speechCheck;
    const recordingCheck = expect(recording).rejects.toMatchObject({
      code: "cancelled",
    });
    const spokenAgain = adapters.textToSpeech.speak("Answer again", "en", 1);
    await recordingCheck;
    spoken[1]!.onend?.();
    await spokenAgain;
    adapters.dispose();
  });
});
