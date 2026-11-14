import { LitElement, css, html, nothing } from "lit";
import { messageFor } from "./messages.js";

interface InsightRow {
  topicId: string;
  topicLabel: string | null;
  lang: string;
  period: string;
  questionCount: number;
  notfoundCount: number;
  helpfulCount: number;
  unhelpfulCount: number;
}

interface InsightResponse {
  insights: InsightRow[];
  period: { start: string; end: string };
  exportedAt: string;
}

interface UiLanguage {
  code: string;
  nameNative?: string;
  nameEn?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class DimtsInsightsPage extends LitElement {
  static override properties = {
    api: { attribute: "data-api" },
    language: { attribute: "data-language" },
    sessionToken: { attribute: "data-session-token" },
    ui: { state: true },
    rows: { state: true },
    languages: { state: true },
    loading: { state: true },
    failed: { state: true },
    selectedLanguage: { state: true },
    startDate: { state: true },
    endDate: { state: true },
    minCellSize: { state: true },
  };

  static override styles = css`
    :host {
      display: block;
      color: #10212d;
      font:
        1rem/1.5 system-ui,
        sans-serif;
    }

    main {
      max-inline-size: 72rem;
      margin-inline: auto;
      padding: 1.5rem;
    }

    h1 {
      font-size: 1.75rem;
      line-height: 1.2;
    }

    form {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 1rem;
      margin-block: 1.5rem;
      padding: 1rem;
      border: 1px solid #647887;
      border-radius: 0.5rem;
    }

    label {
      display: grid;
      gap: 0.25rem;
    }

    input,
    select,
    button {
      min-block-size: 2.75rem;
      max-inline-size: 100%;
      padding: 0.5rem 0.75rem;
      border: 1px solid #405563;
      border-radius: 0.25rem;
      color: inherit;
      background: #fff;
      font: inherit;
    }

    button {
      cursor: pointer;
      font-weight: 700;
    }

    :focus-visible {
      outline: 3px solid #075da8;
      outline-offset: 2px;
    }

    .table-wrap {
      max-inline-size: 100%;
      overflow-x: auto;
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    caption {
      padding-block: 0.5rem;
      text-align: start;
      font-weight: 700;
    }

    th,
    td {
      padding: 0.625rem;
      border: 1px solid #8a9aa5;
      text-align: start;
      vertical-align: top;
    }

    th {
      background: #eaf0f3;
    }

    .summary {
      margin-block: 1rem;
      font-weight: 700;
    }

    [role="status"],
    [role="alert"] {
      padding: 0.75rem;
    }

    @media (max-width: 40rem) {
      main {
        padding: 1rem;
      }

      form > * {
        flex: 1 1 100%;
      }
    }
  `;

  declare api: string;
  declare language: string;
  declare sessionToken: string;
  declare private ui: Record<string, unknown>;
  declare private rows: InsightRow[];
  declare private languages: UiLanguage[];
  declare private loading: boolean;
  declare private failed: boolean;
  declare private selectedLanguage: string;
  declare private startDate: string;
  declare private endDate: string;
  declare private minCellSize: string;

  constructor() {
    super();
    this.api = "";
    this.language = "en";
    this.sessionToken = "";
    this.ui = {};
    this.rows = [];
    this.languages = [];
    this.loading = true;
    this.failed = false;
    this.selectedLanguage = "";
    this.startDate = "";
    this.endDate = "";
    this.minCellSize = "5";
  }

  private get apiRoot(): string {
    return this.api.replace(/\/+$/u, "");
  }

  private t(key: string, values: Record<string, string | number> = {}): string {
    return messageFor(this.ui, key, values, this.language);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async json<T>(url: string, authenticated = false): Promise<T> {
    const response = await fetch(url, {
      ...(authenticated
        ? { headers: { Authorization: `Bearer ${this.sessionToken}` } }
        : {}),
    });
    if (!response.ok) throw new Error("Request failed");
    return (await response.json()) as T;
  }

  private queryParameters(format?: "csv"): URLSearchParams {
    const query = new URLSearchParams({ minCellSize: this.minCellSize });
    if (this.selectedLanguage) query.set("lang", this.selectedLanguage);
    if (this.startDate) query.set("startDate", this.startDate);
    if (this.endDate) query.set("endDate", this.endDate);
    if (format) query.set("format", format);
    return query;
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.failed = false;
    try {
      if (!this.apiRoot || !this.sessionToken)
        throw new Error("Missing session");
      const [ui, languages] = await Promise.all([
        this.json<unknown>(
          `${this.apiRoot}/locales/${encodeURIComponent(this.language)}/ui`,
        ),
        this.json<{ languages: UiLanguage[] }>(`${this.apiRoot}/languages`),
      ]);
      if (!isRecord(ui) || !Array.isArray(languages.languages))
        throw new Error("Invalid response");
      this.ui = ui;
      this.languages = languages.languages.filter(
        (language): language is UiLanguage =>
          isRecord(language) && typeof language.code === "string",
      );
      await this.loadRows();
    } catch {
      this.failed = true;
      this.loading = false;
    }
  }

  private async loadRows(): Promise<void> {
    this.loading = true;
    this.failed = false;
    try {
      const url = `${this.apiRoot}/insights?${this.queryParameters().toString()}`;
      const response = await this.json<InsightResponse>(url, true);
      this.rows = Array.isArray(response.insights) ? response.insights : [];
    } catch {
      this.failed = true;
    } finally {
      this.loading = false;
    }
  }

  private applyFilters(event: SubmitEvent): void {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = new FormData(form);
    this.selectedLanguage = String(values.get("lang") ?? "");
    this.startDate = String(values.get("startDate") ?? "");
    this.endDate = String(values.get("endDate") ?? "");
    this.minCellSize = String(values.get("minCellSize") ?? "5");
    void this.loadRows();
  }

  private async downloadCsv(): Promise<void> {
    try {
      const url = `${this.apiRoot}/insights?${this.queryParameters("csv").toString()}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.sessionToken}` },
      });
      if (!response.ok) throw new Error("Request failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = this.t("insights.csv.filename", {
        date: new Date().toISOString().slice(0, 10),
      });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      this.failed = true;
    }
  }

  private get summary(): string {
    return this.t("insights.summary", {
      languages: new Set(this.rows.map(({ lang }) => lang)).size,
      topics: new Set(this.rows.map(({ topicId }) => topicId)).size,
      questions: this.rows.reduce((sum, row) => sum + row.questionCount, 0),
      notfound: this.rows.reduce((sum, row) => sum + row.notfoundCount, 0),
    });
  }

  protected override render() {
    return html`
      <main lang=${this.language} aria-busy=${this.loading ? "true" : "false"}>
        <h1>${this.t("insights.title")}</h1>
        ${
          this.loading
            ? html`<p role="status" aria-live="polite">
                ${this.t("insights.loading")}
              </p>`
            : nothing
        }
        ${
          this.failed
            ? html`<div role="alert">
                <p>${this.t("insights.error")}</p>
                <button type="button" @click=${() => void this.load()}>
                  ${this.t("insights.errorRetry")}
                </button>
              </div>`
            : nothing
        }
        ${
          !this.loading && !this.failed
            ? html`
                <form @submit=${this.applyFilters}>
                  <fieldset>
                    <legend>${this.t("insights.filters")}</legend>
                    <label>
                      ${this.t("insights.filter.language")}
                      <select name="lang" .value=${this.selectedLanguage}>
                        <option value="">
                          ${this.t("insights.filter.allLanguages")}
                        </option>
                        ${this.languages.map(
                          (language) =>
                            html`<option value=${language.code}>
                              ${language.nameNative ?? language.nameEn ?? language.code}
                            </option>`,
                        )}
                      </select>
                    </label>
                    <label>
                      ${this.t("insights.filter.startDate")}
                      <input
                        type="date"
                        name="startDate"
                        .value=${this.startDate}
                      />
                    </label>
                    <label>
                      ${this.t("insights.filter.endDate")}
                      <input
                        type="date"
                        name="endDate"
                        .value=${this.endDate}
                      />
                    </label>
                    <label>
                      ${this.t("insights.filter.minCellSize")}
                      <input
                        type="number"
                        name="minCellSize"
                        min="5"
                        step="1"
                        .value=${this.minCellSize}
                      />
                    </label>
                    <button type="submit">${this.t("insights.apply")}</button>
                  </fieldset>
                </form>
                <p class="summary" aria-live="polite">${this.summary}</p>
                ${
                  this.rows.length
                    ? html`<div class="table-wrap">
                        <table>
                          <caption>
                            ${this.t("insights.table.caption")}
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">
                                ${this.t("insights.table.topic")}
                              </th>
                              <th scope="col">
                                ${this.t("insights.table.language")}
                              </th>
                              <th scope="col">
                                ${this.t("insights.table.period")}
                              </th>
                              <th scope="col">
                                ${this.t("insights.table.questions")}
                              </th>
                              <th scope="col">
                                ${this.t("insights.table.notfound")}
                              </th>
                              <th scope="col">
                                ${this.t("insights.table.helpful")}
                              </th>
                              <th scope="col">
                                ${this.t("insights.table.unhelpful")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            ${this.rows.map(
                              (row) =>
                                html`<tr>
                                  <th scope="row">
                                    ${row.topicLabel ?? row.topicId}
                                  </th>
                                  <td>${row.lang}</td>
                                  <td>
                                    <time datetime=${row.period}
                                      >${row.period}</time
                                    >
                                  </td>
                                  <td>${row.questionCount}</td>
                                  <td>${row.notfoundCount}</td>
                                  <td>${row.helpfulCount}</td>
                                  <td>${row.unhelpfulCount}</td>
                                </tr>`,
                            )}
                          </tbody>
                        </table>
                      </div>`
                    : html`<p>${this.t("insights.empty")}</p>`
                }
                <button type="button" @click=${() => void this.downloadCsv()}>
                  ${this.t("insights.csv.download")}
                </button>
              `
            : nothing
        }
      </main>
    `;
  }
}

if (!customElements.get("dimts-insights")) {
  customElements.define("dimts-insights", DimtsInsightsPage);
}

declare global {
  interface HTMLElementTagNameMap {
    "dimts-insights": DimtsInsightsPage;
  }
}
