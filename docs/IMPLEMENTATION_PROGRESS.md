# Implementation progress

Updated: 13 November 2026. Current branch: `phase-03-prompt`.

## P03 — implemented increment; acceptance blocked

The user reported P02 committed/pushed and authorized P03 only on the
already-created `phase-03-prompt` branch. It started clean. No agent commit
or push. P04 and later prompts remain out of scope.

Requirements quoted before implementation: FR-UI-06/08–10/14/16/18–20;
FR-CONV-11/12; FR-AI-05; FR-SIMPLE-02/03; FR-INT-01–04/11;
NFR-A11Y-01–06; NFR-PERF-01/02/05/06/07; FR-LANG-06–08/14.
Read the original P03 prompt, Blueprint sections 9–10 and corresponding SRS
acceptance text. Preserved existing session, provider, source-sync and help
contracts; the additive reviewed FAQ contract is recorded in `DECISIONS.md`.

Implemented session consent/revocation, reply actions, shortcuts, Simple mode,
slow-start/ask recovery, reviewed offline FAQ publication/cache, async Level 1
embedding, guarded host themes, nonce CSP, cleanup and real lazy voice/help
modules. Kept production voice/help extensions for P04/P05.

Tests preceded implementation. Browser regressions exposed and verified fixes
for keyboard access to the scrolling help summary, target sizes/spacing at
200% text, Oromo reflow, host-worker preservation, stale FAQ withdrawal,
`Vary: Origin` shell-cache misses, Lit global metadata and retry idempotency.
Abort/409/retry now reuses one client message ID and one learner bubble.
Final review also reproduced and fixed lost consent-response recovery and
uninstall after a host replaces the widget's service worker. Recovery creates
a fresh local-only session, preserves the unsent draft/preferences, and drops
old replies/help connections. Failed recovery remains retryable; it cannot
authenticate a server-side close of old help using an invalidated credential.

### Verified P03 evidence

- `pnpm exec vitest run --maxWorkers=1`: **445 tests / 50 files passed**, no
  skips, including **16 PostgreSQL integration tests**. Used an isolated local
  PostgreSQL 18 cluster; stopped and removed it afterward. Prior session,
  provider/privacy, source-sync, help and answer-cache tests remain green.
- After the final bundle optimization,
  `pnpm exec vitest run packages/widget/test tests/size-gate.test.ts tests/lang/pack-data.test.ts --maxWorkers=1`:
  **48 targeted tests / 10 files passed**, including the new real-build graph
  regression. Most of these repeat cases from the full suite above.
- `pnpm test:widget --workers=2 --grep-invert NFR-PERF-02`: **93 passed**.
  The separate serial startup test below also passed (94 browser tests total).
  Includes consent before the next ask, feedback body minimization, copy,
  Simple/read-aloud adapters, shortcuts, slow recovery, idempotent retries,
  script attributes/API/events, strict nonce CSP, no extra globals, host Lit
  interoperability, uninstall, disabled storage and real offline reload.
- **Accessibility:** zero serious/critical axe violations in the tested
  matrix. Welcome/chat/reply/settings/200%-text settings/help preview/FAQ:
  en/am/om/ar-test × light/contrast × 320/1280px. Embedded launcher/chat adds
  light/dark/contrast × four packs, keyboard and reduced-motion checks.
  Target size, spacing, focus, reply announcements and language direction
  regressions pass. One CSS page-scale check complements text enlargement;
  native browser zoom and assistive technology still need manual evidence.
  Test fixtures do not promote draft packs. Reproduce with the command above;
  per-screen JSON and an Oromo large-text screenshot are written under
  `test-results/` by `p03-a11y.spec.ts` for P11 review.
- **Build/static:** `pnpm build`, `pnpm typecheck`, `pnpm lint`,
  `pnpm lang:check`, `pnpm size`, changed-file Prettier and `git diff --check`
  pass. Compressed initial widget JS **44,013 / 61,440 bytes**; helper
  **27,500 / 61,440**; deferred voice/help **4,380**. Total first load
  **127,626 / 153,600 bytes**, including the regular Ethiopic font, maximum
  locale UI, service worker/manifest and conservative authored FAQ allowance.
  No dependency was added; frozen `pages/` and `assets/` were not changed.
- **Startup measurement:** launcher **2,571 ms / 3,000 ms** and chat ready
  **4,754 ms / 6,000 ms** in the English cold-start fixture. A failed run
  exposed an avoidable serial module download; the bootstrap now imports
  one complete widget entry, with voice/help still deferred. A real Vite
  build test enforces this graph and the preserved module exports. Run separately,
  without competing test jobs:
  `pnpm exec playwright test --config playwright.widget.config.ts packages/widget/e2e/embed-performance.spec.ts --workers=1 --output test-results/performance`.
  Every HTTP response, including worker requests, has at least 400 ms
  first-byte delay and shares a gzip-body link capped at 50,000 bytes/second
  (400 kbps). Browser cache is disabled; headers and tiny uploads are not
  bandwidth-shaped. The test verifies the cap from server transfer records
  and saves `throttled-startup.json` under its output directory. Browser frame
  timestamps capture visible controls, excluding automation reporting delay.
  This is one local Chromium fixture, not deployed or physical-device evidence. It
  supersedes the page-only CDP measurement that missed worker requests.

### P03 acceptance still open

- Real native-speaker/co-designer review is absent. Current locale FAQs stay
  unpublished (empty reviewed endpoint); synthetic reviewed fixtures prove
  behavior, not content approval. New locale copy remains draft.
- No 1 GB Android device/memory measurement, TalkBack, NVDA, native browser
  zoom or signed co-designer session was available. NFR-PERF-05 and the manual
  portions of NFR-A11Y-01/03/05 remain unverified. P11 must retain these gates.
- No real cloud/provider call or hosted deployment was made. Policy/consent
  checks use existing mocked provider contracts; prior P02 credentials and
  model/language acceptance blockers remain open.
- Nginx gzip configuration was added, but its container check was not run:
  Docker CLI exists and the Docker engine is unavailable. Real hosting must
  serve compressed assets and the host must supply its own offline HTML.
- Repository-wide `pnpm format:check` still reports **92 untouched baseline
  files**. Changed supported files pass; unrelated formatting was preserved.

Stop here. The user will review, commit and push; wait for explicit P04
authorization and their next branch. See `docs/INTEGRATION.md` and `docs/API.md`.

## Historical P02 record

## P02 — implemented increment; acceptance blocked

The user reported P01 committed/pushed and authorized P02 on their newly
created `phase-02-prompt` branch. The branch started clean. P03–P14 are not
authorized. No commit or push will be performed by the agent.

Requirements quoted before implementation: FR-CONV-05–09/13/14;
FR-TUTOR-07–11/14; FR-AI-02–10; AR-01/06/08; NFR-MAINT-02,
NFR-PRIV-03 and NFR-PERF-03. Read the original P02 prompt, relevant
Blueprint contracts and SRS acceptance text; preserved source synchronization.

Tests first exposed missing production rules/signals/cache wiring, native
provider registration, capability/privacy gaps, feedback persistence,
cross-language retrieval gating, FAQ source-ID mapping and evaluation integrity.
Preserved explicit provider order while adding priority-based unspecified
fallbacks. Implemented native OpenAI/Gemini/xAI, local-compatible and offline
conformance, durable minimal feedback state, PostgreSQL cache, canonical
pre-provider escalation, output guards, helper provider status, evaluation
and setup documentation. Source-sync architecture and learner UI are preserved.

### Verified P02 evidence

- **FR-CONV-05–09/13/14:** pack rules, automatic escalation, zero-provider
  small talk, injection corpus, per-turn language checks and retry pass.
  PostgreSQL tests prove serial replay after restart and parallel duplicate
  conflict/retry creates only one learner message and one reply.
- **FR-AI-02–09 / AR-01/08 / NFR-PRIV-03:** native/local/offline conformance,
  health/kill/timeout/cooldown/malformed paths, capability and consent filters,
  safe payloads, anonymous feedback counters, bounded/resettable streaks,
  cache expiry/invalidation/current citations and log scans pass. Native
  vendor APIs were mocked; no external provider or model call was made.
- **FR-TUTOR-07–11/14 / AR-06:** cross-source provenance and reviewed-mapping
  restrictions, actual PostgreSQL FAQ resolution, strict JobPosting dates,
  stable IDs, invalid-item indexes, job extraction, glossary rules and sentence
  limits pass. Rejections remain visible; no confidence floor was lowered.
- **Full suite:** `pnpm exec vitest run --maxWorkers=1` passed **406 tests in
  43 files**, including all **15 PostgreSQL integration tests**, with no skips.
  Used an isolated local PostgreSQL 18 cluster, not production data.
- **Coverage:** `pnpm test:core --maxWorkers=1` passed 226 tests. Statements/
  lines, branches, functions: engine **96.10/91.28/92.30%**; grounding
  **81.89/74.50/90.58%**; AI **96.98/89.89/94.73%**. `pnpm test:lang
--maxWorkers=1` passed 60 tests: locales **96.69/88.51/100%**. Every package
  meets the 70% floor for all four metrics.
- **Browser/accessibility:** `pnpm test:widget --workers=2` passed **44 tests**,
  including axe, RTL, keyboard/focus, 320px/200% reflow, helper status loading/
  failure/recovery, long-ID wrapping, and existing absolute/relative help flows.
  These are Chromium checks, not physical-device or native-screen-reader tests.
- **Static/build:** build, typecheck, lint, locale validation and size gates
  passed. Compressed widget/helper JavaScript: **33,865 / 27,500 bytes**, each
  below 61,440. Initial assets: **36,527 / 153,600 bytes**. Changed supported
  files pass Prettier and `git diff --check`; SQL migrations were applied and
  verified idempotent. No production dependency was added.
- **Latency:** Windows x64, Node 24.18.1, Intel i5-10310U (8 logical CPUs),
  8 GiB RAM, local PostgreSQL 18, warm serial samples (10 per mode). Server
  entry through response completion: offline **60 ms p95** (<=1,000), cached
  **41 ms p95** (<50). An earlier client-timed run during concurrent builds
  exceeded 50 ms; the final measurement excludes client/listener setup and
  network, as NFR-PERF-03 specifies. No cold-start or load-test claim is made.
- **Evaluation:** `pnpm eval` exited successfully: 44 questions / 88 normal+
  Simple runs, zero measured gate failures and eight acceptance blockers.
  In-process offline/cache p95: **1.63 / 1.45 ms**. See `docs/EVAL.md` and
  the README snapshot for denominators, refusals and source/language pairs.

### P02 acceptance still open

- Native-speaker/co-designer review and reviewed FAQ/check sets remain absent.
  P01's draft status and content gaps remain; the new helper strings are drafts.
- English end-to-end answer recall is **2/12 (16.7%)**; Amharic/Oromo produced
  **0/16 and 0/18** expected answers. No bilingual source corpus or reviewed
  cross-language mappings were supplied. Citation/language/length metrics for
  missing answers are **unverified**, not passes. FAQ-adapter matches are
  9/9 per draft pack, separately from the full retrieval/confidence pipeline.
- Real local-model/cloud credentials, model evaluation, 15-second/6-second
  p95 measurements and a new-machine setup trial are unavailable. The
  training-week recommended-model list has not been provided; documented
  reference candidates are not claimed as approved project recommendations.
- Known injection cases pass; universal prompt-injection resistance is not
  claimed. Real provider/language quality requires evaluation before enablement.
- Repository-wide `pnpm format:check` still fails on **98 untouched baseline
  files**. Existing README/generated-file formatting exclusions are preserved.

P02 is not marked complete. Temporary PostgreSQL was stopped after verification.
No commit or push was performed. Stop before P03 and await the user's instruction.

## P01 — historical handoff; acceptance blocked

Read the complete consolidated workplan at `docs/REMAINING_WORK_PLAN.md`
(the requested root filename `Remaining-workplan.md` is absent). P01 is the
only prompt implemented on `phase-01-prompt`. At that handoff, P02–P14 had
not been started. The user subsequently committed and pushed P01.

Requirements: FR-LANG-01–05, 09–13, 15–17; FR-CONV-05/07 phrase data;
FR-TUTOR-08/10 prompt and evaluation data; FR-AI-04/FR-UI-16 FAQ data;
NFR-A11Y-07 voice-status data; NFR-MAINT-02 locale coverage.

Implemented for review: pack shape/review/count/ICU/markup validation;
draft pack scaffolding and ten-step guide; data-driven dates and numbers;
per-key fallback with an API response header and session notice; optional
editable Amharic transliteration with explicit confirmation; draft pack
translations, glossary, FAQ and evaluation seeds; registry-driven helper
pickers and explicit draft preview. Existing relative-API help connections
and the learner-ended success notice were repaired after regression tests
failed; no remaining P05 feature was added.

## Verified acceptance evidence

- **FR-LANG-01–05/09/10/16:** new-folder discovery and preview API, mandatory
  keys, ICU variables/plurals, markup whitelist, SMS shape/budget, review
  metadata, count gates, YAML errors/aliases, per-key fallback and stable
  fallback-aware ETags are covered. Runtime voice-chain selection is tested,
  but production voice fallback is not claimed.
- **FR-LANG-12/13/17:** UTC Ethiopian/Gregorian arithmetic, leap/month-13
  cases, pack month names, Western digits, and display preservation pass.
  Amharic desktop output is `ህዳር 5 2019 (ኖቬምበር 14 2026)`.
  Actual `pnpm lang:new qaa` plus `pnpm lang:check` took 8.05 seconds;
  the isolated smoke-test folder was removed afterward.
- **Automated suite:** `pnpm exec vitest run --maxWorkers=2` passed 226
  tests. Ten PostgreSQL tests were skipped because
  `DIMTS_TEST_DATABASE_URL` is unset; no database integration pass is claimed.
- **Locale coverage:** `pnpm test:lang --maxWorkers=2` passed 60 tests;
  statements/lines 96.67%, branches 88.51%, functions 100%. The CI gate
  enforces 70% for all four metrics. CLI wrappers are excluded from that
  unit metric and the actual scaffold command was smoke-tested separately.
- **Tooling:** Node 24.18.1, pinned pnpm 10.12.1 on Windows. The original
  global pnpm 9.12.0 was bypassed with Corepack's installed shims. The stale
  baseline lockfile was repaired, then frozen/offline validation passed.
- **Browser/accessibility:** `pnpm test:widget --workers=2` passed all 43
  Chromium tests, including axe, keyboard/focus, RTL, 320px/200% reflow,
  transliteration confirmation, fallback notices, registry discovery and
  absolute/relative API help-chat regressions. Mock voice tests are not
  physical-device or screen-reader evidence.
- **Static/build gates:** `pnpm build`, `pnpm typecheck`, `pnpm lint`,
  `pnpm lang:check` and `pnpm size` passed. Compressed JavaScript is
  33,865/61,440 bytes for the widget and 27,069/61,440 for the helper;
  initial-load assets are 36,436/153,600 bytes.
- **Diff hygiene:** changed-file Prettier checks and `git diff --check`
  passed. No changes have been committed or pushed.

## Acceptance dependencies still open

- Human/native-speaker review of English, Amharic and Afaan Oromoo;
  co-designer review of distress language. No review metadata was invented.
- Each of `en`, `am` and `om` currently has 30 unreviewed glossary terms and
  nine sourced FAQ entries. Reviewed targets of 200 terms and 30 FAQs per live language
  remain outstanding; additional authorized course content is needed to
  expand FAQs meaningfully.
- Evaluation questions exist (en 13, am 15, om 16); final language/provider
  quality metrics are P02 and have not been claimed here.
- Target Android confirmation of the calendar fixture, and actual
  NVDA/TalkBack/voice testing, remain unperformed. Voice stays disabled.
  Runtime voice fallback is tested independently; configured production
  voice and its learner notice require P04 integration.
- Verified emergency/support contacts are absent. Packs contain no contact
  values; deployment contacts remain a host responsibility.
- Repository-wide `pnpm format:check` reports 123 untouched baseline files
  with formatting/CRLF differences, including `AGENTS.md`, `CHANGELOG.md`
  and `docs/API.md`. None of the changed files fails formatting. This branch
  does not reformat unrelated source files.

The branch must not be labeled P01 complete until its required evidence and
content gaps are resolved. The user's later P02 instruction permits the next
prompt's implementation, but does not supply P01's missing acceptance evidence.
