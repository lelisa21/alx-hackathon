import { LitElement, css, html, nothing } from "lit";
import { IntlMessageFormat } from "intl-messageformat";
import { suggestLanguageOptions } from "./language.js";

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

interface WidgetSettings {
  textScale: 100 | 150 | 200;
  highContrast: boolean;
  stopMotion: boolean;
  simple: boolean;
  dataSaver: boolean;
  readAloud: "off" | "ask" | "always";
}

const defaultSettings: WidgetSettings = {
  textScale: 100,
  highContrast: false,
  stopMotion: false,
  simple: false,
  dataSaver: false,
  readAloud: "off",
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

function messageFor(
  messages: Record<string, unknown>,
  key: string,
  values: Record<string, string | number> = {},
  locale = "en",
): string {
  const value = messages[key];
  if (typeof value !== "string") return "";
  try {
    return String(new IntlMessageFormat(value, locale).format(values));
  } catch {
    return value;
  }
}

export class DimtsAssistant extends LitElement {
  static override properties = {
    api: { attribute: "data-api" },
    hostKey: { attribute: "data-host-key" },
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
    draft: { state: true },
    settings: { state: true },
  };

  declare api: string;
  declare hostKey: string;
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
  declare private draft: string;
  declare private settings: WidgetSettings;

  constructor() {
    super();
    this.api = "";
    this.hostKey = "";
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
    this.draft = "";
    this.settings = this.readSettings();
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
      opacity: 0.72;
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
    .composer-actions {
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

    .primary,
    .help {
      background: var(--dimts-primary);
      color: var(--dimts-primary-text);
      font-weight: 700;
    }

    .help {
      inset-block-end: 0.75rem;
      inset-inline-end: 0.75rem;
      position: sticky;
      z-index: 1;
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
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
      }
    }

    :host([stop-motion]) *,
    :host([stop-motion]) *::before,
    :host([stop-motion]) *::after {
      animation-duration: 0.01ms !important;
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
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
  }

  override disconnectedCallback(): void {
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
    super.disconnectedCallback();
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
    const remoteUrl = new URL(url);
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

  private async initialize(): Promise<void> {
    try {
      const response = await this.fetchStatic(`${this.apiRoot}/languages`);
      if (!response.ok) throw new Error("languages");
      const body = (await response.json()) as { languages: Language[] };
      this.languages = body.languages.filter(
        (language) => language.status !== "draft",
      );
      if (this.languages.length === 0) throw new Error("languages");
      const stored = storage.get("dimts.lang");
      const remembered = this.languages.find(({ code }) => code === stored);
      if (remembered) {
        await this.chooseLanguage(remembered.code, false);
      } else {
        this.selectedLang = this.languages[0]!.code;
        await this.loadUi(this.selectedLang);
      }
    } catch {
      this.notice = this.t("error.network");
    } finally {
      this.loading = false;
    }
  }

  private async loadUi(lang: string): Promise<void> {
    const candidates = [lang, ...(lang === "en" ? [] : ["am", "en"])];
    for (const code of [...new Set(candidates)]) {
      const preview = code === lang ? "" : "?lang_preview=1";
      try {
        const response = await this.fetchStatic(
          `${this.apiRoot}/locales/${encodeURIComponent(code)}/ui${preview}`,
        );
        if (!response.ok) continue;
        this.ui = (await response.json()) as Record<string, unknown>;
        if (code !== lang) {
          this.notice = this.t("notice.languageFallback");
        }
        return;
      } catch {
        continue;
      }
    }
    this.ui = {};
  }

  private async chooseLanguage(code: string, persist = true): Promise<void> {
    const selected = this.languages.find((language) => language.code === code);
    if (!selected) return;
    this.selectedLang = selected.code;
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
    this.busy = true;
    this.notice = "";
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
      this.retryAvailable = false;
      if (this.settings.readAloud === "always") {
        this.speak(assistantMessage);
      }
      await this.updateComplete;
      this.renderRoot
        .querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(reply.id)}"]`,
        )
        ?.focus();
    } catch {
      this.notice = this.t("error.network");
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

  private speak(message: ConversationMessage): void {
    if (
      typeof window.speechSynthesis === "undefined" ||
      typeof window.SpeechSynthesisUtterance === "undefined"
    ) {
      this.notice = this.t("voice.unavailable");
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message.text);
      utterance.lang = message.lang;
      utterance.onerror = () => {
        this.notice = this.t("voice.unavailable");
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      this.notice = this.t("voice.unavailable");
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
        ${this.renderToggle("settings.simple", this.settings.simple, (value) =>
          this.updateSettings({ simple: value }),
        )}
        ${this.renderToggle(
          "settings.dataSaver",
          this.settings.dataSaver,
          (value) => this.updateSettings({ dataSaver: value }),
        )}
        <label class="setting-row" for="read-aloud">
          <span>${this.t("settings.readAloud")}</span>
          <select
            id="read-aloud"
            lang=${this.selectedLang}
            dir=${this.currentDirection}
            .value=${this.settings.readAloud}
            @change=${(event: Event) =>
              this.updateSettings({
                readAloud: (event.currentTarget as HTMLSelectElement)
                  .value as WidgetSettings["readAloud"],
              })}
          >
            <option value="off">${this.t("settings.off")}</option>
            <option value="ask">${this.t("settings.ask")}</option>
            <option value="always">${this.t("settings.always")}</option>
          </select>
        </label>
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
        @click=${() => this.escalate()}
      >
        ${this.t("help.button")}
      </button>
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
          <section class="welcome" aria-labelledby="welcome-heading">
            ${this.renderOfflineBanner()}
            <h1 id="welcome-heading">${this.t("welcome.title")}</h1>
            <div class="language-list">${this.renderLanguageChoices()}</div>
            <p class="status" role="status">${this.notice}</p>
          </section>
          ${this.renderHelpButton()}
        </main>
      `;
    }
    return html`
      <main lang=${this.selectedLang} dir=${this.currentLanguage?.dir ?? "ltr"}>
        ${this.renderOfflineBanner()}
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
                        this.settings.readAloud === "ask"
                          ? html`
                              <button
                                class="read-aloud"
                                type="button"
                                lang=${message.lang}
                                dir=${message.dir}
                                @click=${() => this.speak(message)}
                              >
                                ${this.t("voice.readReply")}
                              </button>
                            `
                          : nothing
                      }
                    </article>
                  `,
            )}
          </div>
          <p
            class="status"
            role=${this.retryAvailable ? "alert" : "status"}
            aria-live=${this.retryAvailable ? "assertive" : "polite"}
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
              @input=${(event: Event) =>
                (this.draft = (
                  event.currentTarget as HTMLTextAreaElement
                ).value)}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  this.renderRoot.querySelector("form")?.requestSubmit();
                }
              }}
            ></textarea>
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
              <button
                class="mic"
                type="button"
                lang=${this.selectedLang}
                dir=${this.currentDirection}
                disabled
                aria-label=${this.t("mic.start")}
              >
                ${this.t("mic.start")}
              </button>
              ${
                !this.currentLanguage?.stt
                  ? html`<span class="muted"
                      >${this.t("voice.unavailable")}</span
                    >`
                  : nothing
              }
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
        ${this.renderHelpButton()}
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
