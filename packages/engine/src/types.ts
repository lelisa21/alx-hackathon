export type Lang = string;
export type SourceType = "course" | "job";
export type ReplyKind =
  "answer" | "notfound" | "escalation" | "distress" | "system";
export type ProviderName = string;

export interface AskRequest {
  sessionId: string;
  clientMsgId: string;
  lang: Lang;
  text: string;
  via: "text" | "voice" | "sms" | "telegram";
  simple?: boolean;
}

export interface Passage {
  id: string;
  text: string;
  label: string;
  url: string;
  lang: Lang;
  sourceType: SourceType;
  timestamp?: number;
}

export interface ScoredPassage extends Passage {
  score: number;
}

export interface LanguageDetection {
  language: Lang;
  confidence: number;
  alternatives: { language: Lang; confidence: number }[];
}

export interface LanguageDetector {
  detect(text: string): Promise<LanguageDetection | null>;
}

export interface Citation {
  passageId: string;
  label: string;
  url: string;
  sourceLang: Lang;
  sourceType: SourceType;
  timestamp?: number;
}

export interface Action {
  type:
    "help" | "more" | "open_source" | "subscribe_jobs" | "language" | "retry";
  label: string;
}

export interface Reply {
  id: string;
  kind: ReplyKind;
  text: string;
  lang: Lang;
  dir: "ltr" | "rtl";
  citations: Citation[];
  actions: Action[];
  contentVersion: string;
}

export interface AnswerRequest {
  question: string;
  lang: Lang;
  passages: Passage[];
  glossary: { term: string; meaning: string }[];
  simple: boolean;
  mode: "generative" | "extractive";
  systemPrompt: string;
}

export interface AnswerResult {
  text: string;
  usedPassageIds: string[];
  provider: ProviderName;
  latencyMs: number;
}

export interface AnswerPolicy {
  cloudOk: boolean;
}

export interface ConversationSignals {
  recentReplyKinds(sessionId: string): Promise<ReplyKind[]>;
  consecutiveNegativeFeedback(sessionId: string): Promise<number>;
  resetNegativeFeedback?(sessionId: string): Promise<void>;
}

export interface RuleSet {
  escalation: string[];
  distress: string[];
}

export interface AskDependencies {
  search(question: string, lang: Lang): Promise<ScoredPassage[]>;
  answer(request: AnswerRequest, policy: AnswerPolicy): Promise<AnswerResult>;
  glossaryFor(
    question: string,
    lang: Lang,
  ): { term: string; meaning: string }[];
  systemPrompt(lang: Lang): string;
  modeFor(lang: Lang): "generative" | "extractive";
  confidenceFloor(lang: Lang): number;
  /**
   * Lower retrieval floor used when an AI provider that can judge relevance is
   * eligible for this request; undefined keeps the strict confidence floor.
   */
  recallFloor?(lang: Lang, policy: AnswerPolicy): number | undefined;
  translate(
    lang: Lang,
    key: string,
    vars?: Record<string, string | number>,
  ): string;
  direction(lang: Lang): "ltr" | "rtl";
  rulesFor?(lang: Lang): RuleSet;
  supportTextFor?(lang: Lang): string;
  conversationSignals?: ConversationSignals;
  answerCache?: import("./cache.js").AnswerCache;
  cacheEvent?(event: { result: "hit" | "miss" }): void;
  languageDetector?: LanguageDetector;
  languageDetectionConfidence?: number;
  contentVersion(): string | Promise<string>;
  createId(): string;
}
