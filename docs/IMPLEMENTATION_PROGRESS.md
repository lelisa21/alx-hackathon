# Implementation progress

Updated: 13 November 2026. Current branch: `phase-07-prompt`.

## P07 — implemented increment; acceptance blocked

The user reported P06 committed/pushed and authorized P07 only on their clean
branch. No commit/push. Read P07's original prompt and authoritative SMS/privacy
contracts; requirements quoted before implementation: FR-SMS-01–12,
FR-LANG-12/17 and related privacy. Decisions are recorded before implementation
in `DECISIONS.md`. Tests preceded encoding, gateway, persistence, API and UI code.

Implemented canonical SMS counting/normalization, simulator/optional HTTP
gateway ports, encrypted conversation/replay state, permanent priority STOP,
callback-Y consent, bounded continuation, shared daily limits and P06 alert
subscription integration. `/sim/sms` is a separate localized, accessible entry;
credentials, phone and thread stay in page memory. No real operator is claimed.

Verified automated evidence:

- **FR-SMS-01/03/04/06/11/12:** 16 encoding/pagination, 8 gateway and 23 domain
  cases pass, including all locale keywords, three-segment bounds, two retries,
  replay and transient tutor/callback/subscription recovery. The documented
  oversized-sentence fallback is a policy interpretation requiring review;
  strict sentence-boundary acceptance is not claimed for that edge case.
- **FR-SMS-05/07/08/09/10:** 6 SMS PostgreSQL and 5 real API/HTTP cases pass:
  encrypted/hash-only persistence, priority/permanent STOP, consent, shared
  budgets, P06 delivery, restart recovery and expiry. All 10 P06 database cases
  pass. The SMS inbound boundary has 18 cases; runtime wiring has 4.
- Full Vitest run: **708/710 passed**. Both existing P02 timing failures pass
  in an isolated rerun without threshold changes (cached p95 **27 ms**, offline
  **62 ms**). The subsequently added container dependency-closure test and
  8 preview-route tests pass separately: **719 unique cases verified across
  these runs**, not a claim of a clean single full-suite run.
- **FR-SMS-02:** All **135 functional browser cases** pass across the full run
  and targeted recovery runs. The 8 P07 cases include the real browser/API/
  PostgreSQL/P06 exchange, keyboard use, 320 px, 200% text, four locale/direction
  cases and axe. Fixed a missing Vite preview route and two test assumptions:
  STOP cascades subscription deletion, and shortcut input must wait for the
  existing asynchronous focus handoff. No production P03 behavior or test
  threshold changed. Artifacts: `p07-final`, `p07-verified`, `p07-final-gates`.
- The separate serial **NFR-PERF-02** gate passes: launcher **2,985.5/3,000 ms**,
  chat ready **5,117.4/6,000 ms**, using the unchanged 400 kbps/400 ms fixture.
  Launcher margin is narrow; this does not replace representative device checks.
- Build, lint, typecheck, locale validation, bundle budgets, changed-file
  formatting and diff checks pass. Initial JS **48,194/61,440 bytes**, simulator
  JS **27,729/61,440**, initial assets **134,907/153,600**. Default and configured
  Compose resolution pass with synthetic values. Docker execution is blocked
  because the Docker Desktop Linux daemon is unavailable.

Native-language/keyword review and physical Android/assistive-technology checks
remain unverified; no locale review flag was promoted. Real operator/callback
delivery requires external credentials and testing; operator contracts are
explicitly outside P07. Current artifacts/logs are under `test-results/p07-*`
and ignored `node_modules/.cache/p07-*`. The isolated PostgreSQL cluster on
port 55432 was stopped and removed after verification.

Stop after P07. P08 requires the user's next instruction and branch.

## P06 — implemented increment; acceptance blocked

The user reported P05 committed/pushed and authorized P06 only on their new,
clean branch. No agent commit or push. Read the complete remaining plan and
P06's original prompt, Blueprint contracts/privacy rules and corresponding SRS
requirements. Quoted before implementation: FR-JOB-01–11, FR-INT-07,
FR-TUTOR-09, FR-SIMPLE-04 and related SMS/Telegram integration/privacy rules.

Tests preceded implementation. Added migration 007 and a durable jobs service,
secret-host import using P02's parser/index contract, authenticated REST/OpenAPI,
encrypted contacts and private drafts, daily alert delivery, a configurable
host HTTP relay and lazy accessible career flows. Contract decisions and
recovery/retention boundaries are recorded in `DECISIONS.md`; exact routes,
configuration and the P07/P08 delivery port are documented in `docs/API.md`.
New locale copy/glossary definitions remain drafts; review status is unchanged.

### Verified P06 evidence

- Full Vitest run: **611/612 passed across 66 files**, no skips; the remaining
  failure is the existing P02 HTTP latency gate below. **30/31 PostgreSQL
  cases** pass, including **9 new domain cases**
  and **3 real HTTP/host-relay cases**. P06's four domain unit tests, REST/Zod
  tests, three widget unit tests and twelve locale tests pass. Tests caught and
  fixed UTC date handling, immutable retries, and the crash window between host
  acceptance and SQL receipt commit. A separate forced SQL-failure test proves
  delivery identity survives restart; concurrent Stop erases contact and blocks
  subsequent sends. Import rollback preserves existing course generations.
- Browser regression: **123/127** passed initially. The new Careers button
  displaced Help in the keyboard sequence; moved it after Help without changing
  the existing assertion. A serial rerun passed all **13 P06 flow cases** plus
  the Help, offline FAQ and shortcut cases (**16/17**). Replacing intercepted
  HTML with a real HTTP host fixed the live fixture's language-fetch failure;
  scoping its duplicate success text to the status region fixed its locator.
  The real browser/API/PostgreSQL/HTTP-relay case then passed (**1/1**), proving
  alert consent, encrypted contact, delivery/Stop and anonymous approved relay.
  All **127 functional cases** have passing evidence across the full run and
  focused reruns. Four-locale/pseudo-RTL, 320px, 200% text, keyboard, axe, voice
  review, private filtering, safe reload, exact approval and uncertain-send
  recovery pass. Artifacts: `test-results/p06-final`, `p06-regressions` and
  `p06-live-verified`. Browser mocks and synthetic delivery do not prove real
  provider delivery or assistive-technology usability.
- Build, typecheck, lint, locale validation, changed-file Prettier, normal
  `git diff --check` and default/configured Compose resolution pass. Compose
  used synthetic environment values; no deployment was performed. Initial JS
  is **47,700 / 61,440 bytes**, helper **33,159 / 61,440**, deferred **17,067**,
  initial assets **133,856 / 153,600** after the final button-order rebuild.
  No external dependency was added.

### P06 acceptance still open

- P02 cached HTTP p95 measured **56 ms** in the full suite and **94 ms** in an
  isolated rerun, above the unchanged **50 ms** gate. A temporary diagnostic
  using the committed API implementation also failed at **54 ms**; it was
  removed. This supports a local timing concern but does not prove P06 meets
  the performance requirement. No threshold or assertion was relaxed.
- Serial startup benchmark failed: launcher **9,964 / 3,000 ms**, chat ready
  **12,064 / 6,000 ms**. The artifact shows multi-second gaps between static
  requests despite correctly paced response bodies. Performance remains
  unverified; reproduce on an idle representative runner and investigate
  before release. Artifacts: `test-results/p06-performance` and ignored
  `node_modules/.cache/p06-vitest-final.log`.

Acceptance still requires a configured production host relay and real
delivery credentials, native-language/co-designer review and physical assistive
technology/device checks. The local HTTP relay uses synthetic data and proves
the protocol, not real SMS/Telegram delivery. Native adapters are P07/P08;
system-wide data deletion and release gates remain P11. The temporary diagnostic
files were removed; the isolated PostgreSQL cluster is stopped and removed after
verification. Stop after P06; do not start P07 without the user's instruction.

## P05 — implemented increment; acceptance blocked

The user reported P04 committed/pushed and authorized P05 only on their new,
clean `phase-05-prompt` branch. No agent commit or push. Read the original P05
prompt, Blueprint help contracts, corresponding SRS requirements and existing
help code/tests. Requirements quoted before implementation: FR-HELP-04–19,
FR-HELP-01–03 regression, and help-related NFR-SEC, NFR-REL and NFR-PRIV.

Tests preceded changes. API/WS/media, learner/helper browser and locale tests
cover the new behavior. The user delegated the unspecified fallback decision:
leave a message in the existing help request during waiting, after timeout or
outside hours. No callback/contact storage or imaginary Telegram destination.
API/client agreements are recorded in `DECISIONS.md` before implementation.

Implemented schedule/timeout handling, optional helper name and sound,
anonymous outcomes, authorized signaling and local consent-controlled media,
database pictures with validation/expiry, anonymous consent records, and cleanup.
The new `sharp` dependency validates complete images and removes metadata;
the existing help package is now a local widget dependency. Existing tutor,
voice, embedding, offline, queue, claim, block and replay behavior is preserved.

### Verified P05 evidence

- `pnpm exec vitest run --maxWorkers=1`: **572 tests / 60 files passed**,
  no skips, including **19 PostgreSQL integration cases** and **28 WebSocket
  tests**. A subsequent media-file run passed **7/7**, adding a regression for
  empty Compose TURN defaults (six cases overlap the full run). The earlier
  run exposed a missing method in the test harness; corrected before the
  final full pass. The isolated PostgreSQL 18 cluster was stopped and removed.
- Real PostgreSQL/HTTP/WS flow verifies waiting-message persistence, summary
  opt-out, claim, replay, name opt-in/removal, consent metadata, image access
  and end cleanup. Database tests cover concurrent claims, the five-per-hour
  limit, expiry, session cascade and anonymous outcome durability. The real
  flow caught retained chat rows; close now atomically deletes messages/images
  and clears the summary. Controller tests **7/7** cover consent, bounded
  async cancellation, 5 fps/300 kbps limits, quality reduction and track cleanup.
- Browser regression: **111/113** passed initially. Updated the existing
  shortcut-copy assertion for Alt+Shift+S and used one click for the voice
  recovery test whose expected consent state is unchecked; both passed their
  focused rerun. All **113 functional/accessibility cases** have passing
  evidence, including **12 new P05 cases**. The en/am/om/ar-test widget matrix,
  helper axe/keyboard checks, native canvas-track stops, unavailable capture,
  image expiry during API failure, replay and optional name/sound pass.
  Browser API doubles and synthetic video do not prove physical-device sharing.
- Separate serial startup benchmark passed: launcher **2,266 / 3,000 ms**,
  chat ready **4,135 / 6,000 ms** under the existing real gzip-response
  400 kbps/400 ms fixture. This adds one browser case (**114 total**).
  Reproduce with `pnpm exec playwright test --config playwright.widget.config.ts
packages/widget/e2e/embed-performance.spec.ts --workers=1`; the functional
  run uses `--workers=2 --grep-invert NFR-PERF-02`. Artifacts are under
  `test-results/p05-final`, `p05-regressions` and `p05-performance`.
- Build, typecheck, lint, `lang:check`, size, changed-file Prettier and
  `git diff --check` pass. Final compressed initial JS **45,996 / 61,440 bytes**,
  helper **33,159 / 61,440**, deferred **11,097**, initial assets
  **130,986 / 153,600**. The isolated full-suite P02 HTTP cached p95 was
  **37 ms** and offline p95 **11 ms**, ten samples each. Whole-repository
  formatting still flags **80 unchanged baseline files**. Compose default and
  configured help/TURN forwarding passed CLI resolution with synthetic values.

### P05 acceptance still open

- No configured Metered account/credential or real TURN call was available.
  Real browser permission/capture, restrictive-network and readable 3G sharing,
  physical stop latency, NVDA/TalkBack, native-language/co-designer review and
  deployment retention remain unverified. Draft translations were not promoted.
- Expired images are inaccessible at two hours. The running API sweeps physical
  database rows every 60 seconds, so deletion may lag by one minute; an offline
  API cannot run that sweep. This is a documented strict-retention limitation,
  not an unconditional two-hour deletion claim. Close/session cleanup is
  verified. P11 must verify deployment scheduling and the complete privacy gate.
- Docker configuration passed; container execution was blocked by the absent
  Docker daemon. No coturn path was selected; P11 owns its optional local
  Compose profile. Production uses Metered/public STUN with picture/text fallback.

See `docs/HELP.md` for the test protocol and `docs/PRIVACY.md` for the scoped
help privacy notes. Preserve inherited P01–P04 review/device gates. Stop before
P06; the user will review, commit, push and explicitly authorize the next phase.

## Historical P04 record

## P04 — implemented increment; acceptance blocked

The user reported P03 committed/pushed and authorized P04 only on their
already-created branch, which started clean. No agent commit or push.
Read P04's original prompt, Blueprint 10.3, the voice SRS requirements and
the existing adapters, widget, API and evidence records. Requirements quoted
before implementation: **FR-VOICE-01–10/12, FR-UI-06, FR-LANG-05,
NFR-A11Y-07**. FR-VOICE-11 audio caching remains removed.

Implemented configured on-device browser recognition/synthesis, reviewed
capability publication, cancellation/timeouts, editable review and playback,
localized states, and the voice Beta explanation. Decisions and the additive
language-catalog declaration are in `DECISIONS.md`; no server engine/audio
endpoint is selected. Text remains the complete fallback.

Tests preceded changes, with failing tests observed before implementation.
Browser regressions also verified cancellation when hidden/closed and restored
disabled-select contrast. Existing host adapters, session recovery, text input,
offline behavior and lazy voice loading remain covered.

### Verified P04 evidence

- **Voice behavior:** 43 adapter tests cover local-only capability checks,
  explicit recording, confidence/review handling, stop/cancel, stale callbacks,
  bounded timeouts and local TTS playback. 36 API tests cover configured,
  reviewed, language/script-matching capabilities, with draft packs disabled.
  Two Compose tests cover selector defaults/forwarding. Locale tests require
  the new copy and keep unreviewed voice disabled.
- **Full regression:** `pnpm exec vitest run --maxWorkers=1` ran 528 tests
  across 54 files: 527 passed; the existing P02 cached-response benchmark
  failed at 91 ms p95 against its 50 ms budget while other checks ran.
  With competing jobs finished, the complete P02 PostgreSQL integration file
  passed **5/5**, including that benchmark: cached p95 **17 ms**, offline
  p95 **95 ms**, ten samples each. The other 15 PostgreSQL cases passed in
  the full run. All 528 cases therefore have passing evidence, but the full
  suite invocation itself exited with a failure. The isolated PostgreSQL 18
  cluster on port 55432 was stopped and removed afterward.
- **Browser/accessibility:** **101/101** functional and accessibility tests
  passed with `pnpm exec playwright test --config playwright.widget.config.ts
--workers=2 --grep-invert NFR-PERF-02 --output=test-results/p04-final`.
  Includes eight new native-API-double voice scenarios, editable confirmation,
  explicit sending, unavailable capabilities, language/session/close cleanup,
  localized Beta copy, playback and voice-review axe checks. The inherited
  en/am/om/ar-test, theme, viewport, 200%-text, keyboard, embed and offline
  regressions pass. These doubles do not verify real speech intelligibility.
- **Startup:** the separate serial `embed-performance.spec.ts` passed:
  launcher **2,474 ms / 3,000 ms**, chat ready **4,892 ms / 6,000 ms**.
  Same cold Chromium fixture as P03: shared 400 kbps gzip-body link,
  400 ms minimum first-byte delay, worker requests included, cache disabled.
  Evidence is generated under `test-results/p04-performance/`; total browser
  coverage is **102 passed** across the functional and separate timing runs.
- **Build/static:** `pnpm build`, `pnpm typecheck`, `pnpm lint`,
  `pnpm lang:check`, `pnpm size`, changed-file Prettier and `git diff --check`
  pass. Compressed initial JS **44,769 / 61,440 bytes**; helper
  **27,500 / 61,440**; deferred voice/help **6,395**; total initial assets
  **128,578 / 153,600**. No dependencies added or frozen pages/assets changed.
  Repository-wide `pnpm format:check` reports **90 untouched baseline files**;
  no changed-file warning remains. Docker Compose configuration resolves all
  four none/browser selector combinations; container execution is unverified.

### P04 acceptance still open

Physical Android eight-of-ten STT/TTS results, native-speaker/co-designer
review, TalkBack/NVDA and an Ethiopic Read-aloud alternative remain unverified.
All shipped voice flags and engine declarations remain disabled. The fixed
draft corpus and result protocol are in `docs/VOICE_TEST.md`. FR-VOICE-01 and
NFR-A11Y-07 are not complete; automated behavior coverage does not replace
these human/device acceptance gates. Locale copy remains unreviewed.

P08 must account for the current browser-only scope: Telegram audio requires
a selected server engine, explicit data policy and endpoint contract. Existing
question/passage consent does not authorize audio transmission. No server
voice credentials were needed or tested. Docker runtime verification remains
unavailable because its daemon is unavailable; preserve inherited P03
device/review gates.

Stop after P04; wait for the user's review/commit/push and explicit P05 instruction.

## Historical P03 record

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
