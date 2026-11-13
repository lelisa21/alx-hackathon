import { LitElement, css, html, nothing } from "lit";
import { messageFor } from "./messages.js";
import { createScreenShareController, type ShareState } from "@dimts/help";
import regularFontUrl from "../../../assets/fonts/NotoSansEthiopic-ethiopic-400-normal.woff2?url&no-inline";
import boldFontUrl from "../../../assets/fonts/NotoSansEthiopic-ethiopic-700-normal.woff2?url&no-inline";

interface HelpRequest {
  id: string;
  lang: string;
  channel: "web" | "api" | "telegram";
  createdAt: string;
  summary: string[] | null;
}

interface ChatMessage {
  id: string;
  from: "learner" | "helper";
  text: string;
}

interface HelpMetrics {
  closedCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  totalWaitMs: number;
  totalResolutionMs: number;
}

interface HelpPicture {
  id: string;
  expiresAt: string;
  url?: string;
}

interface HelperLanguage {
  code: string;
  nameNative: string;
  nameEn: string;
  script: string;
  dir: "ltr" | "rtl";
  status: "live" | "beta" | "draft";
  stt: boolean;
  tts: boolean;
}

function registryLanguage(value: unknown): value is HelperLanguage {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.code === "string" &&
    Boolean(item.code) &&
    typeof item.nameNative === "string" &&
    Boolean(item.nameNative) &&
    typeof item.nameEn === "string" &&
    typeof item.script === "string" &&
    (item.dir === "ltr" || item.dir === "rtl") &&
    ["live", "beta", "draft"].includes(String(item.status)) &&
    typeof item.stt === "boolean" &&
    typeof item.tts === "boolean"
  );
}

let fontsRegistered = false;

function registerEthiopicFonts(): void {
  if (fontsRegistered) return;
  document.fonts.add(
    new FontFace("Noto Sans Ethiopic", `url(${regularFontUrl})`, {
      display: "swap",
      weight: "400",
      unicodeRange: "U+1200-137F, U+1380-139F",
    }),
  );
  document.fonts.add(
    new FontFace("Noto Sans Ethiopic", `url(${boldFontUrl})`, {
      display: "swap",
      weight: "700",
      unicodeRange: "U+1200-137F, U+1380-139F",
    }),
  );
  fontsRegistered = true;
}

function queueRequest(value: unknown): HelpRequest | null {
  if (typeof value !== "object" || value === null) return null;
  if (
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("lang" in value) ||
    typeof value.lang !== "string" ||
    !("channel" in value) ||
    (value.channel !== "web" &&
      value.channel !== "api" &&
      value.channel !== "telegram") ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !("summary" in value) ||
    (value.summary !== null &&
      (!Array.isArray(value.summary) ||
        !value.summary.every((item) => typeof item === "string")))
  ) {
    return null;
  }
  return {
    id: value.id,
    lang: value.lang,
    channel: value.channel,
    createdAt: value.createdAt,
    summary: value.summary,
  };
}

export class DimtsHelperConsole extends LitElement {
  static override properties = {
    api: { attribute: "data-api" },
    language: { attribute: "data-language", reflect: true },
    ui: { state: true },
    languages: { state: true },
    initialized: { state: true },
    jwt: { state: true },
    filter: { state: true },
    requests: { state: true },
    activeRequest: { state: true },
    messages: { state: true },
    draft: { state: true },
    busy: { state: true },
    notice: { state: true },
    noticeIsError: { state: true },
    connectionStatus: { state: true },
    announcement: { state: true },
    providerStatus: { state: true },
    providerState: { state: true },
    sounds: { state: true },
    displayName: { state: true },
    profileBusy: { state: true },
    metrics: { state: true },
    resolution: { state: true },
    shareState: { state: true },
    pictures: { state: true },
  };

  declare api: string;
  declare language: string;
  declare private ui: Record<string, unknown>;
  declare private languages: HelperLanguage[];
  declare private initialized: boolean;
  declare private jwt: string;
  declare private filter: string;
  declare private requests: HelpRequest[];
  declare private activeRequest: HelpRequest | null;
  declare private messages: ChatMessage[];
  declare private draft: string;
  declare private busy: boolean;
  declare private notice: string;
  declare private noticeIsError: boolean;
  declare private connectionStatus:
    "connecting" | "connected" | "reconnecting" | "";
  declare private announcement: string;
  declare private providerStatus: { provider: string; ladder: string[] } | null;
  declare private providerState: "loading" | "ready" | "unavailable";
  private providerRequest = 0;
  private socket: WebSocket | undefined;
  private reconnectTimer: number | undefined;
  private queueRefreshTimer: number | undefined;
  private announcementTimer: number | undefined;
  private reconnectAttempt = 0;
  private queueLoaded = false;
  private knownRequestIds = new Set<string>();
  declare private sounds: boolean;
  declare private displayName: string;
  declare private profileBusy: boolean;
  declare private metrics: HelpMetrics | null;
  declare private resolution: "" | "yes" | "no";
  declare private shareState: ShareState;
  declare private pictures: HelpPicture[];
  private share: ReturnType<typeof createScreenShareController> | undefined;
  private remoteStream: MediaStream | null = null;
  private lastReceivedMessageId: string | undefined;
  private audio: AudioContext | undefined;
  private pictureExpiryTimer: number | undefined;
  private readonly stopOnShortcut = (event: KeyboardEvent) => {
    if (
      this.shareState.status !== "idle" &&
      event.altKey &&
      event.shiftKey &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      this.share?.stop();
    }
  };
  private readonly stopWhenHidden = () => {
    if (document.hidden) this.share?.stop("hidden");
  };

  constructor() {
    super();
    this.api = "";
    this.language = "en";
    this.ui = {};
    this.languages = [];
    this.initialized = false;
    this.jwt = "";
    this.filter = "";
    this.requests = [];
    this.activeRequest = null;
    this.messages = [];
    this.draft = "";
    this.busy = false;
    this.notice = "";
    this.noticeIsError = false;
    this.connectionStatus = "";
    this.announcement = "";
    this.providerStatus = null;
    this.providerState = "loading";
    this.sounds = false;
    this.displayName = "";
    this.profileBusy = false;
    this.metrics = null;
    this.resolution = "";
    this.shareState = { status: "idle" };
    this.pictures = [];
  }

  static override styles = css`
    :host {
      --surface: #ffffff;
      --text: #14232b;
      --muted: #344b55;
      --primary: #164e63;
      --primary-text: #ffffff;
      --border: #526773;
      color: var(--text);
      display: block;
      font-family:
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      font-size: 1rem;
      line-height: 1.5;
    }

    :host([data-script="Ethi"]) {
      font-family:
        "Noto Sans Ethiopic",
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      line-height: 1.65;
    }

    * {
      box-sizing: border-box;
    }

    main {
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      margin-inline: auto;
      max-inline-size: 64rem;
      padding: 1rem;
    }

    .provider-status {
      overflow-wrap: anywhere;
    }

    header,
    .actions,
    .filters {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: space-between;
    }

    button,
    input,
    textarea,
    select {
      color: inherit;
      font: inherit;
    }

    button,
    input,
    select,
    textarea {
      min-block-size: 48px;
    }

    button,
    select {
      background: var(--surface);
      border: 2px solid var(--border);
      border-radius: 0.5rem;
      padding: 0.625rem 0.875rem;
    }

    button {
      cursor: pointer;
    }

    button:disabled {
      cursor: not-allowed;
    }

    :focus-visible {
      outline: 3px solid #005fcc;
      outline-offset: 2px;
    }

    .primary {
      background: var(--primary);
      color: var(--primary-text);
      font-weight: 700;
    }

    .filters,
    .login,
    .chat-form {
      margin-block: 1rem;
    }

    .login {
      display: grid;
      gap: 0.5rem;
      max-inline-size: 28rem;
    }

    .queue {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    }

    article {
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 0.75rem;
    }

    article p {
      margin-block: 0.5rem;
      white-space: pre-wrap;
    }

    .chat {
      border-block-start: 1px solid var(--border);
      margin-block-start: 1rem;
      padding-block-start: 0.75rem;
    }

    .messages {
      display: grid;
      gap: 0.5rem;
      max-block-size: 18rem;
      overflow-y: auto;
    }

    .messages article[data-sender="learner"] {
      background: #f0f5f7;
    }

    textarea {
      inline-size: 100%;
      padding: 0.625rem;
      resize: vertical;
    }

    .chat-form {
      display: grid;
      gap: 0.5rem;
    }

    .status {
      min-block-size: 1.5em;
    }

    .profile {
      display: grid;
      gap: 0.5rem;
      margin-block: 1rem;
    }

    .profile input {
      inline-size: 100%;
      max-inline-size: 28rem;
    }

    input[type="checkbox"] {
      inline-size: 48px;
      vertical-align: middle;
    }

    .share-banner {
      position: sticky;
      inset-block-start: 0;
      z-index: 1;
      background: var(--surface);
      border: 2px solid var(--primary);
      padding: 0.75rem;
      margin-block: 0.75rem;
    }

    video,
    .picture {
      display: block;
      max-inline-size: 100%;
      max-block-size: 28rem;
      margin-block: 0.75rem;
    }

    .visually-hidden {
      block-size: 1px;
      clip-path: inset(50%);
      inline-size: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }

    @media (max-width: 32rem) {
      header {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.stopOnShortcut);
    document.addEventListener("visibilitychange", this.stopWhenHidden);
    void this.initialize();
    if (this.jwt) {
      void this.loadQueue();
      if (this.activeRequest) {
        this.initializeShare();
        this.connectSocket();
      }
    }
  }

  override disconnectedCallback(): void {
    window.removeEventListener("keydown", this.stopOnShortcut);
    document.removeEventListener("visibilitychange", this.stopWhenHidden);
    this.clearMedia();
    void this.audio?.close();
    this.audio = undefined;
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.queueRefreshTimer !== undefined) {
      window.clearTimeout(this.queueRefreshTimer);
      this.queueRefreshTimer = undefined;
    }
    if (this.announcementTimer !== undefined) {
      window.clearTimeout(this.announcementTimer);
      this.announcementTimer = undefined;
    }
    this.socket?.close();
    this.socket = undefined;
    super.disconnectedCallback();
  }

  protected override updated(): void {
    const video = this.renderRoot.querySelector<HTMLVideoElement>("video");
    if (video && video.srcObject !== this.remoteStream)
      video.srcObject = this.remoteStream;
  }

  private get apiRoot(): string {
    const root = this.api.replace(/\/+$/u, "");
    return root.endsWith("/v1") ? root : `${root}/v1`;
  }

  private t(key: string, values: Record<string, string | number> = {}): string {
    return messageFor(this.ui, key, values, this.language);
  }

  private async initialize(): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiRoot}/languages${this.previewQuery}`,
      );
      if (!response.ok) throw new Error("helper languages");
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("languages" in body) ||
        !Array.isArray(body.languages) ||
        !body.languages.every(registryLanguage)
      )
        throw new Error("helper languages");
      this.languages = body.languages.filter(
        ({ status }) => this.previewQuery || status !== "draft",
      );
      if (!this.languages.length) throw new Error("helper languages");
      const selected =
        this.languages.find(({ code }) => code === this.language) ??
        this.languages[0]!;
      this.language = selected.code;
      this.applyLanguageScript();
      await this.loadUi(this.language);
    } catch {
      // Existing locale/login functionality remains usable if registry loading fails.
      await this.loadUi(this.language);
      this.notice = this.t("error.network");
      this.noticeIsError = true;
    }
  }

  private get previewQuery(): string {
    return new URL(window.location.href).searchParams.get("lang_preview") ===
      "1"
      ? "?lang_preview=1"
      : "";
  }

  private applyLanguageScript(): void {
    const script =
      this.languages.find(({ code }) => code === this.language)?.script ??
      "Latn";
    this.setAttribute("data-script", script);
    if (script === "Ethi") registerEthiopicFonts();
  }

  private languageName(code: string): string {
    return (
      this.languages.find((language) => language.code === code)?.nameNative ??
      code
    );
  }

  private languageLabel(language: HelperLanguage): string {
    return language.status === "beta"
      ? `${language.nameNative} · ${this.t("status.beta")}`
      : language.nameNative;
  }

  private async loadUi(language: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiRoot}/locales/${encodeURIComponent(language)}/ui${this.previewQuery}`,
      );
      if (!response.ok) throw new Error("helper locale");
      const ui: unknown = await response.json();
      if (typeof ui !== "object" || ui === null || Array.isArray(ui)) {
        throw new Error("helper locale");
      }
      this.ui = ui as Record<string, unknown>;
      this.initialized = true;
      return true;
    } catch {
      this.initialized = true;
      this.dispatchEvent(
        new CustomEvent("dimts:helper-error", {
          bubbles: true,
          composed: true,
          detail: { code: "locale_unavailable" },
        }),
      );
      return false;
    }
  }

  private async setLanguage(language: string): Promise<void> {
    if (!this.languages.some(({ code }) => code === language)) return;
    const previousLanguage = this.language;
    this.language = language;
    this.initialized = false;
    this.applyLanguageScript();
    if (!(await this.loadUi(language))) {
      this.language = previousLanguage;
      this.applyLanguageScript();
    }
    await this.updateComplete;
    this.renderRoot
      .querySelector<HTMLSelectElement>("[data-language-picker]")
      ?.focus();
  }

  private languagePicker(): unknown {
    if (!this.languages.length) return nothing;
    return html`
      <label>
        <span>${this.t("helper.uiLanguage")}</span>
        <select
          data-language-picker
          .value=${this.language}
          @change=${(event: Event) =>
            void this.setLanguage(
              (event.currentTarget as HTMLSelectElement).value,
            )}
        >
          ${this.languages.map(
            (language) => html`
              <option
                value=${language.code}
                lang=${language.code}
                dir=${language.dir}
              >
                ${this.languageLabel(language)}
              </option>
            `,
          )}
        </select>
      </label>
    `;
  }

  private async signIn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.busy) return;
    const tokenInput =
      this.renderRoot.querySelector<HTMLInputElement>("#helper-token");
    const token = tokenInput?.value.trim() ?? "";
    if (!token) return;
    if (tokenInput) tokenInput.value = "";
    this.busy = true;
    this.notice = "";
    this.noticeIsError = false;
    try {
      const response = await fetch(`${this.apiRoot}/helpers/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        this.notice = this.t("helper.loginFailed");
        this.noticeIsError = true;
        return;
      }
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("jwt" in body) ||
        typeof body.jwt !== "string"
      ) {
        this.notice = this.t("helper.loginFailed");
        this.noticeIsError = true;
        return;
      }
      this.jwt = body.jwt;
      if (tokenInput) tokenInput.value = "";
      this.notice = "";
      this.noticeIsError = false;
      void this.loadProfile();
      void this.loadMetrics();
      await this.loadQueue();
    } catch {
      this.notice = this.t("helper.actionError");
      this.noticeIsError = true;
    } finally {
      this.busy = false;
    }
  }

  private async loadQueue(): Promise<void> {
    const jwt = this.jwt;
    const filter = this.filter;
    if (!jwt) return;
    void this.loadProviderStatus(jwt);
    this.notice = "";
    this.noticeIsError = false;
    try {
      const query = filter ? `?lang=${encodeURIComponent(filter)}` : "";
      const response = await fetch(`${this.apiRoot}/help/queue${query}`, {
        headers: { authorization: `Bearer ${jwt}` },
      });
      if (!response.ok) throw new Error("helper queue");
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("requests" in body) ||
        !Array.isArray(body.requests)
      ) {
        throw new Error("helper queue");
      }
      const requests = body.requests.map(queueRequest);
      if (requests.some((request) => request === null)) {
        throw new Error("helper queue");
      }
      if (this.jwt !== jwt || this.filter !== filter) return;
      const nextRequests = requests
        .filter((request): request is HelpRequest => request !== null)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      const addedRequests = nextRequests.filter(
        ({ id }) => !this.knownRequestIds.has(id),
      );
      nextRequests.forEach(({ id }) => this.knownRequestIds.add(id));
      while (this.knownRequestIds.size > 1_000) {
        const oldestId = this.knownRequestIds.values().next().value;
        if (typeof oldestId !== "string") break;
        this.knownRequestIds.delete(oldestId);
      }
      this.requests = nextRequests;
      if (this.queueLoaded && addedRequests.length > 0) {
        this.announce(this.t("helper.newRequest"));
        this.playChime();
      }
      this.queueLoaded = true;
    } catch {
      if (this.jwt === jwt) {
        this.notice = this.t("helper.actionError");
        this.noticeIsError = true;
      }
    } finally {
      if (this.jwt === jwt) {
        this.scheduleQueueRefresh();
        if (this.activeRequest) void this.loadPictures();
      }
    }
  }

  private async loadProviderStatus(jwt: string): Promise<void> {
    const request = ++this.providerRequest;
    if (!this.providerStatus) this.providerState = "loading";
    try {
      const response = await fetch(`${this.apiRoot}/health`, {
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("provider status");
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("provider" in body) ||
        typeof body.provider !== "string" ||
        !body.provider.trim() ||
        !("ladder" in body) ||
        !Array.isArray(body.ladder) ||
        !body.ladder.every((item) => typeof item === "string" && item.trim())
      )
        throw new Error("provider status");
      if (this.jwt !== jwt || this.providerRequest !== request) return;
      this.providerStatus = { provider: body.provider, ladder: body.ladder };
      this.providerState = "ready";
    } catch {
      if (this.jwt !== jwt || this.providerRequest !== request) return;
      this.providerStatus = null;
      this.providerState = "unavailable";
    }
  }

  private scheduleQueueRefresh(): void {
    if (this.queueRefreshTimer !== undefined) {
      window.clearTimeout(this.queueRefreshTimer);
      this.queueRefreshTimer = undefined;
    }
    if (!this.isConnected || !this.jwt) return;
    this.queueRefreshTimer = window.setTimeout(() => {
      this.queueRefreshTimer = undefined;
      void this.loadQueue();
    }, 15_000);
  }

  private announce(message: string): void {
    this.announcement = message;
    if (this.announcementTimer !== undefined) {
      window.clearTimeout(this.announcementTimer);
    }
    this.announcementTimer = window.setTimeout(() => {
      this.announcement = "";
      this.announcementTimer = undefined;
    }, 3_000);
  }

  private async postAction(
    requestId: string,
    action: "block" | "claim" | "close",
    body?: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.jwt) return false;
    try {
      const response = await fetch(
        `${this.apiRoot}/help/${encodeURIComponent(requestId)}/${action}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.jwt}`,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      if (!response.ok) throw new Error("helper action");
      return true;
    } catch {
      this.notice = this.t("helper.actionError");
      this.noticeIsError = true;
      return false;
    }
  }

  private async block(request: HelpRequest): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (await this.postAction(request.id, "block")) await this.loadQueue();
    this.busy = false;
  }

  private async claim(request: HelpRequest): Promise<void> {
    if (this.busy || this.activeRequest) return;
    this.busy = true;
    if (await this.postAction(request.id, "claim")) {
      this.activeRequest = request;
      this.messages = [];
      this.lastReceivedMessageId = undefined;
      this.draft = "";
      this.resolution = "";
      this.initializeShare();
      this.connectionStatus = "connecting";
      this.connectSocket();
      await this.loadQueue();
    }
    this.busy = false;
  }

  private async closeRequest(): Promise<void> {
    if (!this.activeRequest || this.busy) return;
    this.busy = true;
    this.share?.stop();
    if (
      await this.postAction(
        this.activeRequest.id,
        "close",
        this.resolution ? { resolved: this.resolution === "yes" } : undefined,
      )
    ) {
      this.clearMedia();
      this.activeRequest = null;
      this.messages = [];
      this.draft = "";
      this.announcement = "";
      this.connectionStatus = "";
      this.socket?.close();
      this.socket = undefined;
      if (this.reconnectTimer !== undefined) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
      this.reconnectAttempt = 0;
      void this.loadMetrics();
      await this.loadQueue();
    }
    this.busy = false;
  }

  private signOut(): void {
    this.clearMedia();
    void this.audio?.close();
    this.audio = undefined;
    this.sounds = false;
    this.displayName = "";
    this.metrics = null;
    this.jwt = "";
    this.providerRequest += 1;
    this.providerStatus = null;
    this.providerState = "loading";
    this.requests = [];
    this.knownRequestIds.clear();
    this.queueLoaded = false;
    this.activeRequest = null;
    this.messages = [];
    this.draft = "";
    this.announcement = "";
    this.connectionStatus = "";
    this.socket?.close();
    this.socket = undefined;
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.queueRefreshTimer !== undefined) {
      window.clearTimeout(this.queueRefreshTimer);
      this.queueRefreshTimer = undefined;
    }
    if (this.announcementTimer !== undefined) {
      window.clearTimeout(this.announcementTimer);
      this.announcementTimer = undefined;
    }
    this.reconnectAttempt = 0;
  }

  private connectSocket(): void {
    if (!this.isConnected || !this.activeRequest || !this.jwt) return;
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return;
    try {
      const url = new URL(`${this.apiRoot}/help/ws`, location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        const activeRequest = this.activeRequest;
        if (!activeRequest || !this.jwt || this.socket !== socket) {
          socket.close();
          return;
        }
        const lastMessageId = this.lastReceivedMessageId;
        socket.send(
          JSON.stringify({
            type: "auth",
            requestId: activeRequest.id,
            role: "helper",
            jwt: this.jwt,
            ...(lastMessageId ? { lastMessageId } : {}),
          }),
        );
      };
      socket.onmessage = (event: MessageEvent<unknown>) =>
        this.socket === socket && this.handleSocketFrame(event.data);
      socket.onerror = () => {
        if (this.socket === socket) this.connectionStatus = "reconnecting";
      };
      socket.onclose = (event: CloseEvent) => {
        if (this.socket !== socket) return;
        this.share?.stop("disconnect");
        if (this.socket === socket) this.socket = undefined;
        if (event.code === 4401) {
          this.connectionStatus = "";
          this.notice = this.t("helper.actionError");
          this.noticeIsError = true;
        } else if (this.isConnected && this.activeRequest) {
          this.connectionStatus = "reconnecting";
          this.scheduleReconnect();
        }
      };
    } catch {
      this.connectionStatus = "reconnecting";
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (
      !this.isConnected ||
      !this.activeRequest ||
      this.reconnectTimer !== undefined
    ) {
      return;
    }
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectSocket();
    }, delay);
  }

  private handleSocketFrame(raw: unknown): void {
    if (typeof raw !== "string") {
      this.notice = this.t("helper.actionError");
      this.noticeIsError = true;
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      this.notice = this.t("helper.actionError");
      this.noticeIsError = true;
      return;
    }
    if (typeof frame !== "object" || frame === null || !("type" in frame)) {
      this.notice = this.t("helper.actionError");
      this.noticeIsError = true;
      return;
    }
    if (frame.type === "help.joined") {
      this.connectionStatus = "connected";
      this.reconnectAttempt = 0;
      this.notice = "";
      this.noticeIsError = false;
      return;
    }
    if (frame.type === "help.closed") {
      this.clearMedia();
      this.activeRequest = null;
      this.messages = [];
      this.draft = "";
      this.connectionStatus = "";
      this.socket?.close();
      this.socket = undefined;
      if (this.reconnectTimer !== undefined) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
      void this.loadQueue();
      void this.loadMetrics();
      return;
    }
    if (frame.type === "chat.typing") return;
    if (
      typeof frame.type === "string" &&
      (frame.type.startsWith("share.") || frame.type.startsWith("rtc."))
    ) {
      void this.share?.handleFrame(frame);
      return;
    }
    if (
      frame.type !== "chat.message" ||
      !("id" in frame) ||
      typeof frame.id !== "string" ||
      !("text" in frame) ||
      typeof frame.text !== "string" ||
      !("from" in frame) ||
      (frame.from !== "learner" && frame.from !== "helper")
    ) {
      this.notice = this.t("helper.actionError");
      this.noticeIsError = true;
      return;
    }
    this.lastReceivedMessageId = frame.id;
    if (this.messages.some((message) => message.id === frame.id)) return;
    this.messages = [
      ...this.messages,
      { id: frame.id, from: frame.from, text: frame.text },
    ];
    if (frame.from === "learner") {
      this.announce(this.t("helper.newMessage"));
      const messageId = frame.id;
      const activeElement =
        this.renderRoot instanceof ShadowRoot
          ? this.renderRoot.activeElement
          : document.activeElement;
      if (
        activeElement?.matches(
          "input, textarea, select, [contenteditable='true']",
        )
      )
        return;
      void this.updateComplete.then(() => {
        [...this.renderRoot.querySelectorAll<HTMLElement>("[data-message-id]")]
          .find((element) => element.dataset.messageId === messageId)
          ?.focus();
      });
    }
  }

  private sendMessage(event: SubmitEvent): void {
    event.preventDefault();
    const text = this.draft.trim();
    const socket = this.socket;
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) {
      this.connectionStatus = "reconnecting";
      return;
    }
    const id = crypto.randomUUID();
    try {
      socket.send(JSON.stringify({ type: "chat.message", id, text }));
    } catch {
      this.notice = this.t("helper.actionError");
      this.noticeIsError = true;
      return;
    }
    this.messages = [...this.messages, { id, from: "helper", text }];
    this.draft = "";
  }

  private async loadProfile(): Promise<void> {
    const jwt = this.jwt;
    try {
      const response = await fetch(`${this.apiRoot}/helpers/profile`, {
        headers: { authorization: `Bearer ${jwt}` },
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { displayName?: unknown };
      if (
        this.jwt === jwt &&
        !this.displayName &&
        typeof body.displayName === "string"
      ) {
        this.displayName = body.displayName;
      }
    } catch {
      // Optional profile loading must not interrupt queue or chat.
    }
  }

  private async saveProfile(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!this.jwt || this.profileBusy) return;
    const jwt = this.jwt;
    this.profileBusy = true;
    try {
      const response = await fetch(`${this.apiRoot}/helpers/profile`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ displayName: this.displayName.trim() || null }),
      });
      if (!response.ok) throw new Error("helper profile");
      if (this.jwt === jwt) {
        this.notice = this.t("helper.profileSaved");
        this.noticeIsError = false;
      }
    } catch {
      if (this.jwt === jwt) {
        this.notice = this.t("helper.actionError");
        this.noticeIsError = true;
      }
    } finally {
      this.profileBusy = false;
    }
  }

  private async loadMetrics(): Promise<void> {
    const jwt = this.jwt;
    if (!jwt) return;
    try {
      const response = await fetch(`${this.apiRoot}/help/metrics`, {
        headers: { authorization: `Bearer ${jwt}` },
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as HelpMetrics;
      if (
        this.jwt === jwt &&
        [
          body.closedCount,
          body.resolvedCount,
          body.unresolvedCount,
          body.totalWaitMs,
          body.totalResolutionMs,
        ].every(
          (value) =>
            typeof value === "number" && Number.isFinite(value) && value >= 0,
        )
      ) {
        this.metrics = body;
      }
    } catch {
      // Aggregate reporting is independent of live support.
    }
  }

  private setSounds(enabled: boolean): void {
    this.sounds = enabled;
    if (!enabled) {
      void this.audio?.close();
      this.audio = undefined;
      return;
    }
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume().catch(() => undefined);
    } catch {
      this.audio = undefined;
    }
  }

  private playChime(): void {
    if (!this.sounds || this.audio?.state !== "running") return;
    try {
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      gain.gain.setValueAtTime(0.04, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        this.audio.currentTime + 0.15,
      );
      oscillator.frequency.value = 660;
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start();
      oscillator.stop(this.audio.currentTime + 0.15);
    } catch {
      // Visual and polite announcements remain the primary signal.
    }
  }

  private initializeShare(): void {
    this.clearMedia();
    if (this.activeRequest?.channel === "telegram") return;
    const requestId = this.activeRequest?.id;
    this.share = createScreenShareController({
      role: "helper",
      send: (frame) => {
        if (this.socket?.readyState === WebSocket.OPEN)
          this.socket.send(JSON.stringify(frame));
      },
      loadIceServers: async () => {
        if (!requestId || this.activeRequest?.id !== requestId)
          throw new Error("inactive help");
        const response = await fetch(
          `${this.apiRoot}/help/${encodeURIComponent(requestId)}/ice`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.jwt}`,
              "content-type": "application/json",
            },
            body: "{}",
            cache: "no-store",
          },
        );
        if (!response.ok) throw new Error("help ice");
        const body = (await response.json()) as { iceServers: RTCIceServer[] };
        if (!Array.isArray(body.iceServers)) throw new Error("help ice");
        return body.iceServers;
      },
      onState: (state) => {
        this.shareState = state;
      },
      onRemoteStream: (stream) => {
        this.remoteStream = stream;
        this.requestUpdate();
      },
    });
  }

  private clearMedia(): void {
    if (this.pictureExpiryTimer !== undefined)
      window.clearTimeout(this.pictureExpiryTimer);
    this.pictureExpiryTimer = undefined;
    this.share?.dispose();
    this.share = undefined;
    this.remoteStream = null;
    const video = this.renderRoot?.querySelector<HTMLVideoElement>("video");
    if (video) video.srcObject = null;
    this.shareState = { status: "idle" };
    this.pictures.forEach((picture) => {
      if (picture.url) URL.revokeObjectURL(picture.url);
    });
    this.pictures = [];
  }

  private purgeExpiredPictures(): void {
    if (this.pictureExpiryTimer !== undefined)
      window.clearTimeout(this.pictureExpiryTimer);
    this.pictureExpiryTimer = undefined;
    const now = Date.now();
    this.pictures = this.pictures.filter((picture) => {
      if (Date.parse(picture.expiresAt) > now) return true;
      if (picture.url) URL.revokeObjectURL(picture.url);
      return false;
    });
    if (this.pictures.length) {
      const nextExpiry = Math.min(
        ...this.pictures.map(({ expiresAt }) => Date.parse(expiresAt)),
      );
      this.pictureExpiryTimer = window.setTimeout(
        () => this.purgeExpiredPictures(),
        Math.max(1, nextExpiry - now),
      );
    }
  }

  private async loadPictures(): Promise<void> {
    if (this.activeRequest?.channel === "telegram") return;
    this.purgeExpiredPictures();
    const requestId = this.activeRequest?.id;
    if (!requestId || !this.jwt) return;
    try {
      const response = await fetch(
        `${this.apiRoot}/help/${encodeURIComponent(requestId)}/image`,
        {
          headers: { authorization: `Bearer ${this.jwt}` },
          cache: "no-store",
        },
      );
      if (!response.ok) return;
      const body = (await response.json()) as { images?: unknown };
      if (this.activeRequest?.id !== requestId || !Array.isArray(body.images))
        return;
      const next = body.images
        .filter(
          (picture): picture is HelpPicture =>
            typeof picture === "object" &&
            picture !== null &&
            typeof picture.id === "string" &&
            typeof picture.expiresAt === "string" &&
            Date.parse(picture.expiresAt) > Date.now(),
        )
        .map((picture) => ({
          ...picture,
          ...this.pictures.find(({ id }) => id === picture.id),
        }));
      this.pictures.forEach((picture) => {
        if (picture.url && !next.some(({ id }) => id === picture.id))
          URL.revokeObjectURL(picture.url);
      });
      this.pictures = next;
      this.purgeExpiredPictures();
    } catch {
      // Pictures are an optional fallback; chat remains available.
    }
  }

  private async viewPicture(picture: HelpPicture): Promise<void> {
    const requestId = this.activeRequest?.id;
    if (!requestId || picture.url) return;
    try {
      const response = await fetch(
        `${this.apiRoot}/help/${encodeURIComponent(requestId)}/image/${encodeURIComponent(picture.id)}`,
        {
          headers: { authorization: `Bearer ${this.jwt}` },
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("help picture");
      const blob = await response.blob();
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(blob.type) ||
        blob.size > 2 * 1024 * 1024
      )
        throw new Error("help picture");
      if (
        this.activeRequest?.id !== requestId ||
        !this.pictures.some(
          ({ id, expiresAt, url }) =>
            id === picture.id && Date.parse(expiresAt) > Date.now() && !url,
        )
      )
        return;
      const url = URL.createObjectURL(blob);
      this.pictures = this.pictures.map((item) =>
        item.id === picture.id ? { ...item, url } : item,
      );
    } catch {
      if (this.activeRequest?.id === requestId) {
        this.notice = this.t("helper.pictureError");
        this.noticeIsError = true;
      }
    }
  }

  private renderPreferences(): unknown {
    if (!this.jwt) return nothing;
    return html`
      <label>
        <input
          type="checkbox"
          .checked=${this.sounds}
          @change=${(event: Event) => this.setSounds((event.currentTarget as HTMLInputElement).checked)}
        />
        ${this.t("helper.sound")}
      </label>
      <form
        class="profile"
        @submit=${(event: SubmitEvent) => void this.saveProfile(event)}
      >
        <label for="helper-name">${this.t("helper.profileName")}</label>
        <input
          id="helper-name"
          type="text"
          maxlength="40"
          autocomplete="off"
          aria-describedby="helper-name-note"
          .value=${this.displayName}
          @input=${(event: Event) => {
            this.displayName = (event.currentTarget as HTMLInputElement).value;
          }}
        />
        <p id="helper-name-note">${this.t("helper.profileNote")}</p>
        <button type="submit" ?disabled=${this.profileBusy}>
          ${this.t("helper.profileSave")}
        </button>
      </form>
      ${
        this.metrics
          ? html` <section aria-labelledby="helper-metrics-heading">
              <h2 id="helper-metrics-heading">${this.t("helper.metrics")}</h2>
              <p>
                ${this.t("helper.metricsCounts", { closed: this.metrics.closedCount, resolved: this.metrics.resolvedCount, unresolved: this.metrics.unresolvedCount })}
              </p>
              <p>
                ${this.t("helper.metricsTimes", { wait: Math.floor(this.metrics.totalWaitMs / 60_000), resolution: Math.floor(this.metrics.totalResolutionMs / 60_000) })}
              </p>
            </section>`
          : nothing
      }
    `;
  }

  private renderShareBanner(): unknown {
    const active = ["requested", "connecting", "sharing"].includes(
      this.shareState.status,
    );
    return html`
      ${
        active
          ? html` <div
              class="share-banner"
              role="region"
              aria-label=${this.t("helper.screenView")}
            >
              <p role="status">
                ${this.t(this.shareState.status === "requested" ? "helper.shareRequested" : this.shareState.status === "connecting" ? "helper.shareConnecting" : "helper.shareViewing")}
              </p>
              <button
                type="button"
                aria-keyshortcuts="Alt+Shift+S"
                @click=${() => this.share?.stop()}
              >
                ${this.t("helper.shareStop")}
              </button>
            </div>`
          : nothing
      }
    `;
  }

  private renderShare(): unknown {
    const textOnly = this.activeRequest?.channel === "telegram";
    const active = ["requested", "connecting", "sharing"].includes(
      this.shareState.status,
    );
    return html`
      ${textOnly ? html`<p>${this.t("helper.telegramTextOnly")}</p>` : nothing}
      ${this.shareState.status === "sharing" ? html`<video autoplay muted playsinline aria-label=${this.t("helper.screenView")}></video>` : nothing}
      ${this.shareState.status === "fallback" ? html`<p role="status">${this.t("helper.shareFallback")}</p>` : nothing}
      <div class="actions">
        ${
          textOnly
            ? nothing
            : html`<button
                type="button"
                ?disabled=${active || this.connectionStatus !== "connected"}
                @click=${() => this.share?.request()}
              >
                ${this.t("helper.requestScreen")}
              </button>`
        }
        <button
          type="button"
          @click=${() => {
            this.draft = this.t("helper.describeMessage");
            void this.updateComplete.then(() =>
              this.renderRoot
                .querySelector<HTMLTextAreaElement>("#helper-message")
                ?.focus(),
            );
          }}
        >
          ${this.t("helper.describe")}
        </button>
      </div>
      ${
        this.pictures.length
          ? html` <section aria-labelledby="helper-pictures-heading">
              <h3 id="helper-pictures-heading">${this.t("helper.pictures")}</h3>
              ${this.pictures.map(
                (picture, index) => html`
                  <button
                    type="button"
                    @click=${() => void this.viewPicture(picture)}
                    ?disabled=${Boolean(picture.url)}
                  >
                    ${this.t("helper.viewPicture", { number: index + 1 })}
                  </button>
                  ${picture.url ? html`<img class="picture" src=${picture.url} alt=${this.t("helper.pictureAlt")} />` : nothing}
                `,
              )}
            </section>`
          : nothing
      }
    `;
  }

  private renderLogin(): unknown {
    return html`
      <form
        class="login"
        @submit=${(event: SubmitEvent) => void this.signIn(event)}
      >
        <label for="helper-token">${this.t("helper.token")}</label>
        <input
          id="helper-token"
          type="password"
          autocomplete="one-time-code"
          minlength="20"
          maxlength="200"
          required
        />
        <button class="primary" type="submit" ?disabled=${this.busy}>
          ${this.t("helper.signIn")}
        </button>
      </form>
    `;
  }

  private renderQueue(): unknown {
    if (!this.jwt) return nothing;
    return html`
      <section aria-labelledby="helper-queue-heading">
        <div class="filters">
          <h2 id="helper-queue-heading">${this.t("helper.queue")}</h2>
          <button type="button" @click=${() => void this.loadQueue()}>
            ${this.t("helper.refresh")}
          </button>
          <label>
            <span>${this.t("helper.filter")}</span>
            <select
              .value=${this.filter}
              @change=${(event: Event) => {
                this.filter = (event.currentTarget as HTMLSelectElement).value;
                void this.loadQueue();
              }}
            >
              <option value="">${this.t("helper.filterAny")}</option>
              ${this.languages.map(
                (language) => html`
                  <option
                    value=${language.code}
                    lang=${language.code}
                    dir=${language.dir}
                  >
                    ${this.languageLabel(language)}
                  </option>
                `,
              )}
            </select>
          </label>
        </div>
        ${
          this.requests.length === 0
            ? html`<p>${this.t("helper.empty")}</p>`
            : html`
                <div class="queue">
                  ${this.requests.map(
                    (request) => html`
                      <article data-request-id=${request.id}>
                        <h3>${request.id}</h3>
                        <p>${this.languageName(request.lang)}</p>
                        <p>
                          ${this.t("helper.waitMinutes", { minutes: Math.max(0, Math.floor((Date.now() - Date.parse(request.createdAt)) / 60_000)) })}
                        </p>
                        <p>
                          ${this.t("helper.channel")}:
                          ${this.t(`helper.channel.${request.channel}`)}
                        </p>
                        <p>
                          ${this.t("helper.created")}:
                          ${new Intl.DateTimeFormat(this.language, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(request.createdAt))}
                        </p>
                        ${
                          request.summary?.length
                            ? html`
                                <section aria-label=${this.t("helper.summary")}>
                                  <h4>${this.t("helper.summary")}</h4>
                                  <ul>
                                    ${request.summary.map(
                                      (question) => html`<li>${question}</li>`,
                                    )}
                                  </ul>
                                </section>
                              `
                            : nothing
                        }
                        <div class="actions">
                          <button
                            type="button"
                            ?disabled=${this.busy || Boolean(this.activeRequest)}
                            @click=${() => void this.claim(request)}
                          >
                            ${this.t("helper.claim")}
                          </button>
                          <button
                            type="button"
                            ?disabled=${this.busy}
                            @click=${() => void this.block(request)}
                          >
                            ${this.t("helper.block")}
                          </button>
                        </div>
                      </article>
                    `,
                  )}
                </div>
              `
        }
      </section>
    `;
  }

  private renderActiveRequest(): unknown {
    if (!this.activeRequest) return nothing;
    return html`
      <section class="chat" aria-labelledby="helper-chat-heading">
        <h2 id="helper-chat-heading">${this.t("helper.chat")}</h2>
        <h3>${this.activeRequest.id}</h3>
        <p role="status" aria-live="polite">
          ${this.t(`help.${this.connectionStatus || "connecting"}`)}
        </p>
        ${this.renderShare()}
        <div class="messages" aria-live="off">
          ${this.messages.map(
            (message) => html`
              <article
                data-sender=${message.from}
                data-message-id=${message.id}
                tabindex="-1"
              >
                <strong>
                  ${this.t(message.from === "learner" ? "helper.learner" : "help.helper")}
                </strong>
                <p>${message.text}</p>
              </article>
            `,
          )}
        </div>
        <form
          class="chat-form"
          @submit=${(event: SubmitEvent) => this.sendMessage(event)}
        >
          <label for="helper-message">${this.t("helper.message")}</label>
          <textarea
            id="helper-message"
            maxlength="2000"
            .value=${this.draft}
            @input=${(event: Event) =>
              (this.draft = (event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
          <label for="helper-resolution">${this.t("helper.resolution")}</label>
          <select
            id="helper-resolution"
            .value=${this.resolution}
            @change=${(event: Event) => {
              this.resolution = (event.currentTarget as HTMLSelectElement)
                .value as "" | "yes" | "no";
            }}
          >
            <option value="">${this.t("helper.resolutionUnknown")}</option>
            <option value="yes">${this.t("helper.resolutionYes")}</option>
            <option value="no">${this.t("helper.resolutionNo")}</option>
          </select>
          <div class="actions">
            <button
              class="primary"
              type="submit"
              ?disabled=${this.connectionStatus !== "connected" || this.busy}
            >
              ${this.t("helper.send")}
            </button>
            <button
              type="button"
              ?disabled=${this.busy}
              @click=${() => void this.closeRequest()}
            >
              ${this.t("helper.end")}
            </button>
          </div>
        </form>
      </section>
    `;
  }

  override render() {
    if (!this.initialized) {
      return html`<main aria-busy="true">
        <p class="status">${this.t("status.loading")}</p>
      </main>`;
    }
    return html`
      <main
        lang=${this.language}
        dir=${this.languages.find(({ code }) => code === this.language)?.dir ?? "ltr"}
      >
        <header>
          <h1>${this.t("helper.title")}</h1>
          ${this.languagePicker()}
          ${
            this.jwt
              ? html`
                  <button
                    type="button"
                    ?disabled=${Boolean(this.activeRequest)}
                    @click=${() => this.signOut()}
                  >
                    ${this.t("helper.signOut")}
                  </button>
                `
              : nothing
          }
        </header>
        ${this.renderShareBanner()}
        ${
          this.notice
            ? html`
                <p
                  class="status"
                  role=${this.noticeIsError ? "alert" : "status"}
                  aria-live=${this.noticeIsError ? "assertive" : "polite"}
                >
                  ${this.notice}
                </p>
              `
            : nothing
        }
        <p class="status" role="status" aria-live="polite" aria-atomic="true">
          ${this.announcement}
        </p>
        ${
          this.jwt
            ? html`
                <section
                  class="provider-status"
                  aria-labelledby="helper-provider-heading"
                >
                  <h2 id="helper-provider-heading">
                    ${this.t("helper.providerStatus")}
                  </h2>
                  <div role="status" aria-live="polite">
                    ${
                      this.providerState === "ready" && this.providerStatus
                        ? html`
                            <p>
                              ${this.t("helper.providerActive", { provider: this.providerStatus.provider })}
                            </p>
                            <p>
                              ${this.t("helper.providerLadder", { ladder: this.providerStatus.ladder.join(" → ") })}
                            </p>
                          `
                        : html`<p>
                            ${this.t(this.providerState === "loading" ? "helper.providerLoading" : "helper.providerUnavailable")}
                          </p>`
                    }
                  </div>
                </section>
              `
            : this.renderLogin()
        }
        ${this.renderPreferences()} ${this.renderQueue()}
        ${this.renderActiveRequest()}
      </main>
    `;
  }
}

if (!customElements.get("dimts-helper-console")) {
  customElements.define("dimts-helper-console", DimtsHelperConsole);
}

declare global {
  interface HTMLElementTagNameMap {
    "dimts-helper-console": DimtsHelperConsole;
  }
}
