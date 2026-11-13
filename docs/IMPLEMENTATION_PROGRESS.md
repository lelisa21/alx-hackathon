# Implementation progress

Updated: 13 November 2026. Branch: `phase-01-prompt`.

## P01 — implemented increment; acceptance blocked

Read the complete consolidated workplan at `docs/REMAINING_WORK_PLAN.md`
(the requested root filename `Remaining-workplan.md` is absent). P01 is the
only authorized prompt in this branch. P02–P14 have not been started.
No commit or push is authorized; the user will handle both after team review.

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
content gaps are resolved. Stop here and await the user's instruction before
starting P02, even if P02 code already exists in the baseline repository.
