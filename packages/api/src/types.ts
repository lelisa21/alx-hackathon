import type { ApiConfig } from "./config.js";
import type { LangPack } from "@dimts/locales-tools";
import type { ReplySchema } from "./schemas.js";
import type { InsightsRepository } from "@dimts/insights";
import type { z } from "zod";

export type ApiReply = z.infer<typeof ReplySchema>;

export interface NewSession {
  id: string;
  channel: "web" | "api" | "sms" | "telegram" | "lti";
  lang: string;
  tokenHash?: string;
  token?: string;
  resumeHash?: string;
  cloudOk?: boolean;
  consentVersion?: string | null;
  expiresAt?: Date;
  ltiContext?: {
    issuer: string;
    platformId: string;
    deploymentId: string;
    ltiUserId: string;
    roles: string[];
    contextId?: string;
    insightsAccess: boolean;
    timestamp: number;
  };
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
  runRetention(retentionHours: number): Promise<void>;
  getHostByHash(keyHash: string): Promise<{ origins: string[] } | null>;
  verifyHostKey(key: string): Promise<{ id: string; name: string } | null>;
  getInsightsRepository?(): InsightsRepository | undefined;
  createSession(session: NewSession): Promise<void>;
  resumeSession(session: {
    id: string;
    currentResumeHash: string;
    tokenHash: string;
    resumeHash: string;
    cloudOk?: boolean;
    consentVersion?: string | null;
  }): Promise<{
    id: string;
    lang: string;
    cloudOk: boolean;
    consentVersion: string | null;
  } | null>;
  getCloudConsent(
    sessionId: string,
  ): Promise<{ cloudOk: boolean; consentVersion: string | null } | null>;
  getSessionTokenHash(sessionId: string): Promise<string | null>;
  getSessionDetails?(
    sessionId: string,
  ): Promise<{
    id: string;
    channel: string;
    ltiContext?: NewSession["ltiContext"];
  } | null>;
  touchSession(sessionId: string): Promise<void>;
  // LTI P10 nonce/state/replay prevention
  storeLtiState?(
    state: string,
    platformId: string,
    nonce: string,
    expiresAt: Date,
  ): Promise<void>;
  getLtiStateAndNonce?(
    state: string,
  ): Promise<{ platformId: string; nonce: string } | null>;
  deleteLtiState?(state: string): Promise<void>;
  checkAndMarkNonceUsed?(
    nonce: string,
    sessionId: string,
  ): Promise<boolean>;
  checkAndMarkTokenReplayed?(
    tokenHash: string,
    platformId: string,
    sessionId: string,
  ): Promise<boolean>;
  findReply(sessionId: string, clientMsgId: string): Promise<ApiReply | null>;
  countRecentQuestions(sessionId: string): Promise<number>;
  claimQuestion(question: ClaimedQuestion): Promise<boolean>;
  saveReply(reply: SavedReply): Promise<void>;
  releaseQuestion(sessionId: string, clientMsgId: string): Promise<void>;
}

export interface HelpAuthStore {
  findActiveHelperByTokenHash(
    tokenHash: string,
  ): Promise<{ id: string } | null>;
  isHelperActive(helperId: string): Promise<boolean>;
  claimWaitingRequest(requestId: string, helperId: string): Promise<boolean>;
}

export interface HelpQueueRequest {
  id: string;
  lang: string;
  channel: "web" | "api" | "telegram";
  createdAt: string;
  summary: string[] | null;
}

export type HelpCloseActor =
  { role: "learner"; sessionId: string } | { role: "helper"; helperId: string };

export interface HelpImageMetadata {
  id: string;
  expiresAt: string;
}
export interface HelpMetrics {
  closedCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  totalWaitMs: number;
  totalResolutionMs: number;
}

export interface HelpStore extends HelpAuthStore {
  createRequest(
    sessionId: string,
    includeSummary: boolean,
  ): Promise<{ id: string; status: "waiting" } | null>;
  listWaitingRequests(
    helperId: string,
    lang?: string,
  ): Promise<HelpQueueRequest[]>;
  blockWaitingRequest(requestId: string, helperId: string): Promise<boolean>;
  closeRequest(
    requestId: string,
    actor: HelpCloseActor,
    resolved?: boolean,
  ): Promise<boolean>;
  authorizeRequest?(
    requestId: string,
    actor: HelpCloseActor,
    claimedOnly: boolean,
  ): Promise<boolean>;
  getHelperProfile?(helperId: string): Promise<{ displayName: string | null }>;
  setHelperProfile?(
    helperId: string,
    displayName: string | null,
  ): Promise<{ displayName: string | null }>;
  getMetrics?(): Promise<HelpMetrics>;
  saveImage?(
    requestId: string,
    sessionId: string,
    mime: string,
    data: Buffer,
  ): Promise<HelpImageMetadata | null>;
  listImages?(
    requestId: string,
    actor: HelpCloseActor,
  ): Promise<HelpImageMetadata[]>;
  getImage?(
    requestId: string,
    imageId: string,
    actor: HelpCloseActor,
  ): Promise<{ mime: string; data: Buffer } | null>;
  deleteExpiredImages?(): Promise<void>;
}

export interface AppDependencies {
  config: ApiConfig;
  repository: ApiRepository;
  packs: Map<string, LangPack>;
}
