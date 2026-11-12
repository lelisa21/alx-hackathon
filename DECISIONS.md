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
- **Verified against PostgreSQL:** The WP02 PostgreSQL integration run covers
  dynamic content replacement and atomic source-generation publication and
  rollback.
- **Per-question language behavior:** the engine now accepts an optional
  detector and confidence threshold. Tests confirm a high-confidence result
  selects the reply/search language without mutating the session language,
  while uncertain detection retains the selected language. The default API
  runtime wires the local Franc detector using non-draft packs and the
  validated `DIMTS_LANGUAGE_DETECTION_CONFIDENCE` setting.
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
  manager. Grounding tests cover pagination, URL scope, initial discovery,
  periodic reconciliation, canonical updates/deletions, and source
  authorization. API startup wiring is verified in the Person 2 section below.
- **Verified locally:** `pnpm build`, `pnpm test`, `pnpm typecheck`, and
  `pnpm lint` pass. The full suite passed all 97 tests with PostgreSQL
  integration enabled.
- **Verified against PostgreSQL:** the source-generation integration tests
  passed against an isolated local database, including atomic publication and
  preservation of the last good generation after a failed sync. Private
  sources still require a few host-side callbacks; per-learner ACL filtering
  is not implemented. Public source discovery is sitemap-based, limited to
  250 pages per source, and does not index private or unlisted content.

## WP04 verification

- **Verified locally:** provider contracts, arbitrary configured IDs, the
  OpenAI-compatible and offline adapters, ordered fallback, health and timeout
  handling, 60-second cooldown and recovery, malformed-response retry,
  configuration defaults, extractive mode for unproven provider/language
  pairs, and default API runtime wiring. Remote calls require persisted
  per-session consent; provider payloads are filtered by configured data
  classes, credentials remain server-side, and provider identity is absent
  from learner replies.
- **Partially verified:** FR-AI-04 falls back to passage text with a citation,
  but the 70% FAQ hit-rate cannot be measured because the configured FAQ packs
  contain no entries. Add reviewed FAQ data before claiming that criterion.
- **Consent boundary:** the API enforces the FR-AI-05 consent contract and
  defaults new sessions to no remote processing. The learner-facing disclosure
  and opt-out control remain a WP05 widget responsibility; until it is
  integrated, the widget does not opt sessions into remote processing.
- **Other pending criteria:** native vendor adapters and evaluated multilingual
  retrieval/provider pairs are not claimed. FR-AI-08 answer caching remains
  deferred per the cut line.

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
  declared language/mode/modality capabilities and data-sharing policy. The
  API composition root registers the OpenAI-compatible adapter and the
  deterministic offline adapter; native vendor-specific adapters remain
  unimplemented.
- **Question language:** use local `franc` detection against installed locale
  packs for each question. Apply only results above the configured confidence
  threshold; otherwise keep the request's selected language. Detection never
  mutates the saved session language or sends question text to an external
  service. The default API runtime detects only against non-draft packs and
  reads the threshold from validated configuration. Cross-language retrieval
  evaluation remains pending.
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
  Backend live-PostgreSQL verification is recorded under WP02; full
  FR-INT-09/12 Compose orchestration was completed in the Person 1 pass below.
- **Verified this increment:** local host hashing/origin/upsert unit tests and
  API/grounding contracts pass. Five PostgreSQL integration tests also passed
  locally against an isolated Compose database, covering health, session
  creation, repeat migrations, changed-content answers, and source-generation
  publication and rollback.

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
- **Validation note:** the earlier contract-freeze run found an
  exact-optional-property error in `packages/api/src/routes/core.ts:325`. WP02
  resolved it by defaulting the optional `simple` request flag to `false`; API
  typecheck now passes.
- **Scope note:** this freezes the WebSocket contract; it does not claim the
  help WebSocket server is implemented.

## WP02 API and persistence verification

- **Requirements:** FR-CONV-01–04, FR-CONV-10, FR-CONV-13, NFR-SEC-03,
  NFR-SEC-10, NFR-SEC-12, NFR-OPS-01, NFR-OPS-02, and NFR-PRIV-05.
- **Verified acceptance:** 34 API tests pass, including four contract-parity
  checks, health deadlines, the optional `simple` default, retention
  authorization, and OpenAPI coverage. Five PostgreSQL integration tests pass:
  migrations are repeatable; host/session credentials are stored as hashes;
  reply replay and the persisted session limit work; retention removes expired
  learner/help data, stale images, stopped subscriptions, and expired answer
  cache entries while preserving active sessions; and updated course content
  produces updated cited answers. The engine also now awaits asynchronous
  content-version lookups, covered by a focused regression test.
- **Validation:** workspace build, all 97 tests with PostgreSQL integration
  enabled, workspace typecheck, and repository lint pass. The later Person 1
  pass records the updated suite and completes the previously deferred Compose
  acceptance.

## WP00 Compose acceptance (originally deferred)

- **Requirements:** FR-INT-09 and FR-INT-12, with NFR-OPS-01/02.
- **Historical deferral:** the first Compose increment started only
  PostgreSQL. The user later requested completion of API/widget startup; the
  deferral is resolved by the acceptance below.
- **Scope:** per the authoritative Blueprint, Compose runs PostgreSQL, API, and
  the static widget shell. It does not invent seeded course/job data, a
  simulator, or helper-console behavior.

## Person 1 completion pass — requirements before implementation

- **Requirements in scope:** WP00 (FR-INT-09, FR-INT-12, NFR-OPS-01/02);
  WP04 (FR-AI-01–07, FR-AI-09, FR-AI-11, AR-01, AR-08). Previously completed
  WP02/WP03 acceptance remains covered by the sections above.
- **Consent-contract resolution (user approved):** Add optional `cloudOk` and
  `consentVersion` to the existing session create/resume request. Omitted
  consent is false; enabling remote processing requires a non-empty version;
  resume can revoke it. The response returns persisted consent state.
- **Compose boundary:** Follow the authoritative Blueprint: start PostgreSQL,
  API, and the static widget shell; do not fabricate seeded course answers,
  job data, simulator, or helper-console behavior absent from that boundary.
- **Verified acceptance — WP04:** provider binding configuration validates,
  providers resolve through configured adapters, remote requests are blocked
  without consent and filtered to allowed data classes, credentials stay
  server-side, and offline fallback remains available. API tests exercise both
  non-consenting and consenting sessions. PostgreSQL integration tests verify
  migration 004, default opt-out, consent persistence, and revocation.
- **Verified acceptance — WP00:** `pnpm test:compose` builds and starts the
  database, API, and widget; checks direct and proxied API health, language
  listing, loopback-only API/widget ports, the internal database backend
  network, an offline-image restart with `--pull never --no-build`, and
  cleanup of its uniquely named containers, volume, and images. Startup must
  become healthy within the script's five-minute bound. The database is not
  published to the host.
- **Validation:** `pnpm test` passes 104 tests (the six PostgreSQL tests are
  skipped without a database URL); all six pass separately against an isolated
  PostgreSQL container. `pnpm typecheck`, `pnpm build`, `pnpm lint`,
  `pnpm lang:check`, `pnpm test:widget` (10/10, including axe checks), and
  `pnpm test:compose` pass. Modified files were formatted. Repository-wide
  `pnpm format:check` still reports two untouched pre-existing files:
  `packages/api/src/server.ts` and `packages/grounding/src/grams.ts`.
- **Acceptance boundary:** the Compose restart proves the prebuilt stack starts
  without pulling or rebuilding images; it does not claim a first-time build on
  a physically disconnected machine. FR-AI-04's FAQ hit-rate and the WP05
  learner-facing remote-AI notice/opt-out remain pending their required data
  and UI integration.

## Person 2 source runtime integration

### Requirements before implementation

- **Requirements:** WP03 — FR-INT-08, FR-TUTOR-01–06, FR-TUTOR-12–13,
  FR-TUTOR-15–18, and AR-03–AR-05. Preserve the authorized-sitemap boundary,
  stable source identities, host authorization, provenance, atomic
  publication, and dynamic retrieval behavior.
- **Telegram scope (user-approved):** wire the generic host-owned source
  adapter boundary only. A native Telegram connector remains WP08
  (FR-TG-01–12); learner direct messages and private-chat history are not
  shared index inputs.
- **Discrepancy found:** the source primitives existed, but current API code
  did not parse `DIMTS_PUBLIC_SOURCES`, create/start a `SourceSyncManager`, or
  expose the documented `sourceSyncReady`/`sourceSyncManager` locals. This
  contradicted the earlier startup-wiring claim.

### Verified acceptance

- **FR-INT-08:** validated public sitemap registrations feed the existing
  bounded, same-origin connector. `DIMTS_SOURCE_SYNC_INTERVAL_MS` defaults to
  300,000 ms and is bounded to 1,000–86,400,000 ms.
- **FR-TUTOR-12, AR-03–AR-05:** API startup combines public registrations with
  host-injected `ContentSource` adapters, uses PostgreSQL storage by default,
  and requires an injected `SourceSyncStore` with a custom repository. The
  initial sync is awaited before the server listens; reconciliation is
  scheduled; host-authenticated `notify` calls fetch authoritative content
  through the adapter before atomic publication.
- **Privacy boundary:** shared sources must contain only material authorized
  for every learner using that source. Per-learner ACL filtering is still not
  implemented. Native Telegram ingestion remains WP08; the adapter boundary
  does not index learner DMs or private-chat history, and no public webhook
  was added. Default sync-error logs omit source identifiers, upstream error
  messages, and document text.
- **Verification:** API and grounding source tests pass (69 passed, 6
  PostgreSQL tests skipped without the test database URL); API and grounding
  typechecks and targeted ESLint pass. Prettier passes for the changed
  implementation, test, and documentation files; the pre-existing formatting
  difference in `packages/api/src/server.ts` was not broadened. Compose
  configuration validates and passes the default interval `300000` to the API.

## Widget size-gate follow-up — requirements before implementation

- **Requirement:** FR-UI-14 — “Bundle budget: initial widget JavaScript at
  most 60 KB compressed; voice and help code load on demand. CI size check
  fails if exceeded.”
- **Scope:** preserve the existing budgets and compression measurement; make
  the script locate repository assets independently of the caller's working
  directory and add isolated pass/fail tests for its budget behavior.

### Verified acceptance

- The gate resolves the repository root from its own module path and passes
  when invoked from outside the repository root.
- Fixture tests verify failure when compressed JavaScript exceeds 60 KiB, when
  initial-load assets exceed 150 KiB, and when the build has no JavaScript
  bundle. The actual widget build passes at 28,247 compressed JavaScript bytes
  and 29,175 compressed initial-load bytes.
- `pnpm exec vitest run tests/size-gate.test.ts`, `pnpm size`, targeted ESLint,
  Prettier, and `git diff --check` pass.
- **Not claimed:** FR-UI-14's on-demand voice/help loading remains pending.
  `packages/widget/vite.config.ts` currently inlines dynamic imports, so this
  size-gate change does not establish code-splitting or lazy-load behavior.

## WP06 voice scaffold — requirements before implementation

- **FR-VOICE-02:** “STT and TTS are behind interfaces (SpeechToText,
  TextToSpeech). Engines are adapters chosen by voice.yaml and
  DIMTS_STT_ENGINE / DIMTS_TTS_ENGINE.”
- **FR-VOICE-03:** “if STT or TTS is not supported for the chosen language, the
  mic or read-aloud control is hidden or disabled with a clear text reason,
  and text input works fully.”
- **FR-VOICE-04:** “Recording starts and stops by tap (toggle). ... Maximum 60
  seconds per recording.”
- **FR-VOICE-05:** “the recognised text is shown ... with Send and Say it
  again. The text is editable.”
- **FR-VOICE-06:** “a plain message explains how to continue by text and how to
  enable the mic, no dead ends.”
- **FR-VOICE-07:** “Low confidence or silence: the learner hears and sees
  Please say it again, never a silent failure.”
- **FR-VOICE-08:** “each reply has a Read aloud button; setting can read all
  replies automatically. Speech can be paused, stopped and sped up (0.75, 1,
  1.25).”
- **FR-VOICE-09:** “Audio is not stored by default.”
- **FR-VOICE-12:** “Sound never carries information alone: any tone, voice
  prompt or audio reply has a visible and screen reader equivalent.”

**Selected scope:** build the `SpeechToText` and `TextToSpeech` ports and a
mock-driven widget interaction flow. No real browser/server voice adapter is
selected or enabled: `voice.yaml` engines remain null, the language packs
report STT/TTS unavailable, and no `/v1/stt` contract exists. The widget must
not request microphone access or invoke speech output without an injected,
language-supported adapter. FR-VOICE-01's physical Android test and engine
selection remain prerequisites for production voice.

### Verified acceptance

- `@dimts/voice` now defines provider-neutral STT/TTS ports, voice error codes,
  and the 60-second recording limit. Widget controls require both the language
  capability flag and an injected adapter that reports support.
- Mock-adapter Playwright tests verify unavailable controls and typed chat,
  recording toggle and 60-second stop, editable transcript/retry/explicit send,
  permission and missing-microphone recovery, silence feedback, optional
  spoken retry/transcript, per-reply and automatic read-aloud, speech rate,
  pause/resume/stop, and no transcript persistence in local storage.
- Speech output and transcription prompts have visible text equivalents;
  status and error announcements are exposed to assistive technology. The
  widget accessibility test reports no critical or serious axe violations.
- `pnpm test:widget` passes 17/17; widget/voice typecheck, targeted ESLint,
  style and string lint, `lang:check`, Prettier, and `git diff --check` pass.
  `pnpm size` passes at 29,600 compressed JavaScript bytes and 30,746 compressed
  initial-load bytes.

### Still pending — not a WP06 completion claim

- FR-VOICE-01: no Android device/engine comparison has been recorded in
  `docs/VOICE_TEST.md`; `voice.yaml` and `DIMTS_STT_ENGINE` /
  `DIMTS_TTS_ENGINE` selection are not wired. No production voice adapter is
  active, and the real microphone/audio path is unverified.
- FR-VOICE-02's configuration-driven engine selection, actual voice behavior
  on supported hardware, server STT deletion behavior under FR-VOICE-09, and
  FR-VOICE-10/11 remain unverified or unimplemented.
- Amharic and Afaan Oromoo voice copy is present in their draft locale packs
  but still requires language-lead review.
