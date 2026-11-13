import {
  createBrowserVoiceAdapters,
  MAX_RECORDING_MS,
  VoiceError,
} from "@dimts/voice";
import type { SpeechToText, TextToSpeech } from "@dimts/voice";
import type { WidgetSettings } from "./index.js";

export interface VoiceContext {
  speechToText: SpeechToText | undefined;
  textToSpeech: TextToSpeech | undefined;
  selectedLang: string;
  notice: string;
  draft: string;
  settings: WidgetSettings;
  isRecording: boolean;
  speechReview: boolean;
  speakingMessageId: string | null;
  speechPaused: boolean;
  noticeIsError: boolean;
  speechRun: number;
  recordingRun: number;
  recordingStopRequested: boolean;
  recordingCueActive: boolean;
  recordingTimer: number | undefined;
  audioContext: AudioContext | undefined;
  t(key: string, values?: Record<string, string | number>): string;
  canSpeak(lang: string): boolean;
  canRecord(lang?: string): boolean;
  speak(text: string, lang: string, id: string): Promise<void>;
  finishRecording(
    adapter: SpeechToText,
    lang: string,
    run: number,
  ): Promise<void>;
  stopRecording(): void;
  startRecordingCue(): void;
  stopRecordingCue(): void;
  playTone(frequency: number): void;
  vibrate(pattern: number | number[]): void;
  stopSpeech(): void;
}

export const voiceRuntime = {
  createBrowserAdapters: createBrowserVoiceAdapters,
  async speak(
    this: VoiceContext,
    text: string,
    lang: string,
    id: string,
  ): Promise<void> {
    const adapter = this.textToSpeech;
    if (!adapter || !this.canSpeak(lang)) return;
    this.stopSpeech();
    const run = ++this.speechRun;
    this.speakingMessageId = id;
    this.speechPaused = false;
    try {
      await adapter.speak(text, lang, this.settings.speechRate);
    } catch (error) {
      if (run === this.speechRun) {
        if (error instanceof VoiceError && error.code === "cancelled") return;
        this.notice = this.t(
          error instanceof VoiceError && error.code === "timeout"
            ? "voice.timeout"
            : "voice.outputFailed",
        );
        this.noticeIsError = true;
      }
    } finally {
      if (run === this.speechRun) {
        this.speakingMessageId = null;
        this.speechPaused = false;
      }
    }
  },

  startRecording(this: VoiceContext): void {
    const adapter = this.speechToText;
    const lang = this.selectedLang;
    if (!adapter || !this.canRecord(lang) || this.isRecording) return;

    this.stopSpeech();
    this.notice = "";
    this.noticeIsError = false;
    this.speechReview = false;
    this.isRecording = true;
    this.recordingStopRequested = false;
    this.startRecordingCue();
    const run = ++this.recordingRun;
    this.recordingTimer = window.setTimeout(
      () => this.stopRecording(),
      MAX_RECORDING_MS,
    );
    void this.finishRecording(adapter, lang, run);
  },

  async finishRecording(
    this: VoiceContext,
    adapter: SpeechToText,
    lang: string,
    run: number,
  ): Promise<void> {
    try {
      const transcript = (await adapter.start(lang)).trim();
      if (run !== this.recordingRun) return;
      this.speechReview = transcript.length > 0;
      if (transcript.length === 0) {
        this.notice = this.t("voice.retry");
        this.noticeIsError = true;
        if (this.canSpeak(lang)) {
          void this.speak(this.notice, lang, "voice-retry");
        }
      } else {
        this.draft = transcript;
        if (this.canSpeak(lang)) void this.speak(transcript, lang, "review");
      }
    } catch (error) {
      if (run !== this.recordingRun) return;
      const code =
        error instanceof VoiceError
          ? error.code
          : typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined;
      if (code === "cancelled") return;
      if (code === "permission-denied") {
        this.notice = this.t("voice.permissionDenied");
      } else if (code === "microphone-unavailable") {
        this.notice = this.t("voice.microphoneUnavailable");
      } else {
        this.notice = this.t(
          code === "low-confidence"
            ? "voice.lowConfidence"
            : code === "timeout"
              ? "voice.timeout"
              : "voice.retry",
        );
        if (this.canSpeak(lang)) {
          void this.speak(this.notice, lang, "voice-retry");
        }
      }
      this.noticeIsError = true;
    } finally {
      if (run === this.recordingRun) {
        this.stopRecordingCue();
        if (this.recordingTimer !== undefined) {
          window.clearTimeout(this.recordingTimer);
          this.recordingTimer = undefined;
        }
        this.isRecording = false;
        this.recordingStopRequested = false;
      }
    }
  },

  stopRecording(this: VoiceContext): void {
    if (!this.isRecording || this.recordingStopRequested) return;
    this.recordingStopRequested = true;
    this.stopRecordingCue();
    if (this.recordingTimer !== undefined) {
      window.clearTimeout(this.recordingTimer);
      this.recordingTimer = undefined;
    }
    try {
      this.speechToText?.stop();
    } catch {
      this.recordingRun += 1;
      this.notice = this.t("voice.retry");
      this.noticeIsError = true;
      this.isRecording = false;
      this.recordingStopRequested = false;
    }
  },

  startRecordingCue(this: VoiceContext): void {
    this.recordingCueActive = true;
    this.playTone(660);
    this.vibrate(30);
  },

  stopRecordingCue(this: VoiceContext): void {
    if (!this.recordingCueActive) return;
    this.recordingCueActive = false;
    this.playTone(440);
    this.vibrate([30, 40, 30]);
  },

  playTone(this: VoiceContext, frequency: number): void {
    if (!this.settings.soundCues) return;
    const AudioContextConstructor = window.AudioContext;
    if (typeof AudioContextConstructor !== "function") return;
    try {
      if (!this.audioContext || this.audioContext.state === "closed") {
        this.audioContext = new AudioContextConstructor();
      }

      const context = this.audioContext;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.04, now);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.08);
    } catch {
      // Recording state remains visible when the browser cannot play a cue.
    }
  },

  vibrate(this: VoiceContext, pattern: number | number[]): void {
    if (
      this.settings.stopMotion ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof navigator.vibrate !== "function"
    ) {
      return;
    }
    try {
      navigator.vibrate(pattern);
    } catch {
      // Haptics are a redundant cue, never a prerequisite for recording.
    }
  },

  pauseSpeech(this: VoiceContext): void {
    if (!this.speakingMessageId || this.speechPaused) return;
    try {
      this.textToSpeech?.pause();
      this.speechPaused = true;
    } catch {
      this.notice = this.t("voice.outputFailed");
      this.noticeIsError = true;
    }
  },

  resumeSpeech(this: VoiceContext): void {
    if (!this.speakingMessageId || !this.speechPaused) return;
    try {
      this.textToSpeech?.resume();
      this.speechPaused = false;
    } catch {
      this.notice = this.t("voice.outputFailed");
      this.noticeIsError = true;
    }
  },

  stopSpeech(this: VoiceContext): void {
    if (!this.speakingMessageId) return;
    this.speechRun += 1;
    this.speakingMessageId = null;
    this.speechPaused = false;
    try {
      this.textToSpeech?.stop();
    } catch {
      this.notice = this.t("voice.outputFailed");
      this.noticeIsError = true;
    }
  },
};
