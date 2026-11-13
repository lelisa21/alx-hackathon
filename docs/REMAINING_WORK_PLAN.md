# Dimts remaining implementation prompts

Status: consolidated implementation brief
Date: 12 November 2026  
Authority: `Dimts-System-Blueprint-v2.0.md` (architecture revision 2.1), then
the authoritative brief; the SRS supplies requirement IDs and acceptance
criteria where the blueprint has not superseded it. Record decisions and
contract changes in `DECISIONS.md`.

This document replaces the former four-workstream organization. It is a set of
independently copyable, end-to-end implementation prompts, ordered by genuine
technical prerequisites. It does not authorize implementation of the three
un-numbered product proposals in the core event scope; those proposals are
preserved as clearly marked follow-on prompts below.

## Repository context verified for these prompts

- This is a pnpm TypeScript monorepo (Node.js >=22.18, pnpm >=10.12) with
  Express 5, Zod/OpenAPI, PostgreSQL and SQL migrations, Vitest, Supertest,
  Playwright, Lit, and Vite. Root commands and package boundaries are in
  `package.json` and `pnpm-workspace.yaml`.
- `packages/engine` owns channel-neutral conversation behavior;
  `packages/grounding` owns ingestion, retrieval, citations, and source
  synchronization; `packages/ai` owns provider adapters and routing;
  `packages/api` owns the HTTP/WebSocket boundary and PostgreSQL adapters;
  `packages/widget` is the Lit custom element and helper console;
  `packages/voice` contains voice ports; locale data and tooling live in
  `locales/` and `packages/locales-tools`.
- The existing API implements health, languages, locale UI, sessions, ask,
  helper login/queue/block/claim/close, and internal retention. Extend its
  routes, schemas, repository interfaces, migrations, tests, and generated
  OpenAPI; do not create a second server or bypass the existing auth model.
- Existing foundations to preserve include locale loading/fallback and draft
  gating; pseudonymous bearer/resume sessions and ask idempotency; answer
  schema/citation checks, per-question language detection, the provider
  registry/ladder, in-memory answer cache, PostgreSQL trigram retrieval,
  public sitemap and host-owned source synchronization with atomic
  generations, JobPosting-to-passage parsing, widget chat/settings/service
  worker, and helper chat relay.
- `packages/sms`, `packages/telegram`, `packages/lti`, `packages/jobs`, and
  `packages/insights` currently have empty entry points. The existing voice
  package has ports but not production voice engines or server routes. Locale
  packs remain incomplete; `en` is beta, `am`/`om` are draft scaffolds, and
  their FAQs are empty. The frozen Savanna captures in `pages/` and their
  shared files in `assets/` are reference-only and must not be changed.
- The previous plan's status table is not an authoritative inventory of
  current code. Inspect the named code and tests before editing, preserve
  verified behavior, and avoid rebuilding a working foundation merely because
  the old plan called it incomplete.

## Execution order and dependencies

| Order | Prompt | Genuine prerequisite |
|---|---|---|
| 1 | P01 — Language packs and locale tooling | None |
| 2 | P02 — Grounded tutor, providers, and evaluation | P01 data can be developed concurrently with fixtures, but reviewed packs are required for final language acceptance |
| 3 | P03 — Learner widget, offline UX, and embed contract | P01; existing API/session/ask foundations |
| 4 | P04 — Production voice workflows | P01 and P03's widget integration points |
| 5 | P05 — Human help, availability, and screen sharing | P03; existing help request/chat foundations |
| 6 | P06 — Jobs and accommodation gateway | P02 job-passage contract; API/session foundations |
| 7 | P07 — SMS channel and simulator | P01 and P06 career service/notification contract |
| 8 | P08 — Telegram channel | P01, P02, P05 help relay, and P06 career service |
| 9 | P09 — Anonymous feedback and teacher insights | P02 reply/citation semantics and P03 message actions; P10 later adds LTI instructor access |
| 10 | P10 — LTI and REST integration levels | P03 embed contract and P09 insights page; P06 job import contract |
| 11 | P11 — Operations, privacy, security, and release gates | P04–P10 feature contracts; operational scaffolding may start earlier |
| Follow-on | P12 — Accessibility personalization suite | P01 and P03; explicit privacy and co-design decisions below |
| Follow-on | P13 — Learning coach and outcome analytics | P02, P06, P09, and an approved longitudinal-data/consent model |
| Follow-on | P14 — Connector Hub and self-serve onboarding | Existing AR-03–AR-05 source contracts and synchronization pipeline; P10 integration conventions |

The order is a recommendation, not a reinstatement of the old parallel
ownership lanes. Each prompt below contains enough context and acceptance
criteria to be handed to an agent by itself. Dependencies mean that the agent
must integrate with the named completed contract or package; they do not
permit placeholders or leave work in that prompt's scope unfinished.

## Execution prompts

### P01 — Complete language packs and locale tooling

**Copy this prompt as a unit:**

> Implement the complete language-pack and localization-data capability for
> Dimts. Requirements: preserve and regression-test FR-LANG-01–05,
> FR-LANG-09–13, FR-LANG-15–17; FR-CONV-05/07 phrase data; FR-TUTOR-08 prompt data;
> FR-TUTOR-10 evaluation data; FR-AI-04/FR-UI-16 FAQ data; and NFR-A11Y-07
> voice-status data. Preserve existing loader, fallback, preview gating, and
> locale conventions; inspect `packages/locales-tools`, `locales/*`, the
> language tests, `packages/engine`, and the relevant blueprint/SRS
> requirements before editing. Do not read or depend on the former
> four-workstream plan.
>
> Finish all eight pack files (`meta.yaml`, `ui.yaml`, `prompts.yaml`,
> `glossary.yaml`, `sms.yaml`, `voice.yaml`, `faq.yaml`, `checks.yaml`) for
> `en`, `am`, and `om`, including every key required by the actual UI and
> server flows. `en` may be marked live only with real review metadata;
> `am`/`om` may be beta or live only after native-speaker review, otherwise
> keep them draft. Keep `ar-test` CI-only for pseudo-RTL. Never imply that
> unreviewed scaffold English is a reviewed translation. Use polite register,
> consistent glossary terms, straight Afaan Oromoo apostrophes in stored
> content, and accept the specified search variants without changing display
> text.
>
> Supply at least 200 reviewed glossary entries per live language with the
> required fields; 30 sourced FAQ entries per live language; and at least 10
> evaluation questions per language, including Amharic homophone-letter and
> Afaan Oromoo apostrophe variants. Complete system rules, small-talk,
> escalation, and distress phrase lists for every supported language.
> Distress language must be reviewed with the co-designer; emergency/support
> contact values must remain empty unless verified contacts are provided by
> the host. Provide translated strings for every feature, ICU variables and
> plural forms included; no application code should add user-facing literals.
>
> Complete `pnpm lang:check` validation for pack shape, required keys, ICU
> syntax, allowed inline markup, SMS limits, glossary/check counts, review
> metadata, and forbidden TODO text in live lists. Add `pnpm lang:new <code>`
> and `docs/ADD_A_LANGUAGE.md` with the complete ten-step process; a new draft
> pack must pass checks in under five minutes. Complete the om→am→en fallback
> chain and once-per-session announcement behavior, including missing voice
> fallback. Add the Ethiopian/Gregorian date and number formatting data and
> tests; verify 14 November 2026 renders as ህዳር 5 2019 with the Gregorian
> date in brackets on a target Android device. Ensure `locales-tools` meets
> the 70% unit coverage floor. Search normalization must
> never rewrite displayed text.
>
> FR-LANG-15 remains a SHOULD, not an automatic cut: implement a real,
> optional Latin-to-Ge'ez suggestion flow for Amharic, with editable
> suggestions (including `selam` → `ሰላም`), explicit learner confirmation,
> locale data, and tests. Do not silently transliterate or auto-send.
>
> Write tests before changing implementation. All UI copy belongs in locale
> packs; maintain pack-level RTL data and use CSS logical properties in any
> touched UI. Do not log learner text or contact identifiers. Avoid new
> dependencies unless justified in `DECISIONS.md`. Acceptance: `pnpm
> lang:check`, language tests, and typecheck pass; reviewed/live status is
> truthful; counts and date behavior are verified; all pack data is consumed
> by the existing loader without language-specific branches in the core flow.

### P02 — Complete grounded tutor, AI providers, and evaluation

**Copy this prompt as a unit:**

> Complete Dimts' channel-neutral answer pipeline and its provider/evaluation
> contracts. Requirements: FR-CONV-05–08 and FR-CONV-14; regression coverage
> for FR-CONV-09 and FR-CONV-13; FR-TUTOR-07–11 and FR-TUTOR-14; FR-AI-02–10; AR-01,
> AR-06, AR-08; NFR-MAINT-02 and NFR-PRIV-03. P01 supplies the reviewed
> locale rules, glossary, FAQs, and checks for final acceptance. Inspect
> `packages/engine/src/ask.ts`, `types.ts`, `langcheck.ts`, `cache.ts`,
> `packages/ai`, `packages/grounding`, `packages/api/src/engine.ts`,
> `provider-runtime.ts`, existing tests, and the canonical pipeline and ports
> in the blueprint. Preserve the existing source-sync/index implementation
> and do not read or depend on the former four-workstream plan.
>
> Finish pre-provider rule handling for help/person escalation and distress
> from `prompts.yaml`, with no provider call, localized help action, caring
> brief distress response, and no medical/legal advice. Keep small talk in the
> API's existing path and prove it makes zero engine/provider calls. Use
> `ConversationSignals` to offer gentle help after two consecutive notfound
> replies or two negative feedback taps, without weakening citation rules.
> Cover at least five reviewed trigger phrases per live language and at least
> ten injection cases spanning "ignore rules", reveal system prompt, answer
> without sources, and change language; include attacks in job passages and
> glossary entries.
> Wire the signal port to durable, minimal session state: query only the
> recent reply kinds needed for the two-notfound rule, and retain at most a
> resettable negative-feedback streak flag for the active session. Do not
> retain per-tap feedback events or put session identifiers in feedback
> aggregates; settle this storage boundary with P09 and record it in
> `DECISIONS.md`.
> Treat learner questions, passages, glossary material, and JobPosting text
> as untrusted data; protect system rules against the specified injection
> corpus. Validate language output per turn; retry once through a supported
> extractive/language-capable path, then return localized notfound. Do not
> mutate the saved session language. Explain cross-language citations once in
> the reply language and retain source provenance.
>
> Complete the provider-neutral registry/adapter boundary, including the
> configured native adapters required by the blueprint rather than claiming
> that an OpenAI-compatible endpoint supports every vendor. Apply declared
> language, mode, modality, structured-output, privacy class, evaluated
> language, timeout, priority, and allowed-data-class filters. Remote
> providers remain off absent host enablement and the learner's current
> consent; only allowed question/passages data may be transmitted. Validate
> response JSON and citation IDs, retry malformed output once, use bounded
> token/temperature configuration, cooldown failed providers for 60 seconds,
> and degrade to extractive/offline/notfound without leaking provider details
> into learner UI.
> Ship the cloud, local open-model, and offline FAQ adapter profiles behind
> the same conformance contract; use dedicated adapters for configured
> vendor APIs such as OpenAI, Gemini, and xAI/Grok rather than assuming
> protocol compatibility.
> Measure reply p95 from the service boundary against NFR-PERF-03: offline
> <=1 second, local <=15 seconds, and cloud <=6 seconds. Report test
> conditions; do not claim a target where no real adapter is configured.
>
> Complete offline FAQ matching plus top-passage extraction, always cited.
> Meet the >=70% English FAQ hit target on the reviewed FAQ test set and
> report misses honestly. Complete answer-cache behavior using the existing
> engine cache/key and `answer_cache` schema: key by normalized question,
> language, Simple flag, and content version; provide an API/Postgres adapter
> if used; invalidate on content changes; validate cached citations against
> current passages; never cache personalized conversation state. Verify
> repeat-answer latency under 50 ms and log only privacy-safe hit/miss
> metadata. Complete the approved health/helper-console provider status
> surface and `docs/LOCAL_AI.md`; do not expose active provider identity in
> learner UI.
>
> Preserve and test the existing `parseJobPostingPassages()` converter;
> accept schema.org JobPosting JSON-LD/`@graph`, validate required fields,
> create stable job passages with title/location/deadline and provenance,
> report invalid item indexes, and ensure job answers obey the same
> confidence and citation floor. Do not replace the existing general source
> connector/sync system.
>
> Preserve restart-safe ask idempotency: a repeated client message ID returns
> the same reply, while concurrent duplicate submissions do not create a
> second reply (the in-flight duplicate follows the established conflict and
> retry contract). Test serial and parallel retries against PostgreSQL.
>
> Implement `pnpm eval` and `docs/EVAL.md` against `checks.yaml`: report
> retrieval hit rate, citation validity, notfound correctness,
> answer-language correctness and sentence length by language and relevant
> source/language pair. Use >=10 questions × 3 languages; target 100%
> citation validity and >=90% notfound correctness; show FAQ hit rate;
> enforce <=15-word normal and <=12-word Simple answers without gaming the
> metrics or weakening floors. Add prompt/glossary rule tests and >=70%
> coverage for engine/grounding/AI as specified. Tests must precede code.
> Do not log questions, passages, contact information, or identifiers.
> Acceptance: provider conformance, kill-provider, malformed response,
> privacy/consent, injection, language, citation, cache invalidation,
> JobPosting, and evaluation tests pass; `pnpm eval`, typecheck, lint, and
> existing WP03/WP04 tests pass.

### P03 — Finish learner widget, offline experience, and embed contract

**Copy this prompt as a unit:**

> Complete the end-user web widget, offline/slow/consent experience, remaining
> widget integration behavior, and Level 1 embedding contract. Requirements:
> FR-UI-06, 08–10, 14, 16, 18–20; FR-CONV-11 and FR-CONV-12 client behavior;
> FR-AI-05; FR-SIMPLE-02/03; FR-INT-01–04 and FR-INT-11; NFR-A11Y-01–06;
> NFR-PERF-01/02/05/06/07; and FR-LANG-06–08/14. Inspect `packages/widget`
> (especially `src/index.ts`, helper console, Vite/service-worker config),
> `packages/voice` interfaces, locale packs, widget e2e tests, API routes and
> `docs/API.md`. Existing sessions, chat, settings, language UI, service
> worker, and API routes are real foundations: extend them, do not replace
> them. Do not change frozen `pages/` or `assets/`, and do not read or depend
> on the former four-workstream plan.
>
> Complete the experience end to end: show offline state and useful cached
> content; announce a waking state after a slow (>2 second) API start and a
> working state after a slow request, with one polite announcement and usable
> retry/help controls; never invent a course answer while offline. Add the
> reviewed FAQ response/cache path, including the currently absent
> `GET /v1/locales/{code}/faq` contract, ETag/cache policy as appropriate,
> offline FAQ route, service-worker/offline behavior, and visible empty,
> loading, success, and failure states. Record approval of this additive
> contract in `DECISIONS.md` and keep OpenAPI, Zod, API, and client shapes in
> sync.
>
> Complete the learner-facing remote-AI notice and local/offline opt-out.
> Explain remote processing in one localized line; honor the learner's
> explicit choice for the current session, persist revocation through the
> existing session-consent API, and make revocation effective before the next
> question. With consent off, prove no cloud request occurs; with consent on,
> prove the adapter sends only policy-allowed question and retrieved passage
> data and no identity, transcript history, or extra session fields.
>
> Complete reply-level Copy, Helpful/Not helpful, and Read aloud controls;
> one-tap feedback sends only `{replyId, helpful}` (no reply/question text or
> session ID in the aggregate); preserve message focus/live-region behavior.
> Implement shortcuts Alt+Shift+M/H/L with a disable setting, no printable
> single-key shortcuts. Support host theme custom properties for color, font,
> and radius, rejecting or reverting values below required contrast. Lazy
> load voice and help code, keeping initial compressed widget JavaScript
> <=60 KB and total first load (including CSS and locale UI) <=150 KB. Under
> 400 kbps/400 ms RTT, verify launcher <=3 seconds and chat ready <=6 seconds;
> verify <=100 MB widget memory on a 1 GB Android device and record the
> co-designer/device evidence. Simple mode must hide advanced settings, show one primary action,
> pair icons with text labels, enable read-aloud, increase text to >=150%,
> show one best citation, and consume P02's measured <=12-word answers.
>
> Complete the Level 1 script-tag contract: asynchronous embed/launcher with
> `data-host-key`, `data-lang`, `data-theme` (light/dark/contrast),
> `data-position` (start/end), `data-simple` (true/false), and `data-api`;
> treat `data-host-key` as a public identifier restricted by configured
> allowed origins, never as a secret. Expose only
> `window.Dimts.open/close/setLanguage/escalate` and the documented
> `dimts:opened/closed/language/escalated` events. Support strict CSP including
> nonce, no eval or required inline script, and document the host's required
> CSP directives in `docs/INTEGRATION.md`. Use shadow-root isolation and
> uninstall that removes listeners,
> DOM, timers, and storage it owns. Maintain behavior without third-party
> cookies and with storage disabled. Do not add a second UI framework.
>
> Finish verification on all touched screens: 320 CSS px, 200% zoom,
> keyboard-only, reduced motion, sound-off, high contrast, every supported
> language, and pseudo-RTL. Targets >=48px with >=8px spacing; contrast/focus
> criteria include >=7:1 text contrast, >=3:1 control contrast, and a visible
> 3px focus ring with 2px offset. Verify focus-to-reply/live announcement
> behavior and language suggestions: Ethiopic text suggests Amharic, Latin
> text offers one-tap English/Afaan Oromoo choice, and no language switches
> silently.
> Use accessible HTML first, CSS logical properties, locale keys for every
> user-facing string, Lit-safe rendering, and no third-party network requests.
> Add Playwright and axe checks plus the bundle-size assertion. Acceptance:
> no dead-end online/offline state, browser tests pass, `pnpm test:widget`,
> `pnpm size`, lint, and typecheck pass; provide reproducible accessibility
> evidence for P11's report.

### P04 — Deliver production-ready voice workflows

**Copy this prompt as a unit:**

> Complete the learner-controlled voice workflow, browser adapters, optional
> server STT/TTS path, engine selection, and language/device verification.
> Requirements: FR-VOICE-01–10 and FR-VOICE-12 (FR-VOICE-11 audio caching is
> removed by the authoritative blueprint), FR-UI-06, FR-LANG-05, and
> NFR-A11Y-07. Inspect `packages/voice`, widget recording/review/read-aloud
> code, locale `voice.yaml`/`meta.yaml`, API/OpenAPI, and voice tests. P03
> provides the lazy widget integration point and P01 provides reviewed voice
> capability data. Preserve text as a complete first-class path and do not
> read or depend on the former four-workstream plan.
>
> Provide config-driven selection from pack declarations and validated
> `DIMTS_STT_ENGINE`/`DIMTS_TTS_ENGINE`; changing a supported adapter must not
> require editing conversation logic. Implement real supported adapters,
> capability checks, cancellation, permission/error states, timeouts, and
> graceful unsupported-language behavior. Hide an unavailable mic or
> Read-aloud action with a localized reason rather than presenting a broken
> control. Keep the 60-second recording cap, begin recording only after an
> explicit learner action, provide visible/audio/haptic state cues only as
> redundant signals, and require editable transcript review plus explicit
> Send before any question is submitted. Read-aloud must support pause,
> resume, stop, and configured speech rate without repeated/overlapping audio.
>
> Implement `/v1/stt` and `/v1/tts` only as optional server adapters if the
> selected engine requires them; settle exact schemas through Zod/OpenAPI and
> `DECISIONS.md` before clients use them. Authenticate with the existing
> session model, enforce size/type/language limits, timeouts and rate limits,
> delete temporary audio immediately after transcription/synthesis use, and
> return localized 503/unsupported reasons when no engine is configured.
> Never persist audio, send audio to a remote service without consent and
> allowed data policy, or log audio, transcript, or identifiers.
>
> Add adapter conformance, permission-denied, no-speech, low-confidence,
> timeout, cancellation, review-before-send, unsupported language, cleanup,
> and consent/network tests. Complete `docs/VOICE_TEST.md`: use the same ten
> sentences per language/engine on a real mid-range Android device, record
> screen-reader/read-aloud behavior, and enable voice only at >=8/10
> intelligible; `voice.yaml` and the visible Afaan Oromoo beta label must
> match the results. Record the Ethiopic screen-reader limitation and
> alternative read-aloud path. The earlier plan mentions FR-VOICE-11 audio
> caching, but the authoritative blueprint explicitly removed FR-VOICE-11:
> do not add audio caching. Acceptance: text always works, no audio remains
> after use, only reviewed/configured language-engine pairs are advertised,
> widget and API voice tests pass, and the build remains within P03's size
> budget.

### P05 — Complete human help, availability, and screen sharing

**Copy this prompt as a unit:**

> Deliver the complete human-help workflow from learner request through
> helper resolution, outside-hours/timeout fallback, optional screen share or
> image, and privacy-safe operations. Requirements: FR-HELP-04–19,
> FR-HELP-01–03 regression, NFR-SEC, NFR-REL, and NFR-PRIV help-data rules.
> Inspect `packages/api/src/routes/help.ts`, `help-sockets.ts`, help DB stores
> and migrations, `packages/help`, widget help panels, helper console, OpenAPI,
> config, and existing help tests. The request queue, helper JWT, claim/block/
> close, and chat relay already exist; extend those exact paths and preserve
> role checks and replay behavior. P03 supplies widget conventions. Do not
> read or depend on the former four-workstream plan.
>
> Complete request preview (language and optional last three learner
> questions), default-on but one-action-off summary consent, waiting state
> while the tutor remains usable, and a 5-minute configurable fallback with
> no pressure countdown. Enforce helper hours from validated
> `DIMTS_HELPER_HOURS`; add authenticated `GET /v1/help/availability` with an
> approved `{available,nextOpenAt?}`-equivalent schema and localized client
> presentation. Define the still-unspecified callback/leave-message/
> Telegram-fallback representation before coding: agree the contract with
> affected client/channel owners, record it in `DECISIONS.md`, then implement
> persistence and end-to-end behavior; do not silently invent a second
> request type.
>
> Finish the helper console queue by wait time/language, visual and polite
> live announcements, optional sound, active helper name only when deliberately
> configured, single-winner claim, reconnect/replay ordering, optional
> helper-controlled first name absent by default, close/timeout, and
> content-free wait/resolution metrics. Complete screen-share signaling for
> `share.request/accept/decline`, `rtc.offer/answer/ice`, and `share.stop`;
> authenticate session/helper roles for every frame and ICE request. Nothing
> is captured until helper request, learner consent, and browser permission.
> Put “Not now” first and give it equal visual weight with “Share my screen”.
> Sharing is view-only, no audio/recording/remote control, capped around
> 300 kbps and 5 fps, with a persistent stop banner and either-side stop
> ending both tracks within one second. Use the approved metered TURN/public
> STUN design; coturn is local Compose only. Issue short-lived TURN
> credentials server-side and never expose the TURN provider/API secret to a
> browser; when no TURN key is configured, return the approved STUN-only
> configuration.
>
> Implement `/v1/help/{id}/ice` and `/v1/help/{id}/image` using explicit
> contracts. Images require explicit learner selection, JPEG/PNG/WebP
> allow-list, actual content validation, <=2 MB, database storage (not local
> disk), authorized retrieval, and deletion after two hours or request/session
> end. Unsupported/poor capture must offer picture and describe-in-words
> alternatives. Maintain <=5 requests/hour/session, minimal handoff data,
> 5-minute default, helper metrics without content or identifiers, retention
> and safe failure behavior.
>
> Tests must cover availability with a fake clock, each fallback, opt-out
> summary, concurrent claims, WS role spoofing, reconnect/replay, no capture
> before consent, decline, stop on both sides, unsupported capture, ICE
> authorization, malformed/oversized image, cleanup, rate limit, and privacy
> of metrics. All copy comes from locale packs. Acceptance: full learner and
> helper flows work against PostgreSQL and WebSocket clients, image/share
> data is removed on schedule, no unauthorized relay is possible, and
> Supertest/WS/browser tests pass.

### P06 — Deliver the complete jobs and accommodation gateway

**Copy this prompt as a unit:**

> Implement the complete career gateway across domain logic, API, persistence,
> grounded job answers, web guided flows, and a stable channel-delivery
> contract. Requirements: FR-JOB-01–11, FR-INT-07, FR-TUTOR-09, related
> FR-SMS-06/09 and FR-TG-01/FR-TG-11 integration, FR-SIMPLE-04, and privacy
> requirements. Inspect `packages/jobs` (currently empty), existing
> `packages/grounding/src/job-posting.ts`, `packages/api` schemas/routes/
> repository/migrations, `packages/widget`, channel adapter ports, locale date
> and glossary data, and tests. P02 owns the shared JobPosting passage
> representation; consume it rather than duplicating parsing or retrieval.
> Define the outbound/delivery contract here; P07/P08 implement its channel
> adapters after this service contract is stable. Do not read or depend on
> the former four-workstream plan.
>
> Implement authenticated host-key `POST /v1/jobs/import` for schema.org
> JobPosting JSON-LD (including `@graph`), required fields (`title`,
> `description`, `datePosted`, `hiringOrganization`, and `jobLocation`),
> the `accommodationsOffered` extension, stable IDs, partial failure
> reporting by input index, unknown-field tolerance as specified, and atomic
> persistence/index updates. Add session-authenticated `GET /v1/jobs` with
> validated region/type filters. Job passages must be searchable and cited
> under the same confidence and language rules as course content. Show
> truthful listing details and localized glossary explanations; use
> Ethiopian/Gregorian dates from P01.
>
> Complete alert subscription lifecycle: a one-question-per-screen guided
> flow for job type, region, language and channel; expose P04 voice input and
> transcript review on every supported web/Telegram text-answer field, while
> SMS keeps text/numeric input. Require plain-language consent before contact
> collection; confirmation
> with a visible Stop control; durable stop/delete; matching filters;
> session-authenticated `POST /v1/subscriptions` and
> `DELETE /v1/subscriptions/{id}`; idempotent daily runner and dry-run mode;
> at most one daily digest per subscriber; unique `(subscription,
> job)` delivery; send title, organization, deadline, and link in the
> learner's language; stopped/expired consent is checked before every send;
> per-channel rate/digest policies use the P07/P08 delivery contract. Persist
> only encrypted contact for consented active subscription and keyed hashes
> for continuity; consent metadata is limited to timestamp, channel, and
> notice version. Stop must prevent further sends and delete contact within
> one minute. Support the session-only “Support I need” filter and prove it
> never leaves the session.
>
> Complete the private accommodation request workflow: choose an interview
> and an option (sign-language interpreter, step-free access, written
> questions, extra time, screen-reader-friendly test, or other by text/voice);
> never request medical proof or store a disability label. Review the exact
> message and require explicit approval before sending it to the employer
> contact in the job data through the host or an anonymous relay. The learner
> may choose whether to include a name, but it is never required. Provide
> status/error/retry without duplicate sending. Add
> `POST /v1/accommodation-requests` with explicit draft/approve/send state,
> validation and authorization. Resolve unspecified payload fields
> with the affected API/domain/client owners; add OpenAPI/Zod contract tests
> and a `DECISIONS.md` entry before implementation.
>
> Add accessible web flows with Back/Next, progress, save/resume, review,
> approval, cancellation, loading/empty/success/failure states, locale keys,
> keyboard/focus support, and safe restoration after reload. Add the
> SMS/Telegram delivery interface needed by P07/P08 and wire the actual
> adapters in those channel prompts; do not use placeholder delivery.
> Add migration, repository, domain, route, integration, and Playwright tests
> for malformed/partial imports, filters, passage citations, calendar
> rendering, draft/resume, no-send-before-consent/approval, stop within one
> minute, contact encryption, duplicate runner, dry run, channel contract,
> rate limits and data deletion. Acceptance: job search, sourced answers,
> alert create/stop and approved accommodation relay work end to end on web;
> P07/P08 complete real SMS and Telegram delivery against this contract with
> no diagnosis field or plaintext contact.

### P07 — Implement SMS gateway, conversations, and simulator

**Copy this prompt as a unit:**

> Implement the complete SMS channel and its simulator using the existing
> Dimts engine/session model. Requirements: FR-SMS-01–12, including the
> authoritative curly-apostrophe/quote normalization rule, and related
> FR-LANG-12/17 and privacy requirements. Inspect `packages/sms` (currently
> empty), `packages/widget` routing/build, `packages/api` auth/routes/config/
> migrations/OpenAPI, locale `sms.yaml`/`meta.yaml`, compose, and tests.
> Real operator contracts are out of scope; keep the gateway interface
> replaceable and the simulator on the same inbound path. Do not read or
> depend on the former four-workstream plan.
>
> Implement the `SmsGateway` send/inbound/status interface, a deterministic
> simulator, delivery state, two retries, and `docs/SMS_GATEWAY.md` explaining
> how a real operator adapter would satisfy the contract without claiming
> one is configured. Add authenticated `POST /v1/sms/inbound` with a
> separately configured gateway secret, replay/idempotency protection,
> validation, limits, and localized errors. New numbers receive numeric
> language choice (1 English, 2 Amharic, 3 Afaan Oromoo); language persists
> per pseudonymous session. All HELP/STOP/LANG/JOBS/person and menu keywords
> use reviewed locale data, accept English equivalents in every language,
> and normalize case/diacritics/approved apostrophe variants only for
> matching.
>
> Complete the full tutoring exchange through the existing engine, citation
> links as SMS-safe text, short answer budget, interactive continuation,
> HELP callback flow requiring a separate Y confirmation before exposing a
> phone number to a helper, and `STOP` that ends every message immediately,
> confirms once, and stays stopped. Implement daily outbound cap (default 20
> per number) and digest batching for alert messages through a reusable
> delivery interface so the P06 runner can send real job alerts without
> duplicating gateway logic. Route `JOBS` subscription creation and management
> through P06's guided-subscription service, with localized consent,
> confirmation, and stop behavior; do not create a second subscription store.
> Hash phone identity for session continuity with the existing
> `DIMTS_HASH_KEY`; encrypt contact details only for consented active
> subscriptions using `DIMTS_ENC_KEY`; never store plaintext numbers or
> message text in logs.
>
> Implement exact GSM-7/UCS-2 counting: 160/153 and 70/67 segment rules,
> Amharic uses UCS-2, and concatenation/extension-table characters are
> counted correctly. Limit answers to three segments by shortening at a
> sentence boundary and appending the localized “Reply 1 for more” line;
> continuation must be safe, bounded, and tied to the correct pseudonymous
> session. Before sending, normalize curly apostrophes/quotes to straight
> ones as specified for Afaan Oromoo, and calculate the final encoding and
> segment count from the actual transmitted text. Provide `/sim/sms` as an
> accessible phone-thread UI with inbound/
> outbound exchange, live character counter, encoding, segment count,
> keyboard use, error and empty states. The simulator must call the same
> inbound service path as the gateway.
>
> Add tests for encoding boundary vectors (160/161, 70/71, concatenation,
> Amharic, apostrophes), all keywords/languages, menu selection, STOP
> permanence, Y-before-callback, 20/day digests, encrypted/hash-only
> persistence, retries/status, idempotency, rate abuse, simulator/real
> adapter conformance, and UI accessibility/reflow. Use OpenAPI/Zod and
> approved schema decisions; all copy is localized. Acceptance: full
> simulator exchange passes browser/contract tests; no plaintext contact is
> stored; learners can create and stop P06 job alerts over the simulator, and
> the P06 runner sends through the outbound port; tests/typecheck/lint pass.

### P08 — Implement the Telegram bot and secure channel adapter

**Copy this prompt as a unit:**

> Implement Dimts' complete Telegram private-chat channel. Requirements:
> FR-TG-01–12, including help and career-command integration; related
> FR-VOICE-02/FR-VOICE-10; FR-HELP channel behavior; NFR-SEC/NFR-PRIV.
> Inspect `packages/telegram` (currently empty), `packages/api` routes,
> engine/provider/session interfaces, help relay, P04 voice, P06 career
> contract, locale `ui.yaml`/`sms.yaml`/`voice.yaml`, migrations,
> and tests. Use the established engine and job/help services; no independent
> answer logic or second session store. Do not read or depend on the former
> four-workstream plan.
>
> Implement `/start`, `/language`, `/help`, `/jobs`, `/simple`, `/stop`,
> `/privacy`, and `/endhelp`; localize command descriptions, short button
> labels (<=20 characters), privacy notice, errors, and responses in every
> live language. Respond only to private chats; silently ignore group/channel
> updates. Keep messages short, use no ASCII art, use emoji only alongside
> words, and provide text descriptions for images. Show privacy notice and
> localized consent choices before collecting any alert subscription or
> consented contact use. Use webhook verification in hosted mode and
> configured long polling only where allowed locally; validate update
> structure, deduplicate/replay safely, queue sends at about one message per
> second per chat, retry transient failures without duplicates, and keep a
> friendly `/help` recovery path.
>
> Route text to the existing session/ask path and render source citations as
> links. Split >4096-character messages at sentence boundaries. For voice
> notes, process through the selected P04 STT adapter, show the recognized
> text with localized Send and Say again buttons, and never answer until the
> learner confirms. If read-aloud is enabled and TTS is available, send audio
> only alongside equivalent text; otherwise state the limitation and retain
> text. Implement help creation, the existing helper-console relay, callback
> fallback where approved, and `/endhelp` returning to tutoring. `/jobs` must
> call P06's real job search/subscription service, not a placeholder. Support
> the full Telegram alert create/review/consent/confirm/stop lifecycle through
> that service; provide a visible localized Stop action for active
> subscriptions and do not duplicate alert storage or matching logic.
>
> Store Telegram IDs only as HMAC for continuity; retain encrypted IDs only
> for explicit, active alert consent; handle `/stop` as permanent alert
> deletion within one minute and respect global data deletion. Never log the
> Telegram ID, phone, message, audio, transcript, or token. Use secret
> verification, constant-time comparison where relevant, privacy-aware
> idempotency, strict validation, rate limits, and localized safe errors.
>
> Add fixture updates and tests for every command in every live language,
> group rejection, webhook secret/replay, privacy/consent, voice confirmation
> and retry, long message splitting, send bursts/retry/deduplication, help
> relay/endhelp, job integration, STOP deletion, data deletion, and failures.
> Acceptance: a learner can start, choose language, ask, get a cited answer,
> reach/leave help, find jobs/manage alerts, use voice review, and stop
> privacy-sensitive activity through the production adapter without exposing
> IDs or bypassing the shared engine.

### P09 — Implement anonymous feedback and teacher insights

**Copy this prompt as a unit:**

> Deliver privacy-preserving feedback collection and the complete instructor
> insights feature (domain aggregation, API, access control, accessible page,
> and CSV). Requirements: FR-CONV-12, FR-INSIGHT-01–04, FR-UI-20, and
> NFR-PRIV-03. Inspect `packages/insights` (currently empty), `packages/api`
> schemas/routes/repository/migrations, engine reply/citation storage,
> `packages/widget` message controls, locale packs, and tests. Reuse the
> existing anonymous `feedback_counter`/`insight_aggregate` schema where it
> fits; any migration must preserve its privacy guarantees. P02 supplies
> reply/citation semantics and P03 supplies the client interaction pattern.
> Do not read or depend on the former four-workstream plan.
>
> Implement one-tap `POST /v1/feedback` with strict `{replyId, helpful}`
> input, session authorization for the reply, duplicate-tap handling, and
> server-side resolution of topic from stored reply citations. Store only
> counts by citation topic/lesson/section, language, and period; do not store
> feedback text, question, session ID, or any learner identifier in counters.
> The same aggregate pipeline must count questions and notfound outcomes
> needed by insights. P02's consecutive-negative feedback signal is separate
> from these aggregates: persist only the minimal resettable active-session
> streak needed by FR-CONV-06, never a feedback event history, and expire it
> with the session.
>
> Implement `packages/insights` aggregation and `GET /v1/insights`: only
> host secret-key access or validated LTI instructor role; strict query
> period/language filters; small groups below five are combined into `Other`;
> no question text/session IDs or disaggregations that re-identify a learner.
> Generate CSV with stable documented columns, correct escaping, spreadsheet
> formula-injection defense, explicit date/time semantics, and same
> aggregation/privacy rules as JSON. Avoid exporting secrets or raw
> identifiers.
>
> Build the teacher screen with an accessible text summary before any chart,
> semantic table headers, loading/empty/error states, filters, and CSV
> download. Include content gaps only as aggregate notfound counts, never
> raw question strings. Use locale keys, keyboard/focus behavior, CSS logical
> properties, and no chart as the only representation. Host and instructor
> authorization must be tested separately; unauthorized access is denied.
>
> Add tests for invalid/unauthorized sessions and roles, forged reply IDs,
> duplicate feedback, counters by topic/language/period, small-cell
> suppression, no text/session columns or exports, CSV correctness and
> formula safety, empty data, access filters, and axe/keyboard UI. Acceptance:
> answers can be rated once, teachers see privacy-protected useful summaries
> and CSV, and all database/API/export/browser checks demonstrate that raw
> learner questions and session identities are not disclosed.

### P10 — Finish LTI 1.3 and REST/host integration

**Copy this prompt as a unit:**

> Complete Level 2/3 integration for Dimts: REST/OpenAPI examples and
> production LTI 1.3 login/launch/JWKS/deep-link flow. Requirements:
> FR-INT-05/06/07/10; connect FR-INT-01–04/11 from P03 and
> FR-INSIGHT instructor access from P09; NFR-ADOPT-01/02. Inspect
> `packages/lti` (currently empty), API config/routes/OpenAPI, host/session
> auth, P03's `window.Dimts` contract, P06 job import, P09 instructor
> insights authorization, examples, and integration tests. Follow the
> blueprint's Level 1/2/3 contracts; do not invent a Savanna API or claim
> private platform data is discoverable without a host adapter. Do not read
> or depend on the former four-workstream plan.
>
> Implement LTI 1.3 using registered platform configuration and current
> standards/library support: login, state and nonce generation/storage,
> signature/JWKS verification, issuer, audience/client ID, deployment,
> redirect URI, timestamp/expiry, replay rejection, key rotation, and
> validated role mapping. Support learner launch to the widget and instructor
> launch to the P09 insights page; implement JWKS publication and required
> deep-link behavior. Enforce origin/tenant boundaries, one-time state,
> short expiries, secure cookies/transactions, and safe failure messages.
> Do not trust unsigned launch parameters or grant instructor access from a
> client-supplied role.
>
> Resolve exact platform registration/configuration and any underspecified
> payloads in `DECISIONS.md`; represent schemas in Zod/OpenAPI and add
> contract tests before client or example code. Ensure LTI sessions integrate
> with existing pseudonymous identity and retention; do not create accounts
> or store unneeded roster/identity claims. Publish generated OpenAPI 3.1 at
> `/v1/openapi.yaml` and human-readable docs at `/docs`; document
> `X-Dimts-Key` authentication, schemas, errors, rate limits, the
> `DIMTS_HOST_ORIGINS` allowlist, versioning, and a runnable
> `examples/api-level2.http`. The LTI
> example must exercise the actual flow using a test platform, not a mock
> success page. Keep `examples/lti-level3/` aligned to the verified contract.
>
> Add negative tests independently for bad signature, state, nonce, issuer,
> audience, deployment, expiry, replay, unknown key, unsupported role, and
> cross-tenant launch; plus successful learner/instructor/deep-link tests.
> Run the examples and record an outsider integration trial. Acceptance:
> generated OpenAPI and routes agree, all invalid launches fail closed, roles
> map correctly, instructor-only data stays protected, and L2/L3 examples
> work from documented setup without unapproved assumptions.

### P11 — Production readiness, privacy, operations, and final gates

**Copy this prompt as a unit:**

> Complete the cross-cutting production and project-readiness work after the
> feature prompts: security, privacy/data deletion/retention, reliability,
> deployment, observability, cost controls, CI quality gates, documentation,
> and local/hosted runbooks. Requirements: NFR-SEC-01–12, NFR-REL-01–03,
> NFR-COST-03–06, NFR-PRIV-01–09, NFR-PERF-04,
> NFR-MAINT-01, NFR-ADOPT-01/02, NFR-OPS-01/02,
> FR-INT-08 regression and FR-INT-09/10/12, FR-CONV-10/13, plus
> the overall G1–G13 gate. Inspect current CI, Docker/Compose, API config and
> auth, migrations, retention, scripts, docs, all feature routes and tests.
> Keep existing security controls and use the exact blueprint contracts;
> don't replace working infrastructure or expose secrets. Do not read or
> depend on the former four-workstream plan.
>
> Complete and test CORS/origin and frame restrictions, upload content/size
> validation, request/body limits, brute-force and per-session/channel rate
> limits (20 questions/minute/session and 200 requests/hour/IP, restart-safe
> where specified; help and subscription abuse limits), auth/role checks,
> HTTPS/HSTS deployment settings, safe problem
> responses, dependency audit and secret scan. Regression-test the existing
> FR-INT-08 public sitemap and host-owned private adapter contracts without
> rebuilding them. Measure warm API/database non-AI requests at 50 concurrent
> sessions against the 300 ms p95 target; report methodology and
> failures, and distinguish cold-start behavior. No log or fixture may expose
> message text, names, phone numbers, Telegram IDs, tokens, or secrets.
> Preserve token/key contracts: session tokens are 32 random bytes with only
> SHA-256 stored; helper tokens are random and stored hashed, exchanged for
> an 8-hour JWT, with login limited to 10 attempts per 15 minutes per IP.
> Require distinct 32-byte base64 encryption, HMAC, and JWT-signing secrets,
> and fail startup clearly when any is missing or malformed. Verify the app
> makes no unconsented third-party network requests, analytics, fonts, or
> scripts; cloud AI requires both host enablement and learner consent.
>
> Implement global `POST /v1/data/delete` with session authorization and
> shared web/Telegram/SMS deletion semantics, confirmation/success/error
> interaction, idempotency, and observable completion within one minute.
> Include messages, session links, help/chat/images, contact hashes/encrypted
> subscriptions, accommodation, consent metadata as required by policy,
> cache, and all channel mappings; preserve only permitted anonymous
> aggregates. Complete scheduled retention for 24-hour inactive sessions,
> help images (2 hours), subscriptions and answer cache, plus end-of-event
> purge/dry-run. Use fake-clock tests; deletion failures must be surfaced, not
> reported as success. Publish `docs/PRIVACY.md` in every live language from
> reviewed translated copy and document purposes, consent, retention, and
> deletion.
>
> Complete PostgreSQL-backed durable state, graceful shutdown, restart-safe
> retries and reconciliation, idempotent migrations, and `pnpm migrate` using
> the direct connection string (never automatically on the hosted API).
> `GET /v1/health` must return 200 within two seconds and report database
> availability in its body, including while the database is asleep. Run
> `pnpm test:compose` e2e including restart mid-chat/offline image, migrations,
> seeded course/
> job/helper data, and clean-machine startup under five minutes. Add
> `render.yaml`, local Compose profiles for optional coturn/local AI/
> scheduler/seed, and workflows for retention at 06:00 UTC, alerts at 07:30
> UTC, and keepwarm only 05:00–16:50 UTC (not around the clock). Add
> `scripts/usage.mjs`/`pnpm usage` reporting database size, largest tables,
> session/message counts and a 600 MB warning, cross-checked against
> `pg_database_size`; add `pnpm seed` with safe repeatability.
>
> Wire root `pnpm eval`, `pnpm a11y`, `pnpm usage`, `pnpm seed`, and
> `pnpm test:compose`; add CI for Postgres integration, Playwright/axe matrix,
> eval, contrast, coverage, audit, secret scan, and size. Complete
> `WCAG_REPORT.md`, `COCREATION_LOG.md`, `GATE_CHECKLIST.md`, `COST.md`,
> `FREE_TIER.md`, and integration/privacy links in README. Verify actual free
> tier limits and local offline use; do not claim unverified deployment
> behavior. Preserve local docs on the API/widget separation.
>
> Run all relevant gates: typecheck, lint, format check, unit/contract tests,
> `lang:check`, build, size, widget Playwright, axe matrix, eval, Compose
> e2e, PostgreSQL tests, audit and secret scan. Report skipped checks and
> environmental constraints explicitly. Acceptance: deletion/retention and
> privacy tests pass across channels, security/performance checks have
> evidence, clean local startup and restart are reliable, deployment/workflow
> schedules are bounded, and all release docs reflect verified—not
> aspirational—behavior.

## Explicit follow-on product proposals

The following three ideas are appended to the former plan but have no SRS
requirement IDs, detailed contracts, or acceptance thresholds. They are kept
as separate prompts so none is silently lost or misrepresented as approved
hackathon scope. Resolve the listed product/privacy decisions before treating
them as committed delivery.

### P12 — Accessibility personalization suite (follow-on)

**Copy this prompt as a unit:**

> Build the full accessibility-personalization product proposal on top of
> Dimts' accessible widget. This is unnumbered follow-on scope, not an
> existing FR; inspect the current settings/widget, locale tooling, grounding
> pipeline, video/media content conventions, and P01/P03 tests. Do not read
> or depend on the former four-workstream plan.
>
> Deliver optional, user-controlled profiles for screen-reader, low-vision,
> dyslexia, Deaf, motor-access, and cognitive-load preferences; allow
> combining/editing preferences and returning to defaults. Profiles must
> configure functional settings (text scale/spacing, contrast, motion,
> read-aloud, captions, simplified display, keyboard/switch paths) and never
> gate features or label a learner as having a disability. Do not create a
> diagnosis or disability record. Before choosing persistence or sync,
> record a privacy decision: default to local user-controlled preferences
> unless secure cross-device storage receives explicit approval and consent.
> Explain export/reset/delete and honor the data-deletion contract.
>
> Add easy-read course representations generated only from authorized,
> cited course content and never auto-published: retain source/version
> provenance, human review/approval workflow, correction and rollback, and
> visibly distinguish approved easy-read content from original content.
> Provide a curated sign-language video library for key concepts using real,
> reviewed sign-language content—not synthetic avatars—with localized
> metadata, playback controls, keyboard access, captions/transcripts, and
> accessible alternatives. Support AAC, switch access, and eye-gaze by
> semantic controls, predictable focus order, no drag-only operations, and
> configurable dwell/activation behavior without breaking normal input.
> Ensure captions and transcripts for every included audio/video item.
> Include dyslexia-friendly typography and spacing options using user
> preferences, not assumptions.
>
> Produce a public accessibility conformance report (VPAT/ACR) based on
> actual manual and automated evaluation, and a co-design operating plan
> with a standing council of disabled learners, paid participation,
> accessible materials, consent, safeguarding, and an accountable owner.
> The project repository cannot itself prove the council is funded or
> convened: record organizational evidence as a release dependency, not a
> fabricated code checkbox.
>
> Add tests for profile persistence/reset, no sensitive classification,
> storage deletion, keyboard/switch/eye-gaze semantics, captions/transcripts,
> approved-content provenance, review/rollback, and axe/manual assistive
> technology flows. Acceptance: each preference works end to end in all live
> languages, no profile discloses a disability, only human-approved easy-read
> and sign-language content ships, and the public conformance report is
> evidence-based. Resolve council funding, supported sign languages, video
> ownership/licensing, approval staffing, and cross-device profile policy
> before launch; do not invent them.

### P13 — Learning coach and outcome analytics (follow-on)

**Copy this prompt as a unit:**

> Build the full learning-coach and institutional-outcomes proposal as a
> separate follow-on feature. It has no assigned FR IDs. Inspect existing
> `packages/engine`, grounding/evaluation, insights API/page, job domain,
> database retention and consent before designing. P02 must provide
> citation-gated course answers, P06 career data, and P09 anonymous
> aggregates. Do not read or depend on the former four-workstream plan.
>
> Deliver practice quizzes, flashcards, spaced repetition, and study plans
> derived only from currently authorized course passages. Every generated
> item must retain source passage/version citations, pass schema and
> correctness checks, reject unsupported claims, and provide notfound/
> correction behavior instead of guessing. Add a three-level “explain at my
> level” presentation of the same cited concept with validated language and
> reading-level checks; keep source meaning and citations consistent.
> Support learner-controlled save/review/removal, progress state and
> accessible offline/low-bandwidth interactions with loading, empty, retry,
> and reset states.
>
> Detect content gaps from aggregate retrieval/notfound/feedback outcomes,
> without showing or retaining raw questions in teacher views. Add confusion
> heatmaps by lesson, language, and approved cohort; privacy-preserving
> thresholds and suppression must prevent singling out small groups. Add
> outcome dashboards and funder/accreditation impact reports for completion,
> retention, support deflection, job placement, and cost per outcome. Define
> each metric, denominator, time window, provenance, uncertainty, and
> missing-data behavior. Do not fabricate job placements, attribute causal
> impact without evidence, or represent unavailable metrics as zero.
>
> Before implementing any longitudinal learner analytics, record a decision
> approved by the data owner on lawful purpose, opt-in/opt-out, data
> minimization, cohort membership, retention, deletion, and linkage. The
> current pseudonymous session and 24-hour retention model does not itself
> authorize long-term progress tracking. No names, raw question text,
> disability labels, phone/Telegram IDs, or session IDs may appear in
> institutional outputs; where source data is not legitimately available,
> provide a truthful unavailable state, not synthetic product metrics.
>
> Add source-grounding/answer-level tests, spaced-repetition state tests,
> language/reading-level checks, progress deletion and consent tests,
> small-cell aggregation tests, metric lineage tests, CSV/report privacy
> scans, and accessible browser coverage. Acceptance: every study activity
> is traceable to approved course content; learner progress is user-controlled
> and governed; institutional aggregates resist re-identification and clearly
> state limitations; impact reports are reproducible and never overclaim.

### P14 — Connector Hub and self-serve onboarding (follow-on)

**Copy this prompt as a unit:**

> Build the complete Connector Hub and self-serve onboarding proposal as a
> separate follow-on feature with strict use of Dimts' existing source
> contracts. It has no assigned FR IDs. Inspect `packages/grounding`
> `ContentSource`/`HostAuth`/extractor/sync manager, migrations, API auth,
> content version/cache invalidation, P10 integration docs, and tests.
> Preserve authorized sitemap discovery, same-origin and SSRF controls,
> host-owned private adapters, staged index generations, atomic publish, and
> last-good-generation rollback. Do not read or depend on the former
> four-workstream plan.
>
> Deliver an authenticated connector catalog and setup workflow for Moodle,
> Canvas, Google Drive, Notion, Confluence, SharePoint, PDF/document sources,
> video transcripts, job feeds, and ATS systems. Each connector must use its
> officially supported auth and least-privilege scopes, expose only content
> the host is authorized to share with every learner in that source, keep
> credentials in secret storage, and implement durable cursoring,
> idempotent events plus reconciliation, explicit source status, failure
> recovery, and revoke/disconnect. Never guess vendor endpoints or crawl
> private content using supplied credentials without an approved adapter.
>
> Complete the public website workflow: operator submits an approved HTTPS
> sitemap URL, previews only bounded same-origin listed pages, sees
> exclusions/errors and source diffs, explicitly approves publication, and
> can roll back to the last successful generation. Provide sync history,
> per-resource provenance, deletion handling, and cache invalidation through
> the existing atomic-generation mechanism. Add safe extraction for the
> approved PDF/document and transcript formats, with clear unsupported/
> malformed-resource reports; no file/transcript format is currently
> specified, so obtain and record an approved format list before coding.
>
> Publish a versioned connector SDK with source, authorization, extractor,
> pagination, change-event, error, and conformance contracts; examples and
> compatibility policy; and implement the requested React, Flutter,
> WordPress, and Moodle integration plugins/adapters with documented
> credential and lifecycle handling. Deliver PWA installation and QR
> onboarding that never embeds secrets or bypasses origin validation. Keep
> UI accessible, localized, responsive, and safe for public and private
> source administration.
>
> Before implementation, resolve exact connector versions, OAuth/scopes,
> tenant model, admin roles, supported PDF/video transcript formats,
> scheduled sync budgets, plugin distribution/ownership, and rollback
> semantics in `DECISIONS.md`; use additive versioned contracts and do not
> invent platform APIs. Add mocked conformance tests plus sandbox tests where
> authorized, URL/SSRF/redirect/private-network tests, scope/secret tests,
> pagination/event replay/outage/restart/deletion tests, atomic publish and
> rollback tests, extraction provenance tests, and plugin/PWA onboarding
> browser tests. Acceptance: every advertised connector is actually
> configurable and revocable, previews require approval before publication,
> sync is resumable and atomic, unsupported resources are explicit, and
> installation works without exposing credentials.

## Requirements and original-task cross-check

This index maps the complete four-part plan content to the consolidated
prompts. Requirement IDs are intentionally repeated where delivery crosses
package boundaries; repeated IDs mean integration coverage, not duplicate
implementations.

| Original requirement/task family | Consolidated coverage |
|---|---|
| Conversation escalation, distress, prompt injection, negative-feedback/notfound escalation, language guard, cross-language note, prompt/glossary use, job grounding, evaluation and quality floors; provider adapters, consent, offline FAQ, cache, health/debug, local-AI guide; engine/grounding/AI coverage and privacy-safe logging | P02 |
| Locale ICU/plurals/fallback/status gating/review, 200-term glossary, prompts and phrase lists, 30 FAQs, 10 checks per language, date/number formatting, add-language scaffolder/docs, optional transliteration, voice review metadata | P01; exercised by P02–P08 and P11 |
| Widget offline/slow states and FAQ cache, remote-AI notice/opt-out, reply actions/feedback client, shortcuts, host theming/contrast, lazy loading/size, Simple mode, reflow/zoom/targets/spacing, a11y matrix, Level 1 embed methods/events/CSP/cleanup | P03 |
| Microphone/read-aloud capability selection, no-audio-storage, review-before-send, Afaan Oromoo beta and real-device voice protocol; authoritative removal of audio caching | P04 |
| Help preview/summary consent, availability, outside-hours and 5-minute fallback, waiting while tutoring, helper queue/claim/chat/reconnect, share consent/stop/RTC/ICE/TURN, image fallback/retention, helper name/metrics and rate limits | P05 |
| JobPosting import/list/search/citations, subscriptions/consent/stop, matching and idempotent alert runner, accommodation draft/review/approve/send, no diagnosis/name, session-only Support I need filter, Ethiopian dates, web/SMS/Telegram flows | P02 (passage converter), P06 (career service and web flow), P07/P08 (real SMS/Telegram integration) |
| SMS gateway/simulator, inbound route, keyword and numeric language flows, GSM-7/UCS-2 segmentation/shortening, callback Y consent, STOP, digest/rate limit, encryption/hash, delivery retry/status and documentation | P07; P06 supplies job service; P07 verifies actual SMS job alerts |
| Telegram webhook/private-only commands, voice-note confirmation, text/citations/audio, 4096 splitting, rate-controlled send queue/retry, help/endhelp, privacy consent, hash/encryption, friendly failure handling | P08; P06 supplies job service; P08 verifies actual Telegram job commands/alerts |
| Feedback endpoint, anonymous topic/language/period counters, notfound counts, host/LTI authorization, small-group “Other”, accessible table/summary/CSV, no question text/session ID | P03 (client), P09 (end-to-end service/page), P10 (LTI role) |
| LTI login/launch/JWKS, OIDC validation/deep links/role mapping; REST OpenAPI and examples; integration onboarding | P10; P03 owns Level 1; P11 owns install/release evidence and regression-tests existing FR-INT-08 public/private source adapters |
| Data delete across channels, retention, privacy docs, secure config/rates/uploads/origin controls, Compose/Render/TURN/local AI/seed/restart, cron/keepwarm, usage warning, CI/eval/a11y/contrast/coverage/audit/secret scan, performance, cost/free-tier and gate evidence | P05 (help-specific data), P06–P09 (feature-specific deletion), P11 (system-wide policy and release gate) |
| Accessibility profiles, human-approved easy-read content, real sign-language library, AAC/switch/eye-gaze, captions/transcripts, dyslexia settings, VPAT/ACR, paid standing co-design council | P12 (follow-on; non-code organizational dependencies called out) |
| Grounded study tools, three reading levels, content-gap detection, cohort heatmaps, completion/retention/support/job/cost outcomes, privacy-preserving institutional impact reports | P13 (follow-on; longitudinal-data approval called out) |
| Moodle/Canvas/Drive/Notion/Confluence/SharePoint/PDF/transcript/job-feed/ATS connectors, sitemap preview/approval, diff/rollback/history, SDK, React/Flutter/WordPress/Moodle plugins, PWA/QR onboarding | P14 (follow-on; auth, format, scope, and ownership questions called out) |

### Reconciled ambiguities and stale statements

1. The FAQ endpoint and help-availability endpoint are proposed additions, not
   existing API contracts. P03/P05 require an explicit additive
   OpenAPI/Zod/API/client contract and `DECISIONS.md` entry before relying on
   either.
2. Timeout callback/message/Telegram fallback representation and
   subscription/accommodation request fields are underspecified. P05/P06
   require agreement by the affected owners and contract tests first; no
   endpoint fields or second request type may be silently invented.
3. Verified emergency/support contacts (SRS open question Q9) are not present.
   Keep them empty until the host supplies verified values; do not invent
   phone numbers or place emergency contact text in locale data.
4. The previous plan says `FR-VOICE-11` optional audio cache, but the
   authoritative blueprint explicitly removes that requirement. P04 must
   not implement audio caching.
5. The existing answer cache, job-passage parser, language detector, and
   source synchronization have working foundations. P02/P14 must complete
   missing integration/evidence, not rebuild them.
6. The prior plan's cut-line is not permission to drop remaining SHOULD
   requirements. P01 includes FR-LANG-15 as optional-but-covered,
   P02 includes FR-AI-08, P03 includes FR-UI-20/Simple mode, and P06 includes
   FR-JOB-06. Do not classify these as done or omit them solely due to the
   old time-based cut order.
7. P12–P14 are proposals without requirement IDs and exceed the blueprint's
   stated event scope. Their technical tasks are preserved, but feature launch
   depends on the explicit product, privacy, licensing, data-availability,
   budget, and ownership decisions stated in each prompt.

The consolidated plan is complete only when all MUST acceptance criteria in
the authoritative SRS/blueprint and all accepted SHOULD scope above have
automated and, where specified, co-designer/manual evidence; P12–P14 require
separate approval and must not be represented as prerequisites to the core
Dimts release.
