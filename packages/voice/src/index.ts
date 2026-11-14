export type VoiceErrorCode =
  | "permission-denied"
  | "microphone-unavailable"
  | "no-speech"
  | "low-confidence"
  | "timeout"
  | "cancelled"
  | "unavailable";

export class VoiceError extends Error {
  readonly code: VoiceErrorCode;

  constructor(code: VoiceErrorCode) {
    super(code);
    this.name = "VoiceError";
    this.code = code;
  }
}

export interface SpeechToText {
  supported(lang: string): boolean;
  /** An on-device pack exists but is not installed; install() needs a learner action. */
  installable?(lang: string): boolean;
  install?(lang: string): Promise<boolean>;
  start(lang: string): Promise<string>;
  stop(): void;
  cancel?(): void;
  dispose?(): void;
}

export interface TextToSpeech {
  supported(lang: string): boolean;
  speak(text: string, lang: string, rate: 0.75 | 1 | 1.25): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  dispose?(): void;
}

export const MAX_RECORDING_MS = 60_000;

export { createBrowserVoiceAdapters } from "./browser.js";
export type { BrowserVoiceAdapters, BrowserVoiceLanguage } from "./browser.js";
export { createFileVoiceAdapters } from "./file.js";
export type {
  FileSpeechToText,
  FileTextToSpeech,
  FileVoiceAdapters,
} from "./file.js";
