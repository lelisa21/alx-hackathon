export type VoiceErrorCode =
  | "permission-denied"
  | "microphone-unavailable"
  | "no-speech"
  | "low-confidence"
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
  start(lang: string): Promise<string>;
  stop(): void;
}

export interface TextToSpeech {
  supported(lang: string): boolean;
  speak(text: string, lang: string, rate: 0.75 | 1 | 1.25): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

export const MAX_RECORDING_MS = 60_000;
