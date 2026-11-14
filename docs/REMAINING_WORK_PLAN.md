# Dimts remaining workflows

Status reviewed: 14 November 2026
Purpose: current implementation map and the remaining work needed for release.
Authority: [Dimts-System-Blueprint-v2.0.md](../Dimts-System-Blueprint-v2.0.md),
then the SRS for requirement IDs and acceptance criteria. The latest evidence is
recorded in [IMPLEMENTATION_PROGRESS.md](./IMPLEMENTATION_PROGRESS.md),
[GATE_CHECKLIST.md](./GATE_CHECKLIST.md), and [EVAL.md](./EVAL.md).

This replaces the previous prompt-by-prompt plan. P01–P11 have implementation
increments in the repository; their completed implementation prompts are
removed from the actionable queue. An implementation increment is not the same
as an accepted or release-ready work package. The open evidence and incomplete
surfaces below remain work.

## System workflow implemented so far

```text
Learner / host
  -> Lit web widget, REST, Telegram, or SMS simulator
  -> Express API: session/auth, validation, rate limits, channel routes
  -> channel-neutral conversation engine
       -> locale and per-question language checks
       -> grounded retrieval and citations
       -> consent/capability-filtered provider ladder
  -> PostgreSQL persistence and privacy-safe aggregates
  -> localized response to the originating channel

Adjacent services: human-help queue/chat/share, career/jobs and alerts,
feedback/insights, LTI integration, voice adapters, and source synchronization.
```

Current code boundaries:

- `packages/widget`, `packages/voice`, `packages/help`: learner UI, embedding,
  offline/FAQ behavior, helper console, and browser voice/share integrations.
- `packages/api`: Express routes, OpenAPI/Zod contracts, auth, service wiring,
  and PostgreSQL adapters/migrations.
- `packages/engine`, `packages/grounding`, `packages/ai`, `packages/eval`:
  ask pipeline, retrieval/citations, provider selection, and evaluation.
- `packages/locales-tools` and `locales/`: locale packs, validation, fallback,
  formatting, and scaffolding.
- `packages/jobs`, `packages/sms`, `packages/telegram`, `packages/insights`,
  `packages/lti`: career, channel, analytics, and integration capabilities.

Preserve these existing foundations. Do not create a second server/session
store, replace source synchronization, or alter the frozen Savanna captures in
`pages/` and `assets/`.

## Implementation increments delivered

These are not remaining implementation prompts. Their acceptance caveats are
listed as actionable workflows below.

| Work package | Delivered implementation increment                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01          | Locale checker/scaffolder, pack fallback and preview behavior, date/number formatting, and optional confirmed Amharic transliteration.                                                            |
| P02          | Grounded answer pipeline, provider registry/policy, durable cache and signals, JobPosting passage handling, and evaluation tooling.                                                               |
| P03          | Widget/offline FAQ and consent flows, reply controls, accessibility automation, and Level 1 embed contract.                                                                                       |
| P04          | Browser voice adapters, explicit recording/review/send, playback controls, and capability gating.                                                                                                 |
| P05          | Help queue/relay, availability and fallback behavior, consented sharing/image paths, and helper workflow.                                                                                         |
| P06          | Job import/search, alert and accommodation services, persistence, and learner career flows.                                                                                                       |
| P07          | SMS simulator, gateway boundary, encoding/continuation, STOP and subscription integration. Real carrier service remains out of event scope.                                                       |
| P08          | Private Telegram adapter, shared tutor/help/jobs paths, alert consent and STOP, and voice-note review boundary.                                                                                   |
| P09          | Insights aggregation service/API, privacy suppression, CSV, and authorization foundations. The teacher-facing page and full aggregate event wiring remain open.                                   |
| P10          | Static LTI configuration, launch validation/session persistence, replay protection, instructor authorization, and REST/OpenAPI examples. A complete production LTI/OIDC integration remains open. |
| P11          | Operations/privacy/deletion scaffolding, CI and Compose/evaluation/a11y gates, and release documentation. Human and hosted evidence remains open.                                                 |

## Remaining workflows

Do these in dependency order where noted. Manual reviews and environment setup
can be scheduled in parallel with code work when their prerequisites are ready.

### 1. Review language packs and build representative source data

**Packages:** P01 and P02.
**Requirements:** FR-LANG-01–17, FR-CONV-05/07, FR-TUTOR-08/10,
FR-AI-04/FR-UI-16, NFR-A11Y-07, AR-06/07.

- Obtain and record qualified/native-speaker review for English, Amharic, and
  Afaan Oromoo packs, including distress/help language and privacy copy. Keep
  review status truthful; do not promote draft data without review.
- Complete the reviewed glossary, FAQ, and evaluation-set targets specified
  by P01 (200 glossary entries and 30 sourced FAQs per live language, plus at
  least 10 evaluation questions per language).
- Obtain authorized, representative multilingual lesson/job passages and
  reviewed cross-language mappings. The current checked-in sample sources are
  English-only and cannot establish Amharic/Oromo answer quality.
- Complete the specified Android calendar verification and the review needed
  before enabling language-specific voice capabilities.
- Keep verified emergency/support contact values empty until supplied by the
  host.

**Exit evidence:** review metadata is genuine; `pnpm lang:check` passes; live
status and published FAQ data match review; date behavior is checked on the
target device.

### 2. Verify end-to-end tutor quality and provider profiles

**Packages:** P02; depends on workflow 1 for language acceptance.
**Requirements:** FR-CONV-05–09/13/14, FR-TUTOR-07–11/14, FR-AI-02–10,
AR-01/06/08, NFR-MAINT-02, NFR-PRIV-03, NFR-PERF-03.

- Re-run evaluation with reviewed source/question sets; close the current
  answer-recall gap and report results per language and source/language pair.
- Configure and test real local/cloud provider profiles only where the host
  enables them and learner consent/data policy permits. Current provider
  conformance tests do not establish real model quality or latency.
- Verify provider p95 targets with the configured adapters, including
  conditions and failure cases. Keep unsupported/unmeasured results explicit.
- Maintain the engine/grounding/AI coverage floor. Task 2's focused regression
  tests now make `pnpm test:core -- --maxWorkers=1` pass; grounding branch
  coverage is 74.95% against the unchanged 70% threshold.
- Preserve citation validity, language checks, injection tests, cache
  invalidation, and restart-safe ask idempotency while closing these gaps.

**Current evaluation evidence:** `docs/EVAL.md` reports English expected-answer
recall at 2/12 (16.7%), Amharic 0/16, and Afaan Oromoo 0/18. The draft FAQ
adapter results are separate and do not satisfy full-pipeline acceptance.

### 3. Complete teacher insights end to end

**Packages:** P09, with P02/P03 integration; P10 supplies instructor access.
**Requirements:** FR-CONV-12, FR-INSIGHT-01–04, FR-UI-20, NFR-PRIV-03.

- Add the accessible teacher-facing insights screen with localized loading,
  empty, error, filter, semantic-table, summary, and CSV states.
- Wire question and notfound outcome counts into the privacy-safe aggregate
  path; current evidence confirms the aggregate API/service, but not a complete
  event-to-dashboard workflow.
- Verify that only authorized host/instructor access is granted and that
  groups below five are suppressed/combined. Do not expose question text,
  session IDs, or learner identifiers in aggregates or exports.
- Add browser accessibility and authorization/aggregation end-to-end tests.

### 4. Finish production voice and channel verification

**Packages:** P04 and P08; depends on reviewed P01 capability data and P03
integration points.
**Requirements:** FR-VOICE-01–10/12, NFR-A11Y-07, FR-TG-02/03/10.

- The implemented browser voice flow is not evidence of production speech
  engines. Select/configure supported adapters and complete the same ten
  sentence/device protocol per language and engine before advertising them.
- Verify screen-reader/read-aloud behavior on real devices, including the
  Amharic/Ethiopic limitation and an equivalent text path.
- Telegram currently handles voice through the shared review/confirmation
  boundary; a compatible server-side STT/TTS adapter is not configured.
  Complete its data-policy, consent, deletion, and language-quality checks
  before enabling voice notes.
- Keep unsupported or unreviewed voice actions unavailable with localized
  explanations. Never cache or persist audio; FR-VOICE-11 audio caching was
  removed by the authoritative blueprint.

### 5. Verify real external integration boundaries

**Packages:** P05–P08 and P10; depends on the applicable completed feature
contracts and host-provided credentials/configuration.

- **Human help (P05):** test sharing, permission/stop behavior, and network
  fallback on real devices and restrictive networks. A configured TURN
  provider/credential and hosted retention behavior have not been verified.
- **Jobs (P06):** validate the configured host relay and actual delivery
  path with authorized integration credentials. Local protocol tests do not
  establish a production host's acceptance/delivery.
- **Telegram (P08):** complete an authorized live bot/webhook and delivery
  verification. Tests and simulator data do not substitute for host credentials.
- **LTI / REST (P10):** complete browser OIDC redirects, tool key/JWKS
  publication, deep-link response, and a real test-platform learner/instructor
  launch. Current static launch validation and mocked-JWKS tests are not a
  production LMS integration. Run the documented Level 2/3 examples and an
  outsider integration trial.
- **SMS (P07):** the simulator and replaceable gateway contract are the event
  scope. A real operator connection is explicitly out of scope and is not a
  release prerequisite.

Do not invent credentials, host endpoints, legal contact values, or
platform-specific fields. Agree and record any contract changes in
`DECISIONS.md` before implementation.

### 6. Complete human accessibility and co-designer acceptance

**Packages:** P03–P05, P09, and P11.
**Requirements:** NFR-A11Y-01–07 and G1–G13.

- Run the end-to-end main task with a co-designer using NVDA, TalkBack on a
  physical Android device, keyboard only, 200% zoom, and sound off.
- Complete the helper/share and screen-reader focus/announcement checks on
  real devices. Automated Playwright/axe results do not replace these runs.
- Record tester, device/assistive technology, date, findings, and fixes in
  `COCREATION_LOG.md` and `WCAG_REPORT.md`; close each applicable G1–G13 item
  in `GATE_CHECKLIST.md`.
- Obtain the required native-language and privacy/legal reviews. Do not mark
  the gate complete from automated results alone.

### 7. Close release and operations gates

**Package:** P11; depends on the feature acceptance above.

- Verify hosted Render/Neon setup, secrets, TLS/CSP/origins, scheduled jobs,
  retention, actual free-tier use, database size, and warm 50-session p95.
- Run PostgreSQL integration tests with the configured test database and keep
  the core package coverage thresholds enforced in CI.
- Re-run the clean-machine Compose/restart workflow after the latest migrations.
  Earlier progress records a Compose pass, but Docker is unavailable in this
  verification environment and its local `.env` does not parse. Reproduce the
  runtime check after those environment blockers are resolved.
- Resolve/report the remaining evaluation blockers; attach CI results for axe,
  audit and secret scan; report any skipped checks.
- `pnpm format:check` currently flags 307 baseline files. Do not reformat
  unrelated files as part of this remaining-work update; establish an approved
  baseline or format touched files selectively.
- Update release/gate documentation only with measured evidence. Keep overall
  status **blocked** until the manual, human, provider, and hosted gates pass.

## Follow-on proposals, not release workflows

P12 (expanded accessibility/AAC), P13 (longitudinal learning analytics), and
P14 (additional connectors/SDKs/platform plugins) have no requirement IDs in
the current product scope. They are not prerequisites for this release. Start
them only after explicit product, privacy, licensing, data-availability,
budget, and ownership approval.

## Verification snapshot

The task 2 follow-up build and serialized full suite report 836 tests passed
and 57 skipped across 85 passing test files and 11 skipped files; the separate
core coverage run passes 246 tests across 23 files, including the grounding
branch floor. Typecheck, lint, evaluation, and size checks pass. Compose
interpolation parses with `.env.example`, but the Docker engine was unavailable
and the local `.env` has a line-47 parse error, so container deployment was
not verified. Multilingual tutor quality, native-speaker/co-designer evidence,
real provider/hosted integration, and release gates remain open.
