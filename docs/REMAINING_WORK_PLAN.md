# Dimts remaining work — four independent workstreams

Status: proposed plan for four parallel owners  
Date: 12 November 2026  
Authoritative source: `Dimts-System-Blueprint-v2.0.md` (architecture revision 2.1)
where it supersedes `Dimts-SRS-v1.2-complete.md`.  
Requirement catalogue: `Dimts-SRS-v1.2-complete.md`, sections 5–10 and 23.

This plan covers **only work that is not finished**. It does not re-open verified
WP00–WP07 increments unless a regression is found.

---

## 1. How to use this plan

1. Each owner takes exactly one workstream and owns the paths listed in
   section 3.1. Do not edit another stream's paths.
2. Before implementing an item, quote its requirement IDs in the issue, branch
   description, or test file header. After implementation, record the verified
   acceptance evidence in `DECISIONS.md` (through the Connect scribe) and update
   the relevant doc.
3. Write the failing test first. Every MUST item needs automated coverage.
4. Use only locale-pack strings for user-facing copy, CSS logical properties,
   and the privacy rules in `AGENTS.md`.
5. Do not invent public fields or endpoints. Two contract additions are
   proposed in section 3.4; everything else is already in blueprint section 7.
6. A workstream is "done" only when its acceptance evidence is committed and
   the repository-wide gates in section 8 pass.

---

## 2. Baseline: what is already done

### 2.1 Verified or implemented

| Area                                                                                                                    | State                                                                                          | Evidence                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| WP00 workspace, CI, lint, Compose, health                                                                               | Done. Render blueprint and cron/keepwarm are missing.                                          | `.github/workflows/ci.yml`, `docker-compose.yml`, `Dockerfile`, `pnpm test:compose`                            |
| WP01 locale loader, fallback, checker, en/am/om drafts, ar-test                                                         | Done as scaffolding. Packs are incomplete.                                                     | `packages/locales-tools`, `locales/*`                                                                          |
| WP02 Express app, config, auth, errors, session/ask skeleton, migrations, OpenAPI                                       | Done.                                                                                          | `packages/api/src`, `packages/api/migrations`, `packages/api/test/wp02.test.ts`                                |
| WP03 ingestion, normalisation, trigram retrieval, citations, confidence floor, source sync                              | Done for course/HTML sources. Job source and evaluation are missing.                           | `packages/grounding`, `packages/engine/test/wp03.test.ts`                                                      |
| WP04 provider registry, capability filtering, ladder, offline and OpenAI-compatible adapters, per-session cloud consent | Done. Native vendor adapters, FAQ data, and evaluation remain.                                 | `packages/ai`, `packages/api/test/provider-config.test.ts`                                                     |
| WP05 widget shell, welcome, chat, live region, focus, settings, tokens, service worker, Ethiopic font                   | Done for the tested screens. Several FR-UI items remain.                                       | `packages/widget/src/index.ts`, `packages/widget/e2e/widget.spec.ts`                                           |
| WP06 voice ports, mock STT/TTS flow, mic review, read aloud                                                             | Scaffold done. No production engine or server voice path.                                      | `packages/voice`, `packages/widget/test`, DECISIONS "WP06 voice scaffold"                                      |
| WP07 help create/queue/claim/block/close, helper JWT, WebSocket chat, helper console                                    | Done for chat. Availability, timeout fallback, share/RTC, images, helper name, metrics remain. | `packages/api/src/routes/help.ts`, `packages/api/src/help-sockets.ts`, `packages/widget/src/helper-console.ts` |

### 2.2 Not done

| Area                     | Remaining                                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation rules       | FR-CONV-05, 06, 07, 08, 09, 12, 14; FR-CONV-10/11 need server/widget verification.                                                                                                                                                                        |
| Grounding and evaluation | FR-TUTOR-07, 08, 09, 10, 11, 14; FAQ data; job passages; `pnpm eval`.                                                                                                                                                                                     |
| AI layer                 | FR-AI-02 adapter completeness, 04 FAQ hit-rate, 06/07 contract proofs, 08 cache, 09 debug proof, 10 local-AI doc, 05 learner notice/opt-out.                                                                                                              |
| Widget and pages         | FR-UI-16, 18, 19, 20; FR-UI-06/08/09/10 manual audits; FR-UI-14 lazy loading; FR-HELP-04/05/08–12/14/16; FR-VOICE-01/02/09/10/11; FR-SIMPLE-02/03/04; job flows; SMS simulator; insights page; feedback UI; Delete my data; FR-INT-01–04 client behavior. |
| API and channels         | Missing endpoints: feedback, STT, TTS, help availability, ICE, image, jobs import/list, subscriptions, accommodation requests, insights, data delete, Telegram webhook, SMS inbound, LTI, internal alerts/usage.                                          |
| Services                 | `packages/help`, `telegram`, `lti`, `sms`, `jobs`, `insights` are empty stubs.                                                                                                                                                                            |
| Language data            | All glossaries, FAQs, and checks are empty. `en` is beta; `am`/`om` are English scaffolds. `voice.yaml` engines are null.                                                                                                                                 |
| Operations/docs          | No `render.yaml`, cron/keepwarm, seed, usage script, TURN profile, `WCAG_REPORT`, `EVAL`, `PRIVACY`, `INTEGRATION`, `COST`, `FREE_TIER`, `VOICE_TEST`, `SMS_GATEWAY`, `ADD_A_LANGUAGE`, `GATE_CHECKLIST`, `COCREATION_LOG`, examples.                     |
| Test/CI                  | No Playwright a11y matrix, eval job, Compose e2e, contrast script, or coverage gate.                                                                                                                                                                      |

### 2.3 Do not rebuild

- Do not replace the locale loader, provider registry, ladder, grounding search,
  source-sync manager, API auth/session model, help chat relay, or widget shell.
- Do not re-open verified WP00–WP07 acceptance without a failing regression test.
- Do not add a second UI framework, state manager, database layer, or provider
  abstraction.
- Do not edit `pages/` or `assets/`; those are frozen Savanna reference captures.

---

## 3. Coordination rules

### 3.1 Exclusive path ownership

| Path                                                                                                                                                                                                                                                                                                                                                                        | Owner                       | Notes                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `packages/engine/**`, `packages/grounding/**`, `packages/ai/**`, `content/**`, `tests/grounding/**`                                                                                                                                                                                                                                                                         | **A — Core Intelligence**   | Includes job-passage extraction and eval fixtures.                               |
| `packages/widget/**`, `packages/voice/**`, `tests/a11y/**`, `tests/e2e/**`, `docs/WCAG_REPORT.md`, `docs/COCREATION_LOG.md`                                                                                                                                                                                                                                                 | **B — Experience**          | Includes helper console, simulator, insights page, and a11y script.              |
| `packages/api/**`, `packages/help/**`, `packages/telegram/**`, `packages/lti/**`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.github/workflows/**`, `render.yaml`, `scripts/test-local-compose.mjs`, `scripts/usage.mjs`, `examples/**`, `docs/API.md`, `docs/INTEGRATION.md`, `docs/PRIVACY*.md`, `docs/FREE_TIER.md`, `docs/COST.md`, `docs/GATE_CHECKLIST.md` | **C — Platform & Channels** | Owns OpenAPI, root manifests, README, CHANGELOG, and merge scribe for DECISIONS. |
| `locales/**`, `packages/locales-tools/**`, `packages/sms/**`, `packages/jobs/**`, `packages/insights/**`, `scripts/lang-*`, `docs/ADD_A_LANGUAGE.md`, `docs/VOICE_TEST.md`, `docs/SMS_GATEWAY.md`                                                                                                                                                                           | **D — Language & Services** | Owns all pack data and the SMS/jobs/insights domain libraries.                   |
| `DECISIONS.md`, `CHANGELOG.md`, root `package.json`, `pnpm-lock.yaml`                                                                                                                                                                                                                                                                                                       | **C**                       | Other owners submit exact entries/snippets; C merges.                            |
| `README.md`                                                                                                                                                                                                                                                                                                                                                                 | **C**                       | A supplies the eval table; B supplies install/a11y facts.                        |

If a change cannot avoid another owner's path, stop and hand the patch to that
owner instead of editing it.

### 3.2 Shared surfaces and freeze

The following are frozen at the first integration checkpoint:

- Blueprint section 7 contracts.
- The OpenAPI path/field set.
- The locale key list.
- The screen list and route names.

Additions are allowed (new optional fields, new keys). Renames and removals need
both affected owners and a `DECISIONS.md` entry. New keys are always added to
**all** packs in the same change, even when `am`/`om` temporarily hold English
scaffold text.

**Locale-key workflow:** B, A, and C send D a key request containing key,
English value, ICU variables, and screen. D adds the key to `en`, `am`, `om`,
and `ar-test` and returns the exact key names. Do not hard-code a fallback
string in code.

**OpenAPI workflow:** C adds the schema and route first, with contract tests.
A/B code against the published shape; if a shape is unclear, C records the
resolution in `DECISIONS.md` before anyone implements it.

**DECISIONS workflow:** each owner writes a short entry in
`docs/notes/<stream>.md` with requirement IDs and evidence. C merges accepted
entries into `DECISIONS.md` at each checkpoint. This avoids four-way conflicts.

### 3.3 Staffing deviation to record

The blueprint assigns `jobs` and `insights` to Core. To balance four independent
workstreams, this plan assigns the **domain libraries** to D, while A keeps job
grounding, C owns the HTTP routes, and B owns the pages. This is a staffing
split, not an architecture change. Record it in `DECISIONS.md` before work
starts; requirement ownership does not change.

### 3.4 Contract additions proposed before implementation

These are additive and must be recorded in `DECISIONS.md` and `openapi.yaml`
before code:

1. `GET /v1/locales/{code}/faq` — returns the reviewed offline FAQ entries
   (`{entries:[{q,a,source?}]}`) so the widget/service worker can cache them.
   Needed by FR-UI-16, FR-AI-04, and NFR-PERF-06. C owns the route; D owns the
   data; B owns the cache/UI.
2. `GET /v1/help/availability` — returns `{available, nextOpenAt?}` for the
   authenticated session, or an equivalent shape agreed by B and C. Needed by
   FR-HELP-05. The existing `DIMTS_HELPER_HOURS` parser stays internal until
   this shape is approved.

Two behaviours still need an approved contract before implementation:

- FR-HELP-04 timeout fallback: how a call-back request, a waiting message, or a
  Telegram deep link is represented. Recommended: reuse the help request with an
  explicit mode and consent field, never invent a second request type silently.
- Job subscription and accommodation payloads: blueprint names the endpoints
  and data model but not every field. C and D agree the schema, add it to
  OpenAPI, and record it.

Endpoint **names** are frozen by section 7, but the request/response bodies for
feedback, STT/TTS, subscriptions, accommodation, data delete, internal usage,
and the insights query/CSV are not fully specified there. C defines them
additively in `openapi.yaml`, writes the contract test, and records the decision
before B or D codes against them.

### 3.5 Branches and evidence

- One branch/worktree per stream: `core/…`, `experience/…`, `connect/…`,
  `language/…`.
- Keep commits small and scoped to one requirement group.
- Every PR states: requirement IDs, tests added, commands run, screenshots or
  logs where relevant, and any follow-up.
- Never log message text, names, phone numbers, or Telegram IDs in tests,
  fixtures, or CI output.

---

## 4. Workstream A — Core Intelligence (answer correctness)

### 4.1 Charter

Own the answer pipeline from question to schema-valid cited reply: rule-based
paths, grounding, providers, evaluation, and job passages. Do not touch API
routes, widget, packs, or infrastructure.

### 4.2 Remaining requirements

`FR-CONV-05`, `FR-CONV-06`, `FR-CONV-07`, `FR-CONV-08`, `FR-CONV-14`;
`FR-TUTOR-07`, `FR-TUTOR-08` (prompt use), `FR-TUTOR-09`,
`FR-TUTOR-10`, `FR-TUTOR-11`, `FR-TUTOR-14`; `FR-AI-02`–`FR-AI-10`;
`AR-01`, `AR-06`, `AR-08`; `NFR-MAINT-02`, `NFR-PRIV-03`.

### 4.3 Work items

#### P0 — rules before the model (no provider call)

| ID         | Deliverable                                                                                                                 | Tests first                                                                                  | Acceptance                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| FR-CONV-05 | `packages/engine/src/rules.ts`: escalation keyword match from `prompts.yaml`; reply `kind:"escalation"` with a help action. | ≥5 phrases per live language; provider spy count is 0; unknown phrase falls through.         | All phrases trigger; list is data, not code.               |
| FR-CONV-07 | Distress keyword path; caring one-line reply, help action, host-configured emergency/support text; never advice.            | ≥5 phrases per language; provider not called; no medical/legal advice string.                | Path works; contact text empty until Q9 is verified.       |
| FR-CONV-08 | Delimit learner text and passages as data; strip instruction-like control; keep system rules immutable.                     | 10 injection attempts: ignore rules, reveal prompt, answer without sources, change language. | Each ends in normal behaviour or `notfound`; no rule leak. |

`FR-CONV-09` small talk is already implemented in `POST /v1/ask`
(`isSmallTalk` + locale templates). Do not duplicate it in the engine. C keeps
the regression coverage; A only ensures the engine is never called for a
greeting.

#### P0 — conversation state and language guard

| ID          | Deliverable                                                                                                                                                                                                                    | Tests first                                                                                                           | Acceptance                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| FR-CONV-06  | Extend `AskDependencies` with a small `ConversationSignals` port (recent reply kinds and consecutive negative feedback). After two notfound replies or two negative taps, prepend a gentle escalation message and help action. | Two out-of-course questions then a third reply; two negative feedback signals then a reply; API wires the port later. | Third reply includes help action; provider still follows the citation rule. |
| FR-CONV-14  | `packages/engine/src/langcheck.ts`: Ethiopic script check for `am`; stopword check for `en`/`om`; retry provider once; then localized `notfound`.                                                                              | Wrong-language mock replies for am/en/om; retry count exactly 1; fallback kind `notfound`.                            | No wrong-language answer reaches the learner.                               |
| FR-TUTOR-07 | Cross-language note once, using `from.other` locale key with source language and section.                                                                                                                                      | English passage + Amharic session; note present and in Amharic; same-language answer has no note.                     | Note appears once, with citation.                                           |

#### P1 — evaluation and retrieval quality

| ID                       | Deliverable                                                                                                                                                                                                                              | Tests first                                                                            | Acceptance                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| FR-TUTOR-10, FR-TUTOR-14 | `packages/eval` command (or `grounding` CLI) run by `pnpm eval`; reads `checks.yaml`; reports retrieval hit rate, citation validity, not-found correctness, answer-language correctness, average sentence length; writes `docs/EVAL.md`. | Fixture set with known hits/misses; report schema test; sentence-length test en/am/om. | ≥10 questions × 3 languages; citation validity 100%; not-found ≥90%; retrieval reported per language; ≤15 words (≤12 Simple). |
| FR-TUTOR-11, FR-TUTOR-08 | Glossary injection and prompt rule presence; prompt builder never accepts learner overrides.                                                                                                                                             | Glossary term used consistently; prompt lint over packs.                               | D's glossary data is used; all rules present in every live pack.                                                              |
| FR-TUTOR-09              | JSON-LD `JobPosting` → passage with `sourceType:"job"`, stable id, title/location/deadline text, citation.                                                                                                                               | Valid/invalid JSON-LD fixtures; job question cites a job passage.                      | Job answers obey the same floor/citation rules.                                                                               |

#### P1 — provider completeness and cache

| ID                                     | Deliverable                                                                                                                                 | Tests first                                                                          | Acceptance                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| FR-AI-02, FR-AI-03, FR-AI-06, FR-AI-07 | Shared provider conformance suite for cloud/local/offline profiles; explicit local profile; malformed retry; max tokens/temperature config. | Same suite per adapter; kill-cloud test; malformed reply test; config test.          | Three profiles ship and behave identically at the contract boundary. |
| FR-AI-04                               | Offline FAQ matching plus top-passage extract, always cited; English FAQ hit-rate measurement.                                              | 10+ FAQ fixture questions; network disabled; 70% hit target.                         | Target met once D supplies FAQ data; otherwise report honestly.      |
| FR-AI-08                               | `AnswerCache` port keyed by question + lang + simple + contentVersion; in-memory default; hit/miss logging without text.                    | Second identical request <50 ms; different contentVersion misses; invalidation test. | API can plug a Postgres store later.                                 |
| FR-AI-09, FR-AI-10                     | Ladder state test and `docs/LOCAL_AI.md` with a small-model recipe.                                                                         | Health/debug shape test; doc link check.                                             | Helper console/health can show provider without learner UI leakage.  |

#### P2 — hardening

- Prompt-injection corpus grows to cover job passages and glossary entries.
- Add coverage for `engine`, `grounding`, `ai` at ≥70% (`NFR-MAINT-02`).
- Keep all WP03/WP04 acceptance tests green.

### 4.4 Handoff contract

A provides:

- `AskDependencies` additions: `rulesFor(lang)`, `conversationSignals`, and
  optional `answerCache`.
- Reply semantics: `kind`, `actions`, and the cross-language note.
- `AnswerCache` interface and key function.
- `parseJobPostingPassages()` for C's import route.
- `docs/EVAL.md` and the eval report table for C's README.

A consumes:

- D: `prompts.yaml`, `glossary.yaml`, `faq.yaml`, `checks.yaml`.
- C: persistence adapters for conversation signals and cache; no engine import
  of `pg` or Express.

### 4.5 Definition of done

- All P0/P1 items have tests and verified acceptance entries.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm eval` pass.
- `docs/EVAL.md` has the real table and floors; README contains the table.
- No engine log contains question text, passage text, or learner identifiers.

### 4.6 Start now (no other stream needed)

1. Rules and language guard with fixture packs.
2. Eval harness with fixture questions.
3. Job JSON-LD → passage converter with fixtures.
4. Provider conformance suite and cache interface.

---

## 5. Workstream B — Experience (learner, helper, and pages)

### 5.1 Charter

Own every screen and client behaviour: learner widget, voice adapters, helper
console UI, SMS simulator, insights page, offline behaviour, accessibility, and
host integration. Do not edit API routes, packs, or backend packages.

### 5.2 Remaining requirements

`FR-UI-06`, `FR-UI-08`–`FR-UI-10`, `FR-UI-14`, `FR-UI-16`, `FR-UI-18`–
`FR-UI-20`; `FR-HELP-04`, `FR-HELP-05`, `FR-HELP-08`–`FR-HELP-12`,
`FR-HELP-14`, `FR-HELP-16` (client); `FR-VOICE-01`, `FR-VOICE-02`,
`FR-VOICE-09`–`FR-VOICE-11`; `FR-SIMPLE-02`–`FR-SIMPLE-04`;
`FR-JOB-01`, `FR-JOB-04`–`FR-JOB-06`, `FR-JOB-08` (UI); `FR-INSIGHT-03`;
`FR-SMS-02`; `FR-CONV-11`, `FR-CONV-12` (UI); `FR-INT-01`–`FR-INT-04`,
`FR-INT-11`; `NFR-A11Y-01`–`NFR-A11Y-06`; `NFR-PERF-01`, `NFR-PERF-02`,
`NFR-PERF-05`–`NFR-PERF-07`; `NFR-PRIV-06` (web UI); `FR-LANG-15` (optional,
cut-line).

### 5.3 Work items

#### P0 — offline, slow, and consent states

| ID                                           | Deliverable                                                                                                                                | Tests first                                                                             | Acceptance                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| FR-UI-16, NFR-PERF-06, NFR-PERF-07, FR-AI-04 | Fetch and cache `GET /v1/locales/{code}/faq`; render an offline FAQ route; show `waking.message` after 2 s and `status.working` after 2 s. | Playwright offline mode; delayed health; FAQ visible with no network; one announcement. | No dead end offline; FAQ answers without course answers being fabricated. |
| FR-AI-05                                     | One-line remote-AI notice and a control to use local/offline; update session consent; never call cloud when declined.                      | Network capture with consent on/off; notice accessible text; opt-out persists.          | Only question/passages sent when on; nothing sent when off.               |

#### P0 — help sharing and fallback

| ID                                 | Deliverable                                                                                                                                                    | Tests first                                                                             | Acceptance                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| FR-HELP-05                         | Outside-hours message with next availability and a message option, from C's availability endpoint.                                                             | Fake clock at open/closed times; message and option present.                            | Learner knows when help returns.                                                        |
| FR-HELP-04                         | 5-minute timeout fallback: Telegram, call-back, or leave a message; no pressure countdown.                                                                     | Fake clock; each option reachable; tutor still usable.                                  | Offer appears after configured time, not before.                                        |
| FR-HELP-08, FR-HELP-09, FR-HELP-10 | Consent dialog with equal Share/Not now; no capture before accept; persistent banner with Stop; stop ends tracks on both sides; view-only, no audio/recording. | Fake `getDisplayMedia`/`RTCPeerConnection`; decline test; stop test; API-recording spy. | Not now keeps chat and captures nothing; Stop works with touch, keyboard, and shortcut. |
| FR-HELP-12                         | Picture fallback (2 MB, image types) and "Describe what you see" when capture is unsupported or poor; explain why.                                             | Mobile emulation without `getDisplayMedia`; oversized/wrong-type file.                  | No dead end; upload only after explicit choice.                                         |
| FR-HELP-14, FR-HELP-16             | Helper console share controls, optional helper first name, keyboard/zoom/contrast checks.                                                                      | Console axe/keyboard tests.                                                             | Console passes the same gate checks as the widget.                                      |

#### P1 — message actions, feedback, settings, and host surface

| ID                           | Deliverable                                                                                                                    | Tests first                                                                    | Acceptance                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| FR-CONV-12, FR-UI-20         | Per-reply Copy, Helpful/Not helpful, Read aloud; one-tap feedback posts `{replyId, helpful}`; no text in the request.          | Keyboard tab order; POST body inspection; one tap only.                        | All actions reachable; aggregate has no session id.       |
| FR-UI-18                     | Documented shortcuts (Alt+Shift+M/H/L) with a settings toggle.                                                                 | Shortcut works; disabled toggle disables it; no printable single-key shortcut. | WCAG 2.1.4 respected.                                     |
| FR-UI-19, FR-UI-10           | Expose host CSS custom properties for colour/font/radius; reject low-contrast host values; complete focus-ring contrast audit. | Low-contrast host theme test; token contrast script.                           | Guard restores defaults; 7:1 text and 3px/2px focus ring. |
| FR-UI-14                     | Lazy-load voice and help code; keep initial JS ≤60 KB compressed.                                                              | Size gate; dynamic import assertion.                                           | Budget passes without inlining everything.                |
| FR-UI-06, FR-UI-08, FR-UI-09 | Finish manual/browser evidence for mic cues, 200% zoom, 320px reflow, 48px targets and 8px spacing.                            | Playwright at 320/200%; axe matrix.                                            | Evidence recorded in WCAG report.                         |

#### P1 — Simple mode and guided flows

| ID                                            | Deliverable                                                                                                                              | Tests first                                              | Acceptance                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| FR-SIMPLE-02                                  | One primary action, icons beside labels, advanced settings hidden, read-aloud on, text ≥150%.                                            | Playwright property checks.                              | Every Simple-mode property verified.                   |
| FR-SIMPLE-03                                  | One best citation; consume A's measured short sentences.                                                                                 | One-chip test; sentence-length report consumed.          | Widget shows one citation; engine reports ≤12 words.   |
| FR-SIMPLE-04, FR-JOB-01, FR-JOB-04, FR-JOB-05 | Guided job-alert and accommodation flows: one question per screen, Back/Next, progress, save/resume, review/approve, no diagnosis field. | Reload mid-flow; approval-before-send; no name required. | Flows resume and never send before approval.           |
| FR-JOB-06, FR-JOB-08                          | Support-I-need filter stored only in session; Ethiopian + Gregorian dates from D's formatter.                                            | Filter network test; fixture dates.                      | Filter never leaves the session; both calendars shown. |

#### P1/P2 — pages and integration

| ID                                                    | Deliverable                                                                                                                              | Tests first                                                                                 | Acceptance                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| FR-SMS-02                                             | `/sim/sms` phone-thread page: send box, character counter, encoding, segment count.                                                      | Playwright send/receive/counter; gate checks.                                               | Page passes axe/keyboard/reflow.                          |
| FR-INSIGHT-03                                         | Accessible insights page: table headers, text summary before any chart, CSV export.                                                      | Seed data table; CSV; axe.                                                                  | Passes the gate; no question text.                        |
| NFR-PRIV-06                                           | Delete-my-data control on web with confirmation and success/error states.                                                                | Fake API; focus/live-region; no data after.                                                 | Deletion effective within one minute.                     |
| FR-INT-01, FR-INT-02, FR-INT-03, FR-INT-04, FR-INT-11 | Async embed loader/launcher; `data-theme`, `data-position`, `data-simple`, `window.Dimts`, events, CSP-safe, uninstall cleanup.          | Blank-page embed; strict CSP; removal leaves no elements/listeners/storage except language. | C's examples run; no console errors.                      |
| NFR-A11Y-01–06, G1–G13                                | `pnpm a11y` script: axe across screens × live languages × themes × 320/1280; manual protocol log; `WCAG_REPORT.md`; `COCREATION_LOG.md`. | CI job; report completeness check.                                                          | Zero critical/serious; report has evidence per criterion. |

#### P2 — voice

| ID                                    | Deliverable                                                                                                                        | Tests first                                   | Acceptance                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| FR-VOICE-01, FR-VOICE-02              | Config-driven engine selection from `voice.yaml` + `DIMTS_STT_ENGINE`/`DIMTS_TTS_ENGINE`; browser adapters; hide when unsupported. | Swap adapter by config; unsupported language. | No code change to swap; text path always works.    |
| FR-VOICE-09, FR-VOICE-10, FR-VOICE-11 | No audio stored; Afaan Oromoo beta label; optional audio cache.                                                                    | Storage inspection; label test; cache test.   | Audio deleted after use; beta explanation present. |

### 5.4 Handoff contract

B provides:

- Widget build entries, page routes, `window.Dimts` and event names.
- `pnpm a11y` implementation and screen list.
- Offline FAQ cache key/format.
- WS client message types used (`share.*`, `rtc.*`, `help.*`).
- Feedback/delete request shapes used by the UI.

B consumes:

- C: OpenAPI shapes, local mocks, availability/FAQ/feedback/delete endpoints,
  ICE endpoint, WS signalling.
- D: every UI key and the FAQ/voice data.
- A: reply kinds/actions and cross-language note.

### 5.5 Definition of done

- P0/P1 items pass automated tests and axe.
- 320px, 200% zoom, keyboard-only, sound-off, high-contrast, and all live
  languages are covered.
- `pnpm test:widget`, `pnpm a11y`, and `pnpm size` pass.
- `WCAG_REPORT.md` and `COCREATION_LOG.md` are current.

### 5.6 Start now (mocked API is allowed)

1. Offline/working/waking states and FAQ cache with a fixture FAQ.
2. Remote-AI notice/opt-out with a mocked session.
3. Message actions/feedback and settings/host theming.
4. Share consent/banner/stop with fake media APIs.
5. A11y matrix and page shells (SMS, insights) with fixture data.

---

## 6. Workstream C — Platform, Channels & Operations

### 6.1 Charter

Own the API, persistence wiring, help server, Telegram, LTI, TURN/ICE, CI,
Compose/Render, seeds, scripts, and operator docs. C is also the contract scribe.

### 6.2 Remaining requirements

`FR-CONV-10`, `FR-CONV-12` (server), `FR-CONV-13` (regression);
`FR-HELP-04`–`FR-HELP-07` (server gaps), `FR-HELP-08`–`FR-HELP-18` (server);
`FR-TG-01`–`FR-TG-12`; `FR-INT-05`–`FR-INT-07`, `FR-INT-09`, `FR-INT-10`,
`FR-INT-12`; `FR-AI-05` (server), `FR-AI-09` (server), `FR-AI-08` (persistence);
`NFR-SEC-01`–`NFR-SEC-09`; `NFR-REL-01`–`NFR-REL-03`; `NFR-COST-03`–
`NFR-COST-06`; `NFR-PRIV-05`, `NFR-PRIV-08`, `NFR-PRIV-09`;
`NFR-ADOPT-01`, `NFR-ADOPT-02`; `NFR-PERF-04`; `NFR-MAINT-01`.

### 6.3 Work items

#### P0 — contract scaffolding and help completion

| ID                                             | Deliverable                                                                                                                                                                                                            | Tests first                                                                              | Acceptance                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Contract                                       | Add every missing path/schema from blueprint section 7 to `openapi.yaml` and zod schemas; contract test checks route/spec parity.                                                                                      | Spec-to-route test; unknown-field rejection.                                             | No undocumented endpoint or field.                                    |
| FR-HELP-05                                     | `GET /v1/help/availability` shape, hours from `DIMTS_HELPER_HOURS`; localized response.                                                                                                                                | Fake clock open/closed; contract test.                                                   | B can show when helpers return.                                       |
| FR-HELP-04                                     | Approved timeout fallback contract and persistence.                                                                                                                                                                    | State transition test.                                                                   | No invented shape; recorded in DECISIONS.                             |
| FR-HELP-08–FR-HELP-12                          | WS validation/role checks/relay for `share.request`, `share.accept`, `share.decline`, `rtc.offer`, `rtc.answer`, `rtc.ice`, `share.stop`; `POST /help/{id}/ice`; `POST /help/{id}/image` (2 MB, image types, DB, 2 h). | Two-client signalling; wrong-role rejection; oversized/non-image upload; expiry cleanup. | Consent before capture; stop relayed; image deleted on end/retention. |
| FR-HELP-13, FR-HELP-15, FR-HELP-17, FR-HELP-18 | Handoff payload remains minimal; retention for images/subscriptions; 5/hour regression; helper metrics (wait time, resolution) with no content.                                                                        | Payload inspection; fake-clock retention; rate-limit test; metrics schema.               | No content or identifiers in metrics.                                 |
| FR-HELP-16                                     | Optional helper display name in `help.joined`; helper-controlled.                                                                                                                                                      | Claim payload test.                                                                      | Absent by default.                                                    |

#### P0 — feedback, jobs, subscriptions, accommodation, deletion

| ID                                          | Deliverable                                                                                                                                                                                                       | Tests first                                                                                      | Acceptance                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| FR-CONV-09, FR-CONV-10                      | Keep the existing small-talk and question-rate-limit paths covered; no new engine work.                                                                                                                           | Greeting makes zero provider calls; limit returns the localized message.                         | No regression.                                    |
| FR-CONV-12                                  | `POST /v1/feedback` `{replyId, helpful}`; lookup stored reply citations; aggregate by topic/lang/period; no session id.                                                                                           | Counter test; duplicate tap; no session column.                                                  | One-tap, anonymous aggregate.                     |
| FR-INT-07, FR-TUTOR-09                      | `POST /v1/jobs/import` with secret host key; schema.org JobPosting; invalid items by index; calls D's parser and A's passage ingestion.                                                                           | Valid/invalid fixture; partial import report.                                                    | Unknown fields ignored; invalid indexes reported. |
| FR-JOB-01–FR-JOB-11                         | `GET /v1/jobs` filters; `POST/DELETE /v1/subscriptions` with consent and encrypted contact; `POST /v1/accommodation-requests` draft/approve/send via relay; `POST /v1/data/delete`; alert runner and consent log. | 5-step flow state; stop within 1 min; no diagnosis field; relay without name; idempotent runner. | Track 3 flows work on web/Telegram/SMS.           |
| FR-INSIGHT-01, FR-INSIGHT-02, FR-INSIGHT-04 | `GET /v1/insights` with host token or LTI instructor; aggregate only, `<5` → Other; CSV. B owns the accessible page (`FR-INSIGHT-03`).                                                                            | 401 test; seed table; small-count grouping.                                                      | No question text/session ids.                     |

#### P0/P1 — channels

| ID                 | Deliverable                                                                                                                                                                                                              | Tests first                                                                         | Acceptance                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| FR-TG-01–FR-TG-12  | `packages/telegram`: webhook secret, private-only, commands, voice note "I heard" + Send/Say again, text+link replies, 4096 split, send queue/retry, hashed/encrypted IDs, consent/privacy, `/endhelp`, friendly errors. | Fixture updates per command; group ignored; burst test; long text; error injection. | Every command works in every live language.                                                          |
| FR-INT-06          | `packages/lti` + `/v1/lti/login                                                                                                                                                                                          | launch                                                                              | jwks`: OIDC, state/nonce/signature/audience/expiry, deep linking, Learner→chat, Instructor→insights. | Mock platform; one negative test per check. | Invalid launches rejected; roles map correctly. |
| FR-SMS-01 (server) | `/v1/sms/inbound` gateway secret; calls D's SMS router; simulator uses the same path.                                                                                                                                    | Contract test; wrong secret; simulator exchange.                                    | Same code path for real gateway and simulator.                                                       |
| STT/TTS            | `/v1/stt`, `/v1/tts` optional; audio deleted after transcription; 503 with localized reason when no engine.                                                                                                              | Mock engine; audio deletion; unsupported engine.                                    | No audio retained; text path unaffected.                                                             |

#### P1 — infrastructure, operations, and docs

| ID                                       | Deliverable                                                                                                                                                                     | Tests first                                                                                | Acceptance                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| FR-INT-09, NFR-COST-03/04, NFR-REL-01/02 | Compose profiles for TURN/coturn, local AI, scheduler/seed; seed sample course/jobs/helpers; Render blueprint; graceful shutdown; restart test.                                 | `pnpm test:compose`; restart mid-chat; offline image restart.                              | Clean machine demo under 5 minutes; no state only in memory. |
| NFR-COST-05, NFR-COST-06                 | `scripts/usage.mjs` (`pnpm usage`): DB size, largest tables, session/message counts, 600 MB warning; cron (retention 06:00, alerts 07:30) and keepwarm (05:00–16:50) workflows. | Usage output matches `pg_database_size`; workflow window lint.                             | Runs on seed data; never around the clock.                   |
| NFR-PRIV-05/08/09                        | Retention includes help images/subscriptions/answer cache; `docs/PRIVACY.md` assembled by C from translated copy supplied by D; end-of-event deletion script; log scan.         | Fake-clock retention; log scan with text/phone/Telegram fixtures; deletion script dry run. | Deletes within one minute; no PII in logs.                   |
| FR-INT-05, FR-INT-10, NFR-ADOPT-01/02    | `docs/INTEGRATION.md` Levels 1–3; `examples/embed-level1.html`, `examples/api-level2.http`, LTI example; version/CHANGELOG; README timed under 20 minutes.                      | Each example runs; outsider trial notes.                                                   | A stranger installs with no help.                            |
| CI                                       | Add a11y (B's script), eval (A), Compose e2e, contrast, coverage, audit, secret scan. Add root scripts `eval`, `a11y`, `usage`, `seed`.                                         | CI green on the integration branch.                                                        | Final gate commands all run from root.                       |
| NFR-SEC/PERF                             | CORS/frame limits, upload checks, brute-force limits, p95 300 ms non-AI load test, HTTPS/HSTS config.                                                                           | Negative-origin test; upload test; k6 or equivalent.                                       | All security/perf acceptance evidence attached.              |

### 6.4 Handoff contract

C provides:

- Frozen OpenAPI + zod schemas + local mocks/stubs for B.
- Postgres stores/migrations for conversation signals, feedback, cache,
  subscriptions, accommodation, insights, images, consent.
- TURN/ICE credentials endpoint and WS signalling.
- Webhook/LTI endpoints and secrets configuration.
- CI scripts and root scripts; docs and examples.

C consumes:

- A: `AskDependencies`, cache port, job passage converter, eval output.
- B: widget build entries/pages, a11y script, embed behavior.
- D: SMS router/gateway, jobs parser/runner, insights aggregator, locale data.

### 6.5 Definition of done

- Every blueprint section 7 path exists and is contract-tested.
- Help share, Telegram, LTI, SMS inbound, jobs, accommodation, insights, and
  deletion work end to end against real Postgres.
- `pnpm test:compose`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm audit`
  pass; CI includes all gate jobs.
- README/INTEGRATION/PRIVACY/COST/FREE_TIER/GATE docs are complete.

### 6.6 Start now (stubs are allowed)

1. OpenAPI/schema scaffolding and contract tests for all missing paths.
2. Feedback, availability, and image upload with in-memory stores.
3. Jobs/subscriptions/accommodation routes against D's parser interfaces.
4. Telegram/LTI package skeletons with fixture transports.
5. Render/Compose/CI/cron scaffolding and usage script.

---

## 7. Workstream D — Language, SMS, Jobs & Insights Services

### 7.1 Charter

Own all language data and the domain libraries for SMS, jobs, and insights.
Review every user-facing string. Do not edit API, widget, engine, or infra.

### 7.2 Remaining requirements

`FR-LANG-04`, `FR-LANG-05` (verify), `FR-LANG-09`–`FR-LANG-13`,
`FR-LANG-15` (optional), `FR-LANG-17`; `FR-SMS-01`–`FR-SMS-11`;
`FR-VOICE-01`, `FR-VOICE-10`; `FR-CONV-05`/`FR-CONV-07` word lists;
`FR-TUTOR-08` prompt files, `FR-TUTOR-10` questions; `FR-JOB-01`–`FR-JOB-11`
(domain logic); `FR-INSIGHT-01`, `FR-INSIGHT-02` (aggregates; C owns the
route/access and B owns the page);
`NFR-A11Y-07`; `NFR-PRIV-01`, `NFR-PRIV-02`.

### 7.3 Work items

#### P0 — packs that make the app truthful

| ID                         | Deliverable                                                                                                                                                                            | Tests first                                                                         | Acceptance                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| FR-LANG-09, FR-LANG-10     | `en` moves to live with `reviewed_by`/`reviewed_on`; `am`/`om` move from English scaffold to reviewed beta/live; `ar-test` stays CI-only pseudo-RTL.                                   | `pnpm lang:check` broken-pack test; status gating tests.                            | No live pack has missing keys, empty glossary/checks, or unreviewed text. |
| FR-LANG-11                 | 200-term glossaries per live language with `id,en,am,om,simple_definition,do_not_translate`; native-speaker review.                                                                    | Checker count; sample prompt injection test.                                        | ≥200 reviewed terms each.                                                 |
| FR-LANG-12, FR-LANG-17     | Ethiopian/Gregorian date and number formatter data; display text never normalised.                                                                                                     | 14 Nov 2026 → ህዳር 5 2019 with Gregorian in brackets; stored text equals shown text. | Verified on a target Android phone.                                       |
| FR-TUTOR-08, FR-CONV-05/07 | Complete `prompts.yaml` system rules, escalation, distress, small-talk lists for every live language; distress reviewed by co-designer; verified emergency text only from host config. | Prompt lint; phrase lists; no `TODO`.                                               | A's rule tests pass against real packs.                                   |
| FR-AI-04, FR-UI-16         | 30 FAQ Q/A per live language with source links; used by offline adapter and offline FAQ route.                                                                                         | FAQ count; 70% English hit test; offline route test.                                | A/B acceptance pass.                                                      |
| FR-TUTOR-10                | 10 evaluation questions per live language, including homophone letters and apostrophe variants.                                                                                        | Count and schema; A's eval run.                                                     | 30 total; per-language report.                                            |

#### P0/P1 — locale tooling

| ID                     | Deliverable                                                                                                                                                                         | Tests first                                              | Acceptance                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| FR-LANG-04, FR-LANG-05 | ICU MessageFormat validation and plural tests en/am/om; fallback-chain test om→am→en with once-per-session notice.                                                                  | Malformed message; plural; deleted key.                  | Checker fails malformed; fallback notice works. |
| FR-LANG-13             | `pnpm lang:new <code>` scaffolder copying all files/keys as draft; `docs/ADD_A_LANGUAGE.md` ten steps.                                                                              | Scaffold a test pack; checker passes as draft in <5 min. | Live add-a-language demo works.                 |
| FR-LANG-15 (cut)       | Optional Latin→Ge'ez transliteration data/helper contract for B.                                                                                                                    | `selam` → `ሰላም` proposal, learner confirms.              | Only if time remains.                           |
| FR-SMS-03, FR-SMS-04   | `countSms` and `fitToBudget`: GSM-7 160/153, UCS-2 70/67, Amharic → UCS-2, 71 chars → 2 segments, English 161 → 2, sentence-boundary shortening to 3 segments + "Reply 1 for more". | 160/161/70/71 tests; Amharic; long answer.               | Exact counts and localized suffix.              |

#### P0 — SMS service

| ID                                         | Deliverable                                                                                                         | Tests first                                                       | Acceptance                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| FR-SMS-01, FR-SMS-11                       | `SmsGateway` interface, simulator implementation, status/retry, docs/SMS_GATEWAY.md.                                | Contract tests for simulator; failure injection.                  | C's inbound route uses the same interface. |
| FR-SMS-05, FR-SMS-06, FR-SMS-07, FR-SMS-08 | Numeric language menu; multilingual/Latin/case/accent-insensitive keywords; STOP permanent; call-back only after Y. | Table-driven keyword test; STOP then alert sends nothing; Y gate. | All keywords work in every live language.  |
| FR-SMS-09, FR-SMS-10                       | 20/day outbound limit with digest batching; hashed session numbers, encrypted consented subscribers.                | 30 alerts → ≤20; DB inspection.                                   | No plaintext numbers.                      |

#### P1 — jobs and insights domain

| ID                           | Deliverable                                                                                                                                                                                                | Tests first                                                                            | Acceptance                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| FR-JOB-01–FR-JOB-11          | `packages/jobs`: subscription state machine, consent log, `parseJobPosting`, alert runner (idempotent/dry-run), matching/filter, accommodation draft/approve payload, Ethiopian formatter, glossary terms. | Flow state; stop; duplicate run sends nothing; no diagnosis field; relay without name. | C/B can wire endpoints/UI without domain code.       |
| FR-INSIGHT-01, FR-INSIGHT-02 | `packages/insights`: topic key from citation lesson/section; counts by lang/period; notfound; `<5` → Other; CSV rows; no text/session.                                                                     | Seed aggregate; small-count grouping; CSV; DB export scan.                             | Aggregates are anonymous; B renders them accessibly. |

#### P1 — voice review

| ID                       | Deliverable                                                                                                                                                 | Tests first                              | Acceptance                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| FR-VOICE-01, FR-VOICE-10 | `docs/VOICE_TEST.md`: 10 sentences × language × engine on a real mid-range Android; decision rule 8/10; `voice.yaml` matches; Afaan Oromoo beta label data. | Manual table review; `voice.yaml` check. | B can enable only languages/engines that passed. |

### 7.4 Handoff contract

D provides:

- Packs: every UI key, prompts, glossary, FAQ, checks, SMS keywords, voice
  status.
- `SmsGateway`, `countSms`, `fitToBudget`, keyword router.
- `parseJobPosting`, subscription/alert runner, accommodation payload,
  Ethiopian formatter.
- `aggregateInsights` and CSV rows.
- Translated privacy copy for C's `docs/PRIVACY.md` assembly.
- `docs/ADD_A_LANGUAGE.md`, `docs/VOICE_TEST.md`, `docs/SMS_GATEWAY.md`.

D consumes:

- B/C: key requests with English values and ICU variables.
- A: eval result requirements and FAQ usage.
- C: endpoint field names for subscriptions/accommodation/insights.

### 7.5 Definition of done

- `pnpm lang:check` passes; live packs have 200 terms, 30 FAQs, 10 checks,
  reviewed metadata.
- `docs/VOICE_TEST.md` matches `voice.yaml`; distress lists reviewed.
- SMS simulator contract and segment tests pass.
- Jobs/insights libraries pass their tests; C/B integrations green.

### 7.6 Start now

1. English pack: glossaries, FAQ, checks, prompts, reviewed metadata.
2. `lang:new` and ICU/SMS segment utilities with tests.
3. SMS gateway contract and simulator with keyword/segment tests.
4. Jobs/insights libraries with fixture data.
5. Voice test protocol and sentence list.

---

## 8. Dependency map and integration checkpoints

```text
A Core:      rules ── eval ── providers/cache ── job passages
                  │          │
B Experience:  offline/consent ── share/voice ── flows/pages/a11y
                  │          │              │
C Connect:   contracts ── help/share/feedback ── channels/jobs/LTI ── infra
                  │          │              │
D Language:  packs/glossary/FAQ/checks ── SMS ── jobs/insights libs ── voice test
```

The arrows are data/contract handoffs, not blocking starts. Every stream has a
P0 item that needs no other stream.

### Checkpoint 0 — contract freeze (first block, 2–3 hours)

- C publishes additive OpenAPI/schema list and stub routes.
- D publishes the key request format and starts `en`.
- A publishes `AskDependencies` additions and eval report schema.
- B publishes the screen list, WS client frames, and a11y script shape.
- All owners record their planned additions in `docs/notes/<stream>.md`; C
  merges into `DECISIONS.md`.

### Checkpoint 1 — core vertical slice

- A: en question → cited answer → notfound → escalation.
- B: chat → help preview → request → waiting; offline/consent states.
- C: session/ask/help/feedback/availability wired to Postgres.
- D: en pack usable (UI keys, prompts, FAQ, checks); am/om draft.

Exit: the co-designer can ask, get a cited answer, ask out of course, and reach
a person, in English, with axe zero critical/serious.

### Checkpoint 2 — help and voice

- B/C: share consent, banner, one-action stop, picture fallback, ICE endpoint.
- B/D: voice adapters and `voice.yaml`; read-aloud; Afaan Oromoo beta label.
- C: retention for images/subscriptions; helper queue metrics.
- A: language guard and cross-language note in am/om.

Exit: Amharic text and voice question, cited answer, help chat, share stop.

### Checkpoint 3 — channels and career

- C: Telegram commands/voice notes, SMS inbound, jobs/subscriptions/
  accommodation, LTI, insights route, data delete.
- B: job flows, SMS simulator, insights page, feedback/delete UI.
- D: SMS keywords/segments, jobs/insights libs, 200-term glossaries/FAQs/checks.

Exit: Telegram question, SMS simulator exchange, job alert create/stop,
accommodation draft/approve, teacher insights.

### Checkpoint 4 — gate and freeze

- B: `pnpm a11y` matrix and `WCAG_REPORT.md`.
- A: `pnpm eval` and `EVAL.md` targets.
- C: Compose e2e, Render/cron, README/INTEGRATION/PRIVACY/COST/FREE_TIER,
  `pnpm usage`, gate checklist.
- D: reviewed packs, voice test doc, add-a-language demo.
- All: gate G1–G13 rehearsal; fix only gate failures after code freeze.

---

## 9. Verification gates

Run from the repository root before marking a stream complete:

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm lang:check
pnpm build
pnpm size
pnpm test:widget
pnpm a11y
pnpm eval
pnpm test:compose
pnpm audit --audit-level high
```

Environment notes:

- `pnpm test` skips PostgreSQL integration without `DIMTS_TEST_DATABASE_URL`.
  C must run it against a real database before claiming API completion.
- Docker/Compose must be verified on a machine where the Linux engine is
  running; the current environment could not confirm it.
- `pnpm format:check` has two pre-existing untouched files noted in
  `DECISIONS.md`; do not broaden that diff, but do not add new failures.
- Browser tests require a built widget and may need a local browser install.

Per-stream minimum evidence:

| Stream | Evidence                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------- |
| A      | Unit tests for rules/langcheck/cache; `pnpm eval` report; provider kill tests; `EVAL.md`.             |
| B      | Playwright flows, axe matrix, size gate, `WCAG_REPORT.md`, manual protocol log.                       |
| C      | Supertest contract tests, Postgres integration, WS two-client tests, Compose e2e, audit, log scan.    |
| D      | `lang:check`, SMS segment/keyword tests, pack review metadata, jobs/insights tests, voice test table. |

---

## 10. Cut line and risk

Order of cutting, from blueprint section 18.4 (never cut a MUST or the gate):

1. FR-INSIGHT.
2. FR-LANG-15 transliteration.
3. FR-VOICE-11 audio cache (already removed by D14).
4. FR-SIMPLE-02 extras.
5. FR-JOB-06 Support-I-need filter.
6. Afaan Oromoo voice.
7. FR-AI-08 answer cache.

If time collapses, protect the vertical slice:

1. English text question → cited answer → notfound → Help me now.
2. Accessibility on that slice.
3. Amharic text and voice; Afaan Oromoo text.
4. Helper chat and picture fallback, then screen share.
5. Telegram and SMS simulator.
6. Jobs and accommodation.
7. Integration L2/L3 hardening.
8. Edge features.

Top risks and owners:

| Risk                                       | Mitigation                                                                       | Owner |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ----- |
| Unreviewed am/om copy ships                | Keep `draft`/`beta`; `lang:check`; native review; no live claim without metadata | D     |
| Contract drift across four streams         | One OpenAPI owner; stub-first; checkpoint 0; additive-only rule                  | C     |
| Help share captures before consent         | Fake-media tests; no capture before `share.accept`; one-action stop              | B/C   |
| Empty FAQ/glossary blocks offline and eval | D starts en data immediately; A/B use fixtures until ready                       | D     |
| Compose/Render not verified                | C runs clean-machine and offline-image trials early                              | C     |
| Widget grows over 60 KB                    | Keep voice/help lazy; size gate on every change                                  | B     |
| PostgreSQL tests skipped locally           | C runs with a real test database in CI and before freeze                         | C     |
| Four streams edit shared files             | Exclusive path table; C merges DECISIONS/root manifests                          | All   |

---

## 11. First-day checklist per owner

### A — Core

- [ ] Write the rule/langcheck/cache interfaces and failing tests.
- [ ] Add `packages/eval` (or grounding eval CLI) with fixture questions.
- [ ] Convert a fixture JobPosting to a passage; add citation test.
- [ ] Post the `AskDependencies` additions to C and the key needs to D.
- [ ] Record requirement IDs and planned evidence in `docs/notes/core.md`.

### B — Experience

- [ ] Add failing Playwright tests for offline FAQ, waking/working, consent
      notice, and share decline.
- [ ] Define the screen list and a11y matrix; stub `/sim/sms` and insights.
- [ ] Send the UI key request list to D.
- [ ] Confirm WS frames with C (`share.*`, `rtc.*`) and FAQ endpoint shape.
- [ ] Record planned evidence in `docs/notes/experience.md`.

### C — Connect

- [ ] Publish the additive OpenAPI/schema list and contract tests.
- [ ] Add stub routes for feedback/availability/image/jobs/subscriptions/
      accommodation/insights/delete/telegram/sms/lti/internal.
- [ ] Add `GET /v1/locales/{code}/faq` and `GET /v1/help/availability` after
      DECISIONS approval.
- [ ] Scaffold Render/Compose profiles, cron/keepwarm, usage script.
- [ ] Record contract decisions and start the DECISIONS merge log.

### D — Language

- [ ] Replace the empty `en` glossary/FAQ/checks with reviewed drafts and 10
      eval questions per language.
- [ ] Complete `prompts.yaml` escalation/distress/small-talk lists.
- [ ] Add `lang:new` and `countSms`/`fitToBudget` failing tests.
- [ ] Implement the SMS gateway contract and keyword router tests.
- [ ] Start `packages/jobs` and `packages/insights` fixture tests.

---

## 12. Definition of overall completion

This plan is complete when:

- Every MUST in the SRS has automated coverage and a verified acceptance entry.
- `pnpm lint`, `typecheck`, `test`, `a11y`, `lang:check`, `eval`, `size`, and
  `test:compose` pass on the final commit.
- `WCAG_REPORT.md`, `EVAL.md`, `VOICE_TEST.md`, `PRIVACY.md`,
  `INTEGRATION.md`, `COST.md`, `FREE_TIER.md`, and `GATE_CHECKLIST.md` are
  current and linked.
- Amharic and Afaan Oromoo have reviewed metadata, 200-term glossaries, 30
  FAQs, 10 checks, and reviewed distress lists.
- Gate G1–G13 is rehearsed and signed by the co-designer.
- `DECISIONS.md` records every deviation, contract addition, and staffing
  change with affected requirement IDs.



Then as New Feature


Accessibility personalization suite
Go beyond “passes WCAG” into “made for me.”

Saved accessibility profiles: screen reader, low vision, dyslexia, Deaf, motor, cognitive load.
Easy-read versions of course content, generated and then human-approved.
Sign-language video library for key concepts — not fake AI avatars.
AAC, switch access and eye-gaze support.
Captions and transcripts for every audio or video item.
Dyslexia-friendly typography and spacing.
A public accessibility conformance report (VPAT/ACR).
A standing co-design council of disabled learners, paid for their time.



 Learning Coach and Outcome Analytics
Turn learner questions into learning outcomes and institutional evidence.

Practice quizzes, flashcards, spaced repetition and study plans generated only from course content.
“Explain at my level” — same concept at three reading levels.
Content-gap detection: what learners ask that the course does not answer.
Confusion heatmaps by lesson, language and cohort.
Outcome dashboards: completion, retention, support deflection, job placement, cost per outcome.
Privacy-preserving aggregates; no names, no question text in teacher views.
Impact reports for funders and accreditation bodies.
Why it wins: institutions do not buy “AI.” They buy retention, completion, support savings, compliance evidence and employability. This is the ROI story.

Platform: make it adoptable, sellable and scalable
11. Connector Hub and self-serve onboarding
Make integration take minutes, not a sales call.

One-click connectors: Moodle, Canvas, Google Drive, Notion, Confluence, SharePoint, PDFs, video transcripts, job feeds, ATS systems.
Public website: paste an approved sitemap URL, preview the pages, approve, publish.
Source preview, diff, rollback and generation history.
A connector SDK so partners can build their own.
React, Flutter, WordPress and Moodle plugins.
PWA install and QR onboarding.
Why it wins: adoption is a scoring criterion and a revenue prerequisite. If a stranger cannot install it in under an hour, the product is not real.