import { LitElement, css, html, nothing } from "lit";
import { messageFor } from "./messages.js";
import bootstrapUi from "virtual:dimts-bootstrap-ui";
import { applyThemeGuard } from "./theme.js";
import { clearFaqCache, loadFaq } from "./faq.js";
import { ownsWorkerRegistration } from "./worker-ownership.js";
import type { FaqItem } from "./faq.js";
import type { VoiceContext } from "./voice-runtime.js";
import type { HelpContext } from "./help-runtime.js";
import type { CareerContext } from "./career-runtime.js";
import { installDefaultApi } from "./public-api.js";
import type { SpeechToText, TextToSpeech } from "@dimts/voice";
import { suggestLanguageOptions } from "./language.js";
import {
  hasTransliteration,
  suggestTransliteration,
} from "./transliteration.js";
import ethiopicRegularFontUrl from "../../../assets/fonts/NotoSansEthiopic-ethiopic-400-normal.woff2?url&no-inline";
let ethiopicFont: FontFace | undefined;
const ethiopicFontUsers = new Set<HTMLElement>();
const activeWidgets = new Set<DimtsAssistant>();

function registerEthiopicFonts(widget: HTMLElement): void {
  ethiopicFontUsers.add(widget);
  if (ethiopicFont) return;
  ethiopicFont = new FontFace(
    "Noto Sans Ethiopic",
    `url(${ethiopicRegularFontUrl})`,
    {
      display: "swap",
      weight: "400",
      unicodeRange: "U+1200-137F, U+1380-139F",
    },
  );
  document.fonts.add(ethiopicFont);
}

function releaseEthiopicFont(widget: HTMLElement): void {
  ethiopicFontUsers.delete(widget);
  if (!ethiopicFontUsers.size && ethiopicFont) {
    document.fonts.delete(ethiopicFont);
    ethiopicFont = undefined;
  }
}

export interface Language {
  code: string;
  nameNative: string;
  nameEn: string;
  script: string;
  dir: "ltr" | "rtl";
  status: "live" | "beta" | "draft";
  stt: boolean;
  tts: boolean;
  voice: { engine: "browser"; bcp_tag: string } | null;
}

interface Citation {
  label: string;
  url: string;
}

interface Reply {
  id: string;
  kind: string;
  text: string;
  lang: string;
  dir: "ltr" | "rtl";
  citations: Citation[];
  actions: { type: string; label: string }[];
}

export interface ConversationMessage {
  id: string;
  role: "learner" | "assistant";
  text: string;
  lang: string;
  dir: "ltr" | "rtl";
  citations: Citation[];
}

export interface HelpChatMessage {
  id: string;
  from: "learner" | "helper";
  text: string;
}

export interface WidgetSettings {
  textScale: 100 | 150 | 200;
  highContrast: boolean;
  stopMotion: boolean;
  simple: boolean;
  dataSaver: boolean;
  readAloud: "off" | "ask" | "always";
  speechRate: 0.75 | 1 | 1.25;
  soundCues: boolean;
  shortcuts: boolean;
}

const defaultSettings: WidgetSettings = {
  textScale: 100,
  highContrast: false,
  stopMotion: false,
  simple: false,
  dataSaver: false,
  readAloud: "off",
  speechRate: 1,
  soundCues: true,
  shortcuts: true,
};

const storage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      return;
    }
  },
};

export class DimtsAssistant extends LitElement {
  static override get observedAttributes(): string[] {
    return [...super.observedAttributes, "hidden"];
  }

  static override properties = {
    api: { attribute: "data-api" },
    hostKey: { attribute: "data-host-key" },
    speechToText: { attribute: false },
    textToSpeech: { attribute: false },
    languages: { state: true },
    selectedLang: { state: true },
    ui: { state: true },
    messages: { state: true },
    sessionId: { state: true },
    sessionToken: { state: true },
    loading: { state: true },
    voiceInstall: { state: true },
    cloudVoiceAsk: { state: true },
    offline: { state: true },
    offlineSupportAvailable: { state: true },
    busy: { state: true },
    retryAvailable: { state: true },
    panel: { state: true },
    notice: { state: true },
    fallbackNotice: { state: true },
    draft: { state: true },
    transliterationEnabled: { state: true },
    transliterationSuggestion: { state: true },
    settings: { state: true },
    isRecording: { state: true },
    recordingStopRequested: { state: true },
    speechReview: { state: true },
    speakingMessageId: { state: true },
    speechPaused: { state: true },
    noticeIsError: { state: true },
    helpPreviewOpen: { state: true },
    helpIncludeSummary: { state: true },
    helpRequestId: { state: true },
    helpMessages: { state: true },
    helpDraft: { state: true },
    helpBusy: { state: true },
    helpStatus: { state: true },
    helpNotice: { state: true },
    helpNoticeIsError: { state: true },
    helpAnnouncement: { state: true },
    cloudOk: { state: true },
    consentBusy: { state: true },
    consentFailed: { state: true },
    consentNotice: { state: true },
    deleteConfirmOpen: { state: true },
    deletingData: { state: true },
    deleteDataNotice: { state: true },
    faqState: { state: true },
    faqItems: { state: true },
    courseQuestions: { state: true },
    faqCached: { state: true },
    feedback: { state: true },
    startingSession: { state: true },
    slowRequest: { state: true },
  };

  declare api: string;
  declare hostKey: string;
  declare speechToText: SpeechToText | undefined;
  declare textToSpeech: TextToSpeech | undefined;
  declare private languages: Language[];
  declare private selectedLang: string;
  declare private ui: Record<string, unknown>;
  declare private messages: ConversationMessage[];
  declare private sessionId: string;
  declare private sessionToken: string;
  declare private loading: boolean;
  declare private voiceInstall: "idle" | "installing" | "failed";
  /** Asking the learner to allow cloud voice for this session. */
  declare private cloudVoiceAsk: boolean;
  private cloudVoiceOk = false;
  private cloudVoiceAnswer: ((allowed: boolean) => void) | undefined;
  private cloudVoiceLangs: string[] = [];
  /** Set by an explicit voice action; automatic speech never asks for consent. */
  private voiceIntent = false;
  declare private offline: boolean;
  declare private offlineSupportAvailable: boolean;
  declare private busy: boolean;
  declare private retryAvailable: boolean;
  declare private panel: "language" | "settings" | "faq" | null;
  declare private notice: string;
  declare private fallbackNotice: string;
  private fallbackAnnounced = false;
  private fallbackPending = false;
  declare private draft: string;
  declare private transliterationEnabled: boolean;
  declare private transliterationSuggestion: string | null;
  declare private settings: WidgetSettings;
  declare private isRecording: boolean;
  declare private speechReview: boolean;
  declare private speakingMessageId: string | null;
  declare private speechPaused: boolean;
  declare private noticeIsError: boolean;
  declare private helpPreviewOpen: boolean;
  declare private helpIncludeSummary: boolean;
  declare private helpRequestId: string;
  declare private helpMessages: HelpChatMessage[];
  declare private helpDraft: string;
  declare private helpBusy: boolean;
  declare private helpStatus: "connecting" | "connected" | "reconnecting" | "";
  declare private helpNotice: string;
  declare private helpNoticeIsError: boolean;
  declare private helpAnnouncement: string;
  private recordingTimer: number | undefined;
  declare private recordingStopRequested: boolean;
  private recordingRun = 0;
  private recordingCueActive = false;
  private speechRun = 0;
  private speechRequest = 0;
  private browserVoiceRun = 0;
  private browserVoice:
    | Awaited<
        ReturnType<typeof import("@dimts/voice").createBrowserVoiceAdapters>
      >
    | undefined;
  private audioContext: AudioContext | undefined;
  private helpSocket: WebSocket | undefined;
  private helpReconnectTimer: number | undefined;
  private helpReconnectAttempt = 0;
  declare private cloudOk: boolean;
  declare private consentBusy: boolean;
  declare private consentFailed: boolean;
  declare private consentNotice: string;
  declare private deleteConfirmOpen: boolean;
  declare private deletingData: boolean;
  declare private deleteDataNotice: string;
  declare private faqState: "idle" | "loading" | "ready" | "failed";
  /** Questions the course answers, shown when no reviewed FAQ exists yet. */
  declare private courseQuestions: string[];
  declare private faqItems: FaqItem[];
  declare private faqCached: boolean;
  declare private feedback: Record<string, boolean>;
  declare private startingSession: boolean;
  declare private slowRequest: boolean;
  private resumeToken = "";
  private sessionGeneration = 0;
  private sessionRestartPending = false;
  private sessionPromise: Promise<void> | undefined;
  private initializationPromise: Promise<void> | undefined;
  private askPromise: Promise<void> | undefined;
  private askController: AbortController | undefined;
  private pendingQuestion:
    | {
        text: string;
        lang: string;
        simple: boolean;
        clientMsgId: string;
        via: "text" | "voice";
      }
    | undefined;
  private consentPromise: Promise<void> | undefined;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private workingTimer: ReturnType<typeof setTimeout> | undefined;
  private disposeTheme: (() => void) | undefined;
  private faqRun = 0;
  private faqController: AbortController | undefined;
  private lifecycleController = new AbortController();
  private sessionTimer: ReturnType<typeof setTimeout> | undefined;
  private ownedWorker: ServiceWorkerRegistration | undefined;
  private uiLang = "en";
  private helpSizeObserver: ResizeObserver | undefined;
  private observedHelp: Element | undefined;

  get uiLanguage(): string {
    return this.uiLang;
  }

  get uiDirection(): "ltr" | "rtl" {
    return (
      this.languages.find((language) => language.code === this.uiLang)?.dir ??
      "ltr"
    );
  }

  private async request(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const signal = init.signal
      ? AbortSignal.any([this.lifecycleController.signal, init.signal])
      : this.lifecycleController.signal;
    const response = await fetch(url, { ...init, credentials: "omit", signal });
    signal.throwIfAborted();
    return response;
  }
  private voiceModule:
    typeof import("./voice-runtime.js").voiceRuntime | undefined;
  private helpModule:
    typeof import("./help-runtime.js").helpRuntime | undefined;
  private careerModule:
    typeof import("./career-runtime.js").careerRuntime | undefined;
  private careerContinuity = false;

  private get careerSessionKey(): string {
    return `dimts.career-session.${this.apiRoot}.${this.hostKey}`;
  }

  private rememberCareerSession(clear = false): void {
    try {
      if (clear) sessionStorage.removeItem(this.careerSessionKey);
      else if (this.careerContinuity && this.sessionId && this.resumeToken)
        sessionStorage.setItem(
          this.careerSessionKey,
          JSON.stringify({
            sessionId: this.sessionId,
            resumeToken: this.resumeToken,
          }),
        );
    } catch {
      /* Per-tab persistence is optional. */
    }
  }

  private async openCareer(): Promise<void> {
    this.cancelRecording();
    this.stopSpeech();
    this.careerContinuity = true;
    this.rememberCareerSession();
    const generation = this.sessionGeneration;
    try {
      this.careerModule ??= (await import("./career-runtime.js")).careerRuntime;
      if (
        generation === this.sessionGeneration &&
        this.isConnected &&
        !this.hidden
      )
        await this.careerModule.open.call(this as unknown as CareerContext);
    } catch {
      if (generation === this.sessionGeneration) {
        this.notice = this.t("jobs.failed");
        this.noticeIsError = true;
      }
    }
  }

  private async loadVoice() {
    return (this.voiceModule ??= (
      await import("./voice-runtime.js")
    ).voiceRuntime);
  }

  private async configureBrowserVoice(): Promise<void> {
    const run = ++this.browserVoiceRun;
    this.disposeBrowserVoice();
    const deviceVoice = this.languages.some(
      (language) => language.voice && (language.stt || language.tts),
    );
    // Cloud speech covers languages this device cannot recognise or speak.
    const cloud = (await this.request(`${this.apiRoot}/voice/cloud`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)) as {
      available?: boolean;
      languages?: unknown;
    } | null;
    this.cloudVoiceLangs =
      cloud?.available === true && Array.isArray(cloud.languages)
        ? cloud.languages.filter(
            (code): code is string =>
              typeof code === "string" &&
              this.languages.some((language) => language.code === code),
          )
        : [];
    if (!deviceVoice && !this.cloudVoiceLangs.length) return;
    try {
      const runtime = await this.loadVoice();
      if (!this.isConnected || run !== this.browserVoiceRun) return;
      const device = deviceVoice
        ? await runtime.createBrowserAdapters({
            languages: this.languages.map((language) => ({
              ...language,
              voice: language.voice ?? null,
            })),
            onCapabilitiesChanged: () => {
              if (this.isConnected && run === this.browserVoiceRun)
                this.requestUpdate();
            },
          })
        : undefined;
      const remote = this.cloudVoiceLangs.length
        ? runtime.createCloudAdapters({
            languages: this.cloudVoiceLangs,
            consent: () => this.allowCloudVoice(),
            transport: {
              transcribe: async (input) =>
                String(
                  (
                    (await this.cloudVoiceCall("transcribe", input)) as {
                      text?: unknown;
                    }
                  ).text ?? "",
                ),
              synthesize: async (input) =>
                (await this.cloudVoiceCall("speak", input)) as {
                  audio: string;
                  mimeType: string;
                },
            },
          })
        : undefined;
      const adapters = remote
        ? {
            speechToText: runtime.combineSpeechToText(
              device?.speechToText,
              remote.speechToText,
            ),
            textToSpeech: runtime.combineTextToSpeech(
              device?.textToSpeech,
              remote.textToSpeech,
            ),
            dispose: () => {
              device?.dispose();
              remote.dispose();
            },
          }
        : device!;
      if (!this.isConnected || run !== this.browserVoiceRun) {
        adapters.dispose();
        return;
      }
      this.browserVoice = adapters;
      // A host can still supply either port explicitly, before or after startup.
      this.speechToText ??= adapters.speechToText;
      this.textToSpeech ??= adapters.textToSpeech;
      this.requestUpdate();
    } catch {
      // Text stays ready when device capability detection fails.
      if (this.isConnected) this.requestUpdate();
    }
  }

  /** Resolves true once the learner allows cloud voice for this session. */
  private allowCloudVoice(): Promise<boolean> {
    if (this.cloudVoiceOk) return Promise.resolve(true);
    if (!this.voiceIntent) return Promise.resolve(false);
    this.voiceIntent = false;
    this.cloudVoiceAnswer?.(false);
    this.cloudVoiceAsk = true;
    return new Promise((resolve) => {
      this.cloudVoiceAnswer = resolve;
    });
  }

  private answerCloudVoice(allowed: boolean): void {
    this.cloudVoiceOk = allowed;
    this.cloudVoiceAsk = false;
    this.courseQuestions = [];
    const answer = this.cloudVoiceAnswer;
    this.cloudVoiceAnswer = undefined;
    answer?.(allowed);
  }

  private async cloudVoiceCall(
    action: "transcribe" | "speak",
    input: object,
  ): Promise<unknown> {
    const response = await this.request(`${this.apiRoot}/voice/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.sessionToken}`,
      },
      body: JSON.stringify({
        sessionId: this.sessionId,
        consentVersion: "cloud-voice-v1",
        ...input,
      }),
    });
    if (!response.ok) throw new Error("cloud-voice");
    return response.json();
  }

  private renderCloudVoicePrompt(): unknown {
    return this.cloudVoiceAsk
      ? html`<div
          class="consent cloud-voice"
          role="group"
          aria-labelledby="cloud-voice-text"
        >
          <p id="cloud-voice-text">${this.t("voice.cloudConsent")}</p>
          <div class="header-actions">
            <button
              class="primary"
              type="button"
              lang=${this.uiLanguage}
              dir=${this.uiDirection}
              @click=${() => this.answerCloudVoice(true)}
            >
              ${this.t("voice.cloudAllow")}
            </button>
            <button
              type="button"
              lang=${this.uiLanguage}
              dir=${this.uiDirection}
              @click=${() => this.answerCloudVoice(false)}
            >
              ${this.t("voice.cloudDecline")}
            </button>
          </div>
        </div>`
      : nothing;
  }

  private disposeBrowserVoice(): void {
    const adapters = this.browserVoice;
    if (!adapters) return;
    if (this.speechToText === adapters.speechToText)
      this.speechToText = undefined;
    if (this.textToSpeech === adapters.textToSpeech)
      this.textToSpeech = undefined;
    adapters.dispose();
    this.browserVoice = undefined;
  }

  private async loadHelp() {
    return (this.helpModule ??= (
      await import("./help-runtime.js")
    ).helpRuntime);
  }

  protected override createRenderRoot(): ShadowRoot {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    // A host nonce also supports browsers without constructable stylesheets.
    const style = document.createElement("style");
    if (this.nonce) style.nonce = this.nonce;
    style.textContent = DimtsAssistant.styles.cssText;
    root.append(style);
    this.renderOptions.renderBefore = root.firstChild;
    return root;
  }

  constructor() {
    super();
    this.api = "";
    this.hostKey = "";
    this.speechToText = undefined;
    this.textToSpeech = undefined;
    this.languages = [];
    this.selectedLang = "";
    this.ui = { ...bootstrapUi };
    this.messages = [];
    this.sessionId = "";
    this.sessionToken = "";
    this.cloudVoiceAsk = false;
    this.loading = true;
    this.voiceInstall = "idle";
    this.offline = typeof navigator !== "undefined" && !navigator.onLine;
    this.offlineSupportAvailable = false;
    this.busy = false;
    this.retryAvailable = false;
    this.panel = null;
    this.notice = "";
    this.fallbackNotice = "";
    this.draft = "";
    this.transliterationEnabled = false;
    this.transliterationSuggestion = null;
    this.settings = this.readSettings();
    this.isRecording = false;
    this.recordingStopRequested = false;
    this.speechReview = false;
    this.speakingMessageId = null;
    this.speechPaused = false;
    this.noticeIsError = false;
    this.helpPreviewOpen = false;
    this.helpIncludeSummary = true;
    this.helpRequestId = "";
    this.helpMessages = [];
    this.helpDraft = "";
    this.helpBusy = false;
    this.helpStatus = "";
    this.helpNotice = "";
    this.helpNoticeIsError = false;
    this.helpAnnouncement = "";
    this.cloudOk = false;
    this.consentBusy = false;
    this.consentFailed = false;
    this.consentNotice = "";
    this.faqState = "idle";
    this.faqItems = [];
    this.faqCached = false;
    this.feedback = {};
    this.startingSession = false;
    this.slowRequest = false;
  }

  static override styles = css`
    :host {
      color: var(--dimts-text);
      display: block;
      font-family:
        var(--dimts-font-family, system-ui),
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      font-size: calc(1rem * var(--dimts-scale, 1));
      line-height: 1.5;
    }

    :host([lang="am"]) {
      font-family:
        "Noto Sans Ethiopic",
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      line-height: 1.65;
    }

    [lang="am"] {
      font-family:
        "Noto Sans Ethiopic", var(--dimts-font-family, system-ui), sans-serif;
      line-height: 1.65;
    }

    :host([hidden]) {
      display: none;
    }

    * {
      box-sizing: border-box;
    }

    button,
    input,
    textarea,
    select {
      color: inherit;
      font: inherit;
    }

    button,
    select,
    textarea,
    a {
      min-block-size: 48px;
      min-inline-size: 48px;
    }

    button,
    select {
      border: 2px solid var(--dimts-border);
      border-radius: var(--dimts-radius, 0.5rem);
      background: var(--dimts-surface);
      padding: 0.625rem 0.875rem;
    }

    button {
      cursor: pointer;
      overflow-wrap: anywhere;
    }

    button:disabled,
    select:disabled {
      cursor: not-allowed;
      border-style: dashed;
      opacity: 1;
    }

    :focus-visible {
      outline: 3px solid var(--dimts-focus);
      outline-offset: 2px;
      box-shadow: 0 0 0 2px var(--dimts-surface);
    }

    main {
      --dimts-available-height: var(
        --dimts-embed-height,
        max(6rem, calc(100dvh - var(--dimts-help-reserve, 5em) - 2rem))
      );
      background: var(--dimts-surface);
      border: var(--dimts-frame-border, 1px) solid
        color-mix(in srgb, var(--dimts-border) 40%, var(--dimts-surface));
      border-radius: var(--dimts-frame-radius, var(--dimts-radius, 1rem));
      display: flex;
      flex-direction: column;
      margin-inline: auto;
      max-inline-size: 42rem;
      min-block-size: min(32rem, var(--dimts-available-height));
      max-block-size: var(--dimts-available-height);
      overflow-y: auto;
      scroll-padding-block: 1rem;
      overflow-wrap: anywhere;
      position: relative;
      box-shadow: var(
        --dimts-frame-shadow,
        0 1px 2px rgb(0 0 0 / 8%),
        0 12px 32px rgb(0 0 0 / 14%)
      );
    }

    /* Room for the embed's close button in the top row. */
    main > .header-actions {
      padding-block-start: 0.75rem;
      padding-inline: 1rem calc(1rem + var(--dimts-close-space, 0px));
    }

    /* Header and composer stay in view while the conversation scrolls. */
    header {
      align-items: center;
      background: var(--dimts-primary);
      color: var(--dimts-primary-text);
      border-block-end: 1px solid var(--dimts-border);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      inset-block-start: 0;
      justify-content: space-between;
      padding-block: 0.625rem;
      padding-inline: 1rem calc(1rem + var(--dimts-close-space, 0px));
      position: sticky;
      z-index: 2;
    }

    header > .header-actions {
      flex-basis: 100%;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding: 0.25rem;
      margin: -0.25rem;
      scrollbar-width: thin;
    }

    header > .header-actions > *,
    header .header-actions .header-actions > * {
      flex: none;
    }

    @media (max-width: 30rem) {
      .tagline {
        display: none;
      }

      .empty-state {
        padding-block: 0.75rem;
      }

      .avatar-lg {
        block-size: 2.75rem;
        inline-size: 2.75rem;
      }
    }

    @media (max-height: 40rem) {
      header,
      .composer {
        position: static;
      }
    }

    header .header-actions .header-actions {
      display: contents;
    }

    header strong {
      font-size: 1.15em;
      letter-spacing: 0.01em;
    }

    header button {
      background: transparent;
      border-color: color-mix(
        in srgb,
        var(--dimts-primary-text) 55%,
        var(--dimts-primary)
      );
      border-radius: 999px;
      border-width: 1px;
      color: var(--dimts-primary-text);
      font-size: 0.8125em;
      padding-inline: 0.75rem;
    }

    header button:not(:disabled):hover {
      background: color-mix(
        in srgb,
        var(--dimts-primary-text) 14%,
        var(--dimts-primary)
      );
    }

    .brand {
      align-items: center;
      display: flex;
      gap: 0.625rem;
    }

    .a11y {
      display: flex;
      gap: 0.375rem;
    }

    header > .a11y {
      margin-inline-start: auto;
    }

    .a11y button {
      font-weight: 800;
      padding: 0;
      inline-size: 48px;
    }

    .a11y button[aria-pressed="true"] {
      background: var(--dimts-primary-text);
      color: var(--dimts-primary);
    }

    main > .header-actions .a11y button[aria-pressed="true"] {
      background: var(--dimts-primary);
      color: var(--dimts-primary-text);
    }

    .a11y-size::before {
      content: "A" / "";
      font-size: 0.75em;
    }

    .a11y-size::after {
      content: "A" / "";
      font-size: 1.15em;
    }

    .a11y-contrast::before {
      content: "\\25D0" / "";
      font-size: 1.3em;
    }

    .a11y-simple::before {
      content: "1\\2219 2" / "";
    }

    .brand-text,
    .empty-state {
      display: grid;
    }

    .tagline {
      font-size: 0.8em;
      opacity: 0.9;
    }

    .avatar {
      align-items: center;
      background: var(--dimts-primary);
      border-radius: 50%;
      color: var(--dimts-primary-text);
      display: inline-flex;
      flex: none;
      font-weight: 800;
      block-size: 2.25rem;
      inline-size: 2.25rem;
      justify-content: center;
    }

    header .avatar {
      background: var(--dimts-primary-text);
      color: var(--dimts-primary);
    }

    .avatar-lg {
      block-size: 3.5rem;
      font-size: 1.5em;
      inline-size: 3.5rem;
      justify-self: center;
      margin-block-end: 0.5rem;
    }

    .suggestions-list {
      display: grid;
      gap: 0.5rem;
      margin-block-start: 1.25rem;
      text-align: start;
    }

    .suggest-title {
      color: var(--dimts-muted);
      font-size: 0.8em;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .suggestion {
      background: color-mix(
        in srgb,
        var(--dimts-primary) 7%,
        var(--dimts-surface)
      );
      border-radius: 999px;
      padding-inline: 1.125rem;
      text-align: start;
    }

    .typing {
      align-items: center;
      display: flex;
      gap: 0.625rem;
    }

    .dots {
      display: inline-flex;
      gap: 0.3rem;
      padding: 0.875rem 1rem;
      border-radius: 1rem;
      background: color-mix(
        in srgb,
        var(--dimts-text) 6%,
        var(--dimts-surface)
      );
    }

    .dots i {
      animation: dimts-dot 1.2s infinite ease-in-out;
      background: var(--dimts-muted);
      block-size: 0.5rem;
      border-radius: 50%;
      inline-size: 0.5rem;
    }

    .dots i:nth-child(2) {
      animation-delay: 0.15s;
    }

    .dots i:nth-child(3) {
      animation-delay: 0.3s;
    }

    @keyframes dimts-dot {
      0%,
      80%,
      100% {
        opacity: 0.35;
        transform: translateY(0);
      }

      40% {
        opacity: 1;
        transform: translateY(-0.25rem);
      }
    }

    button:not(:disabled):hover {
      background: color-mix(
        in srgb,
        var(--dimts-primary) 10%,
        var(--dimts-surface)
      );
    }

    .primary:not(:disabled):hover,
    .help:not(:disabled):hover {
      background: color-mix(
        in srgb,
        var(--dimts-primary) 85%,
        var(--dimts-text)
      );
    }

    .header-actions,
    .language-list,
    .settings-list,
    .composer-actions,
    .speech-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .reply-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-block-start: 0.75rem;
    }

    .consent {
      background: color-mix(
        in srgb,
        var(--dimts-primary) 6%,
        var(--dimts-surface)
      );
      border: 1px solid var(--dimts-border);
      border-radius: var(--dimts-radius, 0.75rem);
      font-size: 0.8125em;
      margin: 0.75rem 1rem 0;
      padding: 0.125rem 0.75rem;
    }

    .consent p {
      margin-block: 0.25rem;
    }

    .consent p:empty {
      display: none;
    }

    .empty-state .consent {
      margin: 1.25rem 0 0;
      text-align: start;
    }

    .consent input[type="checkbox"] {
      accent-color: var(--dimts-primary);
      block-size: 1.5rem;
      inline-size: 1.5rem;
      min-block-size: 1.5rem;
      min-inline-size: 1.5rem;
    }

    .consent .setting-row {
      cursor: pointer;
      min-block-size: 48px;
    }

    .action-icon {
      margin-inline-end: 0.5rem;
    }

    .welcome,
    .panel {
      padding: 1.25rem;
    }

    .career-flow,
    .career-filter {
      display: grid;
      gap: 0.75rem;
      min-inline-size: 0;
    }

    .career input:not([type="checkbox"]),
    .career select {
      inline-size: 100%;
      min-inline-size: 0;
      min-block-size: 48px;
      padding: 0.5rem;
      border: 2px solid var(--dimts-border);
      border-radius: var(--dimts-radius, 0.5rem);
      background: var(--dimts-surface);
    }

    .career-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-block: 0.75rem;
    }

    .career fieldset {
      min-inline-size: 0;
      margin-block: 1rem;
    }
    .career-choice {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-block-size: 48px;
      margin-block: 0.5rem;
    }
    .career-choice input {
      min-inline-size: 24px;
      min-block-size: 24px;
    }
    .career article {
      border-block-end: 1px solid var(--dimts-border);
    }
    .career dd {
      margin-inline-start: 1rem;
    }
    .career-exact {
      white-space: pre-wrap;
    }

    .career summary {
      min-block-size: 48px;
      cursor: pointer;
    }

    .career article a {
      display: inline-flex;
      align-items: center;
    }

    .language-list {
      flex-direction: column;
    }

    .language-choice {
      align-items: center;
      border-radius: 1rem;
      column-gap: 0.875rem;
      display: grid;
      grid-template-columns: 2.75rem minmax(0, 1fr);
      min-block-size: 72px;
      text-align: start;
    }

    .language-choice::before {
      align-items: center;
      background: color-mix(
        in srgb,
        var(--dimts-primary) 12%,
        var(--dimts-surface)
      );
      block-size: 2.75rem;
      border-radius: 0.75rem;
      color: var(--dimts-text);
      content: "EN" / "";
      display: flex;
      font-weight: 800;
      grid-row: span 2;
      justify-content: center;
    }

    .language-choice[lang="am"]::before {
      content: "\\12A0\\121B" / "";
    }

    .language-choice[lang="om"]::before {
      content: "OM" / "";
    }

    .language-name {
      display: block;
      font-size: 1.2em;
      font-weight: 700;
    }

    .language-meta,
    .muted {
      color: var(--dimts-muted);
      font-size: 0.875em;
    }

    .chat {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-block-size: 0;
    }

    .messages {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-block-size: 8rem;
      padding: 1rem;
    }

    .empty-state {
      align-self: center;
      color: var(--dimts-muted);
      gap: 0.25rem;
      inline-size: min(100%, 26rem);
      margin-block: auto;
      padding: 1.5rem 0.5rem;
      text-align: center;
    }

    .empty-state strong {
      color: var(--dimts-text);
      display: block;
      font-size: 1.2em;
    }

    article {
      background: color-mix(
        in srgb,
        var(--dimts-text) 4%,
        var(--dimts-surface)
      );
      border: 1px solid
        color-mix(in srgb, var(--dimts-border) 45%, var(--dimts-surface));
      border-radius: 1.125rem;
      border-end-start-radius: 0.25rem;
      margin-block: 0 0.875rem;
      max-inline-size: 92%;
      padding: 0.75rem 1rem;
    }

    article[data-role="assistant"] {
      background: var(--dimts-surface);
      border: 0;
      column-gap: 0.625rem;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      padding: 0;
    }

    article[data-role="assistant"] > :not(.avatar) {
      grid-column: 2;
    }

    article[data-role="assistant"] > p {
      background: color-mix(
        in srgb,
        var(--dimts-text) 5%,
        var(--dimts-surface)
      );
      border-radius: 1.125rem;
      border-end-start-radius: 0.25rem;
      padding: 0.75rem 1rem;
    }

    article[data-role="assistant"] > .avatar {
      grid-row: 1 / span 3;
    }

    article[data-role="learner"] {
      align-self: flex-end;
      background: var(--dimts-primary);
      border-color: var(--dimts-primary);
      color: var(--dimts-primary-text);
      border-end-end-radius: 0.25rem;
      border-end-start-radius: 1rem;
      max-inline-size: 85%;
    }

    article p {
      margin-block: 0;
      white-space: pre-wrap;
    }

    .citations {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-block-start: 0.5rem;
    }

    .citation {
      background: color-mix(
        in srgb,
        var(--dimts-primary) 8%,
        var(--dimts-surface)
      );
      border: 1px solid var(--dimts-border);
      border-radius: 999px;
      font-size: 0.875em;
      gap: 0.375rem;
      padding: 0.25rem 0.875rem;
      text-decoration: none;
    }

    .citation::before {
      background: currentColor;
      block-size: 1em;
      content: "";
      flex: none;
      inline-size: 1em;
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5' fill='none' stroke='black' stroke-width='2'/%3E%3C/svg%3E")
        center / contain no-repeat;
    }

    .citation:hover {
      text-decoration: underline;
    }

    .reply-actions button {
      border-radius: 999px;
      border-width: 1px;
      font-size: 0.875em;
      padding-block: 0.375rem;
    }

    a {
      align-items: center;
      color: var(--dimts-text);
      display: inline-flex;
      overflow-wrap: anywhere;
      padding: 0.25rem;
    }

    .composer {
      background: var(--dimts-surface);
      border-block-start: 1px solid var(--dimts-border);
      box-shadow: 0 -6px 16px rgb(0 0 0 / 6%);
      inset-block-end: 0;
      padding: 0.625rem 1rem 0.75rem;
      position: sticky;
      z-index: 2;
    }

    .composer > label {
      display: block;
      font-size: 0.875em;
      font-weight: 600;
      margin-block-end: 0.25rem;
    }

    textarea {
      max-block-size: 40vh;
      background: var(--dimts-surface);
      border: 2px solid var(--dimts-border);
      border-radius: var(--dimts-radius, 1rem);
      display: block;
      inline-size: 100%;
      min-block-size: 3rem;
      padding: 0.75rem;
      resize: vertical;
    }

    .composer-actions {
      align-items: center;
      justify-content: space-between;
      margin-block-start: 0.5rem;
    }

    .transliteration {
      display: grid;
      gap: 0.5rem;
      margin-block-start: 0.5rem;
    }

    .speech-controls {
      margin-block-start: 0.5rem;
    }

    .primary,
    .help {
      background: var(--dimts-primary);
      color: var(--dimts-primary-text);
      font-weight: 700;
    }

    .send-action {
      border-radius: 999px;
      min-inline-size: 7rem;
    }

    .voice-install {
      align-items: center;
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      font-size: 0.8125em;
    }

    .voice-install button {
      border-radius: 999px;
      border-width: 1px;
    }

    .voice-install .muted:empty {
      display: none;
    }

    .composer > .muted {
      font-size: 0.75em;
      margin-block: 0.375rem 0;
    }

    .help {
      align-self: flex-end;
      border-radius: 999px;
      box-shadow: 0 4px 14px rgb(0 0 0 / 22%);
      inset-block-end: 1rem;
      inset-inline-end: 1rem;
      margin: 0 1rem 1rem;
      /* In-flow layouts put it under the header, clear of the composer. */
      order: var(--dimts-help-order, 1);
      padding-inline: 1.25rem;
      /* Embedded panels keep it in flow so it never covers the composer. */
      position: var(--dimts-help-position, fixed);
      z-index: 3;
    }

    .help-backdrop {
      align-items: center;
      background: rgb(0 0 0 / 55%);
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      inset: 0;
      overflow-y: auto;
      padding: 1rem;
      position: fixed;
      z-index: 3;
    }

    .help-dialog {
      background: var(--dimts-surface);
      border: 2px solid var(--dimts-border);
      border-radius: 0.75rem;
      margin-inline: auto;
      max-block-size: 100%;
      max-inline-size: 36rem;
      min-inline-size: 0;
      overflow-y: auto;
      padding: 1.25rem;
      inline-size: 100%;
    }

    .help-summary {
      border: 1px solid var(--dimts-border);
      margin-block: 0.75rem;
      max-block-size: 12rem;
      overflow-y: auto;
      padding: 0.75rem;
    }

    .share-banner {
      position: sticky;
      inset-block-start: 0;
      order: -1;
      z-index: 4;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      background: var(--dimts-surface);
      color: var(--dimts-text);
      border: 2px solid var(--dimts-border);
      padding: 0.5rem;
    }

    .share-fallback input {
      max-inline-size: 100%;
      min-inline-size: 0;
    }

    .help-actions,
    .help-chat-messages {
      display: grid;
      gap: 0.5rem;
      margin-block: 0.75rem;
    }

    .help-chat-messages {
      max-block-size: 16rem;
      overflow-y: auto;
    }

    .visually-hidden {
      block-size: 1px;
      clip-path: inset(50%);
      inline-size: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }

    .status {
      min-block-size: 1.5em;
      padding-inline: 0.75rem;
    }

    .panel {
      border-block-end: 1px solid var(--dimts-border);
    }

    .settings-list {
      align-items: center;
      margin-block: 0.75rem;
    }

    .setting-group {
      border: 0;
      margin: 0;
      padding: 0;
    }

    .setting-group legend {
      font-weight: 700;
    }

    .setting-toggles {
      display: grid;
      gap: 0.5rem;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .setting-toggles .setting-row {
      display: grid;
      gap: 0.5rem;
      grid-template-columns: minmax(0, 1fr) 48px;
    }

    .setting-row {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: space-between;
      padding-block: 0.375rem;
    }

    .setting-row input {
      min-block-size: 48px;
      min-inline-size: 48px;
    }

    .mic {
      border-radius: 999px;
      min-block-size: 64px;
      min-inline-size: 64px;
    }

    .mic[aria-pressed="true"] {
      background: var(--dimts-primary);
      color: var(--dimts-primary-text);
      position: relative;
    }

    .mic[aria-pressed="true"]::after {
      animation: recording-ring 1.2s ease-out infinite;
      border: 2px solid var(--dimts-primary);
      border-radius: 0.65rem;
      content: "";
      inset: -0.25rem;
      opacity: 0;
      pointer-events: none;
      position: absolute;
    }

    @keyframes recording-ring {
      0% {
        opacity: 0.9;
        transform: scale(0.88);
      }

      100% {
        opacity: 0;
        transform: scale(1.2);
      }
    }

    .offline-banner {
      align-items: center;
      border: 2px solid var(--dimts-border);
      display: flex;
      gap: 0.5rem;
      margin: 0.75rem;
      padding: 0.75rem;
    }

    @media (max-width: 24rem) {
      main {
        border-radius: 0;
      }

      /* Notes take a full row; microphone and Send share the next one. */
      .composer-actions > .muted,
      .composer-actions > .voice-install {
        flex-basis: 100%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation: none !important;
        scroll-behavior: auto !important;
        transition: none !important;
      }
    }

    :host([stop-motion]) *,
    :host([stop-motion]) *::before,
    :host([stop-motion]) *::after {
      animation: none !important;
      scroll-behavior: auto !important;
      transition: none !important;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    activeWidgets.add(this);
    this.lifecycleController = new AbortController();
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("keydown", this.handleShortcut);
    if (this.selectedLang === "am") registerEthiopicFonts(this);
    if (this.hasAttribute("data-simple")) {
      this.updateSettings({
        simple: this.getAttribute("data-simple") === "true",
      });
    } else if (this.settings.simple) {
      this.updateSettings({ simple: true });
    }
    this.toggleAttribute("high-contrast", this.settings.highContrast);
    this.toggleAttribute("stop-motion", this.settings.stopMotion);
    this.style.setProperty(
      "--dimts-scale",
      String(this.settings.textScale / 100),
    );
    this.disposeTheme = applyThemeGuard(this);
    void this.enableOfflineSupport();
    void this.initialize();
    document.addEventListener("visibilitychange", this.handleHelpVisibility);
    if (this.helpRequestId) this.connectHelpSocket();
  }

  override attributeChangedCallback(
    name: string,
    previous: string | null,
    value: string | null,
  ): void {
    super.attributeChangedCallback(name, previous, value);
    if (name === "hidden" && value !== null) {
      this.cancelRecording();
      this.stopSpeech();
      this.helpModule?.stopSharing.call(this as unknown as HelpContext);
      this.careerModule?.suspend.call(this as unknown as CareerContext);
    }
  }

  protected override updated(): void {
    // Populate an already mounted live region, including after initial startup.
    if (!this.loading) this.announceFallback();
    const help = this.renderRoot.querySelector(".help");
    if (help && help !== this.observedHelp) {
      this.helpSizeObserver?.disconnect();
      this.observedHelp = help;
      this.helpSizeObserver = new ResizeObserver(() => {
        if (this.isConnected)
          this.style.setProperty(
            "--dimts-help-reserve",
            `${Math.ceil(help.getBoundingClientRect().height) + 24}px`,
          );
      });
      this.helpSizeObserver.observe(help);
    }
    for (const control of this.renderRoot.querySelectorAll("button, a")) {
      const icon = control.querySelector(".action-icon");
      if (this.settings.simple && !icon) {
        const decoration = document.createElement("span");
        decoration.className = "action-icon";
        decoration.setAttribute("aria-hidden", "true");
        decoration.textContent = control.classList.contains("help")
          ? "?"
          : control.classList.contains("mic")
            ? "●"
            : "›";
        control.prepend(decoration);
      } else if (!this.settings.simple) icon?.remove();
    }
  }

  override disconnectedCallback(): void {
    document.removeEventListener("visibilitychange", this.handleHelpVisibility);
    this.helpModule?.suspend.call(this as unknown as HelpContext);
    this.careerModule?.suspend.call(this as unknown as CareerContext);
    activeWidgets.delete(this);
    this.lifecycleController.abort();
    this.browserVoiceRun += 1;
    this.cancelRecording();
    this.stopSpeech();
    this.disposeBrowserVoice();
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("keydown", this.handleShortcut);
    this.disposeTheme?.();
    this.disposeTheme = undefined;
    this.helpSizeObserver?.disconnect();
    this.helpSizeObserver = undefined;
    this.observedHelp = undefined;
    clearTimeout(this.startupTimer);
    clearTimeout(this.workingTimer);
    clearTimeout(this.sessionTimer);
    this.faqRun += 1;
    this.faqController?.abort();
    releaseEthiopicFont(this);
    void this.audioContext?.close();
    this.audioContext = undefined;
    if (this.recordingTimer !== undefined) {
      window.clearTimeout(this.recordingTimer);
      this.recordingTimer = undefined;
    }
    if (this.helpReconnectTimer !== undefined) {
      window.clearTimeout(this.helpReconnectTimer);
      this.helpReconnectTimer = undefined;
    }
    this.helpSocket?.close();
    this.helpSocket = undefined;
    super.disconnectedCallback();
  }

  private readonly handleOffline = (): void => {
    this.offline = true;
  };
  private readonly handleHelpVisibility = (): void => {
    if (document.hidden)
      this.helpModule?.stopSharing.call(this as unknown as HelpContext);
  };

  private readonly handleOnline = (): void => {
    this.offline = false;
  };

  private readonly handleShortcut = (event: KeyboardEvent): void => {
    if (
      !this.settings.shortcuts ||
      this.hidden ||
      !this.isConnected ||
      !event.altKey ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.repeat
    )
      return;
    const key = event.key.toLowerCase();
    if (!["m", "h", "l", "s"].includes(key)) return;
    if (key === "s") {
      event.preventDefault();
      this.helpModule?.stopSharing.call(this as unknown as HelpContext);
      return;
    }
    // A modal owns its keyboard focus until explicitly dismissed.
    if (
      this.helpPreviewOpen ||
      this.helpModule?.shareDialogOpen.call(this as unknown as HelpContext)
    )
      return;
    event.preventDefault();
    if (key === "h") this.escalate();
    if (key === "l") this.panel = this.panel === "language" ? null : "language";
    if (key === "m" && this.canRecord() && !this.busy) {
      if (this.isRecording) this.stopRecording();
      else this.startRecording();
    }
  };

  uiText(key: string): string {
    return this.t(key);
  }

  clearOwnedStorage(): void {
    this.careerModule?.dispose.call(this as unknown as CareerContext, true);
    this.rememberCareerSession(true);
    try {
      globalThis.localStorage?.removeItem("dimts.settings");
      globalThis.localStorage?.removeItem(
        `dimts.career.${this.apiRoot}.${this.hostKey}`,
      );
    } catch {
      /* Storage can be disabled. */
    }
    const others = [...activeWidgets].filter((widget) => widget !== this);
    const base = new URL(this.apiRoot, location.origin);
    if (
      others.some(
        (widget) => new URL(widget.apiRoot, location.origin).href === base.href,
      )
    )
      return;
    void clearFaqCache(this.apiRoot);
    if (
      this.ownedWorker &&
      ownsWorkerRegistration(this.ownedWorker, this.workerUrl)
    )
      void this.ownedWorker.unregister();
    void Promise.resolve()
      .then(async () => {
        for (const name of await caches.keys()) {
          if (!others.length && /^dimts-shell-v\d+$/u.test(name)) {
            await caches.delete(name);
            continue;
          }
          if (name !== "dimts-static-v1" && name !== "dimts-public-v1")
            continue;
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            const url = new URL(request.url);
            const matches =
              name === "dimts-static-v1"
                ? url.searchParams.get("apiOrigin") === base.origin &&
                  url.pathname.startsWith(`/__dimts_cache${base.pathname}/`)
                : url.origin === base.origin &&
                  url.pathname.startsWith(`${base.pathname}/`);
            if (matches) await cache.delete(request);
          }
          if (!(await cache.keys()).length) await caches.delete(name);
        }
      })
      .catch(() => undefined);
  }

  private get workerUrl(): URL {
    const workerUrl = new URL("/service-worker.js", location.origin);
    workerUrl.searchParams.set("asset", import.meta.url);
    workerUrl.searchParams.set("owner", "dimts");
    workerUrl.searchParams.set(
      "api",
      new URL(this.apiRoot, location.origin).href,
    );
    return workerUrl;
  }

  private async enableOfflineSupport(): Promise<void> {
    if (
      !("serviceWorker" in navigator) ||
      new URL(import.meta.url).origin !== location.origin
    ) {
      return;
    }

    const workerUrl = this.workerUrl;
    try {
      const existing = await navigator.serviceWorker.getRegistration(
        location.href,
      );
      if (existing && !ownsWorkerRegistration(existing, workerUrl)) return;
      if (!this.isConnected) return;
      const registration = await navigator.serviceWorker.register(workerUrl, {
        scope: "/",
      });
      if (!this.isConnected) {
        if (!existing && ownsWorkerRegistration(registration, workerUrl))
          await registration.unregister();
        return;
      }
      this.ownedWorker = registration;
      this.offlineSupportAvailable = true;
    } catch {
      this.offlineSupportAvailable = false;
    }
  }

  private async fetchStatic(url: string): Promise<Response> {
    const remoteUrl = new URL(url, location.origin);
    const cacheUrl = new URL(
      `/__dimts_cache${remoteUrl.pathname}`,
      location.origin,
    );
    remoteUrl.searchParams.forEach((value, key) =>
      cacheUrl.searchParams.append(key, value),
    );
    cacheUrl.searchParams.set("apiOrigin", remoteUrl.origin);
    const cacheRequest = new Request(cacheUrl);
    let cache: Cache | undefined;

    try {
      cache = await caches.open("dimts-static-v1");
    } catch {
      cache = undefined;
    }

    if (this.settings.dataSaver && cache) {
      try {
        const cached = await cache.match(cacheRequest);
        if (cached) return cached;
      } catch {
        this.offlineSupportAvailable = false;
      }
    }

    try {
      const response = await this.request(url);
      if (response.ok) this.offline = !navigator.onLine;
      if (response.ok && cache) {
        try {
          await cache.put(cacheRequest, response.clone());
        } catch {
          this.offlineSupportAvailable = false;
        }
      } else if (response.status >= 500 && cache) {
        this.offline = true;
        const cached = await cache.match(cacheRequest);
        if (cached) return cached;
      }
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      this.offline = true;
      if (cache) {
        let cached: Response | undefined;
        try {
          cached = await cache.match(cacheRequest);
        } catch {
          // Keep the original network error if the cache is unavailable.
        }
        if (cached) return cached;
      }
      throw error;
    }
  }

  private get apiRoot(): string {
    const root = this.api.replace(/\/+$/u, "");
    return root.endsWith("/v1") ? root : `${root}/v1`;
  }

  private t(key: string, values: Record<string, string | number> = {}): string {
    return messageFor(this.ui, key, values, this.selectedLang || "en");
  }

  private get previewQuery(): string {
    return new URLSearchParams(window.location.search).get("lang_preview") ===
      "1"
      ? "?lang_preview=1"
      : "";
  }

  private async initialize(): Promise<void> {
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.startInitialize();
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = undefined;
    }
  }

  private async retryStartup(): Promise<void> {
    const sessionOnly = !this.loading && this.languages.length > 0;
    this.lifecycleController.abort();
    this.lifecycleController = new AbortController();
    await this.initializationPromise;
    await this.sessionPromise;
    if (!this.isConnected) return;
    if (sessionOnly) await this.createSession();
    else await this.initialize();
  }

  private async startInitialize(): Promise<void> {
    const lifecycle = this.lifecycleController.signal;
    this.loading = true;
    this.notice = "";
    clearTimeout(this.startupTimer);
    this.startupTimer = setTimeout(() => {
      this.notice = this.t("waking.message");
    }, 2_000);
    try {
      const response = await this.fetchStatic(
        `${this.apiRoot}/languages${this.previewQuery}`,
      );
      if (!response.ok) throw new Error("languages");
      const body = (await response.json()) as { languages: Language[] };
      lifecycle.throwIfAborted();
      this.languages = body.languages.filter(
        (language) => language.status !== "draft" || Boolean(this.previewQuery),
      );
      void this.configureBrowserVoice();
      if (this.languages.length === 0) throw new Error("languages");
      const stored =
        this.getAttribute("data-lang") || storage.get("dimts.lang");
      const remembered = this.languages.find(({ code }) => code === stored);
      if (remembered) {
        await this.chooseLanguage(remembered.code, false);
      } else {
        // Show the picker in the learner's own language when it is offered.
        const preferred = (navigator.languages ?? [navigator.language])
          .map((tag) => tag.toLowerCase().split("-")[0])
          .concat("en")
          .find((code) => this.languages.some((item) => item.code === code));
        this.setSelectedLanguage(preferred ?? this.languages[0]!.code);
        await this.loadUi(this.selectedLang);
      }
    } catch {
      this.notice = this.t("error.network");
    } finally {
      clearTimeout(this.startupTimer);
      this.loading = false;
      if (this.isConnected && !lifecycle.aborted)
        this.dispatchEvent(new Event("dimts:ready"));
    }
  }

  private async loadUi(lang: string): Promise<void> {
    const candidates = [lang, "en"];
    for (const code of [...new Set(candidates)]) {
      try {
        const response = await this.fetchStatic(
          `${this.apiRoot}/locales/${encodeURIComponent(code)}/ui${this.previewQuery}`,
        );
        if (!response.ok) continue;
        this.ui = (await response.json()) as Record<string, unknown>;
        this.uiLang = code;
        void this.refreshFaq();
        if (
          code !== lang ||
          response.headers.get("X-Dimts-Locale-Fallback") === "1"
        ) {
          this.fallbackPending = true;
        }
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        continue;
      }
    }
    this.ui = { ...bootstrapUi };
    this.uiLang = "en";
  }

  private setSelectedLanguage(code: string): void {
    if (code === "am") registerEthiopicFonts(this);
    this.selectedLang = code;
    this.transliterationEnabled = false;
    this.transliterationSuggestion = null;
    this.setAttribute("lang", code);
    this.setAttribute(
      "dir",
      this.languages.find((language) => language.code === code)?.dir ?? "ltr",
    );
  }

  private async chooseLanguage(code: string, persist = true): Promise<void> {
    const lifecycle = this.lifecycleController.signal;
    const selected = this.languages.find((language) => language.code === code);
    if (!selected) return;
    this.cancelRecording();
    this.careerModule?.suspend.call(this as unknown as CareerContext);
    this.stopSpeech();
    this.fallbackNotice = "";
    this.fallbackPending = false;
    this.setSelectedLanguage(selected.code);
    this.faqRun += 1;
    this.faqController?.abort();
    this.faqState = "idle";
    this.faqItems = [];
    await this.loadUi(selected.code);
    if (lifecycle.aborted || !this.isConnected) return;
    if (persist) {
      storage.set("dimts.lang", selected.code);
      this.dispatchEvent(
        new CustomEvent("dimts:language", {
          bubbles: true,
          composed: true,
          detail: { lang: selected.code },
        }),
      );
    }
    this.panel = null;
    await this.updateComplete;
    this.renderRoot
      .querySelector<HTMLButtonElement>(".header-actions button")
      ?.focus();
    if (!this.sessionId) {
      await this.createSession();
    }
  }

  setLanguage(code: string): void {
    this.setAttribute("data-lang", code);
    if (this.languages.length) void this.chooseLanguage(code);
  }

  escalate(): void {
    this.dispatchEvent(
      new CustomEvent("dimts:escalated", {
        bubbles: true,
        composed: true,
        detail: { lang: this.selectedLang },
      }),
    );
    this.openHelpPreview();
  }

  private async openHelpPreview(): Promise<void> {
    const generation = this.sessionGeneration;
    try {
      const runtime = await this.loadHelp();
      if (this.isConnected && generation === this.sessionGeneration)
        return runtime.openHelpPreview.call(this as unknown as HelpContext);
    } catch {
      if (generation !== this.sessionGeneration) return;
      this.notice = this.t("help.error");
      this.noticeIsError = true;
    }
  }

  private async cancelHelpPreview(): Promise<void> {
    return await this.helpModule?.cancelHelpPreview.call(
      this as unknown as HelpContext,
    );
  }

  private trapHelpDialog(event: KeyboardEvent): void {
    return this.helpModule?.trapHelpDialog.call(
      this as unknown as HelpContext,
      event,
    );
  }

  private async createHelpRequest(): Promise<void> {
    return await this.helpModule?.createHelpRequest.call(
      this as unknown as HelpContext,
    );
  }

  private connectHelpSocket(): void {
    return this.helpModule?.connectHelpSocket.call(
      this as unknown as HelpContext,
    );
  }

  private scheduleHelpReconnect(): void {
    return this.helpModule?.scheduleHelpReconnect.call(
      this as unknown as HelpContext,
    );
  }

  private handleHelpFrame(raw: unknown): void {
    return this.helpModule?.handleHelpFrame.call(
      this as unknown as HelpContext,
      raw,
    );
  }

  private sendHelpMessage(event: SubmitEvent): void {
    return this.helpModule?.sendHelpMessage.call(
      this as unknown as HelpContext,
      event,
    );
  }

  private async closeHelpRequest(): Promise<void> {
    return await this.helpModule?.closeHelpRequest.call(
      this as unknown as HelpContext,
    );
  }

  private async createSession(): Promise<void> {
    if (this.sessionPromise) return this.sessionPromise;
    const pending = this.startSession();
    this.sessionPromise = pending;
    try {
      await pending;
    } finally {
      if (this.sessionPromise === pending) this.sessionPromise = undefined;
    }
  }

  private async startSession(): Promise<void> {
    const generation = this.sessionGeneration;
    if (!this.hostKey) {
      this.notice = this.t("error.host");
      return;
    }
    this.startingSession = true;
    this.notice = "";
    const timer = setTimeout(() => {
      if (generation === this.sessionGeneration)
        this.notice = this.t("waking.message");
    }, 2_000);
    this.sessionTimer = timer;
    try {
      let careerResume: { sessionId: string; resumeToken: string } | undefined;
      try {
        const raw = sessionStorage.getItem(this.careerSessionKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (
            typeof parsed.sessionId === "string" &&
            typeof parsed.resumeToken === "string"
          ) {
            careerResume = {
              sessionId: parsed.sessionId,
              resumeToken: parsed.resumeToken,
            };
            this.careerContinuity = true;
          }
        }
      } catch {
        /* A fresh session is still available with storage disabled. */
      }
      const response = await this.request(`${this.apiRoot}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dimts-key": this.hostKey,
        },
        body: JSON.stringify(
          careerResume ?? { lang: this.selectedLang, channel: "web" },
        ),
      });
      if (response.status === 401 && careerResume) {
        this.resetExpiredSession();
        await this.startSession();
        return;
      }
      if (!response.ok) throw new Error("session");
      const session = (await response.json()) as {
        sessionId: string;
        sessionToken: string;
        resumeToken: string;
        cloudOk: boolean;
      };
      if (generation !== this.sessionGeneration) return;
      if (
        this.sessionRestartPending &&
        (session.cloudOk !== false ||
          !session.sessionId ||
          !session.sessionToken ||
          !session.resumeToken)
      )
        throw new Error("session");
      if (this.sessionId && this.sessionId !== session.sessionId)
        this.fallbackAnnounced = false;
      this.sessionId = session.sessionId;
      this.sessionToken = session.sessionToken;
      this.resumeToken = session.resumeToken;
      this.rememberCareerSession();
      this.cloudOk = session.cloudOk === true;
      this.notice = "";
      if (this.sessionRestartPending) {
        this.sessionRestartPending = false;
        this.consentFailed = false;
        this.consentNotice = this.t("privacy.sessionRestarted");
      }
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    } catch {
      if (generation === this.sessionGeneration)
        this.notice = this.t("error.network");
    } finally {
      clearTimeout(timer);
      if (this.sessionTimer === timer) this.sessionTimer = undefined;
      if (generation === this.sessionGeneration) this.startingSession = false;
    }
  }

  private async changeConsent(cloudOk: boolean): Promise<void> {
    if (this.consentBusy) return;
    this.cloudOk = cloudOk;
    this.consentBusy = true;
    this.consentFailed = false;
    this.consentNotice = this.t("privacy.saving");
    this.consentPromise = this.persistConsent(cloudOk);
    try {
      await this.consentPromise;
    } finally {
      this.consentPromise = undefined;
      this.consentBusy = false;
    }
  }

  private async persistConsent(cloudOk: boolean): Promise<void> {
    try {
      const response = await this.request(`${this.apiRoot}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dimts-key": this.hostKey,
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          resumeToken: this.resumeToken,
          cloudOk,
          ...(cloudOk ? { consentVersion: "remote-ai-v1" } : {}),
        }),
      });
      if (response.status === 401) {
        this.resetExpiredSession();
        await this.createSession();
        if (!this.sessionId) throw new Error("session");
        return;
      }
      if (!response.ok) throw new Error("consent");
      const session = (await response.json()) as {
        sessionId: string;
        sessionToken: string;
        resumeToken: string;
        cloudOk: boolean;
      };
      if (
        session.sessionId !== this.sessionId ||
        session.cloudOk !== cloudOk ||
        !session.sessionToken ||
        !session.resumeToken
      )
        throw new Error("consent");
      this.sessionToken = session.sessionToken;
      this.resumeToken = session.resumeToken;
      this.rememberCareerSession();
      this.consentNotice = this.t("privacy.saved");
      // Resuming rotates the credential; a help reconnect must use the new one.
      this.helpSocket?.close();
    } catch {
      this.consentFailed = true;
      this.consentNotice = this.t("privacy.failed");
    }
  }

  private resetExpiredSession(): void {
    this.careerModule?.dispose.call(this as unknown as CareerContext, true);
    this.rememberCareerSession(true);
    try {
      localStorage.removeItem(`dimts.career.${this.apiRoot}.${this.hostKey}`);
    } catch {
      /* Storage can be disabled. */
    }
    this.careerContinuity = false;
    this.helpModule?.dispose.call(this as unknown as HelpContext);
    // The rotated credential cannot recover an old session after a lost response.
    // Cancel its work before starting an explicitly local-only replacement.
    this.sessionGeneration += 1;
    this.lifecycleController.abort();
    this.lifecycleController = new AbortController();
    this.askController?.abort();
    this.askController = undefined;
    this.askPromise = undefined;
    this.sessionPromise = undefined;
    clearTimeout(this.workingTimer);
    clearTimeout(this.sessionTimer);
    this.cancelRecording();
    this.speechReview = false;
    this.stopSpeech();
    clearTimeout(this.helpReconnectTimer);
    this.helpReconnectTimer = undefined;
    const socket = this.helpSocket;
    this.helpSocket = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
    this.helpReconnectAttempt = 0;
    this.helpPreviewOpen = false;
    this.helpRequestId = "";
    this.helpMessages = [];
    this.helpDraft = "";
    this.helpBusy = false;
    this.helpStatus = "";
    this.helpNotice = "";
    this.helpNoticeIsError = false;
    this.helpAnnouncement = "";
    this.sessionId = "";
    this.sessionToken = "";
    this.resumeToken = "";
    this.sessionRestartPending = true;
    this.cloudOk = false;
    this.consentFailed = false;
    this.consentNotice = "";
    this.pendingQuestion = undefined;
    this.feedback = {};
    this.messages = [];
    this.busy = false;
    this.slowRequest = false;
    this.retryAvailable = false;
    this.noticeIsError = false;
    this.panel = null;
    this.fallbackPending = this.fallbackPending || this.fallbackAnnounced;
    this.fallbackAnnounced = false;
    this.fallbackNotice = "";
  }

  private renderConsent(): unknown {
    return html`<section
      class="consent"
      aria-label=${this.t("privacy.cloudOk")}
    >
      ${this.messages.length ? nothing : html`<p>${this.t("privacy.remoteNotice")}</p>`}
      <label class="setting-row" for="cloud-consent"
        ><span>${this.t("privacy.cloudOk")}</span
        ><input
          lang=${this.uiLanguage}
          dir=${this.uiDirection}
          id="cloud-consent"
          type="checkbox"
          .checked=${this.cloudOk}
          ?disabled=${this.consentBusy}
          @change=${(event: Event) => void this.changeConsent((event.currentTarget as HTMLInputElement).checked)}
      /></label>
      ${!this.cloudOk && !this.messages.length ? html`<p>${this.t("privacy.localOnly")}</p>` : nothing}
      <p role="status" aria-live="polite">${this.consentNotice}</p>
      ${this.consentFailed ? html`<button lang=${this.uiLanguage} dir=${this.uiDirection} type="button" @click=${() => void this.changeConsent(this.cloudOk)}>${this.t("error.retry")}</button>` : nothing}
    </section>`;
  }

  private async copyReply(message: ConversationMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.text);
      this.notice = this.t("answer.copied");
      this.noticeIsError = false;
    } catch {
      this.notice = this.t("answer.copyFailed");
      this.noticeIsError = true;
    }
  }

  private async rateReply(replyId: string, helpful: boolean): Promise<void> {
    const generation = this.sessionGeneration;
    try {
      await this.consentPromise;
      if (generation !== this.sessionGeneration) return;
      const response = await this.request(`${this.apiRoot}/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.sessionToken}`,
        },
        body: JSON.stringify({ replyId, helpful }),
      });
      if (generation !== this.sessionGeneration) return;
      if (!response.ok) throw new Error("feedback");
      this.feedback = { ...this.feedback, [replyId]: helpful };
      this.notice = this.t("answer.feedbackSaved");
      this.noticeIsError = false;
    } catch {
      if (generation !== this.sessionGeneration) return;
      this.notice = this.t("answer.feedbackFailed");
      this.noticeIsError = true;
    }
  }

  private async openFaq(): Promise<void> {
    this.panel = "faq";
    await this.refreshFaq();
  }

  private async refreshFaq(): Promise<void> {
    const run = ++this.faqRun;
    this.faqController?.abort();
    const controller = new AbortController();
    this.faqController = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    this.faqState = "loading";
    this.faqItems = [];
    try {
      const result = await loadFaq(
        this.apiRoot,
        this.selectedLang || "en",
        Boolean(this.previewQuery),
        { signal: controller.signal },
      );
      if (run !== this.faqRun || !this.isConnected) return;
      this.faqItems = result.items;
      this.courseQuestions = result.items.length
        ? []
        : await this.request(
            `${this.apiRoot}/course/questions?lang=${encodeURIComponent(this.selectedLang || "en")}`,
          )
            .then((response) => (response.ok ? response.json() : null))
            .then((body: { questions?: { text?: unknown }[] } | null) =>
              (body?.questions ?? [])
                .map(({ text }) => (typeof text === "string" ? text : ""))
                .filter(Boolean)
                .slice(0, 12),
            )
            .catch(() => []);
      if (run !== this.faqRun || !this.isConnected) return;
      this.faqCached = result.cached;
      this.faqState = "ready";
    } catch {
      if (run === this.faqRun) {
        this.faqItems = [];
        this.faqState = "failed";
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private renderFaq(): unknown {
    if (this.panel !== "faq") return nothing;
    return html`<section class="panel" aria-labelledby="faq-heading">
      <h2 id="faq-heading">${this.t("faq.title")}</h2>
      <p role="status" aria-live="polite">
        ${this.t(this.faqState === "loading" ? "faq.loading" : this.faqState === "failed" ? "faq.failed" : !this.faqItems.length ? "faq.empty" : this.faqCached ? "faq.cached" : "")}
      </p>
      ${this.faqState === "failed" ? html`<button lang=${this.uiLanguage} dir=${this.uiDirection} type="button" @click=${() => void this.openFaq()}>${this.t("error.retry")}</button>` : nothing}
      ${
        !this.faqItems.length && this.sessionId && this.courseQuestions.length
          ? html`<div
              class="suggestions-list"
              role="group"
              aria-label=${this.t("suggest.title")}
            >
              <span class="suggest-title">${this.t("suggest.title")}</span>
              ${this.courseQuestions.map(
                (question) =>
                  html`<button
                    type="button"
                    class="suggestion"
                    lang=${this.selectedLang}
                    dir=${this.currentDirection}
                    @click=${() => {
                      this.panel = null;
                      void this.askSuggestion(question);
                    }}
                  >
                    ${question}
                  </button>`,
              )}
            </div>`
          : nothing
      }
      ${this.faqItems.map(
        (item) =>
          html`<article lang=${item.lang} dir=${item.dir}>
            <h3>${item.question}</h3>
            <p>${item.answer}</p>
            <div class="citations">
              ${(this.settings.simple ? item.citations.slice(0, 1) : item.citations).map((citation) => html`<a lang=${this.uiLanguage} dir=${this.uiDirection} href=${citation.url} target="_blank" rel="noopener">${this.t("answer.source", { lesson: citation.label })}</a>`)}
            </div>
          </article>`,
      )}
    </section>`;
  }

  private async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.askPromise) return;
    const pending = this.askQuestion();
    this.askPromise = pending;
    try {
      await pending;
    } finally {
      if (this.askPromise === pending) this.askPromise = undefined;
    }
  }

  private async askSuggestion(text: string): Promise<void> {
    if (this.busy || this.isRecording) return;
    this.pendingQuestion = undefined;
    this.draft = text;
    await this.updateComplete;
    this.renderRoot
      .querySelector<HTMLFormElement>(".composer")
      ?.requestSubmit();
  }

  private get avatarLetter(): string {
    return Array.from(this.t("app.name"))[0] ?? "";
  }

  private renderEmptyState(): unknown {
    const suggestions = ["suggest.1", "suggest.2", "suggest.3"]
      .map((key) => ({ key, text: this.t(key) }))
      .filter(({ key, text }) => text && text !== key);
    return html`<div class="empty-state">
      <span class="avatar avatar-lg" aria-hidden="true"
        >${this.avatarLetter}</span
      >
      <strong>${this.t("welcome.ready")}</strong>
      <span>${this.t("app.tagline")}</span>
      ${
        suggestions.length
          ? html`<div
              class="suggestions-list"
              role="group"
              aria-label=${this.t("suggest.title")}
            >
              <span class="suggest-title">${this.t("suggest.title")}</span>
              ${suggestions.map(
                ({ text }) =>
                  html`<button
                    type="button"
                    class="suggestion"
                    lang=${this.selectedLang}
                    dir=${this.currentDirection}
                    ?disabled=${this.busy}
                    @click=${() => void this.askSuggestion(text)}
                  >
                    ${text}
                  </button>`,
              )}
            </div>`
          : nothing
      }
      ${this.renderConsent()}
    </div>`;
  }

  private async retryQuestion(): Promise<void> {
    this.askController?.abort();
    await this.askPromise;
    if (this.isConnected)
      this.renderRoot
        .querySelector<HTMLFormElement>(".composer")
        ?.requestSubmit();
  }

  private async askQuestion(): Promise<void> {
    const generation = this.sessionGeneration;
    const text = this.draft.trim();
    if (!text || this.busy || this.isRecording || this.consentFailed) return;
    await this.consentPromise;
    if (
      this.busy ||
      this.consentFailed ||
      generation !== this.sessionGeneration
    )
      return;
    if (
      !this.pendingQuestion ||
      this.pendingQuestion.text !== text ||
      this.pendingQuestion.lang !== this.selectedLang ||
      this.pendingQuestion.simple !== this.settings.simple
    ) {
      this.pendingQuestion = {
        text,
        lang: this.selectedLang,
        simple: this.settings.simple,
        clientMsgId: crypto.randomUUID(),
        via: this.speechReview ? "voice" : "text",
      };
    }
    const question = this.pendingQuestion;
    this.stopSpeech();
    const learnerMessage: ConversationMessage = {
      id: question.clientMsgId,
      role: "learner",
      text,
      lang: this.selectedLang,
      dir: this.currentLanguage?.dir ?? "ltr",
      citations: [],
    };
    this.messages = [...this.messages, learnerMessage];
    this.draft = "";
    this.transliterationSuggestion = null;
    this.speechReview = false;
    this.busy = true;
    this.slowRequest = false;
    const controller = new AbortController();
    this.askController = controller;
    this.notice = "";
    this.noticeIsError = false;
    this.retryAvailable = false;
    this.workingTimer = setTimeout(() => {
      if (this.busy) {
        this.notice = this.t("status.working");
        this.slowRequest = true;
      }
    }, 2_000);
    try {
      if (!this.sessionId || !this.sessionToken) {
        await this.createSession();
      }
      if (!this.sessionId || !this.sessionToken) {
        throw new Error("session");
      }
      const response = await this.request(`${this.apiRoot}/ask`, {
        signal: controller.signal,
        method: "POST",
        headers: {
          authorization: `Bearer ${this.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          clientMsgId: question.clientMsgId,
          lang: question.lang,
          text,
          via: question.via,
          simple: question.simple,
        }),
      });
      if (!response.ok) throw new Error("ask");
      const reply = (await response.json()) as Reply;
      if (generation !== this.sessionGeneration) return;
      const assistantMessage: ConversationMessage = {
        id: reply.id,
        role: "assistant",
        text: reply.text,
        lang: reply.lang,
        dir: reply.dir,
        citations: reply.citations ?? [],
      };
      this.messages = [...this.messages, assistantMessage];
      if (this.pendingQuestion === question) this.pendingQuestion = undefined;
      this.notice = "";
      this.noticeIsError = false;
      this.retryAvailable = false;
      if (
        this.settings.readAloud === "always" &&
        this.canSpeak(assistantMessage.lang)
      ) {
        void this.speak(
          assistantMessage.text,
          assistantMessage.lang,
          assistantMessage.id,
        );
      }
      await this.updateComplete;
      this.renderRoot
        .querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(reply.id)}"]`,
        )
        ?.focus();
    } catch {
      if (generation !== this.sessionGeneration) return;
      this.notice = this.t("error.network");
      this.noticeIsError = true;
      this.retryAvailable = true;
      this.messages = this.messages.filter(
        (message) => message.id !== learnerMessage.id,
      );
      this.draft = text;
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    } finally {
      if (generation === this.sessionGeneration) {
        clearTimeout(this.workingTimer);
        this.busy = false;
        this.slowRequest = false;
        if (this.askController === controller) this.askController = undefined;
      }
    }
  }

  private updateTransliteration(): void {
    this.transliterationSuggestion = this.transliterationEnabled
      ? suggestTransliteration(this.draft, this.ui)
      : null;
  }

  private async useTransliteration(): Promise<void> {
    if (!this.transliterationSuggestion?.trim() || this.busy) return;
    this.draft = this.transliterationSuggestion;
    this.transliterationSuggestion = null;
    this.notice = this.t("transliteration.applied");
    this.noticeIsError = false;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLTextAreaElement>("#message")?.focus();
  }

  private renderTransliteration() {
    if (!hasTransliteration(this.ui)) return nothing;
    return html`
      <section class="transliteration">
        <label class="setting-row">
          <input
            lang=${this.uiLanguage}
            dir=${this.uiDirection}
            type="checkbox"
            .checked=${this.transliterationEnabled}
            ?disabled=${this.busy}
            @change=${(event: Event) => {
              this.transliterationEnabled = (
                event.currentTarget as HTMLInputElement
              ).checked;
              this.updateTransliteration();
            }}
          />
          <span>${this.t("transliteration.enable")}</span>
        </label>
        ${
          this.transliterationEnabled
            ? html`<p id="transliteration-hint">
                ${this.t("transliteration.hint")}
              </p>`
            : nothing
        }
        ${
          this.transliterationSuggestion !== null
            ? html`
                <label for="transliteration-suggestion"
                  >${this.t("transliteration.suggestion")}</label
                >
                <textarea
                  lang=${this.uiLanguage}
                  dir=${this.uiDirection}
                  id="transliteration-suggestion"
                  aria-describedby="transliteration-hint"
                  .value=${this.transliterationSuggestion}
                  ?disabled=${this.busy}
                  @input=${(event: Event) => {
                    this.transliterationSuggestion = (
                      event.currentTarget as HTMLTextAreaElement
                    ).value;
                  }}
                ></textarea>
                <button
                  lang=${this.uiLanguage}
                  dir=${this.uiDirection}
                  type="button"
                  ?disabled=${this.busy || !this.transliterationSuggestion.trim()}
                  @click=${() => void this.useTransliteration()}
                >
                  ${this.t("transliteration.use")}
                </button>
              `
            : this.transliterationEnabled && /[A-Za-z]/u.test(this.draft)
              ? html`<p role="status">
                  ${this.t("transliteration.unavailable")}
                </p>`
              : nothing
        }
      </section>
    `;
  }

  private renderFallbackNotice() {
    return html`<p
      id="language-fallback-notice"
      class=${this.fallbackNotice ? "status" : "visually-hidden"}
      role="status"
      aria-live="polite"
    >
      ${this.fallbackNotice}
    </p>`;
  }

  private announceFallback(): void {
    if (!this.sessionId || !this.fallbackPending || this.fallbackAnnounced)
      return;
    this.fallbackNotice = this.t("notice.languageFallback");
    this.fallbackAnnounced = Boolean(this.fallbackNotice);
    this.fallbackPending = false;
  }

  private async speak(text: string, lang: string, id: string): Promise<void> {
    const generation = this.sessionGeneration;
    const request = ++this.speechRequest;
    if (this.hidden || !this.canSpeak(lang)) return;
    try {
      const runtime = await this.loadVoice();
      if (
        this.isConnected &&
        !this.hidden &&
        generation === this.sessionGeneration &&
        request === this.speechRequest
      )
        return runtime.speak.call(
          this as unknown as VoiceContext,
          text,
          lang,
          id,
        );
    } catch {
      if (generation !== this.sessionGeneration) return;
      this.notice = this.t("voice.outputFailed");
      this.noticeIsError = true;
    }
  }

  private startRecording(): void {
    this.voiceIntent = true;
    this.careerModule?.cancelVoice.call(this as unknown as CareerContext);
    if (this.hidden || !this.canRecord() || this.isRecording) return;
    const generation = this.sessionGeneration;
    const run = this.recordingRun;
    void this.loadVoice()
      .then((runtime) => {
        if (
          this.isConnected &&
          !this.hidden &&
          generation === this.sessionGeneration &&
          run === this.recordingRun
        )
          runtime.startRecording.call(this as unknown as VoiceContext);
      })
      .catch(() => {
        if (generation !== this.sessionGeneration) return;
        this.notice = this.t("voice.retry");
        this.noticeIsError = true;
      });
  }

  private async finishRecording(
    adapter: SpeechToText,
    lang: string,
    run: number,
  ): Promise<void> {
    return (
      (await this.voiceModule?.finishRecording.call(
        this as unknown as VoiceContext,
        adapter,
        lang,
        run,
      )) ?? Promise.resolve()
    );
  }

  private stopRecording(): void {
    return this.voiceModule?.stopRecording.call(
      this as unknown as VoiceContext,
    );
  }

  private cancelRecording(): void {
    this.recordingRun += 1;
    if (this.recordingTimer !== undefined)
      window.clearTimeout(this.recordingTimer);
    this.recordingTimer = undefined;
    // Cancellation is silent: leaving a language or widget must not start audio.
    this.recordingCueActive = false;
    try {
      if (this.isRecording) {
        if (this.speechToText?.cancel) this.speechToText.cancel();
        else this.speechToText?.stop();
      }
    } catch {
      // Invalidate the result even when a host adapter cannot cancel cleanly.
    } finally {
      this.isRecording = false;
      this.recordingStopRequested = false;
      this.speechReview = false;
    }
  }

  private startRecordingCue(): void {
    return this.voiceModule?.startRecordingCue.call(
      this as unknown as VoiceContext,
    );
  }

  private stopRecordingCue(): void {
    return this.voiceModule?.stopRecordingCue.call(
      this as unknown as VoiceContext,
    );
  }

  private playTone(frequency: number): void {
    return this.voiceModule?.playTone.call(
      this as unknown as VoiceContext,
      frequency,
    );
  }

  private vibrate(pattern: number | number[]): void {
    return this.voiceModule?.vibrate.call(
      this as unknown as VoiceContext,
      pattern,
    );
  }

  private canRecord(lang = this.selectedLang): boolean {
    return Boolean(
      (this.languages.find((language) => language.code === lang)?.stt ||
        this.cloudVoiceLangs.includes(lang)) &&
      this.speechToText?.supported(lang),
    );
  }

  /** On-device recognition exists for this language but needs a learner-approved download. */
  private canInstallVoice(lang = this.selectedLang): boolean {
    return Boolean(
      this.languages.find((language) => language.code === lang)?.stt &&
      this.speechToText?.installable?.(lang),
    );
  }

  private async installVoice(): Promise<void> {
    const lang = this.selectedLang;
    if (!this.speechToText?.install || this.voiceInstall === "installing")
      return;
    this.voiceInstall = "installing";
    const installed = await this.speechToText.install(lang).catch(() => false);
    this.voiceInstall = installed ? "idle" : "failed";
  }

  private canSpeak(lang: string): boolean {
    return Boolean(
      (this.languages.find((language) => language.code === lang)?.tts ||
        this.cloudVoiceLangs.includes(lang)) &&
      this.textToSpeech?.supported(lang),
    );
  }

  private pauseSpeech(): void {
    return this.voiceModule?.pauseSpeech.call(this as unknown as VoiceContext);
  }

  private resumeSpeech(): void {
    return this.voiceModule?.resumeSpeech.call(this as unknown as VoiceContext);
  }

  private stopSpeech(): void {
    this.speechRequest += 1;
    return this.voiceModule?.stopSpeech.call(this as unknown as VoiceContext);
  }

  private renderSpeechControls(id: string): unknown {
    if (this.speakingMessageId !== id) return nothing;
    return html`
      <div class="speech-controls">
        <button
          type="button"
          lang=${this.selectedLang}
          dir=${this.currentDirection}
          @click=${() =>
            this.speechPaused ? this.resumeSpeech() : this.pauseSpeech()}
        >
          ${this.t(this.speechPaused ? "voice.resume" : "voice.pause")}
        </button>
        <button
          type="button"
          lang=${this.selectedLang}
          dir=${this.currentDirection}
          @click=${() => this.stopSpeech()}
        >
          ${this.t("voice.stop")}
        </button>
      </div>
    `;
  }

  private speechRateFrom(value: string): WidgetSettings["speechRate"] {
    if (value === "0.75") return 0.75;
    if (value === "1.25") return 1.25;
    return 1;
  }

  private updateSpeechRate(event: Event): void {
    this.updateSettings({
      speechRate: this.speechRateFrom(
        (event.currentTarget as HTMLSelectElement).value,
      ),
    });
  }

  private setReadAloud(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "off" || value === "ask" || value === "always") {
      this.updateSettings({ readAloud: value });
    }
  }

  private readSettings(): WidgetSettings {
    const stored = storage.get("dimts.settings");
    if (!stored) return { ...defaultSettings };
    try {
      const parsed = JSON.parse(stored) as Partial<WidgetSettings>;
      return {
        ...defaultSettings,
        ...parsed,
        textScale: [100, 150, 200].includes(parsed.textScale ?? 100)
          ? (parsed.textScale as WidgetSettings["textScale"])
          : 100,
        readAloud: ["off", "ask", "always"].includes(parsed.readAloud ?? "off")
          ? (parsed.readAloud as WidgetSettings["readAloud"])
          : "off",
        speechRate:
          parsed.speechRate === 0.75 ||
          parsed.speechRate === 1 ||
          parsed.speechRate === 1.25
            ? parsed.speechRate
            : 1,
        soundCues: parsed.soundCues !== false,
      };
    } catch {
      return { ...defaultSettings };
    }
  }

  private updateSettings(patch: Partial<WidgetSettings>): void {
    if (patch.readAloud === "off" || patch.speechRate !== undefined)
      this.stopSpeech();
    this.settings = { ...this.settings, ...patch };
    if (this.settings.simple) {
      this.settings.textScale = this.settings.textScale === 200 ? 200 : 150;
      this.settings.readAloud = "always";
    }
    storage.set("dimts.settings", JSON.stringify(this.settings));
    this.style.setProperty(
      "--dimts-scale",
      String(this.settings.textScale / 100),
    );
    this.toggleAttribute("high-contrast", this.settings.highContrast);
    this.toggleAttribute("stop-motion", this.settings.stopMotion);
  }

  private get currentLanguage(): Language | undefined {
    return this.languages.find(({ code }) => code === this.selectedLang);
  }

  private get currentDirection(): "ltr" | "rtl" {
    return this.currentLanguage?.dir ?? "ltr";
  }

  private get suggestedLanguages(): Language[] {
    const suggestedCodes = suggestLanguageOptions(this.draft, this.languages);
    return this.languages.filter(({ code }) => suggestedCodes.includes(code));
  }

  private renderLanguageChoices(): unknown {
    return this.languages.map(
      (language) => html`
        <button
          class="language-choice"
          type="button"
          lang=${language.code}
          dir=${language.dir}
          @focus=${() =>
            void this.speak(
              language.nameNative,
              language.code,
              `language-${language.code}`,
            )}
          @click=${() => void this.chooseLanguage(language.code)}
        >
          <span class="language-name">${language.nameNative}</span>
          <span class="language-meta">
            ${language.nameEn}
            ${language.status === "beta" ? ` · ${this.t("status.beta")}` : ""}
          </span>
        </button>
      `,
    );
  }

  private renderSettings(): unknown {
    const textToSpeechAvailable = this.canSpeak(this.selectedLang);
    return html`
      <section
        class="panel"
        aria-labelledby="settings-heading"
        lang=${this.uiLanguage}
        dir=${this.currentLanguage?.dir ?? "ltr"}
      >
        <h2 id="settings-heading">${this.t("settings.title")}</h2>
        <fieldset class="setting-group">
          <legend>${this.t("settings.textSize")}</legend>
          <div class="settings-list">
            ${([100, 150, 200] as const).map(
              (scale) => html`
                <button
                  type="button"
                  lang=${this.uiLanguage}
                  dir=${this.uiDirection}
                  aria-pressed=${this.settings.textScale === scale}
                  @click=${() => this.updateSettings({ textScale: scale })}
                >
                  ${this.t(`settings.scale${scale}`)}
                </button>
              `,
            )}
          </div>
        </fieldset>
        <div class="setting-toggles">
          ${this.renderToggle(
            "settings.highContrast",
            this.settings.highContrast,
            (value) => this.updateSettings({ highContrast: value }),
          )}
          ${this.renderToggle(
            "settings.stopMotion",
            this.settings.stopMotion,
            (value) => this.updateSettings({ stopMotion: value }),
          )}
          ${this.renderToggle("voice.soundCues", this.settings.soundCues, (value) => this.updateSettings({ soundCues: value }))}
          ${this.renderToggle(
            "settings.simple",
            this.settings.simple,
            (value) => this.updateSettings({ simple: value }),
          )}
          ${!this.settings.simple ? this.renderToggle("settings.dataSaver", this.settings.dataSaver, (value) => this.updateSettings({ dataSaver: value })) : nothing}
        </div>
        ${
          !this.settings.simple
            ? html`
                ${this.renderToggle("settings.shortcuts", this.settings.shortcuts, (value) => this.updateSettings({ shortcuts: value }))}
                <p>${this.t("settings.shortcutsHelp")}</p>
                <label class="setting-row" for="read-aloud">
                  <span>${this.t("settings.readAloud")}</span>
                  <select
                    id="read-aloud"
                    lang=${this.uiLanguage}
                    dir=${this.uiDirection}
                    aria-describedby=${
                      textToSpeechAvailable ? nothing : "read-aloud-unavailable"
                    }
                    ?disabled=${!textToSpeechAvailable}
                    .value=${this.settings.readAloud}
                    @change=${(event: Event) => this.setReadAloud(event)}
                  >
                    <option value="off">${this.t("settings.off")}</option>
                    <option value="ask">${this.t("settings.ask")}</option>
                    <option value="always">${this.t("settings.always")}</option>
                  </select>
                </label>
                <label class="setting-row" for="speech-rate">
                  <span>${this.t("voice.speed")}</span>
                  <select
                    id="speech-rate"
                    lang=${this.uiLanguage}
                    dir=${this.uiDirection}
                    aria-describedby=${
                      textToSpeechAvailable ? nothing : "read-aloud-unavailable"
                    }
                    ?disabled=${!textToSpeechAvailable}
                    .value=${String(this.settings.speechRate)}
                    @change=${(event: Event) => this.updateSpeechRate(event)}
                  >
                    <option value="0.75">${this.t("voice.rate075")}</option>
                    <option value="1">${this.t("voice.rate100")}</option>
                    <option value="1.25">${this.t("voice.rate125")}</option>
                  </select>
                </label>
              `
            : nothing
        }
        ${
          textToSpeechAvailable
            ? nothing
            : html`<p
                class="muted"
                id="read-aloud-unavailable"
                lang=${this.uiLanguage}
                dir=${this.uiDirection}
              >
                ${this.t("voice.unavailable")}
              </p>`
        }
        ${
          this.sessionId
            ? html`
                <section
                  class="setting-group"
                  aria-labelledby="delete-data-heading"
                >
                  <h3 id="delete-data-heading">
                    ${this.t("privacy.deleteTitle")}
                  </h3>
                  <p>${this.t("privacy.deleteDescription")}</p>
                  <p>
                    <a
                      href="https://github.com/lelisa21/alx-hackathon/blob/main/docs/PRIVACY.md"
                      target="_blank"
                      rel="noopener noreferrer"
                      lang=${this.uiLanguage}
                      dir=${this.uiDirection}
                      >${this.t("privacy.policyLink")}</a
                    >
                  </p>
                  ${
                    this.deleteConfirmOpen
                      ? html`
                          <p>${this.t("privacy.deleteConfirm")}</p>
                          <div class="settings-list">
                            <button
                              lang=${this.uiLanguage}
                              dir=${this.uiDirection}
                              type="button"
                              ?disabled=${this.deletingData}
                              @click=${() => void this.deleteMyData()}
                            >
                              ${
                                this.deletingData
                                  ? this.t("privacy.deleting")
                                  : this.t("privacy.deleteConfirmButton")
                              }
                            </button>
                            <button
                              lang=${this.uiLanguage}
                              dir=${this.uiDirection}
                              type="button"
                              ?disabled=${this.deletingData}
                              @click=${() => {
                                this.deleteConfirmOpen = false;
                                this.deleteDataNotice = "";
                              }}
                            >
                              ${this.t("privacy.deleteCancel")}
                            </button>
                          </div>
                        `
                      : html`
                          <button
                            lang=${this.uiLanguage}
                            dir=${this.uiDirection}
                            type="button"
                            @click=${() => {
                              this.deleteConfirmOpen = true;
                              this.deleteDataNotice = "";
                            }}
                          >
                            ${this.t("privacy.deleteButton")}
                          </button>
                        `
                  }
                  <p role="status" aria-live="polite">
                    ${this.deleteDataNotice}
                  </p>
                </section>
              `
            : nothing
        }
      </section>
    `;
  }

  private async deleteMyData(): Promise<void> {
    if (!this.sessionId || !this.sessionToken || this.deletingData) return;
    this.deletingData = true;
    this.deleteDataNotice = this.t("privacy.deleting");
    try {
      const response = await this.request(`${this.apiRoot}/data/delete`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sessionId: this.sessionId }),
      });
      if (!response.ok) throw new Error("data deletion failed");
      this.clearOwnedStorage();
      this.resetExpiredSession();
      this.panel = "settings";
      this.deleteConfirmOpen = false;
      this.deleteDataNotice = this.t("privacy.deleted");
      this.notice = this.deleteDataNotice;
      this.noticeIsError = false;
    } catch {
      this.deleteDataNotice = this.t("privacy.deleteFailed");
    } finally {
      this.deletingData = false;
    }
  }

  private renderToggle(
    key: string,
    checked: boolean,
    change: (value: boolean) => void,
  ): unknown {
    const id = key.replaceAll(".", "-");
    return html`
      <label class="setting-row" for=${id}>
        <span>${this.t(key)}</span>
        <input
          id=${id}
          type="checkbox"
          lang=${this.uiLanguage}
          dir=${this.uiDirection}
          .checked=${checked}
          @change=${(event: Event) =>
            change((event.currentTarget as HTMLInputElement).checked)}
        />
      </label>
    `;
  }

  private renderOfflineBanner(): unknown {
    return this.offline
      ? html`
          <p
            class="offline-banner"
            role="status"
            aria-live="polite"
            lang=${this.selectedLang}
            dir=${this.currentDirection}
          >
            <span aria-hidden="true">!</span>
            ${this.t(
              this.offlineSupportAvailable
                ? "offline.banner"
                : "offline.limited",
            )}
          </p>
        `
      : nothing;
  }

  private renderHelpButton(): unknown {
    return html`
      <button
        class="help"
        type="button"
        lang=${this.selectedLang}
        dir=${this.currentDirection}
        ?disabled=${Boolean(this.helpRequestId)}
        @click=${() => this.escalate()}
      >
        ${this.t("help.button")}
      </button>
    `;
  }

  /** Text size, high contrast and Simple mode, one tap away on every screen. */
  private renderA11y(): unknown {
    const { textScale, highContrast, simple } = this.settings;
    const sizeLabel = `${this.t("settings.textSize")} ${textScale}%`;
    const toggle = (
      kind: string,
      label: string,
      pressed: boolean,
      patch: Partial<WidgetSettings>,
    ) =>
      html`<button
        class=${`a11y-${kind}`}
        type="button"
        lang=${this.uiLanguage}
        dir=${this.uiDirection}
        aria-label=${label}
        title=${label}
        aria-pressed=${pressed}
        @click=${() => this.updateSettings(patch)}
      ></button>`;
    return html`<div
      class="a11y"
      role="group"
      aria-label=${this.t("settings.title")}
    >
      <button
        class="a11y-size"
        type="button"
        lang=${this.uiLanguage}
        dir=${this.uiDirection}
        aria-label=${sizeLabel}
        title=${sizeLabel}
        @click=${() =>
          this.updateSettings({
            textScale: textScale === 100 ? 150 : textScale === 150 ? 200 : 100,
          })}
      ></button>
      ${toggle("contrast", this.t("settings.highContrast"), highContrast, {
        highContrast: !highContrast,
      })}
      ${toggle("simple", this.t("settings.simple"), simple, { simple: !simple })}
    </div>`;
  }

  private renderUtilities(a11y = true): unknown {
    return html`<div class="header-actions">
      ${a11y ? this.renderA11y() : nothing}
      <button
        lang=${this.uiLanguage}
        dir=${this.uiDirection}
        type="button"
        @click=${() => (this.panel = this.panel === "settings" ? null : "settings")}
      >
        ${this.t("settings.button")}
      </button>
      <button
        lang=${this.uiLanguage}
        dir=${this.uiDirection}
        type="button"
        @click=${() => void this.openFaq()}
      >
        ${this.t("faq.action")}
      </button>
    </div>`;
  }

  private renderHelpPreview(): unknown {
    return (
      this.helpModule?.renderHelpPreview.call(this as unknown as HelpContext) ??
      nothing
    );
  }

  private renderHelpSession(): unknown {
    return (
      this.helpModule?.renderHelpSession.call(this as unknown as HelpContext) ??
      nothing
    );
  }

  override render() {
    if (this.loading) {
      return html`<main
        lang=${this.selectedLang || "en"}
        dir=${this.currentDirection}
      >
        ${this.renderUtilities()}
        ${this.panel === "settings" ? this.renderSettings() : nothing}
        ${this.renderFaq()} ${this.renderHelpButton()}
        ${this.renderHelpPreview()}
        <p class="status" role="status" aria-live="polite">
          ${this.notice || this.t("status.loading")}
        </p>
        ${this.notice ? html`<button lang=${this.uiLanguage} dir=${this.uiDirection} type="button" @click=${() => void this.retryStartup()}>${this.t("error.retry")}</button>` : nothing}
      </main>`;
    }
    if (this.languages.length === 0 || !this.selectedLang) {
      return html`<main>
        ${this.renderUtilities()}
        ${this.panel === "settings" ? this.renderSettings() : nothing}
        ${this.renderFaq()} ${this.renderHelpButton()}
        ${this.renderHelpPreview()}
        <p class="status" role="alert">${this.notice}</p>
        <button
          lang=${this.uiLanguage}
          dir=${this.uiDirection}
          type="button"
          @click=${() => void this.retryStartup()}
        >
          ${this.t("error.retry")}
        </button>
      </main>`;
    }
    if (!this.sessionId) {
      return html`
        <main
          lang=${this.selectedLang}
          dir=${this.currentLanguage?.dir ?? "ltr"}
        >
          ${this.renderOfflineBanner()} ${this.renderFallbackNotice()}
          ${this.renderUtilities()}
          ${this.panel === "settings" ? this.renderSettings() : nothing}
          ${this.renderFaq()} ${this.renderHelpButton()}
          ${this.renderHelpSession()} ${this.renderHelpPreview()}
          <section class="welcome" aria-labelledby="welcome-heading">
            <h1 id="welcome-heading">${this.t("welcome.title")}</h1>
            <div class="language-list">${this.renderLanguageChoices()}</div>
            <p class="status" role="status" aria-live="polite">
              ${this.notice}
            </p>
            ${this.notice ? html`<button lang=${this.uiLanguage} dir=${this.uiDirection} type="button" @click=${() => void this.retryStartup()}>${this.t("error.retry")}</button>` : nothing}
          </section>
        </main>
      `;
    }
    return html`
      <main lang=${this.selectedLang} dir=${this.currentLanguage?.dir ?? "ltr"}>
        ${this.renderOfflineBanner()} ${this.renderFallbackNotice()}
        <header>
          <span class="brand">
            <span class="avatar" aria-hidden="true">${this.avatarLetter}</span>
            <span class="brand-text"
              ><strong>${this.t("app.name")}</strong
              ><span class="tagline">${this.t("app.tagline")}</span></span
            >
          </span>
          ${this.renderA11y()}
          <div class="header-actions">
            <button
              type="button"
              lang=${this.selectedLang}
              dir=${this.currentDirection}
              @click=${() => (this.panel = this.panel === "language" ? null : "language")}
            >
              ${this.t("language.button")}
            </button>
            <button
              class="career-launcher"
              type="button"
              lang=${this.uiLanguage}
              dir=${this.uiDirection}
              @click=${() => void this.openCareer()}
            >
              ${this.t("jobs.title")}
            </button>
            ${this.renderUtilities(false)}
          </div>
        </header>
        ${this.renderHelpButton()} ${this.renderHelpSession()}
        ${this.renderHelpPreview()}
        ${this.careerModule?.render.call(this as unknown as CareerContext) ?? nothing}
        ${
          this.panel === "language"
            ? html`
                <section class="panel" aria-label=${this.t("language.button")}>
                  <div class="language-list">
                    ${this.renderLanguageChoices()}
                  </div>
                </section>
              `
            : nothing
        }
        ${this.panel === "settings" ? this.renderSettings() : nothing}
        ${this.renderFaq()}
        ${this.messages.length ? this.renderConsent() : nothing}
        <div class="chat">
          <div
            class="messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label=${this.t("chat.log")}
          >
            ${this.messages.length === 0 ? this.renderEmptyState() : nothing}
            ${this.messages.map((message) =>
              message.role === "learner"
                ? html`
                    <article
                      data-role="learner"
                      lang=${message.lang}
                      dir=${message.dir}
                      aria-label=${this.t("chat.you")}
                      aria-live="off"
                    >
                      <p>${message.text}</p>
                    </article>
                  `
                : html`
                    <article
                      data-role="assistant"
                      data-message-id=${message.id}
                      tabindex="-1"
                      lang=${message.lang}
                      dir=${message.dir}
                      aria-label=${this.t("chat.dimts")}
                    >
                      <span class="avatar" aria-hidden="true"
                        >${this.avatarLetter}</span
                      >
                      <p>${message.text}</p>
                      ${
                        message.citations.length
                          ? html`
                              <div class="citations">
                                ${(this.settings.simple
                                  ? message.citations.slice(0, 1)
                                  : message.citations
                                ).map(
                                  (citation) => html`
                                    <a
                                      class="citation"
                                      lang=${this.uiLanguage}
                                      dir=${this.uiDirection}
                                      href=${citation.url}
                                      target="_blank"
                                      rel="noopener"
                                    >
                                      ${this.t("answer.source", { lesson: citation.label })}
                                    </a>
                                  `,
                                )}
                              </div>
                            `
                          : nothing
                      }
                      <div class="reply-actions">
                        <button
                          lang=${this.uiLanguage}
                          dir=${this.uiDirection}
                          type="button"
                          @click=${() => void this.copyReply(message)}
                        >
                          ${this.t("answer.copy")}
                        </button>
                        <button
                          lang=${this.uiLanguage}
                          dir=${this.uiDirection}
                          type="button"
                          aria-pressed=${this.feedback[message.id] === true}
                          @click=${() => void this.rateReply(message.id, true)}
                        >
                          ${this.t("answer.helpful")}
                        </button>
                        <button
                          lang=${this.uiLanguage}
                          dir=${this.uiDirection}
                          type="button"
                          aria-pressed=${this.feedback[message.id] === false}
                          @click=${() => void this.rateReply(message.id, false)}
                        >
                          ${this.t("answer.notHelpful")}
                        </button>
                        ${
                          this.canSpeak(message.lang)
                            ? html`
                                <button
                                  class="read-aloud"
                                  type="button"
                                  lang=${this.uiLanguage}
                                  dir=${this.uiDirection}
                                  @click=${() => {
                                    this.voiceIntent = true;
                                    void this.speak(
                                      message.text,
                                      message.lang,
                                      message.id,
                                    );
                                  }}
                                >
                                  ${this.t("voice.readReply")}
                                </button>
                                ${this.renderSpeechControls(message.id)}
                              `
                            : html`<span
                                class="muted"
                                lang=${this.uiLanguage}
                                dir=${this.uiDirection}
                                >${this.t("voice.unavailable")}</span
                              >`
                        }
                      </div>
                    </article>
                  `,
            )}
            ${
              this.busy
                ? html`<div class="typing" aria-hidden="true">
                    <span class="avatar">${this.avatarLetter}</span
                    ><span class="dots"><i></i><i></i><i></i></span>
                  </div>`
                : nothing
            }
          </div>
          <p
            class="status"
            role=${
              this.retryAvailable || this.noticeIsError ? "alert" : "status"
            }
            aria-live=${
              this.retryAvailable || this.noticeIsError ? "assertive" : "polite"
            }
          >
            ${this.notice}
            ${this.slowRequest ? html`<button type="button" lang=${this.uiLanguage} dir=${this.uiDirection} @click=${() => void this.retryQuestion()}>${this.t("error.retry")}</button>` : nothing}
            ${
              this.retryAvailable
                ? html`
                    <button
                      type="button"
                      lang=${this.selectedLang}
                      dir=${this.currentDirection}
                      @click=${() =>
                        this.renderRoot
                          .querySelector<HTMLFormElement>(".composer")
                          ?.requestSubmit()}
                    >
                      ${this.t("error.retry")}
                    </button>
                  `
                : nothing
            }
          </p>
          <form
            class="composer"
            @submit=${(event: SubmitEvent) => void this.submit(event)}
            lang=${this.selectedLang}
            dir=${this.currentLanguage?.dir ?? "ltr"}
          >
            <label for="message">${this.t("composer.label")}</label>
            <textarea
              id="message"
              lang=${this.selectedLang}
              dir=${this.currentDirection}
              .value=${this.draft}
              placeholder=${this.t("composer.placeholder")}
              ?disabled=${this.busy}
              @input=${(event: Event) => {
                this.pendingQuestion = undefined;
                this.draft = (event.currentTarget as HTMLTextAreaElement).value;
                this.updateTransliteration();
              }}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  this.renderRoot
                    .querySelector<HTMLFormElement>(".composer")
                    ?.requestSubmit();
                }
              }}
            ></textarea>
            ${this.renderTransliteration()} ${this.renderCloudVoicePrompt()}
            ${this.currentLanguage?.status === "beta" && (this.canRecord() || this.canSpeak(this.selectedLang)) ? html`<p class="muted">${this.t("status.beta")}: ${this.t("voice.betaNote")}</p>` : nothing}
            ${this.isRecording ? html`<p class="status" role="status" aria-live="polite">${this.t(this.recordingStopRequested ? "voice.processing" : "voice.listening")}</p>` : nothing}
            ${
              this.speechReview
                ? html`
                    <p
                      class="status"
                      role="status"
                      aria-live="polite"
                      lang=${this.selectedLang}
                      dir=${this.currentDirection}
                    >
                      ${this.t("review.heard", { text: this.draft })}
                    </p>
                    <button
                      type="button"
                      lang=${this.selectedLang}
                      dir=${this.currentDirection}
                      @click=${() => this.startRecording()}
                    >
                      ${this.t("review.retry")}
                    </button>
                    ${this.renderSpeechControls("review")}
                  `
                : nothing
            }
            ${
              this.suggestedLanguages.length > 0
                ? html`
                    <section
                      class="suggestions"
                      aria-label=${this.t(
                        /\p{Script=Ethiopic}/u.test(this.draft)
                          ? "language.suggestion.am"
                          : "language.suggestion.latin",
                      )}
                      lang=${this.selectedLang}
                      dir=${this.currentDirection}
                    >
                      <p>
                        ${this.t(
                          /\p{Script=Ethiopic}/u.test(this.draft)
                            ? "language.suggestion.am"
                            : "language.suggestion.latin",
                        )}
                      </p>
                      <div class="header-actions">
                        ${this.suggestedLanguages.map(
                          (language) => html`
                            <button
                              type="button"
                              lang=${language.code}
                              dir=${language.dir}
                              aria-pressed=${language.code === this.selectedLang}
                              @click=${() => {
                                void this.chooseLanguage(language.code);
                              }}
                            >
                              ${language.nameNative}
                            </button>
                          `,
                        )}
                      </div>
                    </section>
                  `
                : nothing
            }
            <div class="composer-actions">
              ${
                !this.canRecord() && this.canInstallVoice()
                  ? html`<span class="voice-install">
                      <button
                        type="button"
                        lang=${this.selectedLang}
                        dir=${this.currentDirection}
                        ?disabled=${this.voiceInstall === "installing"}
                        @click=${() => void this.installVoice()}
                      >
                        ${this.t("voice.install")}
                      </button>
                      <span class="muted" role="status" aria-live="polite"
                        >${
                          this.voiceInstall === "installing"
                            ? this.t("voice.installing")
                            : this.voiceInstall === "failed"
                              ? this.t("voice.installFailed")
                              : ""
                        }</span
                      >
                    </span>`
                  : this.canRecord()
                    ? nothing
                    : html`<span
                        class="muted"
                        id="voice-input-unavailable"
                        lang=${this.selectedLang}
                        dir=${this.currentDirection}
                      >
                        ${this.t("voice.inputUnavailable")}
                      </span>`
              }
              ${
                this.canRecord()
                  ? html`<button
                      class="mic"
                      type="button"
                      lang=${this.selectedLang}
                      dir=${this.currentDirection}
                      aria-label=${this.t(
                        this.isRecording ? "mic.stop" : "mic.start",
                      )}
                      aria-pressed=${this.isRecording}
                      ?disabled=${this.busy || this.recordingStopRequested}
                      @click=${() =>
                        this.isRecording
                          ? this.stopRecording()
                          : this.startRecording()}
                    >
                      ${this.t(this.isRecording ? "mic.stop" : "mic.start")}
                    </button>`
                  : nothing
              }
              <button
                class=${this.helpPreviewOpen || this.helpRequestId ? "send-action" : "primary send-action"}
                type="submit"
                lang=${this.selectedLang}
                dir=${this.currentDirection}
                ?disabled=${this.busy || this.isRecording || this.consentBusy || this.consentFailed}
              >
                ${this.t("review.send")}
              </button>
            </div>
          </form>
        </div>
      </main>
    `;
  }
}

if (!customElements.get("dimts-assistant")) {
  customElements.define("dimts-assistant", DimtsAssistant);
}

declare global {
  interface HTMLElementTagNameMap {
    "dimts-assistant": DimtsAssistant;
  }
}

installDefaultApi();
