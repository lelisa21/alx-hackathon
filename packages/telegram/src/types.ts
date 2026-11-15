import type { Pool } from "pg";
import type { JobsService, PublicJob } from "@dimts/jobs";
import type { TelegramTransport } from "./transport.js";
import type { TelegramVoice } from "./voice.js";
import type { TelegramStore } from "./store.js";
export interface TelegramSession {
  id: string;
  lang: string;
}
export interface TelegramServiceOptions {
  pool?: Pool;
  revocationPool?: Pool;
  store?: TelegramStore;
  hashKey: Buffer;
  encryptionKey: Buffer;
  transport: TelegramTransport;
  languages: readonly { code: string; label: string }[];
  locales(lang: string): Record<string, string>;
  sessions: {
    ensure(input: {
      contactHash: string;
      lang: string;
    }): Promise<TelegramSession>;
    setLanguage(sessionId: string, lang: string): Promise<void>;
    delete(sessionId: string): Promise<void>;
  };
  ask(input: {
    sessionId: string;
    lang: string;
    text: string;
    clientMsgId: string;
    simple: boolean;
  }): Promise<{ text: string; citations: { label: string; url: string }[] }>;
  renderJobs?(input: { lang: string; jobs: PublicJob[] }): string;
  jobs?: Pick<
    JobsService,
    "listJobs" | "listSubscriptions" | "subscribe" | "stopContact"
  >;
  help?: {
    stopSession?(sessionId: string): Promise<void>;
    start(input: { sessionId: string; chatId: string }): Promise<string>;
    relay(input: {
      sessionId: string;
      chatId: string;
      requestId: string;
      text: string;
      key: string;
    }): Promise<boolean>;
    end(input: { sessionId: string; requestId: string }): Promise<void>;
    bind?(input: {
      sessionId: string;
      chatId: string;
      requestId: string;
    }): Promise<void>;
  };
  voice?: TelegramVoice;
  /** The voice adapter sends audio to a remote service: ask first, once. */
  voiceConsentRequired?: boolean;
  now?: () => Date;
  perMinuteLimit?: number;
}
export interface TelegramPrivateState {
  simple?: boolean;
  readAloud?: boolean;
  step:
    | "ready"
    | "jobs_type"
    | "jobs_region"
    | "jobs_language"
    | "jobs_review"
    | "jobs_consent"
    | "jobs_confirm"
    | "delete_confirm";
  jobType?: string;
  region?: string;
  jobLang?: string;
  flowId?: number;
  voice?: { text: string; id: number; expiresAt: number };
  /** The learner allowed remote transcription of their voice notes. */
  cloudVoice?: boolean;
  /** A voice note waiting for that permission (file reference only). */
  voiceFile?: {
    id: number;
    fileId: string;
    duration: number;
    fileSize?: number;
    mimeType?: string;
    expiresAt: number;
  };
  helpRequestId?: string;
}
export interface TelegramRecord {
  contactHash: string;
  sessionId: string | null;
  lang: string;
  stopped: boolean;
  lastUpdate: number;
  replayCutoff?: number;
  windowAt: number;
  windowCount: number;
  expiresAt: number;
  state: TelegramPrivateState;
}
