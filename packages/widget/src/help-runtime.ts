import { html, nothing } from "lit";
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

export const helpRuntime = {
  async openHelpPreview(this: HelpContext): Promise<void> {
    if (this.helpRequestId || this.helpBusy) return;
    this.helpIncludeSummary = true;
    this.helpNotice = "";
    this.helpNoticeIsError = false;
    this.helpPreviewOpen = true;
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
