# Decision log

This file records project choices and resolutions. The system blueprint's
decision register is authoritative for architectural choices.

## Setup baseline

- **A-04, pre-kickoff code:** The user confirmed that organizer approval for
  pre-built code has been obtained before this scaffold was created.
- **Architecture source:** Follow the authoritative Dimts System Blueprint
  (filename retained as v2.0; architecture revision 2.1) where it supersedes
  the SRS. Express 5, PostgreSQL, Node.js, and pnpm are the current reference
  implementation, not product-level dependencies; public protocols and
  application ports define replacement boundaries.
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

## Host source integration verification

- **Verified acceptance criteria:** AR-03, AR-04, FR-INT-08, and FR-TUTOR-12
  now support a no-code public-site path and a small host-owned private adapter.
  Public discovery uses an approved sitemap and indexes only same-origin HTML;
  the private adapter remains scoped to material shareable with all learners
  using that source. Initial full sync, scheduled reconciliation, atomic
  publication, and host-authenticated notification refresh use the same source
  manager. Tests cover pagination, URL scope, initial discovery, periodic
  reconciliation, canonical updates/deletions, source authorization, and API
  startup wiring.
- **Verified locally:** `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
  and formatting checks pass (`100` tests passed; `3` PostgreSQL tests skipped).
- **Not verified against PostgreSQL:** the source-generation integration tests
  remain skipped because `DIMTS_TEST_DATABASE_URL` is unavailable locally.
  Private sources still require a few host-side callbacks; per-learner ACL
  filtering is not implemented. Public source discovery is sitemap-based,
  limited to 250 pages per source, and does not index private or unlisted
  content.

## WP04 verification

- **Verified locally:** FR-AI-01 to 03, 06, 07, and 11 provider contracts,
  adapters, ordered fallback, health and timeout handling, 60-second cooldown
  and recovery, malformed-response retry, configuration defaults, and
  extractive mode for unproven provider/language pairs. `pnpm exec vitest run
packages/ai/test packages/engine/test/wp03.test.ts packages/api/test/wp02.test.ts`
  passes; workspace build, typecheck, affected-file ESLint, and literal-string
  checks pass.
- **Partially verified:** FR-AI-04 falls back to passage text with a citation,
  but the 70% FAQ hit-rate cannot be measured because the configured FAQ packs
  contain no entries. Add reviewed FAQ data before claiming that criterion.
- **Pending WP05:** FR-AI-05's learner notice and opt-out control are a widget
  responsibility. The API defaults to offline; the browser notice and
  end-to-end network check are not yet verified.
- **Deferred per cut line:** FR-AI-08 answer caching.

## WP05 verification

- **Verified acceptance criteria:** FR-UI-01 welcome and language choice,
  FR-UI-04 reply focus, FR-UI-08 320px reflow, FR-UI-09 interactive target
  sizes, FR-UI-14 bundle budget, FR-UI-15 retry/help error recovery,
  FR-LANG-07 text-based suggestions without automatic switching, and the
  offline banner plus service-worker registration and cached language recovery
  are covered by widget tests. `pnpm test:widget` builds the widget before
  running Playwright. The latest browser run passed 10/10 tests, including
  zero critical/serious axe violations and storage-disabled behavior.
- **Implemented, acceptance criteria still outstanding:** text chat, citations,
  beta labels, persisted language/settings, read-aloud using browser speech
  synthesis, and data-saver caching. FR-UI-06 microphone recognition and its
  state behavior are not implemented. Offline recovery restores static
  language/UI data only; FR-UI-16's offline FAQ is blocked by empty FAQ packs
  and the absence of a documented FAQ API contract. Do not fabricate course
  answers.
- **Other WP05 gaps:** FR-UI-13 needs an approved self-hosted Ethiopic font.
  The specified 200% zoom, formal contrast threshold/token check, full 8px
  spacing verification, and FR-UI-18/19 acceptance criteria remain
  outstanding. The help action emits the host event; the actual human handoff
  is WP07. Draft-language UI copy still needs language-lead review.
- **Deployment constraint:** service-worker support requires the widget module
  and `/service-worker.js` to be served from the embedding page's origin. The
  service worker caches shell assets; static API responses use the widget's
  separate CacheStorage logic. A cross-origin embed cannot install the worker
  for its host page.

## Dynamic content and backend bootstrap

- **Architecture review (Blueprint architecture revision 2.1):** the prior design treated the current technology
  stack and three provider labels too much like fixed architecture, and did
  not define authorized source discovery, durable synchronization, or
  per-question language detection. The Blueprint adds AR-01–AR-08, capability
  ports, explicit source lifecycle, confidence-gated language behavior,
  conformance acceptance, and the limitations of universal platform discovery.
- **Provider registry:** provider IDs and API schemas are now open-ended,
  configuration selects adapter bindings by ID, and the ladder filters by
  declared language/mode/modality capabilities. The runtime currently
  registers the OpenAI-compatible adapter; native vendor adapters and
  provider data-class consent filtering remain unimplemented.
- **Question language:** use local `franc` detection against installed locale
  packs for each question. Apply only results above the configured confidence
  threshold; otherwise keep the request's selected language. Detection never
  mutates the saved session language or sends question text to an external
  service. Cross-language retrieval remains evaluation-gated.
- **Static shell versus dynamic learner data:** the local/hosted "static site"
  is only the widget delivery layer. Course content is queried from the active
  PostgreSQL passage set at ask time; re-ingestion updates the active version
  and invalidates answer cache (FR-TUTOR-12). Do not bake course answers into
  the widget or describe the app as static-content-only.
- **Content integration levels:** public pages need no website code when the
  owner approves an HTTPS XML sitemap in `DIMTS_PUBLIC_SOURCES`; the built-in
  connector reads only same-origin sitemap pages. Private course content uses
  a small host-owned `ContentSource`/`HostAuth` adapter passed through
  `buildApp({ sourceSync })`. The host selects content shareable with the
  source's learner population; per-user/role ACL filtering is not yet
  supported. Dimts performs an initial full sync and scheduled reconciliation.
  Native changes are authenticated by the host before calling the manager's
  internal `notify` hook; no generic public webhook is exposed.
- **Local host bootstrap:** `pnpm local:bootstrap` applies pending migrations
  and upserts the local widget host by ID. It stores only the SHA-256 hash of
  `DIMTS_LOCAL_WIDGET_KEY`, validates allowed origins, and can be rerun safely.
  The key is a public development identifier, not a production credential.
  Backend live-PostgreSQL verification and complete FR-INT-09/12 Compose
  orchestration remain pending.
- **Verified this increment:** local host hashing/origin/upsert unit tests and
  API/grounding contracts pass. The PostgreSQL integration tests for health,
  session creation, idempotent migrations, and changed-content answers are
  wired into CI but skipped locally because Docker Engine is unavailable.

## Backend contract freeze

- **Requirements:** FR-CONV-13, NFR-SEC-11, and NFR-SEC-12.
- **Resolution:** the blueprint now matches SRS Part III for reply replay
  columns, first-message WebSocket authentication, and required API secrets.
  The duplicate decision number for helper display names is corrected to D29;
  the decision itself is unchanged.
- **Verified acceptance:** `packages/api/test/contract-docs.test.ts` checks
  migration/blueprint reply-schema parity, WebSocket auth requirements,
  documented secrets, and unique blueprint decision IDs. The focused run
  passed 4 contract tests and all 17 WP02 API tests.
- **Validation note:** API typecheck is currently blocked by a pre-existing
  exact-optional-property error in `packages/api/src/routes/core.ts:325`;
  that runtime source was not changed as part of this contract freeze.
- **Scope note:** this freezes the WebSocket contract; it does not claim the
  help WebSocket server is implemented.
