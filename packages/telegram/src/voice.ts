import { createFileVoiceAdapters, VoiceError } from "@dimts/voice";
import type { FileVoiceAdapters } from "@dimts/voice";
import type { TelegramVoiceFile } from "./transport.js";

export interface TelegramVoice {
  supported(lang: string): { stt: boolean; tts: boolean };
  transcribe(voice: TelegramVoiceFile, lang: string): Promise<string>;
  synthesize(
    text: string,
    lang: string,
  ): Promise<{ audio: Uint8Array; mimeType: string }>;
}

async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new VoiceError("timeout"));
        }, 30_000);
      }),
    ]);
  } catch (error) {
    throw error instanceof VoiceError ? error : new VoiceError("unavailable");
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

export function createTelegramVoice(options: {
  transport: {
    downloadVoice(
      voice: TelegramVoiceFile,
    ): Promise<{ audio: Uint8Array; mimeType: string }>;
  };
  adapters?: Partial<FileVoiceAdapters>;
}): TelegramVoice {
  const adapters = createFileVoiceAdapters(options.adapters);
  return {
    supported: (lang) => ({
      stt: adapters.speechToText.supported(lang),
      tts: adapters.textToSpeech.supported(lang),
    }),
    async transcribe(voice, lang) {
      if (!adapters.speechToText.supported(lang))
        throw new VoiceError("unavailable");
      let audio: Uint8Array | undefined;
      try {
        const download = await options.transport.downloadVoice(voice);
        audio = download.audio;
        const text = (
          await bounded((signal) =>
            adapters.speechToText.transcribe({ ...download, lang, signal }),
          )
        ).trim();
        if (!text) throw new VoiceError("no-speech");
        if (text.length > 1000) throw new VoiceError("unavailable");
        return text;
      } catch (error) {
        throw error instanceof VoiceError
          ? error
          : new VoiceError("unavailable");
      } finally {
        audio?.fill(0);
      }
    },
    async synthesize(text, lang) {
      if (
        !adapters.textToSpeech.supported(lang) ||
        !text.trim() ||
        text.length > 65_536
      )
        throw new VoiceError("unavailable");
      const result = await bounded((signal) =>
        adapters.textToSpeech.synthesize({ text, lang, signal }),
      );
      if (
        !["audio/ogg", "audio/mpeg", "audio/mp4"].includes(result.mimeType) ||
        !result.audio.byteLength ||
        result.audio.byteLength > 8 * 1024 * 1024
      ) {
        result.audio.fill(0);
        throw new VoiceError("unavailable");
      }
      return result;
    },
  };
}
