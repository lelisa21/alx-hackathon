import { VoiceError } from "./index.js";
import type { SpeechToText, TextToSpeech } from "./index.js";

/**
 * Cloud speech adapters for languages the device cannot recognise or speak.
 * The microphone opens only after `consent()` resolves true. Audio is recorded
 * as 16 kHz mono WAV, which every speech service accepts, and sent once; it is
 * never stored in the browser.
 */
export interface CloudVoiceTransport {
  transcribe(input: {
    audio: string;
    mimeType: "audio/wav";
    lang: string;
  }): Promise<string>;
  synthesize(input: {
    text: string;
    lang: string;
  }): Promise<{ audio: string; mimeType: string }>;
}

export interface CloudVoiceAdapters {
  speechToText: SpeechToText;
  textToSpeech: TextToSpeech;
  dispose(): void;
}

const TARGET_RATE = 16_000;

function encodeWav(chunks: Float32Array[], sourceRate: number): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const ratio = sourceRate / TARGET_RATE;
  const length = Math.max(0, Math.floor(total / ratio));
  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const write = (at: number, text: string) => {
    for (let index = 0; index < text.length; index += 1)
      view.setUint8(at + index, text.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 2, true);
  for (let index = 0; index < length; index += 1) {
    // Average the source samples that fall into this output sample.
    const start = Math.floor(index * ratio);
    const end = Math.min(total, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let at = start; at < end; at += 1) sum += samples[at] ?? 0;
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    view.setInt16(
      44 + index * 2,
      value < 0 ? value * 0x8000 : value * 0x7fff,
      true,
    );
  }
  return new Uint8Array(buffer);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function createCloudVoiceAdapters(options: {
  languages: string[];
  consent(): Promise<boolean>;
  transport: CloudVoiceTransport;
}): CloudVoiceAdapters {
  const supported = (lang: string) => options.languages.includes(lang);
  let recording:
    | {
        stop(): void;
        cancel(): void;
      }
    | undefined;
  let audio: HTMLAudioElement | undefined;
  let audioUrl: string | undefined;
  let finishSpeech: ((error?: VoiceError) => void) | undefined;

  const releaseAudio = () => {
    audio?.pause();
    audio = undefined;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = undefined;
  };

  const speechToText: SpeechToText = {
    supported,
    async start(lang) {
      if (!supported(lang)) throw new VoiceError("unavailable");
      if (!(await options.consent())) throw new VoiceError("cancelled");
      const media = navigator.mediaDevices?.getUserMedia;
      if (typeof media !== "function")
        throw new VoiceError("microphone-unavailable");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      } catch (error) {
        throw new VoiceError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "permission-denied"
            : "microphone-unavailable",
        );
      }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      // ScriptProcessor is deprecated but universally available and needs no
      // separate worklet file under a strict host CSP.
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silent = context.createGain();
      silent.gain.value = 0;
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);
      const close = () => {
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        silent.disconnect();
        for (const track of stream.getTracks()) track.stop();
        void context.close();
      };
      const recorded = await new Promise<Uint8Array | null>((resolve) => {
        recording = {
          stop: () => {
            const rate = context.sampleRate;
            close();
            resolve(encodeWav(chunks, rate));
          },
          cancel: () => {
            close();
            resolve(null);
          },
        };
      });
      recording = undefined;
      chunks.length = 0;
      if (!recorded) throw new VoiceError("cancelled");
      // Less than a quarter second of audio is not a question.
      if (recorded.byteLength < 44 + TARGET_RATE / 2)
        throw new VoiceError("no-speech");
      try {
        return (
          await options.transport.transcribe({
            audio: toBase64(recorded),
            mimeType: "audio/wav",
            lang,
          })
        ).trim();
      } catch {
        throw new VoiceError("unavailable");
      } finally {
        recorded.fill(0);
      }
    },
    stop() {
      recording?.stop();
    },
    cancel() {
      recording?.cancel();
    },
    dispose() {
      recording?.cancel();
    },
  };

  const textToSpeech: TextToSpeech = {
    supported,
    async speak(text, lang, rate) {
      if (!supported(lang)) throw new VoiceError("unavailable");
      if (!(await options.consent())) throw new VoiceError("cancelled");
      releaseAudio();
      let result: { audio: string; mimeType: string };
      try {
        result = await options.transport.synthesize({ text, lang });
      } catch {
        throw new VoiceError("unavailable");
      }
      const bytes = Uint8Array.from(atob(result.audio), (character) =>
        character.charCodeAt(0),
      );
      audioUrl = URL.createObjectURL(
        new Blob([bytes], { type: result.mimeType }),
      );
      const element = new Audio(audioUrl);
      audio = element;
      element.playbackRate = rate;
      await new Promise<void>((resolve, reject) => {
        finishSpeech = (error) => {
          finishSpeech = undefined;
          if (error) reject(error);
          else resolve();
        };
        element.onended = () => finishSpeech?.();
        element.onerror = () => finishSpeech?.(new VoiceError("unavailable"));
        element
          .play()
          .catch(() => finishSpeech?.(new VoiceError("unavailable")));
      }).finally(releaseAudio);
    },
    pause() {
      audio?.pause();
    },
    resume() {
      void audio?.play();
    },
    stop() {
      finishSpeech?.(new VoiceError("cancelled"));
      releaseAudio();
    },
    dispose() {
      this.stop();
    },
  };

  return {
    speechToText,
    textToSpeech,
    dispose() {
      speechToText.dispose?.();
      textToSpeech.dispose?.();
    },
  };
}

/** Prefer the on-device port; fall back to cloud for languages it lacks. */
export function combineSpeechToText(
  primary: SpeechToText | undefined,
  fallback: SpeechToText,
): SpeechToText {
  let active: SpeechToText | undefined;
  const pick = (lang: string) =>
    primary?.supported(lang) ? primary : fallback;
  return {
    supported: (lang) =>
      Boolean(primary?.supported(lang)) || fallback.supported(lang),
    ...(primary?.installable
      ? { installable: (lang: string) => primary.installable!(lang) }
      : {}),
    ...(primary?.install
      ? { install: (lang: string) => primary.install!(lang) }
      : {}),
    async start(lang) {
      active = pick(lang);
      try {
        return await active.start(lang);
      } finally {
        active = undefined;
      }
    },
    stop() {
      active?.stop();
    },
    cancel() {
      if (active?.cancel) active.cancel();
      else active?.stop();
    },
    dispose() {
      primary?.dispose?.();
      fallback.dispose?.();
    },
  };
}

export function combineTextToSpeech(
  primary: TextToSpeech | undefined,
  fallback: TextToSpeech,
): TextToSpeech {
  let active: TextToSpeech | undefined;
  return {
    supported: (lang) =>
      Boolean(primary?.supported(lang)) || fallback.supported(lang),
    async speak(text, lang, rate) {
      active = primary?.supported(lang) ? primary : fallback;
      return active.speak(text, lang, rate);
    },
    pause() {
      active?.pause();
    },
    resume() {
      active?.resume();
    },
    stop() {
      primary?.stop();
      fallback.stop();
    },
    dispose() {
      primary?.dispose?.();
      fallback.dispose?.();
    },
  };
}
