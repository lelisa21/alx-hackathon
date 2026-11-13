import { LitElement, css, html, nothing } from "lit";
import { messageFor } from "./messages.js";
import { MAX_RECORDING_MS, VoiceError } from "@dimts/voice";
import type { SpeechToText, TextToSpeech } from "@dimts/voice";
import { suggestLanguageOptions } from "./language.js";
import {
  hasTransliteration,
  suggestTransliteration,
} from "./transliteration.js";
import ethiopicRegularFontUrl from "../../../assets/fonts/NotoSansEthiopic-ethiopic-400-normal.woff2?url&no-inline";
import ethiopicBoldFontUrl from "../../../assets/fonts/NotoSansEthiopic-ethiopic-700-normal.woff2?url&no-inline";

let ethiopicFontsRegistered = false;

function registerEthiopicFonts(): void {
  if (ethiopicFontsRegistered) return;
  document.fonts.add(
    new FontFace("Noto Sans Ethiopic", `url(${ethiopicRegularFontUrl})`, {
      display: "swap",
      weight: "400",
      unicodeRange: "U+1200-137F, U+1380-139F",
    }),
  );
  document.fonts.add(
    new FontFace("Noto Sans Ethiopic", `url(${ethiopicBoldFontUrl})`, {
      display: "swap",
      weight: "700",
      unicodeRange: "U+1200-137F, U+1380-139F",
    }),
  );
  ethiopicFontsRegistered = true;
}

interface Language {
  code: string;
  nameNative: string;
  nameEn: string;
  script: string;
  dir: "ltr" | "rtl";
  status: "live" | "beta" | "draft";
  stt: boolean;
  tts: boolean;
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

interface ConversationMessage {
  id: string;
  role: "learner" | "assistant";
  text: string;
  lang: string;
  dir: "ltr" | "rtl";
  citations: Citation[];
}

interface HelpChatMessage {
  id: string;
  from: "learner" | "helper";
  text: string;
}

interface WidgetSettings {
  textScale: 100 | 150 | 200;
  highContrast: boolean;
  stopMotion: boolean;
  simple: boolean;
  dataSaver: boolean;
  readAloud: "off" | "ask" | "always";
  speechRate: 0.75 | 1 | 1.25;
}

const defaultSettings: WidgetSettings = {
  textScale: 100,
  highContrast: false,
  stopMotion: false,
  simple: false,
  dataSaver: false,
  readAloud: "off",
  speechRate: 1,
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
  declare private offline: boolean;
  declare private offlineSupportAvailable: boolean;
  declare private busy: boolean;
  declare private retryAvailable: boolean;
  declare private panel: "language" | "settings" | null;
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
  private recordingStopRequested = false;
  private recordingRun = 0;
  private recordingCueActive = false;
  private speechRun = 0;
  private audioContext: AudioContext | undefined;
  private helpSocket: WebSocket | undefined;
  private helpReconnectTimer: number | undefined;
  private helpReconnectAttempt = 0;

  constructor() {
    super();
    this.api = "";
    this.hostKey = "";
    this.speechToText = undefined;
    this.textToSpeech = undefined;
    this.languages = [];
    this.selectedLang = "";
    this.ui = {};
    this.messages = [];
    this.sessionId = "";
    this.sessionToken = "";
    this.loading = true;
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
  }

  static override styles = css`
    :host {
      --dimts-surface: #ffffff;
      --dimts-text: #14232b;
      --dimts-muted: #344b55;
      --dimts-primary: #164e63;
      --dimts-primary-text: #ffffff;
      --dimts-border: #526773;
      color: var(--dimts-text);
      display: block;
      font-family:
        system-ui,
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

    :host([high-contrast]) {
      --dimts-surface: #ffffff;
      --dimts-text: #000000;
      --dimts-muted: #1a1a1a;
      --dimts-primary: #000000;
      --dimts-primary-text: #ffffff;
      --dimts-border: #000000;
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
    }

    button,
    select {
      border: 2px solid var(--dimts-border);
      border-radius: 0.5rem;
      background: var(--dimts-surface);
      padding: 0.625rem 0.875rem;
    }

    button {
      cursor: pointer;
    }

    button:disabled {
      cursor: not-allowed;
      border-style: dashed;
    }

    :focus-visible {
      outline: 3px solid #005fcc;
      outline-offset: 2px;
    }

    main {
      background: var(--dimts-surface);
      border: 1px solid var(--dimts-border);
      border-radius: 0.75rem;
      display: flex;
      flex-direction: column;
      margin-inline: auto;
      max-inline-size: 42rem;
      min-block-size: 32rem;
      overflow-wrap: anywhere;
      padding-block-end: 4.5rem;
      position: relative;
    }

    header {
      align-items: center;
      border-block-end: 1px solid var(--dimts-border);
      display: flex;
      gap: 0.5rem;
      justify-content: space-between;
      padding: 0.75rem;
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

    .welcome,
    .panel {
      padding: 1.25rem;
    }

    .language-list {
      flex-direction: column;
    }

    .language-choice {
      min-block-size: 64px;
      text-align: start;
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
      flex: 1;
      min-block-size: 12rem;
      overflow-y: auto;
      padding: 1rem;
    }

    article {
      border: 1px solid var(--dimts-border);
      border-radius: 0.5rem;
      margin-block: 0 0.75rem;
      padding: 0.75rem;
    }

    article[data-role="learner"] {
      background: #f0f5f7;
    }

    article p {
      margin-block: 0;
      white-space: pre-wrap;
    }

    .citations {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-block-start: 0.75rem;
    }

    a {
      align-items: center;
      color: #064b70;
      display: inline-flex;
      overflow-wrap: anywhere;
      padding: 0.25rem;
    }

    .composer {
      border-block-start: 1px solid var(--dimts-border);
      padding: 0.75rem;
    }

    textarea {
      border: 2px solid var(--dimts-border);
      border-radius: 0.5rem;
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

    .help {
      align-self: flex-end;
      inset-block-end: 0.75rem;
      inset-inline-end: 0.75rem;
      order: 1;
      position: fixed;
      z-index: 1;
    }

    .help-backdrop {
      align-items: center;
      background: rgb(0 0 0 / 55%);
      display: grid;
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
        min-block-size: 100%;
      }

      header {
        align-items: flex-start;
        flex-direction: column;
      }

      .composer-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      }

      .composer-actions > .muted {
        grid-column: 1;
        grid-row: 1;
      }

      .composer-actions .mic {
        grid-column: 2;
        grid-row: 1;
        justify-self: center;
      }

      .composer-actions .primary {
        grid-column: 3;
        grid-row: 1;
        justify-self: end;
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
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("online", this.handleOnline);
    this.toggleAttribute("high-contrast", this.settings.highContrast);
    this.toggleAttribute("stop-motion", this.settings.stopMotion);
    this.style.setProperty(
      "--dimts-scale",
      String(this.settings.textScale / 100),
    );
    void this.enableOfflineSupport();
    void this.initialize();
    if (this.helpRequestId) this.connectHelpSocket();
  }

  protected override updated(): void {
    // Populate an already mounted live region, including after initial startup.
    if (!this.loading) this.announceFallback();
  }

  override disconnectedCallback(): void {
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
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
    try {
      if (this.isRecording) {
        this.stopRecordingCue();
        this.speechToText?.stop();
      }
    } catch {
      this.notice = this.t("voice.retry");
      this.noticeIsError = true;
    } finally {
      this.recordingRun += 1;
      this.isRecording = false;
      this.recordingStopRequested = false;
      this.stopSpeech();
      super.disconnectedCallback();
    }
  }

  private readonly handleOffline = (): void => {
    this.offline = true;
  };

  private readonly handleOnline = (): void => {
    this.offline = false;
  };

  private async enableOfflineSupport(): Promise<void> {
    if (
      !("serviceWorker" in navigator) ||
      new URL(import.meta.url).origin !== location.origin
    ) {
      return;
    }

    const workerUrl = new URL("/service-worker.js", location.origin);
    workerUrl.searchParams.set("asset", import.meta.url);
    try {
      await navigator.serviceWorker.register(workerUrl, { scope: "/" });
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
      const response = await fetch(url);
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
    try {
      const response = await this.fetchStatic(
        `${this.apiRoot}/languages${this.previewQuery}`,
      );
      if (!response.ok) throw new Error("languages");
      const body = (await response.json()) as { languages: Language[] };
      this.languages = body.languages.filter(
        (language) => language.status !== "draft" || Boolean(this.previewQuery),
      );
      if (this.languages.length === 0) throw new Error("languages");
      const stored = storage.get("dimts.lang");
      const remembered = this.languages.find(({ code }) => code === stored);
      if (remembered) {
        await this.chooseLanguage(remembered.code, false);
      } else {
        this.setSelectedLanguage(this.languages[0]!.code);
        await this.loadUi(this.selectedLang);
      }
    } catch {
      this.notice = this.t("error.network");
    } finally {
      this.loading = false;
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
        if (
          code !== lang ||
          response.headers.get("X-Dimts-Locale-Fallback") === "1"
        ) {
          this.fallbackPending = true;
        }
        return;
      } catch {
        continue;
      }
    }
    this.ui = {};
  }

  private setSelectedLanguage(code: string): void {
    if (code === "am") registerEthiopicFonts();
    this.selectedLang = code;
    this.transliterationEnabled = false;
    this.transliterationSuggestion = null;
    this.setAttribute("lang", code);
  }

  private async chooseLanguage(code: string, persist = true): Promise<void> {
    const selected = this.languages.find((language) => language.code === code);
    if (!selected) return;
    this.stopSpeech();
    this.fallbackNotice = "";
    this.fallbackPending = false;
    this.setSelectedLanguage(selected.code);
    await this.loadUi(selected.code);
    if (persist) {
      storage.set("dimts.lang", selected.code);
      window.dispatchEvent(
        new CustomEvent("dimts:language", { detail: { lang: selected.code } }),
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
    void this.chooseLanguage(code);
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
    if (this.helpRequestId || this.helpBusy) return;
    this.helpIncludeSummary = true;
    this.helpNotice = "";
    this.helpNoticeIsError = false;
    this.helpPreviewOpen = true;
    await this.updateComplete;
    this.renderRoot
      .querySelector<HTMLInputElement>(".help-dialog input")
      ?.focus();
  }

  private async cancelHelpPreview(): Promise<void> {
    this.helpPreviewOpen = false;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLButtonElement>(".help")?.focus();
  }

  private trapHelpDialog(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      void this.cancelHelpPreview();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        ".help-dialog input, .help-dialog button",
      ),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    const activeElement =
      this.renderRoot instanceof ShadowRoot
        ? this.renderRoot.activeElement
        : null;
    if (!first || !last) return;
    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private async createHelpRequest(): Promise<void> {
    if (this.helpBusy || !this.helpPreviewOpen) return;
    this.helpBusy = true;
    this.helpNotice = "";
    this.helpNoticeIsError = false;
    try {
      if (!this.sessionId || !this.sessionToken) {
        await this.createSession();
      }
      if (!this.sessionId || !this.sessionToken) {
        this.helpNotice = this.t("help.error");
        this.helpNoticeIsError = true;
        return;
      }
      const response = await fetch(`${this.apiRoot}/help`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          includeSummary: this.helpIncludeSummary,
        }),
      });
      if (!response.ok) {
        this.helpNotice = this.t(
          response.status === 429 ? "help.limit" : "help.error",
        );
        this.helpNoticeIsError = true;
        return;
      }
      const request = (await response.json()) as {
        id: string;
        status: "waiting";
      };
      if (
        typeof request.id !== "string" ||
        request.id.length === 0 ||
        request.status !== "waiting"
      ) {
        this.helpNotice = this.t("help.error");
        this.helpNoticeIsError = true;
        return;
      }
      this.helpRequestId = request.id;
      this.helpMessages = [];
      this.helpDraft = "";
      this.helpStatus = "connecting";
      this.helpPreviewOpen = false;
      this.helpNotice = "";
      this.helpNoticeIsError = false;
      this.connectHelpSocket();
      await this.updateComplete;
      this.renderRoot
        .querySelector<HTMLTextAreaElement>(".help-chat textarea")
        ?.focus();
    } catch {
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
    } finally {
      this.helpBusy = false;
    }
  }

  private connectHelpSocket(): void {
    if (
      !this.isConnected ||
      !this.helpRequestId ||
      !this.sessionId ||
      !this.sessionToken
    ) {
      return;
    }
    if (this.helpSocket && this.helpSocket.readyState < WebSocket.CLOSING) {
      return;
    }
    try {
      const url = new URL(`${this.apiRoot}/help/ws`, location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      this.helpSocket = socket;
      socket.onopen = () => {
        if (!this.helpRequestId || this.helpSocket !== socket) {
          socket.close();
          return;
        }
        const lastMessageId = this.helpMessages.at(-1)?.id;
        socket.send(
          JSON.stringify({
            type: "auth",
            requestId: this.helpRequestId,
            role: "learner",
            sessionId: this.sessionId,
            token: this.sessionToken,
            ...(lastMessageId ? { lastMessageId } : {}),
          }),
        );
      };
      socket.onmessage = (event: MessageEvent<unknown>) => {
        this.handleHelpFrame(event.data);
      };
      socket.onerror = () => {
        this.helpStatus = "reconnecting";
      };
      socket.onclose = (event: CloseEvent) => {
        if (this.helpSocket === socket) this.helpSocket = undefined;
        if (event.code === 4401) {
          this.helpStatus = "";
          this.helpNotice = this.t("help.error");
          this.helpNoticeIsError = true;
        } else if (this.isConnected && this.helpRequestId) {
          this.helpStatus = "reconnecting";
          this.scheduleHelpReconnect();
        }
      };
    } catch {
      this.helpStatus = "reconnecting";
      this.scheduleHelpReconnect();
    }
  }

  private scheduleHelpReconnect(): void {
    if (
      !this.isConnected ||
      !this.helpRequestId ||
      this.helpReconnectTimer !== undefined
    ) {
      return;
    }
    const delay = Math.min(1_000 * 2 ** this.helpReconnectAttempt, 30_000);
    this.helpReconnectAttempt += 1;
    this.helpReconnectTimer = window.setTimeout(() => {
      this.helpReconnectTimer = undefined;
      this.connectHelpSocket();
    }, delay);
  }

  private handleHelpFrame(raw: unknown): void {
    if (typeof raw !== "string") {
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
      return;
    }
    if (typeof frame !== "object" || frame === null || !("type" in frame)) {
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
      return;
    }
    if (frame.type === "help.joined") {
      this.helpStatus = "connected";
      this.helpReconnectAttempt = 0;
      this.helpNotice = "";
      this.helpNoticeIsError = false;
      return;
    }
    if (frame.type === "help.closed") {
      this.helpRequestId = "";
      this.helpMessages = [];
      this.helpDraft = "";
      this.helpStatus = "";
      this.helpAnnouncement = "";
      this.helpSocket?.close();
      this.helpSocket = undefined;
      if (this.helpReconnectTimer !== undefined) {
        window.clearTimeout(this.helpReconnectTimer);
        this.helpReconnectTimer = undefined;
      }
      this.notice = this.t("help.ended");
      this.noticeIsError = false;
      return;
    }
    if (
      frame.type !== "chat.message" ||
      !("id" in frame) ||
      typeof frame.id !== "string" ||
      !("text" in frame) ||
      typeof frame.text !== "string" ||
      !("from" in frame) ||
      frame.from !== "helper"
    ) {
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
      return;
    }
    if (this.helpMessages.some((message) => message.id === frame.id)) return;
    this.helpMessages = [
      ...this.helpMessages,
      { id: frame.id, from: "helper", text: frame.text },
    ];
    this.helpAnnouncement = this.t("help.newMessage");
  }

  private sendHelpMessage(event: SubmitEvent): void {
    event.preventDefault();
    const text = this.helpDraft.trim();
    const socket = this.helpSocket;
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) {
      this.helpStatus = "reconnecting";
      return;
    }
    const id = crypto.randomUUID();
    try {
      socket.send(JSON.stringify({ type: "chat.message", id, text }));
    } catch {
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
      return;
    }
    this.helpMessages = [...this.helpMessages, { id, from: "learner", text }];
    this.helpDraft = "";
  }

  private async closeHelpRequest(): Promise<void> {
    if (!this.helpRequestId || this.helpBusy) return;
    this.helpBusy = true;
    this.helpNotice = "";
    this.helpNoticeIsError = false;
    try {
      const response = await fetch(
        `${this.apiRoot}/help/${encodeURIComponent(this.helpRequestId)}/close`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.sessionToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ sessionId: this.sessionId }),
        },
      );
      if (!response.ok) throw new Error("help close");
      this.helpRequestId = "";
      this.helpMessages = [];
      this.helpDraft = "";
      this.helpStatus = "";
      this.helpAnnouncement = "";
      this.helpSocket?.close();
      this.helpSocket = undefined;
      this.helpReconnectAttempt = 0;
      this.notice = this.t("help.ended");
      this.noticeIsError = false;
      if (this.helpReconnectTimer !== undefined) {
        window.clearTimeout(this.helpReconnectTimer);
        this.helpReconnectTimer = undefined;
      }
    } catch {
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
    } finally {
      this.helpBusy = false;
    }
  }

  private async createSession(): Promise<void> {
    if (!this.hostKey) {
      this.notice = this.t("error.host");
      return;
    }
    try {
      const response = await fetch(`${this.apiRoot}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dimts-key": this.hostKey,
        },
        body: JSON.stringify({ lang: this.selectedLang, channel: "web" }),
      });
      if (!response.ok) throw new Error("session");
      const session = (await response.json()) as {
        sessionId: string;
        sessionToken: string;
      };
      if (this.sessionId && this.sessionId !== session.sessionId)
        this.fallbackAnnounced = false;
      this.sessionId = session.sessionId;
      this.sessionToken = session.sessionToken;
      this.notice = "";
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    } catch {
      this.notice = this.t("error.network");
    }
  }

  private async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const text = this.draft.trim();
    if (!text || this.busy) return;
    const learnerMessage: ConversationMessage = {
      id: crypto.randomUUID(),
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
    this.notice = "";
    this.noticeIsError = false;
    this.retryAvailable = false;
    const workingTimer = setTimeout(() => {
      if (this.busy) this.notice = this.t("status.working");
    }, 2_000);
    try {
      if (!this.sessionId || !this.sessionToken) {
        await this.createSession();
      }
      if (!this.sessionId || !this.sessionToken) {
        throw new Error("session");
      }
      const response = await fetch(`${this.apiRoot}/ask`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          clientMsgId: crypto.randomUUID(),
          lang: this.selectedLang,
          text,
          via: "text",
          simple: this.settings.simple,
        }),
      });
      if (!response.ok) throw new Error("ask");
      const reply = (await response.json()) as Reply;
      const assistantMessage: ConversationMessage = {
        id: reply.id,
        role: "assistant",
        text: reply.text,
        lang: reply.lang,
        dir: reply.dir,
        citations: reply.citations ?? [],
      };
      this.messages = [...this.messages, assistantMessage];
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
      clearTimeout(workingTimer);
      this.busy = false;
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
    const adapter = this.textToSpeech;
    if (!adapter || !this.canSpeak(lang)) return;
    this.stopSpeech();
    const run = ++this.speechRun;
    this.speakingMessageId = id;
    this.speechPaused = false;
    try {
      await adapter.speak(text, lang, this.settings.speechRate);
    } catch {
      if (run === this.speechRun) {
        this.notice = this.t("voice.outputFailed");
        this.noticeIsError = true;
      }
    } finally {
      if (run === this.speechRun) {
        this.speakingMessageId = null;
        this.speechPaused = false;
      }
    }
  }

  private startRecording(): void {
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
  }

  private async finishRecording(
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
      if (code === "permission-denied") {
        this.notice = this.t("voice.permissionDenied");
      } else if (code === "microphone-unavailable") {
        this.notice = this.t("voice.microphoneUnavailable");
      } else {
        this.notice = this.t("voice.retry");
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
  }

  private stopRecording(): void {
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
  }

  private startRecordingCue(): void {
    this.recordingCueActive = true;
    this.playTone(660);
    this.vibrate(30);
  }

  private stopRecordingCue(): void {
    if (!this.recordingCueActive) return;
    this.recordingCueActive = false;
    this.playTone(440);
    this.vibrate([30, 40, 30]);
  }

  private playTone(frequency: number): void {
    const AudioContextConstructor = window.AudioContext;
    if (typeof AudioContextConstructor !== "function") return;
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
  }

  private vibrate(pattern: number | number[]): void {
    if (this.settings.stopMotion || typeof navigator.vibrate !== "function") {
      return;
    }
    navigator.vibrate(pattern);
  }

  private canRecord(lang = this.selectedLang): boolean {
    return Boolean(
      this.languages.find((language) => language.code === lang)?.stt &&
      this.speechToText?.supported(lang),
    );
  }

  private canSpeak(lang: string): boolean {
    return Boolean(
      this.languages.find((language) => language.code === lang)?.tts &&
      this.textToSpeech?.supported(lang),
    );
  }

  private pauseSpeech(): void {
    if (!this.speakingMessageId || this.speechPaused) return;
    try {
      this.textToSpeech?.pause();
      this.speechPaused = true;
    } catch {
      this.notice = this.t("voice.outputFailed");
      this.noticeIsError = true;
    }
  }

  private resumeSpeech(): void {
    if (!this.speakingMessageId || !this.speechPaused) return;
    try {
      this.textToSpeech?.resume();
      this.speechPaused = false;
    } catch {
      this.notice = this.t("voice.outputFailed");
      this.noticeIsError = true;
    }
  }

  private stopSpeech(): void {
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
      };
    } catch {
      return { ...defaultSettings };
    }
  }

  private updateSettings(patch: Partial<WidgetSettings>): void {
    this.settings = { ...this.settings, ...patch };
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
        lang=${this.selectedLang}
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
                  lang=${this.selectedLang}
                  dir=${this.currentDirection}
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
          ${this.renderToggle(
            "settings.simple",
            this.settings.simple,
            (value) => this.updateSettings({ simple: value }),
          )}
          ${this.renderToggle(
            "settings.dataSaver",
            this.settings.dataSaver,
            (value) => this.updateSettings({ dataSaver: value }),
          )}
        </div>
        <label class="setting-row" for="read-aloud">
          <span>${this.t("settings.readAloud")}</span>
          <select
            id="read-aloud"
            lang=${this.selectedLang}
            dir=${this.currentDirection}
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
            lang=${this.selectedLang}
            dir=${this.currentDirection}
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
        ${
          textToSpeechAvailable
            ? nothing
            : html`<p
                class="muted"
                id="read-aloud-unavailable"
                lang=${this.selectedLang}
                dir=${this.currentDirection}
              >
                ${this.t("voice.unavailable")}
              </p>`
        }
      </section>
    `;
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
          lang=${this.selectedLang}
          dir=${this.currentDirection}
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

  private renderHelpPreview(): unknown {
    if (!this.helpPreviewOpen) return nothing;
    const questions = this.messages
      .filter((message) => message.role === "learner")
      .slice(-3);
    return html`
      <div class="help-backdrop">
        <section
          class="help-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-preview-title"
          lang=${this.selectedLang}
          dir=${this.currentDirection}
          @keydown=${(event: KeyboardEvent) => this.trapHelpDialog(event)}
        >
          <h2 id="help-preview-title">${this.t("help.preview.title")}</h2>
          <p>
            ${this.t("help.preview.language", {
              language: this.currentLanguage?.nameNative ?? this.selectedLang,
            })}
          </p>
          <label class="setting-row" for="include-help-summary">
            <span>${this.t("help.includeSummary")}</span>
            <input
              id="include-help-summary"
              type="checkbox"
              .checked=${this.helpIncludeSummary}
              @change=${(event: Event) => {
                this.helpIncludeSummary = (
                  event.currentTarget as HTMLInputElement
                ).checked;
              }}
            />
          </label>
          ${
            this.helpIncludeSummary && questions.length > 0
              ? html`
                  <section
                    class="help-summary"
                    aria-label=${this.t("help.preview.summary")}
                  >
                    <h3>${this.t("help.preview.summary")}</h3>
                    <ul>
                      ${questions.map((question) => html`<li>${question.text}</li>`)}
                    </ul>
                  </section>
                `
              : nothing
          }
          ${
            this.helpNotice
              ? html`
                  <p
                    role=${this.helpNoticeIsError ? "alert" : "status"}
                    aria-live=${this.helpNoticeIsError ? "assertive" : "polite"}
                  >
                    ${this.helpNotice}
                  </p>
                `
              : nothing
          }
          <div class="help-actions">
            <button type="button" @click=${() => void this.cancelHelpPreview()}>
              ${this.t("help.cancel")}
            </button>
            <button
              class="primary"
              type="button"
              ?disabled=${this.helpBusy}
              @click=${() => void this.createHelpRequest()}
            >
              ${this.t("help.sendRequest")}
            </button>
          </div>
        </section>
      </div>
    `;
  }

  private renderHelpSession(): unknown {
    if (!this.helpRequestId) return nothing;
    return html`
      <section
        class="panel"
        aria-labelledby="help-chat-heading"
        lang=${this.selectedLang}
        dir=${this.currentDirection}
      >
        <h2 id="help-chat-heading">${this.t("help.chat")}</h2>
        <p>${this.t("help.waiting")}</p>
        <p role="status" aria-live="polite">
          ${this.t(`help.${this.helpStatus || "connecting"}`)}
        </p>
        ${
          this.helpNotice
            ? html`
                <p
                  role=${this.helpNoticeIsError ? "alert" : "status"}
                  aria-live=${this.helpNoticeIsError ? "assertive" : "polite"}
                >
                  ${this.helpNotice}
                </p>
              `
            : nothing
        }
        <div class="help-chat-messages" aria-live="off">
          ${this.helpMessages.map(
            (message) => html`
              <article
                data-help-sender=${message.from}
                aria-label=${this.t(
                  message.from === "helper" ? "help.helper" : "help.you",
                )}
              >
                <strong>
                  ${this.t(
                    message.from === "helper" ? "help.helper" : "help.you",
                  )}
                </strong>
                <p>${message.text}</p>
              </article>
            `,
          )}
        </div>
        <p class="visually-hidden" role="status" aria-live="polite">
          ${this.helpAnnouncement}
        </p>
        <form
          class="help-chat"
          @submit=${(event: SubmitEvent) => this.sendHelpMessage(event)}
        >
          <label for="help-message">${this.t("help.message")}</label>
          <textarea
            id="help-message"
            maxlength="2000"
            .value=${this.helpDraft}
            @input=${(event: Event) =>
              (this.helpDraft = (
                event.currentTarget as HTMLTextAreaElement
              ).value)}
          ></textarea>
          <div class="help-actions">
            <button
              type="submit"
              class="primary"
              ?disabled=${this.helpStatus !== "connected" || this.helpBusy}
            >
              ${this.t("help.send")}
            </button>
            <button
              type="button"
              ?disabled=${this.helpBusy}
              @click=${() => void this.closeHelpRequest()}
            >
              ${this.t("help.end")}
            </button>
          </div>
        </form>
      </section>
    `;
  }

  override render() {
    if (this.loading) {
      return html`<main aria-busy="true">
        <p class="status">${this.t("status.loading")}</p>
      </main>`;
    }
    if (this.languages.length === 0 || !this.selectedLang) {
      return html`<main>
        <p class="status" role="alert">${this.notice}</p>
      </main>`;
    }
    if (!this.sessionId) {
      return html`
        <main
          lang=${this.selectedLang}
          dir=${this.currentLanguage?.dir ?? "ltr"}
        >
          ${this.renderOfflineBanner()} ${this.renderFallbackNotice()}
          ${this.renderHelpButton()} ${this.renderHelpSession()}
          ${this.renderHelpPreview()}
          <section class="welcome" aria-labelledby="welcome-heading">
            <h1 id="welcome-heading">${this.t("welcome.title")}</h1>
            <div class="language-list">${this.renderLanguageChoices()}</div>
            <p class="status" role="status">${this.notice}</p>
          </section>
        </main>
      `;
    }
    return html`
      <main lang=${this.selectedLang} dir=${this.currentLanguage?.dir ?? "ltr"}>
        ${this.renderOfflineBanner()} ${this.renderFallbackNotice()}
        <header>
          <strong>${this.t("app.name")}</strong>
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
              type="button"
              lang=${this.selectedLang}
              dir=${this.currentDirection}
              @click=${() => (this.panel = this.panel === "settings" ? null : "settings")}
            >
              ${this.t("settings.button")}
            </button>
          </div>
        </header>
        ${this.renderHelpButton()} ${this.renderHelpSession()}
        ${this.renderHelpPreview()}
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
        <div class="chat">
          <div
            class="messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label=${this.t("chat.log")}
          >
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
                      <p>${message.text}</p>
                      ${
                        message.citations.length
                          ? html`
                              <div class="citations">
                                ${message.citations.map(
                                  (citation) => html`
                                    <a
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
                      ${
                        this.canSpeak(message.lang)
                          ? html`
                              <button
                                class="read-aloud"
                                type="button"
                                lang=${message.lang}
                                dir=${message.dir}
                                @click=${() =>
                                  void this.speak(
                                    message.text,
                                    message.lang,
                                    message.id,
                                  )}
                              >
                                ${this.t("voice.readReply")}
                              </button>
                              ${this.renderSpeechControls(message.id)}
                            `
                          : nothing
                      }
                    </article>
                  `,
            )}
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
            ${
              this.retryAvailable
                ? html`
                    <button
                      type="button"
                      lang=${this.selectedLang}
                      dir=${this.currentDirection}
                      @click=${() =>
                        this.renderRoot
                          .querySelector<HTMLFormElement>("form")
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
                this.draft = (event.currentTarget as HTMLTextAreaElement).value;
                this.updateTransliteration();
              }}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  this.renderRoot.querySelector("form")?.requestSubmit();
                }
              }}
            ></textarea>
            ${this.renderTransliteration()}
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
                this.canRecord()
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
              <button
                class="mic"
                type="button"
                lang=${this.selectedLang}
                dir=${this.currentDirection}
                aria-describedby=${
                  this.canRecord() ? nothing : "voice-input-unavailable"
                }
                aria-label=${this.t(
                  this.isRecording ? "mic.stop" : "mic.start",
                )}
                aria-pressed=${this.isRecording}
                ?disabled=${!this.canRecord() || this.busy}
                @click=${() =>
                  this.isRecording
                    ? this.stopRecording()
                    : this.startRecording()}
              >
                ${this.t(this.isRecording ? "mic.stop" : "mic.start")}
              </button>
              <button
                class="primary"
                type="submit"
                lang=${this.selectedLang}
                dir=${this.currentDirection}
                ?disabled=${this.busy}
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

export interface DimtsApi {
  open(): void;
  close(): void;
  setLanguage(language: string): void;
  escalate(): void;
}

declare global {
  interface Window {
    Dimts?: DimtsApi;
  }
}

const widgetApi: DimtsApi = {
  open() {
    document
      .querySelectorAll<DimtsAssistant>("dimts-assistant")
      .forEach((widget) => {
        widget.hidden = false;
      });
    window.dispatchEvent(new CustomEvent("dimts:opened"));
  },
  close() {
    document
      .querySelectorAll<DimtsAssistant>("dimts-assistant")
      .forEach((widget) => {
        widget.hidden = true;
      });
    window.dispatchEvent(new CustomEvent("dimts:closed"));
  },
  setLanguage(language) {
    document
      .querySelectorAll<DimtsAssistant>("dimts-assistant")
      .forEach((widget) => {
        widget.setLanguage(language);
      });
  },
  escalate() {
    document
      .querySelectorAll<DimtsAssistant>("dimts-assistant")
      .forEach((widget) => {
        widget.escalate();
      });
  },
};

if (typeof window !== "undefined") {
  window.Dimts = widgetApi;
}
