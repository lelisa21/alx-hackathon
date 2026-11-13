import { VoiceError } from "./index.js";

/** File-based P04 ports for server channels. Browser microphone/speaker adapters
 * cannot implement these ports and are never silently advertised as capable. */
export interface FileSpeechToText {
  supported(lang: string): boolean;
  transcribe(input: {
    audio: Uint8Array;
    mimeType: string;
    lang: string;
    signal: AbortSignal;
  }): Promise<string>;
}
export interface FileTextToSpeech {
  supported(lang: string): boolean;
  synthesize(input: {
    text: string;
    lang: string;
    signal: AbortSignal;
  }): Promise<{ audio: Uint8Array; mimeType: string }>;
}
export interface FileVoiceAdapters {
  speechToText: FileSpeechToText;
  textToSpeech: FileTextToSpeech;
}

export function createFileVoiceAdapters(
  adapters: Partial<FileVoiceAdapters> = {},
): FileVoiceAdapters {
  return {
    speechToText: adapters.speechToText ?? {
      supported: () => false,
      transcribe: async () => {
        throw new VoiceError("unavailable");
      },
    },
    textToSpeech: adapters.textToSpeech ?? {
      supported: () => false,
      synthesize: async () => {
        throw new VoiceError("unavailable");
      },
    },
  };
}
