# Implementation progress

Updated: 13 November 2026. Current branch: `phase-02-prompt`.

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
