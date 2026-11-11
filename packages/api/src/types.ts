import type { ApiConfig } from "./config.js";
import type { LangPack } from "@dimts/locales-tools";
import type { ReplySchema } from "./schemas.js";
import type { z } from "zod";

export type ApiReply = z.infer<typeof ReplySchema>;

export interface NewSession {
  id: string;
  channel: "web" | "api";
  lang: string;
  tokenHash: string;
  resumeHash: string;
}

export interface ClaimedQuestion {
  sessionId: string;
  clientMsgId: string;
  text: string;
  lang: string;
}

export interface SavedReply {
  sessionId: string;
  clientMsgId: string;
  reply: ApiReply;
}

export interface ApiRepository {
  ping(): Promise<boolean>;
  getHostByHash(keyHash: string): Promise<{ origins: string[] } | null>;
  createSession(session: NewSession): Promise<void>;
  resumeSession(session: {
    id: string;
    currentResumeHash: string;
    tokenHash: string;
    resumeHash: string;
  }): Promise<{ id: string; lang: string } | null>;
  getSessionTokenHash(sessionId: string): Promise<string | null>;
  touchSession(sessionId: string): Promise<void>;
  findReply(sessionId: string, clientMsgId: string): Promise<ApiReply | null>;
  countRecentQuestions(sessionId: string): Promise<number>;
  claimQuestion(question: ClaimedQuestion): Promise<boolean>;
  saveReply(reply: SavedReply): Promise<void>;
  releaseQuestion(sessionId: string, clientMsgId: string): Promise<void>;
}

export interface AppDependencies {
  config: ApiConfig;
  repository: ApiRepository;
  packs: Map<string, LangPack>;
}
