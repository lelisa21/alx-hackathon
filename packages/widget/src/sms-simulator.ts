import { LitElement, html, nothing, unsafeCSS } from "lit";
import { countSms, normalizeForSms } from "@dimts/sms/segments";
import packs from "virtual:dimts-simulator-locales";
import styles from "./sms-simulator.css?inline";
import { messageFor } from "./messages.js";
import {
  inboundEndpoint,
  parseSmsResponse,
  type SimulatorMessage,
} from "./sms-simulator-runtime.js";
import regularFontUrl from "../../../assets/fonts/NotoSansEthiopic-ethiopic-400-normal.woff2?url&no-inline";
import boldFontUrl from "../../../assets/fonts/NotoSansEthiopic-ethiopic-700-normal.woff2?url&no-inline";

type ThreadMessage = SimulatorMessage & { direction: "inbound" | "outbound" };
interface PendingInbound {
  endpoint: string;
  body: { id: string; from: string; text: string };
}

/** Standalone operator simulator: all credentials, contact and text are ephemeral. */
export class DimtsSmsSimulator extends LitElement {
  static override properties = {
    api: { state: true },
    secret: { state: true },
    phone: { state: true },
    language: { state: true },
    draft: { state: true },
    messages: { state: true },
    busy: { state: true },
    stopped: { state: true },
    error: { state: true },
  };

  declare private api: string;
  declare private secret: string;
  declare private phone: string;
  declare private language: string;
  declare private draft: string;
  declare private messages: ThreadMessage[];
  declare private busy: boolean;
  declare private stopped: boolean;
  declare private error: "" | "error" | "invalidConfiguration";
  private pending: PendingInbound | undefined;
  private requestController: AbortController | undefined;
  private readonly preview =
    new URL(window.location.href).searchParams.get("lang_preview") === "1";

  static override styles = unsafeCSS(styles);

  constructor() {
    super();
    this.api = "/v1";
    this.secret = "";
    this.phone = "";
    this.language = "en";
    this.draft = "";
    this.messages = [];
    this.busy = false;
    this.stopped = false;
    this.error = "";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.applyLanguage();
    for (const [url, weight] of [
      [regularFontUrl, "400"],
      [boldFontUrl, "700"],
    ] as const) {
      document.fonts.add(
        new FontFace("Noto Sans Ethiopic", `url(${url})`, {
          display: "swap",
          weight,
          unicodeRange: "U+1200-137F, U+1380-139F",
        }),
      );
    }
  }

  override disconnectedCallback(): void {
    this.requestController?.abort();
    this.secret = "";
    this.phone = "";
    this.draft = "";
    this.pending = undefined;
    this.messages = [];
    super.disconnectedCallback();
  }

  private t(key: string, values: Record<string, string | number> = {}): string {
    return messageFor(
      packs[this.language]!.ui,
      `smsSim.${key}`,
      values,
      this.language,
    );
  }

  private applyLanguage(): void {
    const pack = packs[this.language]!;
    this.dir = pack.dir;
    this.lang = this.language;
    document.documentElement.dir = pack.dir;
    document.documentElement.lang = this.language;
    document.title = this.t("title");
  }

  private selectLanguage(event: Event): void {
    this.language = (event.target as HTMLSelectElement).value;
    this.applyLanguage();
  }

  private async focusField(id: string): Promise<void> {
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(`#${id}`)?.focus();
  }

  private newThread(): void {
    if (this.busy) return;
    this.secret = "";
    this.phone = "";
    this.draft = "";
    this.messages = [];
    this.pending = undefined;
    this.stopped = false;
    this.error = "";
    void this.focusField("sms-phone");
  }

  private async send(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.busy || this.stopped) return;
    if (!this.pending) {
      if (!this.draft.trim()) return;
      try {
        if (!/^\+[1-9]\d{7,14}$/u.test(this.phone) || !this.secret.trim())
          throw new Error("sms configuration");
        const text = normalizeForSms(this.draft);
        this.pending = {
          endpoint: inboundEndpoint(this.api, window.location.href),
          body: { id: crypto.randomUUID(), from: this.phone, text },
        };
        this.messages = [
          ...this.messages,
          {
            id: this.pending.body.id,
            direction: "inbound",
            text,
            ...countSms(text),
            status: "queued",
          },
        ];
      } catch {
        this.error = "invalidConfiguration";
        return;
      }
    }
    const pending = this.pending;
    this.busy = true;
    this.error = "";
    this.requestController = new AbortController();
    const timeout = window.setTimeout(
      () => this.requestController?.abort(),
      30_000,
    );
    try {
      const response = await fetch(pending.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.secret}`,
        },
        body: JSON.stringify(pending.body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: this.requestController.signal,
      });
      if (!response.ok) throw new Error("sms request");
      const result = parseSmsResponse(await response.json());
      if (!this.isConnected) return;
      this.messages = [
        ...this.messages.map((item) =>
          item.id === pending.body.id
            ? { ...item, status: "sent" as const }
            : item,
        ),
        ...result.messages.map((item) => ({
          ...item,
          direction: "outbound" as const,
        })),
      ];
      this.stopped = result.stopped;
      this.pending = undefined;
      this.draft = "";
    } catch {
      if (this.isConnected) {
        this.error = "error";
        this.messages = this.messages.map((item) =>
          item.id === pending.body.id ? { ...item, status: "failed" } : item,
        );
      }
    } finally {
      window.clearTimeout(timeout);
      this.requestController = undefined;
      this.busy = false;
      if (this.isConnected) {
        await this.updateComplete;
        const thread = this.renderRoot.querySelector<HTMLElement>(".thread");
        if (thread) thread.scrollTop = thread.scrollHeight;
        void this.focusField(
          this.error
            ? "sms-retry"
            : this.stopped
              ? "sms-new-thread"
              : "sms-message",
        );
      }
    }
  }

  private renderMessage(message: ThreadMessage) {
    return html`<li class=${message.direction}>
      <article>
        <p class="message-direction">${this.t(message.direction)}</p>
        <p class="message-text" dir="auto">${message.text}</p>
        <p class="message-meta">
          <span
            >${this.t("encoding", { encoding: this.t(message.encoding) })}</span
          >
          <span>${this.t("segments", { count: message.segments })}</span>
          <span>${this.t(message.status)}</span>
        </p>
      </article>
    </li>`;
  }

  override render() {
    const count = countSms(this.draft);
    const characters = Array.from(this.draft).length;
    const threadStarted = this.messages.length > 0;
    return html` <main>
      <header>
        <p class="eyebrow">${this.t("description")}</p>
        <h1>${this.t("title")}</h1>
        <p>${this.t("privacy")}</p>
      </header>
      <div class="workspace">
        <section class="configuration" aria-label=${this.t("title")}>
          <label for="sms-language">${this.t("uiLanguage")}</label>
          <select
            id="sms-language"
            .value=${this.language}
            @change=${this.selectLanguage}
          >
            ${Object.entries(packs)
              .filter(([, pack]) => this.preview || pack.status !== "draft")
              .map(
                ([code, pack]) =>
                  html`<option value=${code}>
                    ${pack.name}${pack.status === "beta" ? ` · ${messageFor(packs[this.language]!.ui, "status.beta")}` : ""}
                  </option>`,
              )}
          </select>
          <label for="sms-api">${this.t("api")}</label>
          <input
            id="sms-api"
            type="text"
            dir="ltr"
            autocomplete="off"
            spellcheck="false"
            .value=${this.api}
            ?disabled=${threadStarted || this.busy}
            aria-describedby="sms-api-hint"
            @input=${(event: Event) => {
              this.api = (event.target as HTMLInputElement).value;
            }}
          />
          <p class="hint" id="sms-api-hint">${this.t("apiHint")}</p>
          <label for="sms-secret">${this.t("secret")}</label>
          <input
            id="sms-secret"
            type="password"
            autocomplete="off"
            spellcheck="false"
            .value=${this.secret}
            ?disabled=${this.busy}
            aria-describedby="sms-secret-hint"
            @input=${(event: Event) => {
              this.secret = (event.target as HTMLInputElement).value;
            }}
          />
          <p class="hint" id="sms-secret-hint">${this.t("secretHint")}</p>
          <label for="sms-phone">${this.t("phone")}</label>
          <input
            id="sms-phone"
            type="tel"
            dir="ltr"
            autocomplete="off"
            .value=${this.phone}
            ?disabled=${threadStarted || this.busy}
            aria-describedby="sms-phone-hint"
            @input=${(event: Event) => {
              this.phone = (event.target as HTMLInputElement).value;
            }}
          />
          <p class="hint" id="sms-phone-hint">${this.t("phoneHint")}</p>
          <button
            id="sms-new-thread"
            type="button"
            class="secondary"
            ?disabled=${this.busy}
            @click=${this.newThread}
          >
            ${this.t("newThread")}
          </button>
          <p class="hint">${this.t("newThreadHint")}</p>
        </section>
        <section class="phone" aria-label=${this.t("thread")}>
          <h2>${this.t("thread")}</h2>
          <div
            class="thread"
            role="log"
            aria-label=${this.t("thread")}
            aria-live="polite"
            aria-relevant="additions text"
          >
            ${
              threadStarted
                ? html`<ol>
                    ${this.messages.map((message) => this.renderMessage(message))}
                  </ol>`
                : html`<p class="empty">${this.t("empty")}</p>`
            }
          </div>
          <form @submit=${this.send}>
            <label for="sms-message">${this.t("message")}</label>
            <textarea
              id="sms-message"
              rows="3"
              maxlength="1000"
              autocomplete="off"
              spellcheck="false"
              dir="auto"
              .value=${this.draft}
              ?disabled=${this.busy || this.stopped || Boolean(this.pending)}
              aria-describedby="sms-counters"
              @input=${(event: Event) => {
                this.draft = (event.target as HTMLTextAreaElement).value;
              }}
            ></textarea>
            <div
              id="sms-counters"
              class="counters"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-characters=${characters}
              data-encoding=${count.encoding}
              data-units=${count.units}
              data-segments=${count.segments}
            >
              <span>${this.t("characters", { count: characters })}</span>
              <span
                >${this.t("encoding", { encoding: this.t(count.encoding) })}</span
              >
              <span>${this.t("units", { count: count.units })}</span>
              <span>${this.t("segments", { count: count.segments })}</span>
            </div>
            <button
              type="submit"
              ?disabled=${this.busy || this.stopped || Boolean(this.pending) || !this.draft.trim()}
            >
              ${this.t("send")}
            </button>
          </form>
          ${this.busy ? html`<p role="status">${this.t("sending")}</p>` : nothing}
          ${
            this.error
              ? html`<p role="alert">${this.t(this.error)}</p>
                  ${this.pending ? html`<button id="sms-retry" type="button" ?disabled=${this.busy} @click=${() => void this.send()}>${this.t("retry")}</button>` : nothing}`
              : nothing
          }
          ${this.stopped ? html`<p class="stopped" role="status">${this.t("stopped")}</p>` : nothing}
        </section>
      </div>
    </main>`;
  }
}

customElements.define("dimts-sms-simulator", DimtsSmsSimulator);
