export type Lang = string;
export type SourceType = "course" | "job";
export type ReplyKind =
  "answer" | "notfound" | "escalation" | "distress" | "system";
export type ProviderName = "cloud" | "local" | "offline";

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
  provider?: ProviderName;
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

export interface AiProvider {
  name: ProviderName;
  health(): Promise<{ ok: boolean; reason?: string }>;
  answer(request: AnswerRequest, signal: AbortSignal): Promise<AnswerResult>;
}

export interface AskDependencies {
  search(question: string, lang: Lang): Promise<ScoredPassage[]>;
  answer(request: AnswerRequest): Promise<AnswerResult>;
  glossaryFor(
    question: string,
    lang: Lang,
  ): { term: string; meaning: string }[];
  systemPrompt(lang: Lang): string;
  modeFor(lang: Lang): "generative" | "extractive";
  confidenceFloor(lang: Lang): number;
  translate(lang: Lang, key: string): string;
  direction(lang: Lang): "ltr" | "rtl";
  contentVersion(): string | Promise<string>;
  createId(): string;
}
