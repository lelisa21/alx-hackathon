# Decision log

This file records project choices and resolutions. The system blueprint's
decision register is authoritative for architectural choices.

## Setup baseline

- **A-04, pre-kickoff code:** The user confirmed that organizer approval for
  pre-built code has been obtained before this scaffold was created.
- **Architecture source:** Follow `Dimts-System-Blueprint-v2.0.md` where it
  supersedes the SRS, including Express 5, PostgreSQL, pnpm workspaces, and the
  final repository layout.
- **Package manager:** Pin pnpm 10.12.1 in the root manifest for reproducible
  workspace tooling.
- **Local database:** Use the PostgreSQL 17 Alpine container in the `local`
  Compose profile. The database password is provided through an ignored `.env`
  file; no production credentials belong in the repository.
- **Initial scope:** This commit prepares WP00's workspace, CI, Compose, and
  quality-check foundation. It does not implement application behavior.
- **WP00 acceptance scope:** Establish the strict TypeScript, lint/format, test,
  size-gate, and CI foundations for NFR-MAINT-01 and FR-INT-09.
- **Savanna reference snapshot:** The user authorized importing the static
  reference pages and assets from
  `https://github.com/alx-africa/Savanna-static-pages` at commit
  `9e83ac77891708117728ad9fc05301e124cc8ec8`. Keep the captures in `pages/`
  with their shared files in `assets/`; do not adapt the frozen captures into
  application pages.
- **WP01 locale drafts:** Amharic and Afaan Oromoo packs remain `draft` and use
  English scaffold text until the language lead supplies and reviews approved
  translations. English is `beta` until it meets the live-pack review and
  content checks. `ar-test` is a CI-only pseudo-RTL pack and is not exposed
  outside language preview.
- **Locale markup and SMS checks:** Locale UI values may use only `b`, `br`,
  `code`, `em`, `i`, and `strong`, without attributes. The pack checker counts
  Unicode code points against `sms_max_chars`; it does not calculate SMS
  segment encoding.
- **Locale fallback notice:** The translator returns `didFallback` and
  `usedLang`; the widget owns the once-per-session announcement so it can
  announce the notice in the active conversation context.
- **WP02 ask behavior:** Until grounding and AI arrive in WP03/WP04, the ask
  route handles locale-backed small talk and otherwise returns the configured
  localized not-found reply with a help action. The service remains usable
  offline and makes no provider call.
- **API language content:** Locale UI keys for the draft Amharic, Afaan Oromoo,
  and pseudo-RTL packs remain scaffold English until language-lead review. API
  language listings and direct locale reads hide draft packs by default;
  `?lang_preview=1` is required to preview them.
- **WP03 citation URLs:** Content ingestion requires `DIMTS_CONTENT_BASE_URL`
  and builds each lesson URL from that base, the lesson filename, and its
  heading anchor. Transcript ingestion is deferred until the course format is
  confirmed; no transcript file format is assumed.
- **WP03 HTML parsing:** Use the small MIT-licensed `linkedom` parser for HTML
  lessons rather than parsing HTML with regular expressions.
- **WP03 Amharic search keys:** Preserve vowel order while applying Ethiopic
  row aliases. Add the FR-TUTOR-15 `ሥ`/`ሰ` search-trigram equivalence without
  changing normalized display text or source citations.

## WP03 verification

- **Verified locally:** Markdown/HTML passage construction and anchors,
  300-word chunking, Amharic and Afaan Oromoo normalization, cross-language
  glossary expansion, top-five scoring, confidence bounds, citation gating,
  empty-index behavior, transactional replacement, and answer-cache
  invalidation. The tests also assert the `passage.grams` GIN index.
- **Not verified against PostgreSQL:** Applying ingestion and search queries to
  a live database; the local Docker database is unavailable in this
  environment. CI is configured to apply migrations twice against PostgreSQL;
  its result has not been observed here.
- **Pending later work:** the 70% multilingual retrieval evaluation and floor
  calibration require reviewed glossary/evaluation data (WP14); citation-link
  browser checks belong to the widget (WP05). Transcript ingestion remains
  deferred per the user's choice and the unresolved course-format question.
