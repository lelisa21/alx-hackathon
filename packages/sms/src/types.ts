import type { Pool } from "pg";
import type { SubscriptionInput } from "@dimts/jobs";
import type { SmsGateway, SmsDeliveryStatus } from "./gateway.js";
import type { SmsStore } from "./store.js";

export interface SmsInbound {
  id: string;
  from: string;
  text: string;
}
export interface SmsMessage {
  id: string;
  text: string;
  encoding: "gsm7" | "ucs2";
  units: number;
  segments: number;
  status: SmsDeliveryStatus;
}
export interface SmsInboundResult {
  messages: SmsMessage[];
  stopped: boolean;
  lang: string;
}
export interface SmsLocale {
  strings: Record<string, string>;
  keywords: Record<string, string[]>;
}
export interface SmsServiceOptions {
  pool?: Pool;
  revocationPool?: Pool;
  store?: SmsStore;
  hashKey: Buffer;
  encryptionKey: Buffer;
  gateway: SmsGateway;
  locales(lang: string): SmsLocale;
  sessions: {
    create(lang: string): Promise<string>;
    setLanguage(sessionId: string, lang: string): Promise<void>;
    delete(sessionId: string): Promise<void>;
  };
  ask(input: {
    sessionId: string;
    lang: string;
    text: string;
    clientMsgId: string;
  }): Promise<string>;
  jobs?: {
    subscribe(
      input: SubscriptionInput,
    ): Promise<{ id: string; status: "active" | "stopped" }>;
    stopContact(contact: string): Promise<void>;
  };
  /** The host must deduplicate idempotencyKey before accepting the transient contact. */
  callback?:
    | ((input: {
        from: string;
        sessionId: string;
        lang: string;
        idempotencyKey: string;
      }) => Promise<void>)
    | undefined;
  dailyLimit?: number;
  now?: () => Date;
}

export interface SmsAction {
  kind: "reply" | "ask" | "callback" | "subscribe" | "language" | "unsubscribe";
  lang: string;
  text?: string;
  jobType?: string;
  region?: string;
}
export interface SmsReceipt {
  fingerprint: string;
  createdAt: number;
  action: SmsAction | null;
  messageIds: string[];
  completed: boolean;
  outcome?: SmsDeliveryStatus;
}
export interface SmsOutbox extends SmsMessage {
  lang: string;
  attempts: number;
  createdAt: number;
  gatewayId?: string;
}
export interface SmsPrivateState {
  step:
    | "language"
    | "ready"
    | "callback"
    | "jobs_manage"
    | "jobs_type"
    | "jobs_region"
    | "jobs_language"
    | "jobs_consent";
  jobType?: string;
  region?: string;
  jobLang?: string;
  continuation?: { sessionId: string; pages: string[]; expiresAt: number };
  receipts: Record<string, SmsReceipt>;
  outbox: SmsOutbox[];
}
export interface SmsRecord {
  phoneHash: string;
  sessionId: string | null;
  lang: string;
  stopped: boolean;
  stopDelivery: SmsOutbox | null;
  day: string;
  count: number;
  windowAt: number;
  windowCount: number;
  state: SmsPrivateState;
}
