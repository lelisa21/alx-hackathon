import { html, nothing } from "lit";
import { createScreenShareController, type ShareState } from "@dimts/help";
import type {
  Language,
  ConversationMessage,
  HelpChatMessage,
} from "./index.js";

export interface HelpContext {
  sessionGeneration: number;
  uiLanguage: string;
  uiDirection: "ltr" | "rtl";
  selectedLang: string;
  request(url: string, init?: RequestInit): Promise<Response>;
  messages: ConversationMessage[];
  sessionId: string;
  sessionToken: string;
  notice: string;
  noticeIsError: boolean;
  helpPreviewOpen: boolean;
  helpIncludeSummary: boolean;
  helpRequestId: string;
  helpMessages: HelpChatMessage[];
  helpDraft: string;
  helpBusy: boolean;
  helpStatus: "connecting" | "connected" | "reconnecting" | "";
  helpNotice: string;
  helpNoticeIsError: boolean;
  helpAnnouncement: string;
  helpSocket: WebSocket | undefined;
  helpReconnectTimer: number | undefined;
  helpReconnectAttempt: number;
  isConnected: boolean;
  hidden: boolean;
  requestUpdate(): void;
  renderRoot: HTMLElement | ShadowRoot;
  updateComplete: Promise<boolean>;
  currentDirection: "ltr" | "rtl";
  currentLanguage: Language | undefined;
  apiRoot: string;
  t(key: string, values?: Record<string, string | number>): string;
  createSession(): Promise<void>;
  cancelHelpPreview(): Promise<void>;
  trapHelpDialog(event: KeyboardEvent): void;
  createHelpRequest(): Promise<void>;
  connectHelpSocket(): void;
  scheduleHelpReconnect(): void;
  handleHelpFrame(raw: unknown): void;
  sendHelpMessage(event: SubmitEvent): void;
  closeHelpRequest(): Promise<void>;
}

interface HelpExtras {
  available?: boolean;
  nextOpenAt?: string | undefined;
  waitTimeoutMs: number;
  availabilityFailed: boolean;
  joined: boolean;
  helperName?: string | undefined;
  timedOut: boolean;
  timer?: number;
  waitStartedAt?: number;
  lastServerMessageId?: string;
  share: ShareState;
  controller?: ReturnType<typeof createScreenShareController> | undefined;
  imageBusy: boolean;
  imageNotice: string;
  imageFailed: boolean;
}
const extras = new WeakMap<HelpContext, HelpExtras>();
function state(context: HelpContext): HelpExtras {
  let value = extras.get(context);
  if (!value) {
    value = {
      waitTimeoutMs: 300000,
      availabilityFailed: false,
      joined: false,
      timedOut: false,
      share: { status: "idle" },
      imageBusy: false,
      imageNotice: "",
      imageFailed: false,
    };
    extras.set(context, value);
  }
  return value;
}
function focusMessage(context: HelpContext): void {
  context.renderRoot
    .querySelector<HTMLTextAreaElement>(".help-chat textarea")
    ?.focus();
}
function scheduleWait(context: HelpContext): void {
  const value = state(context);
  clearTimeout(value.timer);
  if (
    value.joined ||
    value.waitStartedAt === undefined ||
    !context.helpRequestId ||
    !context.isConnected
  )
    return;
  value.timer = window.setTimeout(
    () => {
      if (!value.joined && context.helpRequestId) {
        value.timedOut = true;
        context.requestUpdate();
      }
    },
    Math.max(0, value.waitStartedAt + value.waitTimeoutMs - Date.now()),
  );
}
function sharing(context: HelpContext) {
  const value = state(context);
  return (value.controller ??= createScreenShareController({
    role: "learner",
    send(frame) {
      if (context.helpSocket?.readyState !== WebSocket.OPEN)
        throw new Error("disconnected");
      context.helpSocket.send(JSON.stringify(frame));
    },
    async loadIceServers() {
      const response = await context.request(
        `${context.apiRoot}/help/${encodeURIComponent(context.helpRequestId)}/ice`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${context.sessionToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ sessionId: context.sessionId }),
        },
      );
      if (!response.ok) throw new Error("ice");
      const body = (await response.json()) as { iceServers: RTCIceServer[] };
      return body.iceServers;
    },
    onState(next) {
      value.share = next;
      context.requestUpdate();
      if (next.status === "requested")
        void context.updateComplete.then(() =>
          context.renderRoot
            .querySelector<HTMLButtonElement>(".share-dialog button")
            ?.focus(),
        );
      if (next.status === "idle" || next.status === "fallback")
        void context.updateComplete.then(() => focusMessage(context));
    },
  }));
}
async function loadAvailability(context: HelpContext): Promise<void> {
  const generation = context.sessionGeneration;
  const value = state(context);
  try {
    if (!context.sessionId || !context.sessionToken) return;
    const response = await context.request(
      `${context.apiRoot}/help/availability?sessionId=${encodeURIComponent(context.sessionId)}`,
      { headers: { authorization: `Bearer ${context.sessionToken}` } },
    );
    if (!response.ok) throw new Error("availability");
    const body = (await response.json()) as {
      available: boolean;
      nextOpenAt?: string;
      waitTimeoutMs: number;
    };
    if (
      typeof body.available !== "boolean" ||
      !Number.isFinite(body.waitTimeoutMs) ||
      body.waitTimeoutMs < 1000 ||
      body.waitTimeoutMs > 3600000
    )
      throw new Error("availability");
    if (generation !== context.sessionGeneration) return;
    value.available = body.available;
    value.nextOpenAt = body.nextOpenAt;
    value.waitTimeoutMs = body.waitTimeoutMs;
    value.availabilityFailed = false;
    scheduleWait(context);
  } catch {
    if (generation === context.sessionGeneration)
      value.availabilityFailed = true;
  }
  if (generation === context.sessionGeneration) context.requestUpdate();
}
function availability(context: HelpContext) {
  const value = state(context);
  let date = "";
  if (value.nextOpenAt && Number.isFinite(Date.parse(value.nextOpenAt))) {
    date = new Intl.DateTimeFormat(context.uiLanguage, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value.nextOpenAt));
  }
  return html`<p data-help-availability role="status">
    ${context.t(value.availabilityFailed ? "help.availabilityFailed" : value.available === undefined ? "help.availabilityLoading" : value.available ? "help.hoursOpen" : "help.hoursClosed")}
    ${!value.available && date ? context.t("help.nextOpen", { date }) : nothing}
  </p>`;
}
async function uploadImage(context: HelpContext, event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const value = state(context);
  if (value.imageBusy || !context.helpRequestId) return;
  value.imageFailed = false;
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size === 0 ||
    file.size > 2097152
  ) {
    value.imageFailed = true;
    value.imageNotice = context.t("share.imageInvalid");
    context.requestUpdate();
    return;
  }
  value.imageBusy = true;
  value.imageNotice = "";
  context.requestUpdate();
  const generation = context.sessionGeneration,
    requestId = context.helpRequestId;
  try {
    const response = await context.request(
      `${context.apiRoot}/help/${encodeURIComponent(requestId)}/image?sessionId=${encodeURIComponent(context.sessionId)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${context.sessionToken}`,
          "content-type": file.type,
        },
        body: file,
      },
    );
    if (!response.ok) throw new Error("image");
    if (
      generation === context.sessionGeneration &&
      requestId === context.helpRequestId
    )
      value.imageNotice = context.t("share.imageSent");
  } catch {
    if (
      generation === context.sessionGeneration &&
      requestId === context.helpRequestId
    ) {
      value.imageFailed = true;
      value.imageNotice = context.t("share.imageFailed");
    }
  } finally {
    value.imageBusy = false;
    context.requestUpdate();
  }
}
function renderSharing(context: HelpContext) {
  const value = state(context);
  if (value.share.status === "requested")
    return html`<div class="help-backdrop">
      <section
        class="help-dialog share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.preventDefault();
            sharing(context).decline();
            return;
          }
          if (event.key !== "Tab") return;
          const controls =
            context.renderRoot.querySelectorAll<HTMLButtonElement>(
              ".share-dialog button",
            );
          const active =
            context.renderRoot instanceof ShadowRoot
              ? context.renderRoot.activeElement
              : null;
          if (event.shiftKey && active === controls[0]) {
            event.preventDefault();
            controls[1]?.focus();
          } else if (!event.shiftKey && active === controls[1]) {
            event.preventDefault();
            controls[0]?.focus();
          }
        }}
      >
        <h2 id="share-title">${context.t("share.ask")}</h2>
        <p>${context.t("share.privacy")}</p>
        <div class="help-actions">
          <button type="button" @click=${() => sharing(context).decline()}>
            ${context.t("help.cancel")}</button
          ><button type="button" @click=${() => void sharing(context).accept()}>
            ${context.t("share.accept")}
          </button>
        </div>
      </section>
    </div>`;
  if (value.share.status === "sharing" || value.share.status === "connecting")
    return html`<aside
      class="share-banner"
      role="region"
      aria-label=${context.t("share.active")}
    >
      <span role="status"
        >${context.t(value.share.status === "sharing" ? "share.active" : "share.connecting")}</span
      ><button
        type="button"
        aria-keyshortcuts="Alt+Shift+S"
        @click=${() => sharing(context).stop()}
      >
        ${context.t("share.stop")}
      </button>
    </aside>`;
  return nothing;
}

export const helpRuntime = {
  stopSharing(this: HelpContext): void {
    state(this).controller?.stop();
  },
  suspend(this: HelpContext): void {
    const value = extras.get(this);
    if (!value) return;
    clearTimeout(value.timer);
    value.controller?.dispose();
    value.controller = undefined;
    value.share = { status: "idle" };
  },
  dispose(this: HelpContext): void {
    const value = extras.get(this);
    if (!value) return;
    clearTimeout(value.timer);
    value.controller?.dispose();
    extras.delete(this);
  },
  shareDialogOpen(this: HelpContext): boolean {
    return state(this).share.status === "requested";
  },
  async openHelpPreview(this: HelpContext): Promise<void> {
    if (this.helpRequestId || this.helpBusy) return;
    this.helpIncludeSummary = true;
    this.helpNotice = "";
    this.helpNoticeIsError = false;
    this.helpPreviewOpen = true;
    void loadAvailability(this);
    await this.updateComplete;
    this.renderRoot
      .querySelector<HTMLInputElement>(".help-dialog input")
      ?.focus();
  },

  async cancelHelpPreview(this: HelpContext): Promise<void> {
    this.helpPreviewOpen = false;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLButtonElement>(".help")?.focus();
  },

  trapHelpDialog(this: HelpContext, event: KeyboardEvent): void {
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
  },

  async createHelpRequest(this: HelpContext): Promise<void> {
    const generation = this.sessionGeneration;
    if (this.helpBusy || !this.helpPreviewOpen) return;
    this.helpBusy = true;
    this.helpNotice = "";
    this.helpNoticeIsError = false;
    try {
      if (!this.sessionId || !this.sessionToken) {
        await this.createSession();
      }
      if (generation !== this.sessionGeneration) return;
      if (!this.sessionId || !this.sessionToken) {
        this.helpNotice = this.t("help.error");
        this.helpNoticeIsError = true;
        return;
      }
      const response = await this.request(`${this.apiRoot}/help`, {
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
      if (generation !== this.sessionGeneration) return;
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
      if (generation !== this.sessionGeneration) return;
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
      const value = state(this);
      value.joined = false;
      value.timedOut = false;
      value.helperName = undefined;
      value.waitStartedAt = Date.now();
      scheduleWait(this);
      this.connectHelpSocket();
      await this.updateComplete;
      this.renderRoot
        .querySelector<HTMLTextAreaElement>(".help-chat textarea")
        ?.focus();
    } catch {
      if (generation !== this.sessionGeneration) return;
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
    } finally {
      if (generation === this.sessionGeneration) this.helpBusy = false;
    }
  },

  connectHelpSocket(this: HelpContext): void {
    scheduleWait(this);
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
        const lastMessageId = state(this).lastServerMessageId;
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
        if (this.helpSocket !== socket) return;
        this.handleHelpFrame(event.data);
      };
      socket.onerror = () => {
        this.helpStatus = "reconnecting";
      };
      socket.onclose = (event: CloseEvent) => {
        if (this.helpSocket !== socket) return;
        state(this).controller?.stop();
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
  },

  scheduleHelpReconnect(this: HelpContext): void {
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
  },

  handleHelpFrame(this: HelpContext, raw: unknown): void {
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
      const value = state(this);
      value.joined = !("helperJoined" in frame) || frame.helperJoined === true;
      value.helperName =
        "helperName" in frame && typeof frame.helperName === "string"
          ? frame.helperName
          : undefined;
      if (value.joined) {
        clearTimeout(value.timer);
        value.timedOut = false;
      }
      this.helpStatus = "connected";
      this.helpReconnectAttempt = 0;
      this.helpNotice = "";
      this.helpNoticeIsError = false;
      this.requestUpdate();
      return;
    }
    if (frame.type === "help.closed") {
      helpRuntime.dispose.call(this);
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
      typeof frame.type === "string" &&
      (frame.type.startsWith("share.") || frame.type.startsWith("rtc."))
    ) {
      if (this.hidden || !this.isConnected) return;
      void sharing(this).handleFrame(frame);
      return;
    }
    if (frame.type === "chat.typing") return;
    if (
      frame.type !== "chat.message" ||
      !("id" in frame) ||
      typeof frame.id !== "string" ||
      !("text" in frame) ||
      typeof frame.text !== "string" ||
      !("from" in frame) ||
      (frame.from !== "helper" && frame.from !== "learner")
    ) {
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
      return;
    }
    state(this).lastServerMessageId = frame.id;
    if (this.helpMessages.some((message) => message.id === frame.id)) return;
    this.helpMessages = [
      ...this.helpMessages,
      { id: frame.id, from: frame.from, text: frame.text },
    ];
    if (frame.from !== "helper") return;
    this.helpAnnouncement = "";
    void this.updateComplete.then(() => {
      if (this.helpRequestId) this.helpAnnouncement = this.t("help.newMessage");
    });
  },

  sendHelpMessage(this: HelpContext, event: SubmitEvent): void {
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
  },

  async closeHelpRequest(this: HelpContext): Promise<void> {
    const generation = this.sessionGeneration;
    if (!this.helpRequestId || this.helpBusy) return;
    this.helpBusy = true;
    helpRuntime.stopSharing.call(this);
    this.helpNotice = "";
    this.helpNoticeIsError = false;
    try {
      const response = await this.request(
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
      if (generation !== this.sessionGeneration) return;
      if (!response.ok) throw new Error("help close");
      helpRuntime.dispose.call(this);
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
      if (generation !== this.sessionGeneration) return;
      this.helpNotice = this.t("help.error");
      this.helpNoticeIsError = true;
    } finally {
      if (generation === this.sessionGeneration) this.helpBusy = false;
    }
  },

  renderHelpPreview(this: HelpContext): unknown {
    if (!this.helpPreviewOpen) return renderSharing(this);
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
          ${availability(this)}
          <p>
            ${this.t("help.preview.language", {
              language: this.currentLanguage?.nameNative ?? this.selectedLang,
            })}
          </p>
          <label class="setting-row" for="include-help-summary">
            <span>${this.t("help.includeSummary")}</span>
            <input
              lang=${this.uiLanguage}
              dir=${this.uiDirection}
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
                    tabindex="0"
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
            <button
              lang=${this.uiLanguage}
              dir=${this.uiDirection}
              type="button"
              @click=${() => void this.cancelHelpPreview()}
            >
              ${this.t("help.cancel")}
            </button>
            <button
              lang=${this.uiLanguage}
              dir=${this.uiDirection}
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
  },

  renderHelpSession(this: HelpContext): unknown {
    if (!this.helpRequestId) return nothing;
    const value = state(this);
    return html`
      <section
        class="panel"
        aria-labelledby="help-chat-heading"
        lang=${this.selectedLang}
        dir=${this.currentDirection}
      >
        <h2 id="help-chat-heading">${this.t("help.chat")}</h2>
        ${
          !value.joined
            ? html`<p>${this.t("help.waiting")}</p>
                ${availability(this)}${value.timedOut ? html`<p data-help-timeout role="status">${this.t("help.timeout")}</p>` : nothing}<button
                  type="button"
                  @click=${() => focusMessage(this)}
                >
                  ${this.t("help.leaveMessage")}
                </button>`
            : nothing
        }
        ${value.helperName ? html`<p>${this.t("help.named", { name: value.helperName })}</p>` : nothing}
        <p role="status" aria-live="polite">
          ${this.t(`help.${this.helpStatus === "connected" && !value.joined ? "messageReady" : this.helpStatus || "connecting"}`)}
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
        ${value.share.status === "fallback" ? html`<p role="status">${this.t("share.fallback")}</p>` : nothing}
        ${
          value.joined || value.share.status === "fallback"
            ? html`<section
                class="share-fallback"
                aria-label=${this.t("share.alternatives")}
              >
                <label for="help-picture">${this.t("share.picture")}</label
                ><input
                  id="help-picture"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  ?disabled=${value.imageBusy}
                  @change=${(event: Event) => void uploadImage(this, event)}
                />
                <p>${this.t("share.imagePrivacy")}</p>
                <button type="button" @click=${() => focusMessage(this)}>
                  ${this.t("share.describe")}
                </button>
                <p role=${value.imageFailed ? "alert" : "status"}>
                  ${value.imageBusy ? this.t("share.imageUploading") : value.imageNotice}
                </p>
              </section>`
            : nothing
        }
        <form
          class="help-chat"
          @submit=${(event: SubmitEvent) => this.sendHelpMessage(event)}
        >
          <label for="help-message">${this.t("help.message")}</label>
          <textarea
            lang=${this.uiLanguage}
            dir=${this.uiDirection}
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
              lang=${this.uiLanguage}
              dir=${this.uiDirection}
              type="submit"
              class="primary"
              ?disabled=${this.helpStatus !== "connected" || this.helpBusy}
            >
              ${this.t("help.send")}
            </button>
            <button
              lang=${this.uiLanguage}
              dir=${this.uiDirection}
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
  },
};
