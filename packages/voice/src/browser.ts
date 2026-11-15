import { MAX_RECORDING_MS, VoiceError } from "./index.js";
import type { SpeechToText, TextToSpeech, VoiceErrorCode } from "./index.js";

// FR-VOICE-01/02: declarations are the API's reviewed, configured capabilities.
export interface BrowserVoiceLanguage {
  code: string;
  stt: boolean;
  tts: boolean;
  voice?: { engine: "browser"; bcp_tag: string } | null;
}

export interface BrowserVoiceAdapters {
  speechToText: SpeechToText;
  textToSpeech: TextToSpeech;
  dispose(): void;
}

interface RecognitionResult {
  isFinal: boolean;
  0?: { transcript: string; confidence: number };
}

interface Recognition {
  processLocally?: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface RecognitionConstructor {
  new (): Recognition;
  available?: (options: {
    langs: string[];
    processLocally: true;
  }) => Promise<string>;
  install?: (options: {
    langs: string[];
    processLocally: true;
  }) => Promise<boolean>;
}

interface BrowserSpeechGlobals {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}

const PROBE_MS = 2_000;
const END_WAIT_MS = 2_000;
const SYNTHESIS_MS = 120_000;
const MIN_CONFIDENCE = 0.5;
const MAX_TRANSCRIPT_LENGTH = 1_000;

// Never retain or surface native error messages, which can contain private data.
function nativeError(error: string): VoiceErrorCode {
  if (error === "not-allowed" || error === "service-not-allowed")
    return "permission-denied";
  if (error === "audio-capture") return "microphone-unavailable";
  if (error === "no-speech") return "no-speech";
  if (error === "aborted" || error === "canceled" || error === "interrupted")
    return "cancelled";
  return "unavailable";
}

function thrownError(error: unknown): VoiceErrorCode {
  return error instanceof Error &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
    ? "permission-denied"
    : "unavailable";
}

function quiet(action: () => void): void {
  try {
    action();
  } catch {
    /* Native cleanup must not prevent promise settlement. */
  }
}

async function localRecognitionStatus(
  Constructor: RecognitionConstructor | undefined,
  tag: string,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!Constructor?.available) return "unavailable";
    const probe = new Constructor();
    if (!("processLocally" in probe)) return "unavailable";
    probe.processLocally = true;
    if (probe.processLocally !== true) return "unavailable";
    // FR-VOICE-09: no implicit remote recognition or language-pack downloads.
    return await Promise.race([
      Constructor.available({ langs: [tag], processLocally: true }),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("unavailable"), PROBE_MS);
      }),
    ]);
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}

/** Local browser speech only. Construction/probing never starts the microphone. */
export async function createBrowserVoiceAdapters(options: {
  languages: readonly BrowserVoiceLanguage[];
  onCapabilitiesChanged?: () => void;
}): Promise<BrowserVoiceAdapters> {
  const browser = globalThis as unknown as BrowserSpeechGlobals;
  const Constructor =
    browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  const synthesis = browser.speechSynthesis;
  const Utterance = browser.SpeechSynthesisUtterance;
  const declarations = new Map(
    options.languages.map((language) => [language.code, language]),
  );
  const localRecognition = new Set<string>();
  const installableRecognition = new Set<string>();
  let localVoices = new Map<string, SpeechSynthesisVoice>();
  let disposed = false;
  let cancelRecognition: (() => void) | undefined;
  let stopRecognition: (() => void) | undefined;
  let cancelSynthesis: (() => void) | undefined;
  let synthesisLanguage: string | undefined;
  let synthesisPaused = false;

  await Promise.all(
    options.languages.map(async (language) => {
      if (!language.stt || language.voice?.engine !== "browser") return;
      const status = await localRecognitionStatus(
        Constructor,
        language.voice.bcp_tag,
      );
      if (status === "available") localRecognition.add(language.code);
      else if (status === "downloadable" && Constructor?.install)
        installableRecognition.add(language.code);
    }),
  );

  const refreshVoices = (notify = true) => {
    if (disposed) return;
    const next = new Map<string, SpeechSynthesisVoice>();
    try {
      if (synthesis && Utterance) {
        const voices = synthesis.getVoices();
        for (const language of declarations.values()) {
          if (!language.tts || language.voice?.engine !== "browser") continue;
          const tag = language.voice.bcp_tag.toLowerCase();
          const voice = voices.find(
            (candidate) =>
              candidate.localService === true &&
              candidate.lang.toLowerCase() === tag,
          );
          if (voice) next.set(language.code, voice);
        }
      }
    } catch {
      /* Unsupported or restricted native APIs fail closed. */
    }
    const changed =
      next.size !== localVoices.size ||
      [...next.keys()].some((code) => !localVoices.has(code));
    localVoices = next;
    if (synthesisLanguage && !next.has(synthesisLanguage)) cancelSynthesis?.();
    if (changed && notify) options.onCapabilitiesChanged?.();
  };
  const onVoicesChanged = () => refreshVoices();
  // The initial read establishes synchronous supported(); events refresh it later.
  refreshVoices(false);
  if (synthesis)
    quiet(() => synthesis.addEventListener("voiceschanged", onVoicesChanged));

  const speechToText: SpeechToText = {
    supported: (lang) => !disposed && localRecognition.has(lang),
    installable: (lang) => !disposed && installableRecognition.has(lang),
    async install(lang) {
      const tag = declarations.get(lang)?.voice?.bcp_tag;
      if (disposed || !tag || !installableRecognition.has(lang)) return false;
      try {
        // Explicit learner action only (FR-VOICE-09): downloads the browser's
        // on-device recognition pack; recognition stays local afterwards.
        const installed = await Constructor?.install?.({
          langs: [tag],
          processLocally: true,
        });
        if (
          installed !== true ||
          (await localRecognitionStatus(Constructor, tag)) !== "available"
        )
          return false;
        installableRecognition.delete(lang);
        localRecognition.add(lang);
        options.onCapabilitiesChanged?.();
        return true;
      } catch {
        return false;
      }
    },
    start(lang) {
      cancelRecognition?.();
      cancelSynthesis?.();
      const declaration = declarations.get(lang);
      if (
        !speechToText.supported(lang) ||
        !Constructor ||
        !declaration?.voice
      ) {
        return Promise.reject(new VoiceError("unavailable"));
      }
      return new Promise<string>((resolve, reject) => {
        let recognition: Recognition;
        try {
          recognition = new Constructor();
          if (!("processLocally" in recognition))
            throw new VoiceError("unavailable");
          recognition.processLocally = true;
          if (recognition.processLocally !== true)
            throw new VoiceError("unavailable");
          recognition.lang = declaration.voice!.bcp_tag;
          recognition.continuous = true;
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;
        } catch (error) {
          reject(new VoiceError(thrownError(error)));
          return;
        }
        let settled = false;
        let stopping = false;
        let transcript = "";
        let lowConfidence = false;
        let endTimer: ReturnType<typeof setTimeout> | undefined;

        const finish = (code?: VoiceErrorCode) => {
          if (settled) return;
          settled = true;
          clearTimeout(limitTimer);
          clearTimeout(endTimer);
          recognition.onresult = null;
          recognition.onerror = null;
          recognition.onend = null;
          cancelRecognition = undefined;
          stopRecognition = undefined;
          if (code) quiet(() => recognition.abort());
          const result = transcript;
          transcript = "";
          if (code) reject(new VoiceError(code));
          else resolve(result);
        };
        cancelRecognition = () => finish("cancelled");
        stopRecognition = () => {
          if (settled || stopping) return;
          stopping = true;
          clearTimeout(limitTimer);
          endTimer = setTimeout(() => finish("timeout"), END_WAIT_MS);
          try {
            recognition.stop();
          } catch (error) {
            finish(thrownError(error));
          }
        };
        recognition.onresult = (event) => {
          if (settled) return;
          // Web Speech's result list contains previous final segments as well.
          const parts: string[] = [];
          lowConfidence = false;
          for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            const alternative = result?.[0];
            if (!result?.isFinal || !alternative) continue;
            parts.push(alternative.transcript);
            if (
              !Number.isFinite(alternative.confidence) ||
              alternative.confidence < MIN_CONFIDENCE
            )
              lowConfidence = true;
          }
          transcript = Array.from(parts.join(" ").trim())
            .slice(0, MAX_TRANSCRIPT_LENGTH)
            .join("");
        };
        recognition.onerror = (event) => finish(nativeError(event.error));
        recognition.onend = () =>
          finish(
            !transcript
              ? "no-speech"
              : lowConfidence
                ? "low-confidence"
                : undefined,
          );
        const limitTimer = setTimeout(
          () => stopRecognition?.(),
          MAX_RECORDING_MS,
        );
        try {
          recognition.start();
        } catch (error) {
          finish(thrownError(error));
        }
      });
    },
    stop: () => stopRecognition?.(),
    cancel: () => cancelRecognition?.(),
    dispose: () => dispose(),
  };

  const textToSpeech: TextToSpeech = {
    supported: (lang) => !disposed && localVoices.has(lang),
    speak(text, lang, rate) {
      cancelSynthesis?.();
      cancelRecognition?.();
      refreshVoices();
      const voice = localVoices.get(lang);
      if (
        !textToSpeech.supported(lang) ||
        !voice ||
        !synthesis ||
        !Utterance ||
        ![0.75, 1, 1.25].includes(rate)
      ) {
        return Promise.reject(new VoiceError("unavailable"));
      }
      if (!text.trim()) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        let utterance: SpeechSynthesisUtterance;
        try {
          utterance = new Utterance(text);
          utterance.voice = voice;
          utterance.lang = voice.lang;
          utterance.rate = rate;
        } catch (error) {
          reject(new VoiceError(thrownError(error)));
          return;
        }
        let settled = false;
        const finish = (code?: VoiceErrorCode) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          utterance.onend = null;
          utterance.onerror = null;
          cancelSynthesis = undefined;
          synthesisLanguage = undefined;
          if (code) quiet(() => synthesis.cancel());
          // cancel() does not reset SpeechSynthesis.paused in the native API.
          if (synthesisPaused) quiet(() => synthesis.resume());
          synthesisPaused = false;
          if (code) reject(new VoiceError(code));
          else resolve();
        };
        const timer = setTimeout(() => finish("timeout"), SYNTHESIS_MS);
        cancelSynthesis = () => finish("cancelled");
        synthesisLanguage = lang;
        utterance.onend = () => finish();
        utterance.onerror = (event) => finish(nativeError(event.error));
        try {
          synthesis.speak(utterance);
        } catch (error) {
          finish(thrownError(error));
        }
      });
    },
    pause: () => {
      if (cancelSynthesis && synthesis) {
        synthesisPaused = true;
        quiet(() => synthesis.pause());
      }
    },
    resume: () => {
      if (cancelSynthesis && synthesis) {
        synthesisPaused = false;
        quiet(() => synthesis.resume());
      }
    },
    stop: () => cancelSynthesis?.(),
    dispose: () => dispose(),
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelRecognition?.();
    cancelSynthesis?.();
    localRecognition.clear();
    localVoices.clear();
    if (synthesis)
      quiet(() =>
        synthesis.removeEventListener("voiceschanged", onVoicesChanged),
      );
  }

  return { speechToText, textToSpeech, dispose };
}
