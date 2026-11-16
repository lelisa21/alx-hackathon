import { css } from "lit";

/**
 * Bridgely assistant styles (restructured).
 *
 * Layout model
 *   main (flex column, fixed height, no scroll of its own)
 *   ├─ header          – brand row + one scrolling row of tools   (flex: none)
 *   ├─ panels          – settings / FAQ / language / sign / jobs   (scroll, capped at 70%)
 *   ├─ .chat           – .messages scrolls, .composer is pinned    (takes the rest)
 *   └─ .help           – "talk to a person" bar, never overlaps the composer
 *
 * Every class name used by the component's render() and by the help, career and
 * sign runtimes is kept. Theme tokens (--Bridgely-*) are untouched, so the dark
 * and high-contrast themes keep working. All touch targets stay >= 48px.
 */
export const widgetStyles = css`
  /* ───────────── Tokens ───────────── */
  :host {
    color: var(--Bridgely-text);
    display: block;
    font-family:
      var(--Bridgely-font-family, system-ui), -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    font-size: calc(1rem * var(--Bridgely-scale, 1));
    line-height: 1.5;

    --Bridgely-accent-soft: color-mix(in srgb, var(--Bridgely-primary) 9%, var(--Bridgely-surface));
    --Bridgely-accent-line: color-mix(in srgb, var(--Bridgely-primary) 28%, var(--Bridgely-surface));
    --Bridgely-ink-soft: color-mix(in srgb, var(--Bridgely-text) 4%, var(--Bridgely-surface));
    --Bridgely-hairline: color-mix(in srgb, var(--Bridgely-border) 32%, var(--Bridgely-surface));

    --b-r-sm: 0.625rem;
    --b-r-md: 1rem;
    --b-r-bubble: 1.125rem;
    --b-shadow-sm: 0 1px 2px rgb(0 0 0 / 6%), 0 2px 8px rgb(0 0 0 / 4%);
    --b-gutter: 1rem;

    --Bridgely-icon-copy: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='9' width='11' height='11' rx='2'/%3E%3Cpath d='M5 15V6a2 2 0 0 1 2-2h9'/%3E%3C/svg%3E");
    --Bridgely-icon-thumb: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 10v11H4V10zM7 10l4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 21H7'/%3E%3C/svg%3E");
    --Bridgely-icon-speaker: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 9v6h4l5 4V5L8 9zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11'/%3E%3C/svg%3E");
    --Bridgely-icon-mic: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='3' width='6' height='11' rx='3'/%3E%3Cpath d='M5 11a7 7 0 0 0 14 0M12 18v3'/%3E%3C/svg%3E");
    --Bridgely-icon-send: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12 20 4l-6 16-2.5-6.5z'/%3E%3C/svg%3E");
    --Bridgely-icon-person: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M4 21a8 8 0 0 1 16 0'/%3E%3C/svg%3E");
    --Bridgely-icon-arrow: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12h14M13 6l6 6-6 6'/%3E%3C/svg%3E");
    --b-switch-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect x='4' y='12' width='40' height='24' rx='12'/%3E%3C/svg%3E");
  }

  :host([hidden]) {
    display: none;
  }

  :host([lang="am"]),
  :host([lang="ti"]) {
    font-family: "Noto Sans Ethiopic", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.65;
  }

  [lang="am"],
  [lang="ti"] {
    font-family: "Noto Sans Ethiopic", var(--Bridgely-font-family, system-ui), sans-serif;
    line-height: 1.65;
  }

  /* ───────────── Base ───────────── */
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
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: var(--Bridgely-radius, var(--b-r-sm));
    padding: 0.5rem 0.875rem;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.15s ease;
  }

  button {
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  button:not(:disabled):hover {
    background: var(--Bridgely-accent-soft);
    border-color: var(--Bridgely-accent-line);
  }

  button:disabled,
  select:disabled {
    cursor: not-allowed;
    border-style: dashed;
    opacity: 0.7;
  }

  :focus-visible {
    outline: 3px solid var(--Bridgely-focus);
    outline-offset: 2px;
    box-shadow: 0 0 0 2px var(--Bridgely-surface);
  }

  a {
    align-items: center;
    color: var(--Bridgely-text);
    display: inline-flex;
    overflow-wrap: anywhere;
    padding: 0.25rem;
  }

  h1, h2, h3 {
    line-height: 1.25;
    margin-block: 0 0.5rem;
  }

  p {
    margin-block: 0.25rem;
  }

  .muted,
  .language-meta {
    color: var(--Bridgely-muted);
    font-size: 0.875em;
  }

  .visually-hidden {
    block-size: 1px;
    clip-path: inset(50%);
    inline-size: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
  }

  .primary,
  .help {
    background: var(--Bridgely-primary);
    border-color: var(--Bridgely-primary);
    color: var(--Bridgely-primary-text);
    font-weight: 700;
  }

  .primary:not(:disabled):hover,
  .help:not(:disabled):hover {
    background: color-mix(in srgb, var(--Bridgely-primary) 85%, var(--Bridgely-text));
    border-color: transparent;
  }

  .action-icon {
    margin-inline-end: 0.5rem;
  }

  [role="status"],
  [role="alert"],
  [aria-live],
  [aria-atomic] {
    overflow-wrap: break-word;
    word-wrap: break-word;
  }

  /* ───────────── Frame ───────────── */
  main {
    --Bridgely-available-height: var(
      --bridgely-embed-height,
      min(44rem, calc(100dvh - 2rem))
    );
    background: var(--Bridgely-surface);
    block-size: var(--Bridgely-available-height);
    border: var(--Bridgely-frame-border, 1px) solid
      color-mix(in srgb, var(--Bridgely-border) 40%, var(--Bridgely-surface));
    border-radius: var(--Bridgely-frame-radius, var(--Bridgely-radius, var(--b-r-md)));
    box-shadow: var(
      --Bridgely-frame-shadow,
      0 1px 2px rgb(0 0 0 / 8%),
      0 12px 32px rgb(0 0 0 / 14%)
    );
    display: flex;
    flex-direction: column;
    margin-inline: auto;
    max-inline-size: min(100%, 42rem);
    min-block-size: min(28rem, var(--Bridgely-available-height));
    overflow: hidden;
    overflow-wrap: anywhere;
    position: relative;
  }

  /* Everything is a fixed row except the three areas that grow below. */
  main > * {
    flex: none;
  }

  .status {
    color: var(--Bridgely-muted);
    font-size: 0.8125em;
    margin: 0;
    padding-inline: var(--b-gutter);
  }

  main > .status {
    padding-block: 0.75rem;
  }

  .offline-banner {
    align-items: center;
    background: var(--Bridgely-accent-soft);
    border: 1px solid var(--Bridgely-accent-line);
    border-radius: var(--b-r-sm);
    display: flex;
    font-size: 0.875em;
    gap: 0.5rem;
    margin: 0.5rem var(--b-gutter) 0;
    padding: 0.5rem 0.75rem;
  }

  /* ───────────── Header ───────────── */
  header {
    background: linear-gradient(
      135deg,
      var(--Bridgely-primary) 0%,
      color-mix(in srgb, var(--Bridgely-primary) 82%, var(--Bridgely-primary-text)) 130%
    );
    box-shadow: 0 4px 14px rgb(0 0 0 / 12%);
    color: var(--Bridgely-primary-text);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-block: 0.75rem 0.625rem;
    padding-inline: var(--b-gutter) calc(var(--b-gutter) + var(--Bridgely-close-space, 0px));
    position: relative;
    z-index: 2;
  }

  .brand {
    align-items: center;
    display: flex;
    gap: 0.625rem;
    min-inline-size: 0;
  }

  .brand-text {
    display: grid;
    min-inline-size: 0;
  }

  .brand-text > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .brand-text strong {
    font-size: 1.05em;
    line-height: 1.25;
  }

  .tagline {
    font-size: 0.78em;
    line-height: 1.3;
    opacity: 0.88;
  }

  /* One scrolling row of tools; nested wrapper from renderUtilities(false) dissolves. */
  header > .header-actions {
    align-items: center;
    flex-wrap: nowrap;
    gap: 0.5rem;
    margin: -0.25rem;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    padding: 0.25rem;
    scrollbar-width: none;
  }

  header > .header-actions::-webkit-scrollbar {
    display: none;
  }

  header .header-actions .header-actions {
    display: contents;
  }

  header .header-actions > *,
  header .header-actions .header-actions > * {
    flex: none;
  }

  header .header-actions button {
    background: color-mix(in srgb, var(--Bridgely-primary-text) 10%, transparent);
    border-color: color-mix(in srgb, var(--Bridgely-primary-text) 35%, var(--Bridgely-primary));
    color: var(--Bridgely-primary-text);
    font-size: 0.8125em;
    font-weight: 600;
    overflow-wrap: normal;
    padding-inline: 1rem;
    white-space: nowrap;
  }

  header .header-actions button:not(:disabled):hover {
    background: color-mix(in srgb, var(--Bridgely-primary-text) 22%, transparent);
  }

  header .header-actions button[aria-pressed="true"] {
    background: color-mix(in srgb, var(--Bridgely-primary-text) 26%, transparent);
    box-shadow: inset 0 0 0 1px var(--Bridgely-primary-text);
  }

  /* The one highlighted action. */
  header .header-actions .career-launcher {
    background: var(--Bridgely-primary-text);
    border-color: var(--Bridgely-primary-text);
    color: var(--Bridgely-primary);
  }

  header .header-actions .career-launcher:not(:disabled):hover {
    background: color-mix(in srgb, var(--Bridgely-primary-text) 88%, var(--Bridgely-primary));
  }

  .sign-launcher-btn {
    align-items: center;
    display: inline-flex;
    gap: 0.375rem;
  }

  /* ───────────── Avatars ───────────── */
  .avatar {
    align-items: center;
    background: linear-gradient(
      135deg,
      var(--Bridgely-primary),
      color-mix(in srgb, var(--Bridgely-primary) 78%, var(--Bridgely-primary-text))
    );
    block-size: 2.25rem;
    border-radius: 50%;
    color: var(--Bridgely-primary-text);
    display: inline-flex;
    flex: none;
    font-weight: 800;
    inline-size: 2.25rem;
    justify-content: center;
  }

  header .avatar {
    background: var(--Bridgely-primary-text);
    block-size: 2.5rem;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--Bridgely-primary-text) 22%, transparent);
    color: var(--Bridgely-primary);
    inline-size: 2.5rem;
  }

  .avatar-lg {
    block-size: 3.5rem;
    border-radius: var(--b-r-md);
    box-shadow: 0 10px 24px color-mix(in srgb, var(--Bridgely-primary) 28%, transparent);
    font-size: 1.5em;
    inline-size: 3.5rem;
    justify-self: center;
    margin-block-end: 0.5rem;
  }

  /* ───────────── Accessibility group (welcome / loading toolbar) ───────────── */
  .a11y {
    display: flex;
    gap: 0.5rem;
  }

  .a11y button {
    border-radius: 50%;
    font-weight: 800;
    inline-size: 48px;
    padding: 0;
  }

  .a11y button[aria-pressed="true"] {
    background: var(--Bridgely-primary);
    border-color: var(--Bridgely-primary);
    color: var(--Bridgely-primary-text);
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

  /* Toolbar on the loading / welcome / error screens. */
  main > .header-actions {
    align-items: center;
    border-block-end: 1px solid var(--Bridgely-hairline);
    flex-wrap: wrap;
    padding-block: 0.75rem;
    padding-inline: var(--b-gutter) calc(var(--b-gutter) + var(--Bridgely-close-space, 0px));
  }

  main > .header-actions > button:not(.a11y *) {
    background: var(--Bridgely-ink-soft);
    border-radius: 999px;
    font-size: 0.8125em;
    font-weight: 600;
    white-space: nowrap;
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

  /* ───────────── Panels ───────────── */
  .panel {
    border-block-end: 1px solid var(--Bridgely-hairline);
    flex: 0 1 auto;
    max-block-size: 70%;
    min-block-size: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 1.25rem var(--b-gutter);
    scrollbar-width: thin;
  }

  main > .career {
    flex: 1 1 auto;
    min-block-size: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 1.25rem var(--b-gutter);
  }

  /* Welcome screen: the language picker owns the free space and scrolls. */
  .welcome {
    flex: 1 1 auto;
    min-block-size: 0;
    overflow-y: auto;
    padding: 1.25rem var(--b-gutter);
  }

  .welcome h1 {
    font-size: 1.45em;
    margin-block: 0.25rem 1rem;
  }

  /* ───────────── Language choices ───────────── */
  .language-list {
    flex-direction: column;
  }

  .language-choice {
    align-items: center;
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: var(--b-r-md);
    box-shadow: var(--b-shadow-sm);
    column-gap: 0.875rem;
    display: grid;
    grid-template-columns: 2.75rem minmax(0, 1fr);
    min-block-size: 72px;
    min-inline-size: 0;
    padding: 0.75rem 1rem;
    text-align: start;
  }

  .language-choice:not(:disabled):hover,
  .language-choice[aria-pressed="true"] {
    background: var(--Bridgely-accent-soft);
    border-color: var(--Bridgely-primary);
  }

  .language-choice::before {
    align-items: center;
    background: color-mix(in srgb, var(--Bridgely-primary) 12%, var(--Bridgely-surface));
    block-size: 2.75rem;
    border-radius: 0.75rem;
    content: "EN" / "";
    display: flex;
    flex-shrink: 0;
    font-weight: 800;
    grid-row: span 2;
    justify-content: center;
  }

  .language-choice[lang="am"]::before { content: "\\12A0\\121B" / ""; }
  .language-choice[lang="om"]::before { content: "OM" / ""; }
  .language-choice[lang="ti"]::before { content: "\\1275\\130D" / ""; }

  .language-name {
    display: block;
    font-size: 1.15em;
    font-weight: 700;
  }

  /* ───────────── Settings ───────────── */
  .setting-group {
    border: 0;
    margin: 0 0 1rem;
    min-inline-size: 0;
    padding: 0;
  }

  .setting-group legend {
    font-weight: 700;
    margin-block-end: 0.5rem;
    padding: 0;
  }

  .settings-list {
    align-items: center;
    margin-block: 0.5rem;
  }

  .settings-list button[aria-pressed="true"] {
    background: var(--Bridgely-primary);
    border-color: var(--Bridgely-primary);
    color: var(--Bridgely-primary-text);
  }

  /* Toggle rows: label on the start side, switch on the end side. */
  .setting-toggles {
    display: grid;
    gap: 0.25rem;
    margin-block-end: 0.75rem;
  }

  .setting-row {
    align-items: center;
    display: flex;
    flex-wrap: nowrap;
    gap: 0.75rem;
    justify-content: space-between;
    min-block-size: 48px;
    min-inline-size: 0;
    padding-block: 0.25rem;
  }

  .setting-row > span {
    flex: 1 1 auto;
    min-inline-size: 0;
  }

  .setting-row select {
    flex: 0 1 12rem;
  }

  label.setting-row:has(input[type="checkbox"]) {
    cursor: pointer;
  }

  /* One 48px switch used everywhere (settings, privacy, transliteration). */
  input[type="checkbox"] {
    appearance: none;
    background:
      radial-gradient(circle at 16px 50%, var(--Bridgely-surface) 0 8px, transparent 8.5px),
      color-mix(in srgb, var(--Bridgely-muted) 72%, var(--Bridgely-surface));
    block-size: 48px;
    border: 0;
    cursor: pointer;
    flex: none;
    inline-size: 48px;
    margin: 0;
    mask: var(--b-switch-mask) center / 100% 100% no-repeat;
    min-block-size: 48px;
    min-inline-size: 48px;
  }

  input[type="checkbox"]:checked {
    background:
      radial-gradient(circle at 32px 50%, var(--Bridgely-primary-text) 0 8px, transparent 8.5px),
      var(--Bridgely-primary);
  }

  input[type="checkbox"]:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  main[dir="rtl"] input[type="checkbox"] {
    background:
      radial-gradient(circle at 32px 50%, var(--Bridgely-surface) 0 8px, transparent 8.5px),
      color-mix(in srgb, var(--Bridgely-muted) 72%, var(--Bridgely-surface));
  }

  main[dir="rtl"] input[type="checkbox"]:checked {
    background:
      radial-gradient(circle at 16px 50%, var(--Bridgely-primary-text) 0 8px, transparent 8.5px),
      var(--Bridgely-primary);
  }

  /* The mask would clip an outline on the input, so the row shows focus. */
  input[type="checkbox"]:focus-visible {
    box-shadow: none;
    outline: 0;
  }

  .setting-row:has(input:focus-visible) {
    border-radius: 0.75rem;
    outline: 3px solid var(--Bridgely-focus);
    outline-offset: 2px;
  }

  /* ───────────── Consent card ───────────── */
  .consent {
    background: var(--Bridgely-accent-soft);
    border: 1px solid var(--Bridgely-accent-line);
    border-radius: var(--b-r-md);
    font-size: 0.8125em;
    margin: 0.75rem var(--b-gutter) 0;
    padding: 0.375rem 0.875rem;
  }

  .consent p:empty {
    display: none;
  }

  .empty-state .consent {
    margin: 1.25rem 0 0;
    text-align: start;
  }

  .consent .setting-row {
    cursor: pointer;
  }

  .cloud-voice {
    margin-inline: 0;
  }

  /* ───────────── Chat area ───────────── */
  .chat {
    background: var(--Bridgely-ink-soft);
    display: flex;
    flex: 1 1 12rem;
    flex-direction: column;
    min-block-size: 8rem;
  }

  .messages {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 0.875rem;
    min-block-size: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 1rem var(--b-gutter) 0.5rem;
    scroll-padding-block: 1rem;
    scrollbar-color: var(--Bridgely-hairline) transparent;
    scrollbar-width: thin;
  }

  /* Empty state: centred greeting, consent, starter questions. */
  .empty-state {
    align-self: center;
    color: var(--Bridgely-muted);
    display: grid;
    gap: 0.25rem;
    inline-size: min(100%, 26rem);
    margin-block: auto;
    padding: 1rem 0.5rem;
    text-align: center;
  }

  .empty-state strong {
    color: var(--Bridgely-text);
    display: block;
    font-size: 1.2em;
  }

  .suggestions-list {
    display: grid;
    gap: 0.5rem;
    margin-block-start: 1.25rem;
    text-align: start;
  }

  .suggest-title {
    color: var(--Bridgely-muted);
    font-size: 0.75em;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .suggestion {
    align-items: center;
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: var(--b-r-md);
    box-shadow: var(--b-shadow-sm);
    display: flex;
    font-size: 0.9em;
    font-weight: 600;
    gap: 0.75rem;
    justify-content: space-between;
    min-block-size: 52px;
    padding: 0.75rem 1.125rem;
    text-align: start;
  }

  .suggestion::after {
    background: var(--Bridgely-primary);
    block-size: 1em;
    content: "";
    flex: none;
    inline-size: 1em;
    mask: var(--Bridgely-icon-arrow) center / contain no-repeat;
  }

  main[dir="rtl"] .suggestion::after {
    transform: scaleX(-1);
  }

  .suggestion:not(:disabled):hover {
    background: var(--Bridgely-accent-soft);
    border-color: var(--Bridgely-primary);
    transform: translateY(-1px);
  }

  /* ───────────── Message bubbles ───────────── */
  article {
    border-radius: var(--b-r-bubble);
    max-inline-size: min(88%, 45ch);
    overflow-wrap: break-word;
    padding: 0.75rem 1rem;
    word-wrap: break-word;
  }

  article p {
    hyphens: auto;
    margin: 0;
    overflow-wrap: break-word;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Learner: accent bubble on the end side. */
  article[data-role="learner"] {
    align-self: flex-end;
    background: linear-gradient(
      135deg,
      var(--Bridgely-primary) 0%,
      color-mix(in srgb, var(--Bridgely-primary) 82%, #000) 100%
    );
    border-end-end-radius: 0.25rem;
    box-shadow: 0 4px 14px color-mix(in srgb, var(--Bridgely-primary) 24%, transparent);
    color: var(--Bridgely-primary-text);
    font-size: 0.95em;
  }

  /* Assistant: avatar beside a white card; actions sit under the card. */
  article[data-role="assistant"] {
    align-self: flex-start;
    background: transparent;
    column-gap: 0.625rem;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    max-inline-size: 100%;
    padding: 0;
  }

  article[data-role="assistant"] > :not(.avatar) {
    grid-column: 2;
    min-inline-size: 0;
  }

  article[data-role="assistant"] > .avatar {
    grid-row: 1 / span 4;
  }

  article[data-role="assistant"] > p {
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: var(--b-r-bubble);
    border-start-start-radius: 0.375rem;
    box-shadow: var(--b-shadow-sm);
    font-size: 0.95em;
    line-height: 1.6;
    padding: 0.875rem 1.125rem;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  article[data-role="assistant"].is-speaking > p {
    border-color: var(--Bridgely-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--Bridgely-primary) 18%, transparent);
  }

  /* Focus lands on a fresh answer for screen readers. */
  article:focus-visible {
    box-shadow: none;
    outline: 3px solid color-mix(in srgb, var(--Bridgely-focus) 70%, transparent);
    outline-offset: 4px;
  }

  .speaking-badge {
    align-items: center;
    background: var(--Bridgely-accent-soft);
    border: 1px solid var(--Bridgely-primary);
    border-radius: 999px;
    color: var(--Bridgely-primary);
    display: inline-flex;
    font-size: 0.75em;
    font-weight: 700;
    gap: 0.35rem;
    justify-self: start;
    margin-block-start: 0.375rem;
    padding: 0.2rem 0.625rem;
  }

  .speaking-badge .wave-bar {
    block-size: 8px;
    inline-size: 2.5px;
  }

  /* Sources */
  .citations {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-block-start: 0.5rem;
  }

  .citation {
    background: var(--Bridgely-accent-soft);
    border: 1px solid var(--Bridgely-accent-line);
    border-radius: 0.875rem;
    font-size: 0.8125em;
    font-weight: 600;
    line-height: 1.35;
    padding: 0.375rem 0.875rem;
    text-align: start;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .citation:hover {
    background: color-mix(in srgb, var(--Bridgely-primary) 16%, var(--Bridgely-surface));
    border-color: var(--Bridgely-primary);
  }

  /* Copy / helpful / not helpful / read aloud */
  .reply-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-block-start: 0.5rem;
  }

  .reply-actions button {
    align-items: center;
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: 999px;
    color: var(--Bridgely-muted);
    display: inline-flex;
    font-size: 0.8125em;
    font-weight: 600;
    gap: 0.375rem;
    min-block-size: 40px;
    padding: 0.25rem 0.75rem;
  }

  .reply-actions button:not(:disabled):hover {
    border-color: var(--Bridgely-primary);
    color: var(--Bridgely-text);
  }

  .reply-actions button[aria-pressed="true"] {
    background: var(--Bridgely-accent-soft);
    border-color: var(--Bridgely-primary);
    color: var(--Bridgely-text);
  }

  .reply-actions > button:nth-of-type(-n + 3)::before,
  .reply-actions > .read-aloud::before {
    background: currentColor;
    block-size: 1.05em;
    content: "";
    flex: none;
    inline-size: 1.05em;
    mask: var(--Bridgely-icon-copy) center / contain no-repeat;
  }

  .reply-actions > button:nth-of-type(2)::before,
  .reply-actions > button:nth-of-type(3)::before {
    mask-image: var(--Bridgely-icon-thumb);
  }

  .reply-actions > button:nth-of-type(3)::before {
    transform: rotate(180deg);
  }

  .reply-actions > .read-aloud::before {
    mask-image: var(--Bridgely-icon-speaker);
  }

  .speech-controls {
    margin: 0;
  }

  /* Typing indicator */
  .typing {
    align-items: center;
    display: flex;
    gap: 0.625rem;
  }

  .dots {
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-hairline);
    border-radius: var(--b-r-md);
    border-start-start-radius: 0.375rem;
    display: inline-flex;
    gap: 0.3rem;
    padding: 0.875rem 1rem;
  }

  .dots i {
    animation: Bridgely-dot 1.2s infinite ease-in-out;
    background: var(--Bridgely-muted);
    block-size: 0.5rem;
    border-radius: 50%;
    inline-size: 0.5rem;
  }

  .dots i:nth-child(2) { animation-delay: 0.15s; }
  .dots i:nth-child(3) { animation-delay: 0.3s; }

  @keyframes Bridgely-dot {
    0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-0.25rem); }
  }

  /* Status line between messages and composer: collapses when empty. */
  .chat > .status {
    background: var(--Bridgely-ink-soft);
    padding-block: 0.25rem;
  }

  /* ───────────── Composer ───────────── */
  .composer {
    background: var(--Bridgely-surface);
    border-block-start: 1px solid var(--Bridgely-hairline);
    box-shadow: 0 -4px 18px rgb(0 0 0 / 5%);
    flex: none;
    padding-block: 0.75rem max(0.875rem, calc(0.75rem + env(safe-area-inset-bottom)));
    padding-inline: var(--b-gutter);
    position: relative;
    z-index: 1;
  }

  .composer-header {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: space-between;
    margin-block-end: 0.375rem;
  }

  .composer-label {
    color: var(--Bridgely-muted);
    font-size: 0.75em;
    font-weight: 700;
    letter-spacing: 0.02em;
    margin: 0;
  }

  .auto-voice-toggle {
    align-items: center;
    background: var(--Bridgely-ink-soft);
    border-radius: 999px;
    display: inline-flex;
    font-size: 0.8125em;
    font-weight: 600;
    gap: 0.375rem;
    min-block-size: 40px;
    padding: 0.25rem 0.75rem;
  }

  .auto-voice-toggle::before {
    background: currentColor;
    block-size: 1.1em;
    content: "";
    flex: none;
    inline-size: 1.1em;
    mask: var(--Bridgely-icon-speaker) center / contain no-repeat;
  }

  .auto-voice-toggle[aria-pressed="true"] {
    background: var(--Bridgely-accent-soft);
    border-color: var(--Bridgely-primary);
    box-shadow: 0 0 0 1px var(--Bridgely-primary);
    color: var(--Bridgely-primary);
    font-weight: 700;
  }

  .composer-input-wrapper {
    inline-size: 100%;
    position: relative;
  }

  textarea {
    background: var(--Bridgely-ink-soft);
    border: 1.5px solid var(--Bridgely-hairline);
    border-radius: var(--b-r-bubble);
    display: block;
    field-sizing: content;
    inline-size: 100%;
    line-height: 1.5;
    max-block-size: 9rem;
    min-block-size: 3.5rem;
    min-inline-size: 0;
    padding: 0.85rem 1.1rem;
    resize: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
  }

  textarea:focus {
    background: var(--Bridgely-surface);
    border-color: var(--Bridgely-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--Bridgely-primary) 18%, transparent);
  }

  .composer > .muted {
    font-size: 0.75em;
    margin-block: 0.375rem 0;
  }

  .transliteration {
    display: grid;
    gap: 0.5rem;
    margin-block-start: 0.5rem;
  }

  /* Language suggestions under the field */
  .suggestions {
    margin-block-start: 0.5rem;
  }

  .suggestions p {
    color: var(--Bridgely-muted);
    font-size: 0.8125em;
    margin-block: 0 0.375rem;
  }

  /* Action row: hint on the start side, mic + send on the end side. */
  .composer-actions {
    align-items: center;
    justify-content: space-between;
    margin-block-start: 0.625rem;
  }

  .composer-actions > .muted,
  .composer-actions > .voice-install {
    flex: 1 1 8rem;
    min-inline-size: 0;
  }

  .composer-buttons {
    align-items: center;
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-inline-start: auto;
  }

  .voice-install {
    align-items: center;
    display: inline-flex;
    flex-wrap: wrap;
    font-size: 0.8125em;
    gap: 0.5rem;
  }

  .voice-install .muted:empty {
    display: none;
  }

  .voice-install button {
    background: transparent;
    color: var(--Bridgely-muted);
    font-size: 0.8125em;
    font-weight: 600;
  }

  .mic,
  .career-mic {
    align-items: center;
    background: var(--Bridgely-accent-soft);
    border: 1.5px solid var(--Bridgely-accent-line);
    border-radius: 999px;
    color: var(--Bridgely-primary);
    display: inline-flex;
    font-size: 0.875em;
    font-weight: 700;
    gap: 0.5rem;
    justify-content: center;
  }

  .mic {
    /* The microphone stays a large 64px target. */
    min-block-size: 64px;
    padding: 0.5rem 1.25rem 0.5rem 1rem;
  }

  .career-mic {
    justify-self: start;
    padding-inline: 0.875rem 1.125rem;
  }

  .mic::before,
  .career-mic::before {
    background: currentColor;
    block-size: 1.2em;
    content: "";
    flex: none;
    inline-size: 1.2em;
    mask: var(--Bridgely-icon-mic) center / contain no-repeat;
  }

  .mic:not(:disabled):hover {
    background: color-mix(in srgb, var(--Bridgely-primary) 15%, var(--Bridgely-surface));
  }

  .mic[aria-pressed="true"] {
    animation: mic-pulse 1.4s infinite;
    background: #dc2626;
    border-color: #dc2626;
    color: #fff;
  }

  @keyframes mic-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgb(220 38 38 / 40%); }
    50% { box-shadow: 0 0 0 8px rgb(220 38 38 / 0%); }
  }

  .send-action {
    align-items: center;
    border: 0;
    border-radius: 999px;
    display: inline-flex;
    gap: 0.5rem;
    justify-content: center;
    min-block-size: 56px;
    min-inline-size: 6.5rem;
    padding: 0.625rem 1.25rem;
  }

  .send-action.primary {
    background: linear-gradient(
      135deg,
      var(--Bridgely-primary) 0%,
      color-mix(in srgb, var(--Bridgely-primary) 82%, #000) 100%
    );
    box-shadow: 0 3px 10px color-mix(in srgb, var(--Bridgely-primary) 28%, transparent);
  }

  .send-action:not(:disabled):hover {
    transform: translateY(-1px);
  }

  .send-action::after {
    background: currentColor;
    block-size: 1.05em;
    content: "";
    flex: none;
    inline-size: 1.05em;
    mask: var(--Bridgely-icon-send) center / contain no-repeat;
  }

  main[dir="rtl"] .send-action::after {
    transform: scaleX(-1);
  }

  /* While help is open, send steps back so the help bar leads. */
  .send-action:not(.primary) {
    background: var(--Bridgely-primary);
    color: var(--Bridgely-primary-text);
  }

  /* Recording + review cards */
  .voice-wave-container,
  .speech-review-card {
    align-items: center;
    background: var(--Bridgely-accent-soft);
    border: 1px solid var(--Bridgely-accent-line);
    border-radius: var(--b-r-md);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
    margin-block: 0.5rem 0;
    padding: 0.5rem 0.75rem;
  }

  .voice-wave-container {
    border-color: var(--Bridgely-primary);
  }

  .voice-wave-container .status,
  .speech-review-card .status {
    flex: 1 1 8rem;
    padding: 0;
  }

  .voice-wave-visualizer {
    align-items: center;
    block-size: 24px;
    display: inline-flex;
    gap: 4px;
  }

  .wave-bar {
    animation: wave-bar-pulse 0.7s ease-in-out infinite alternate;
    background: var(--Bridgely-primary);
    block-size: 14px;
    border-radius: 999px;
    inline-size: 3.5px;
  }

  .wave-bar:nth-child(2) { animation-delay: 0.15s; block-size: 22px; }
  .wave-bar:nth-child(3) { animation-delay: 0.3s; block-size: 26px; }
  .wave-bar:nth-child(4) { animation-delay: 0.45s; block-size: 18px; }
  .wave-bar:nth-child(5) { animation-delay: 0.6s; block-size: 12px; }

  @keyframes wave-bar-pulse {
    0% { transform: scaleY(0.4); }
    100% { transform: scaleY(1.4); }
  }

  .voice-stop-btn {
    border-radius: 999px;
    font-size: 0.8125em;
    font-weight: 600;
    margin-inline-start: auto;
  }

  .speech-review-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* ───────────── Talk to a person ───────────── */
  /* A bar under the composer by default; hosts can float it with
     --Bridgely-help-position: fixed and the usual inset/margin variables. */
  .help {
    align-items: center;
    align-self: stretch;
    border-radius: 0;
    display: inline-flex;
    font-size: 0.875em;
    gap: 0.5rem;
    inset-block-end: 1rem;
    inset-inline-end: 1rem;
    justify-content: center;
    margin: var(--Bridgely-help-margin, 0);
    order: var(--Bridgely-help-order, 1);
    padding-inline: 1.25rem;
    position: var(--Bridgely-help-position, static);
    z-index: var(--Bridgely-help-z, 3);
  }

  .help::before {
    background: currentColor;
    block-size: 1.15em;
    content: "";
    flex: none;
    inline-size: 1.15em;
    mask: var(--Bridgely-icon-person) center / contain no-repeat;
  }

  .help[style*="fixed"],
  :host([style*="--Bridgely-help-position"]) .help {
    align-self: flex-end;
    border-radius: 999px;
    box-shadow: 0 6px 16px color-mix(in srgb, var(--Bridgely-primary) 28%, transparent);
  }

  .help-backdrop {
    align-items: center;
    background: rgb(0 0 0 / 55%);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    inset: 0;
    overflow-y: auto;
    padding: 1rem;
    padding-block-end: max(1rem, env(safe-area-inset-bottom));
    padding-block-start: max(1rem, env(safe-area-inset-top));
    padding-inline-end: max(1rem, env(safe-area-inset-right));
    padding-inline-start: max(1rem, env(safe-area-inset-left));
    position: fixed;
    z-index: 5;
  }

  .help-dialog {
    background: var(--Bridgely-surface);
    border: 2px solid var(--Bridgely-border);
    border-radius: 0.75rem;
    inline-size: min(100%, calc(100% - 2rem));
    margin-inline: auto;
    max-block-size: min(100vh, 90dvh);
    max-inline-size: 36rem;
    min-inline-size: 0;
    overflow-y: auto;
    padding: 1.25rem;
  }

  .help-summary {
    border: 1px solid var(--Bridgely-border);
    margin-block: 0.75rem;
    max-block-size: min(12rem, 50vh);
    min-inline-size: 0;
    overflow-wrap: break-word;
    overflow-y: auto;
    padding: 0.75rem;
  }

  .share-banner {
    align-items: center;
    background: var(--Bridgely-surface);
    border: 2px solid var(--Bridgely-border);
    color: var(--Bridgely-text);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: space-between;
    order: -1;
    padding: 0.5rem;
    position: sticky;
    inset-block-start: 0;
    z-index: 4;
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
    max-block-size: min(16rem, 40vh);
    min-inline-size: 0;
    overflow-y: auto;
  }

  /* ───────────── FAQ cards inside the panel ───────────── */
  .panel article {
    background: var(--Bridgely-ink-soft);
    border: 1px solid var(--Bridgely-hairline);
    margin-block: 0.75rem 0;
    max-inline-size: 100%;
  }

  .panel article h3 {
    font-size: 1em;
  }

  /* ───────────── Jobs & support (career runtime) ───────────── */
  .career {
    min-inline-size: 0;
  }

  .career-flow,
  .career-filter {
    display: grid;
    gap: 0.75rem;
    min-inline-size: 0;
  }

  .career input:not([type="checkbox"]),
  .career select {
    background: var(--Bridgely-surface);
    border: 1px solid var(--Bridgely-border);
    border-radius: var(--Bridgely-radius, var(--b-r-sm));
    inline-size: 100%;
    min-block-size: 48px;
    min-inline-size: 0;
    padding: 0.5rem;
  }

  .career-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-block: 0.75rem;
  }

  .career fieldset {
    margin-block: 1rem;
    min-inline-size: 0;
  }

  .career-choice {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    margin-block: 0.5rem;
    min-block-size: 48px;
  }

  .career article {
    background: transparent;
    border: 0;
    border-block-end: 1px solid var(--Bridgely-hairline);
    border-radius: 0;
    max-inline-size: 100%;
    padding-inline: 0;
  }

  .career dd {
    margin-inline-start: 1rem;
  }

  .career-exact {
    white-space: pre-wrap;
  }

  .career summary {
    cursor: pointer;
    min-block-size: 48px;
  }

  .career article a {
    align-items: center;
    display: inline-flex;
  }

  /* ───────────── Sign Language Studio ───────────── */
  .visual-alert-halo {
    animation: halo-pulse 1.2s ease-out;
  }

  @keyframes halo-pulse {
    0% { box-shadow: 0 0 0 0 var(--Bridgely-primary); }
    50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--Bridgely-primary) 40%, transparent); }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  /* ───────────── Responsive ───────────── */
  @media (max-width: 30rem) {
    :host {
      --b-gutter: 0.75rem;
    }

    main {
      border-radius: 0;
      margin-inline: 0;
      max-inline-size: 100%;
    }

    .tagline {
      display: none;
    }

    article {
      max-inline-size: min(92%, 40ch);
    }

    .empty-state {
      padding-block: 0.5rem;
    }

    .avatar-lg {
      block-size: 2.75rem;
      inline-size: 2.75rem;
    }

    /* Hint takes a full row; microphone and Send share the next one. */
    .composer-actions > .muted,
    .composer-actions > .voice-install {
      flex-basis: 100%;
    }
  }

  @media (max-width: 20rem) {
    main {
      min-block-size: min(16rem, var(--Bridgely-available-height));
    }

    .language-choice {
      grid-template-columns: 2.25rem minmax(0, 1fr);
      min-block-size: 64px;
    }

    .language-choice::before {
      block-size: 2.25rem;
    }

    .setting-row {
      align-items: flex-start;
      flex-wrap: wrap;
    }
  }

  /* Short screens (landscape phones): give the conversation the room. */
  @media (max-height: 34rem) {
    main {
      block-size: calc(100dvh - 1rem);
      min-block-size: 0;
    }

    header {
      padding-block: 0.5rem 0.375rem;
    }

    .tagline {
      display: none;
    }

    .composer {
      padding-block-start: 0.375rem;
    }

    textarea {
      max-block-size: 5rem;
      min-block-size: 3rem;
    }
  }

  /* ───────────── Motion & contrast ───────────── */
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

  @media (forced-colors: active) {
    input[type="checkbox"] {
      appearance: auto;
      mask: none;
      outline: 3px solid;
    }
  }
`;