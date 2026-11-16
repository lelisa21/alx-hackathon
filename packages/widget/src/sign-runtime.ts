import { html } from "lit";
import type { TemplateResult } from "lit";

export interface SignContext {
  selectedLang: string;
  uiLanguage: string;
  uiDirection: "ltr" | "rtl";
  currentDirection: "ltr" | "rtl";
  t(key: string, values?: Record<string, string | number>): string;
  askFromSign(text: string): Promise<void>;
  closeSignSpace(): void;
}

export interface SignGesture {
  id: string;
  labelKey: string;
  gloss: {
    en: string;
    am: string;
    om: string;
    ti: string;
  };
  category: "essential" | "learning" | "conversation";
  movementDescription: string;
  query: {
    en: string;
    am: string;
    om: string;
    ti: string;
  };
  handShape: "open-palm" | "fist-nod" | "open-book" | "chin-touch" | "temple-tap";
}

const ETHSL_BADGE = "EthSL";
export const ETHSL_GESTURES: readonly SignGesture[] = [
  {
    id: "hello",
    labelKey: "sign.gestureHello",
    gloss: {
      en: "Hello / Peace",
      am: "ሰላም",
      om: "Nagaa",
      ti: "ሰላም",
    },
    category: "essential",
    movementDescription:
      "Open palm begins near the chest and arcs gently forward and outward with a welcoming smile.",
    query: {
      en: "Hello, how can you help me learn today?",
      am: "ሰላም፣ ዛሬ እንድማር በምን ልትረዳኝ ትችላለህ?",
      om: "Akkam, har'a akkamitti na gargaaruu dandeessa?",
      ti: "ሰላም፣ ሎሚ ክመሃር ብኸመይ ክትሕግዘኒ ትኽእል?",
    },
    handShape: "open-palm",
  },
  {
    id: "thank_you",
    labelKey: "sign.gestureThankYou",
    gloss: {
      en: "Thank you",
      am: "አመሰግናለሁ",
      om: "Galatoomaa",
      ti: "የቐንየለይ",
    },
    category: "essential",
    movementDescription:
      "Fingertips of flat right hand lightly touch chin or lips, then move forward toward person with head nod.",
    query: {
      en: "Thank you for the explanation.",
      am: "ስለ ማብራሪያው አመሰግናለሁ።",
      om: "Ibsa kenniteef galatoomi.",
      ti: "ስለቲ መብርሂ የቐንየለይ።",
    },
    handShape: "chin-touch",
  },
  {
    id: "need_help",
    labelKey: "sign.gestureHelp",
    gloss: {
      en: "Need Help",
      am: "እርዳታ እፈልጋለሁ",
      om: "Gargaarsa barbaada",
      ti: "ሓገዝ እደሊ",
    },
    category: "essential",
    movementDescription:
      "Left palm faces up. Right closed hand with thumb raised rests upon left palm, lifting upward together.",
    query: {
      en: "I need help with this lesson.",
      am: "በዚህ ትምህርት ላይ እርዳታ እፈልጋለሁ።",
      om: "Barnoota kana irratti gargaarsa barbaada.",
      ti: "ኣብዚ ትምህርቲ ሓገዝ እደሊ ኣለኹ።",
    },
    handShape: "fist-nod",
  },
  {
    id: "question",
    labelKey: "sign.gestureQuestion",
    gloss: {
      en: "Ask Question",
      am: "ጥያቄ አለኝ",
      om: "Gaaffii qaba",
      ti: "ሕቶ ኣሎኒ",
    },
    category: "learning",
    movementDescription:
      "Index finger traces question mark in the air, ending with a small forward point and raised eyebrows.",
    query: {
      en: "Can you explain the main concept simply?",
      am: "ዋናውን ጽንሰ-ሀሳብ በቀላሉ ልታስረዳኝ ትችላለህ?",
      om: "Yaada ijoo salphaatti naaf ibsuu dandeessaa?",
      ti: "ነቲ ቀንዲ ሓሳብ ብቐሊሉ ክተረድኣኒ ትኽእልዶ?",
    },
    handShape: "open-palm",
  },
  {
    id: "understand",
    labelKey: "sign.gestureUnderstand",
    gloss: {
      en: "I Understand",
      am: "ገብቶኛል",
      om: "Naaf galeera",
      ti: "ተረዲኡኒ",
    },
    category: "learning",
    movementDescription:
      "Right index finger taps near the temple and opens upward into an open palm with an affirmative nod.",
    query: {
      en: "I understand. What should I study next?",
      am: "ገብቶኛል። ቀጥሎ ምን ማጥናት አለብኝ?",
      om: "Naaf galeera. Itti aansee maalan qo'adha?",
      ti: "ተረዲኡኒ ኣሎ። ቀጺለ እንታይ ከጽንዕ ኣለኒ?",
    },
    handShape: "temple-tap",
  },
  {
    id: "repeat",
    labelKey: "sign.gestureRepeat",
    gloss: {
      en: "Please Repeat",
      am: "እባክዎን ይድገሙልኝ",
      om: "Mee irra deebi'aa",
      ti: "ብኽብረትኩም ድገሙለይ",
    },
    category: "learning",
    movementDescription:
      "Right hand cupped in small arc rolls inward toward body in gentle circular motion asking to repeat.",
    query: {
      en: "Please repeat and explain with simpler words.",
      am: "እባክዎ በቀላል ቃላት ደግመው ያብራሩልኝ።",
      om: "Mee jechoota salphaadhaan irra deebi'ii naaf ibsi.",
      ti: "ብኽብረትኩም ብቐለልቲ ቃላት ደጊምኩም ኣብራህሩለይ።",
    },
    handShape: "open-palm",
  },
  {
    id: "yes",
    labelKey: "sign.gestureYes",
    gloss: {
      en: "Yes",
      am: "አዎ",
      om: "Eeyyee",
      ti: "እወ",
    },
    category: "conversation",
    movementDescription:
      "Right hand forms loose fist and nods up and down at wrist, mimicking head nod.",
    query: {
      en: "Yes, please continue.",
      am: "አዎ፣ እባክዎ ይቀጥሉ።",
      om: "Eeyyee, mee itti fufaa.",
      ti: "እወ፣ ብኽብረትኩም ቀጽሉ።",
    },
    handShape: "fist-nod",
  },
  {
    id: "no",
    labelKey: "sign.gestureNo",
    gloss: {
      en: "No",
      am: "አይደለም",
      om: "Lakki",
      ti: "ኣይኮነን",
    },
    category: "conversation",
    movementDescription:
      "Index and middle finger snap horizontally against thumb, or extended index finger wags side to side.",
    query: {
      en: "No, that is not what I meant. Let me clarify.",
      am: "አይደለም፣ ማለቴ ይሄ አልነበረም። ላብራራልህ።",
      om: "Lakki, jechuun koo kana hin turre. Naaf eeyyamaa ibsa.",
      ti: "ኣይኮነን፣ ማለተይ እዚ ኣይነበረን። ከብርሃልካ።",
    },
    handShape: "open-palm",
  },
];

function renderHandSvg(shape: SignGesture["handShape"]): TemplateResult {
  switch (shape) {
    case "chin-touch":
      return html`
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="32" cy="20" r="12" stroke-dasharray="2 3" opacity="0.4" />
          <path d="M28 28c0 4 2 8 6 8s6-4 6-8" />
          <path d="M30 46v-8a3 3 0 0 1 6 0v8" />
          <path d="M36 40a3 3 0 0 1 6 0v6" />
          <path d="M24 44v-4a3 3 0 0 1 6 0" />
          <path d="M24 44c0 8 6 12 14 12s12-4 12-10v-6" />
          <path d="M42 34l6-6m0 0l-4-1m4 1l-1 4" stroke-width="2" />
        </svg>
      `;
    case "fist-nod":
      return html`
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="22" y="24" width="20" height="24" rx="6" />
          <path d="M26 24v-8a4 4 0 0 1 8 0v8" />
          <path d="M22 32h20M22 40h20" opacity="0.4" />
          <path d="M14 54h36" stroke-width="3" />
          <path d="M32 10v-4m-3 3l3-3 3 3" stroke-width="2" />
        </svg>
      `;
    case "temple-tap":
      return html`
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="32" cy="28" r="14" opacity="0.4" />
          <path d="M42 22l8-4m-4 8l6-2" opacity="0.6" />
          <path d="M38 48v-8a3 3 0 0 0-6 0v8" />
          <path d="M32 40v-8a3 3 0 0 0-6 0v16" />
          <path d="M26 36v-14a3 3 0 0 0-6 0v26c0 6 4 10 12 10s12-4 12-10v-4" />
        </svg>
      `;
    case "open-palm":
    default:
      return html`
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 40v-8a3 3 0 0 1 6 0v8" />
          <path d="M26 32v-12a3 3 0 0 1 6 0v12" />
          <path d="M32 20v-10a3 3 0 0 1 6 0v10" />
          <path d="M38 20v-6a3 3 0 0 1 6 0v14" />
          <path d="M44 30a3 3 0 0 1 6 0v10c0 10-6 16-16 16s-16-6-16-16v-6a3 3 0 0 1 6 0" />
          <path d="M48 22c4 4 6 9 6 15" stroke-dasharray="2 2" opacity="0.5" />
        </svg>
      `;
  }
}

const SIGN_STYLES = `
  .sign-studio-container {
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0.5rem;
    padding: 1rem;
  }
  .sign-studio-header {
    align-items: center;
    display: flex;
    justify-content: space-between;
  }
  .sign-studio-title {
    align-items: center;
    display: flex;
    gap: 0.5rem;
  }
  .sign-studio-title h2 {
    font-size: 1.15rem;
    margin: 0;
  }
  .sign-badge {
    background: var(--Bridgely-primary);
    border-radius: 999px;
    color: var(--Bridgely-primary-text);
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.125rem 0.5rem;
  }
  .sign-close-btn {
    align-items: center;
    background: transparent;
    border: none;
    cursor: pointer;
    display: grid;
    place-items: center;
    min-block-size: 40px;
    min-inline-size: 40px;
    padding: 0;
  }
  .sign-close-btn svg {
    block-size: 1.25rem;
    inline-size: 1.25rem;
  }
  .sign-studio-subtitle {
    color: var(--Bridgely-muted);
    font-size: 0.875rem;
    margin: 0;
  }
  .sign-stage {
    background: var(--Bridgely-ink-soft);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: 0.875rem;
    padding: 0.875rem;
  }
  .sign-visual-card {
    align-items: center;
    display: flex;
    gap: 1rem;
  }
  .sign-illustration {
    align-items: center;
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: 0.75rem;
    color: var(--Bridgely-primary);
    display: flex;
    flex: none;
    block-size: 5rem;
    inline-size: 5rem;
    justify-content: center;
    padding: 0.5rem;
  }
  .sign-illustration svg {
    block-size: 100%;
    inline-size: 100%;
  }
  .sign-details {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.25rem;
  }
  .sign-category-pill {
    color: var(--Bridgely-muted);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .sign-active-gloss {
    font-size: 1.25rem;
    margin: 0;
  }
  .sign-description {
    font-size: 0.85rem;
    margin: 0;
  }
  .sign-ask-btn {
    align-items: center;
    border-radius: 999px;
    display: inline-flex;
    font-size: 0.85rem;
    font-weight: 600;
    gap: 0.375rem;
    margin-block-start: 0.5rem;
    padding: 0.375rem 0.875rem;
  }
  .sign-ask-btn svg {
    block-size: 1rem;
    inline-size: 1rem;
  }
  .sign-search {
    border: 1px solid var(--Bridgely-border);
    border-radius: 0.5rem;
    font: inherit;
    inline-size: 100%;
    padding: 0.5rem 0.75rem;
  }
  .sign-cards-grid {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
    margin-block-start: 0.5rem;
    max-block-size: 10rem;
    overflow-y: auto;
  }
  .sign-mini-card {
    align-items: center;
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: 0.625rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.25rem;
    text-align: center;
  }
  .sign-mini-card.selected {
    border-color: var(--Bridgely-primary);
    box-shadow: 0 0 0 2px var(--Bridgely-primary);
  }
  .sign-mini-icon {
    block-size: 2rem;
    color: var(--Bridgely-primary);
    inline-size: 2rem;
  }
  .sign-mini-icon svg {
    block-size: 100%;
    inline-size: 100%;
  }
  .sign-mini-label {
    font-size: 0.75rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export class EthSLVisualStudio {
  private selectedGestureId: string = ETHSL_GESTURES[0]!.id;
  private filterQuery = "";

  getSelectedGesture(): SignGesture {
    return (
      ETHSL_GESTURES.find((g) => g.id === this.selectedGestureId) ??
      ETHSL_GESTURES[0]!
    );
  }

  selectGesture(id: string): void {
    this.selectedGestureId = id;
  }

  setFilter(query: string): void {
    this.filterQuery = query.toLowerCase().trim();
  }

  getFilteredGestures(): readonly SignGesture[] {
    if (!this.filterQuery) return ETHSL_GESTURES;
    return ETHSL_GESTURES.filter((g) => {
      const q = this.filterQuery;
      return (
        g.gloss.en.toLowerCase().includes(q) ||
        g.gloss.am.includes(q) ||
        g.gloss.om.toLowerCase().includes(q) ||
        g.gloss.ti.includes(q) ||
        g.movementDescription.toLowerCase().includes(q)
      );
    });
  }

  render(context: SignContext): TemplateResult {
    const active = this.getSelectedGesture();
    const list = this.getFilteredGestures();
    const lang = context.selectedLang as "en" | "am" | "om" | "ti";
    const activeGloss = active.gloss[lang] ?? active.gloss.en;
    const activeQuery = active.query[lang] ?? active.query.en;

    return html`
      <section
        class="sign-studio-container"
        lang=${context.selectedLang}
        dir=${context.currentDirection}
        aria-label=${context.t("sign.title")}
      >
        <style>${SIGN_STYLES}</style>
        <header class="sign-studio-header">
          <div class="sign-studio-title">
            <span class="sign-badge" aria-hidden="true">${ETHSL_BADGE}</span>
            <h2>${context.t("sign.title")}</h2>
          </div>
          <button
            type="button"
            class="sign-close-btn"
            lang=${context.uiLanguage}
            dir=${context.uiDirection}
            aria-label=${context.t("sign.close")}
            @click=${() => context.closeSignSpace()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <p class="sign-studio-subtitle">${context.t("sign.subtitle")}</p>

        <!-- Active Gesture Visual Demonstration Stage -->
        <article class="sign-stage" aria-live="polite">
          <div class="sign-visual-card">
            <div class="sign-illustration" aria-hidden="true">
              ${renderHandSvg(active.handShape)}
            </div>
            <div class="sign-details">
              <span class="sign-category-pill">${active.category}</span>
              <h3 class="sign-active-gloss">${activeGloss}</h3>
              <p class="sign-description">${active.movementDescription}</p>
              <div class="sign-action-bar">
                <button
                  type="button"
                  class="sign-ask-btn primary"
                  lang=${context.selectedLang}
                  dir=${context.currentDirection}
                  @click=${() => void context.askFromSign(activeQuery)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>${context.t("sign.sendAsMessage")}</span>
                </button>
              </div>
            </div>
          </div>
        </article>

        <!-- Gesture Picker Grid -->
        <div class="sign-grid-section">
          <label for="sign-search-input" class="sr-only">${context.t("sign.searchPlaceholder")}</label>
          <input
            id="sign-search-input"
            type="search"
            class="sign-search"
            lang=${context.selectedLang}
            dir=${context.currentDirection}
            placeholder=${context.t("sign.searchPlaceholder")}
            .value=${this.filterQuery}
            @input=${(e: Event) => {
              this.setFilter((e.currentTarget as HTMLInputElement).value);
              (context as unknown as { requestUpdate(): void }).requestUpdate();
            }}
          />

          <div class="sign-cards-grid" role="list">
            ${list.map((item) => {
              const itemGloss = item.gloss[lang] ?? item.gloss.en;
              const isSelected = item.id === active.id;
              return html`
                <button
                  type="button"
                  role="listitem"
                  class="sign-mini-card ${isSelected ? "selected" : ""}"
                  aria-pressed=${isSelected}
                  @click=${() => {
                    this.selectGesture(item.id);
                    (context as unknown as { requestUpdate(): void }).requestUpdate();
                  }}
                >
                  <span class="sign-mini-icon" aria-hidden="true">
                    ${renderHandSvg(item.handShape)}
                  </span>
                  <span class="sign-mini-label">${itemGloss}</span>
                </button>
              `;
            })}
          </div>
        </div>
      </section>
    `;
  }
}

export const signRuntime = new EthSLVisualStudio();
