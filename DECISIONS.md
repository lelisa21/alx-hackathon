# Decision log

This file records project choices and resolutions. The system blueprint's
decision register is authoritative for architectural choices.

## P09 — Anonymous feedback and teacher insights (13 November 2026)

- **Scope before implementation:** FR-CONV-12, FR-INSIGHT-01–04, FR-UI-20,
  NFR-PRIV-03. P09 only on `phase-09-prompt`. Requirements quoted before
  implementation. Tests preceded code.
- **Auth decision (D31):** Host key (X-Dimts-Key) authorization required for
  `GET /v1/insights`. LTI instructor role added in P10. Both paths supported;
  learner sessions rejected at 403.
- **Period granularity (D32):** Day only (existing DATE schema in
  feedback_counter/insight_aggregate). No rolling windows; users can aggregate
  client-side.
- **CSV export (D33):** Minimal stable column set (topic_id, topic_label,
  lang, period, question_count, notfound_count, helpful, unhelpful). Formula
  injection defense: prefix = + - @ with '. RFC 4180: CRLF line endings, quoted
  fields with comma/quote/newline, escaped quotes doubled.
- **Small-cell suppression (D34):** Groups with combined count <5 (default,
  configurable via minCellSize parameter) combined into "Other" row per
  language/period. Threshold applies to (questionCount + notfoundCount +
  helpfulCount + unhelpfulCount).
- **Privacy boundary (D35):** Query only aggregates (feedback_counter,
  insight_aggregate tables via FULL OUTER JOIN). Never join with session,
  message, or identifying tables. topicLabel set to null (may be enriched
  later from passage metadata if needed). No session IDs, learner identifiers,
  question text, or raw feedback events exposed.
- **Feedback recording:** P02 POST /v1/feedback records only
  (topic_id, lang, period, helpful/unhelpful counts) in feedback_counter.
  Session-local negative_feedback_streak remains session-only, never in
  aggregates. P09 does not modify P02's feedback contract.
- **Question/notfound recording:** Recording logic not yet integrated into
  ask route. insight_aggregate.question_count and notfound_count must be
  incremented when reply kind recorded. Deferred to P09 follow-up or full
  implementation gate.
- **Locale keys:** insights.* keys added to en/am/om ui.yaml (27 keys,
  including title, loading, empty, error, filters, table headers, CSV download,
  summary template). All UI copy from packs, no hardcoded strings.
- **Widget page:** Teacher insights page deferred; API and service complete.
  Widget implementation and browser tests are in scope but not yet delivered.

## P08 — Telegram private-chat adapter (13 November 2026)

- **Scope before implementation:** FR-TG-01–12, FR-VOICE-02/10, related help,
  security and privacy. P08 only. The checkout was clean on the committed P07
  branch; the requested `phase-08-prompt` did not exist locally and was created
  from that commit. No commit or push is authorized.
- **Boundary:** Retain `DIMTS_TELEGRAM_TOKEN` and `DIMTS_TELEGRAM_SECRET` and
  canonical `POST /v1/telegram/webhook`. Authenticate the standard
  `X-Telegram-Bot-Api-Secret-Token` before parsing a bounded body. Hosted mode
  uses webhooks; explicitly selected polling is allowed only outside production.
  Accept supported Telegram update fields, validate strictly, and project away
  names and unused metadata before dispatch. Nonprivate updates are acknowledged
  without conversation effects. Responses contain no chat ID or message text.
- **Reuse and consent:** Use the existing session, conversation, jobs and help
  stores. HMAC identities use `DIMTS_HASH_KEY`; only explicit active P06 alert
  consent permits encrypted contact persistence. Helper routing uses bounded,
  temporary in-memory chat IDs; after restart, the next private inbound restores
  routing and replays existing help messages. `/stop` permanently revokes alerts
  for that identity and clears pending private activity; tutoring may resume.
  Session deletion erases channel state; minimal stop/replay metadata must never
  recreate a deleted session or contact through an old update.
- **Voice capability:** P04 currently provides browser/none adapters, which
  cannot transcribe or synthesize Telegram files on the server. Preserve that
  honest limitation. Provide shared file-voice ports and fixture-backed review
  tests, but no fabricated transcript or unapproved provider. Production voice
  acceptance remains blocked until a compatible adapter and language/device
  review exist. Audio stays transient and is never answered before Send.
- **Delivery:** Queue about one send per second per chat. Retry confirmed
  transient rejections with stable local identities. A lost Telegram send
  response has no server-side idempotency key; do not claim exactly-once delivery
  or blindly duplicate an ambiguous send. Preserve explicit delivery uncertainty
  and a localized recovery path. Tokens, IDs, audio and text are never logged.
  After durable STOP/deletion, cancel queued sends, retries and pending audio;
  suppress stale recovery messages. Already accepted messages cannot be recalled.
- **Consent and ordering:** Review/consent/confirm callbacks are bound to the
  current alert setup. A previous setup cannot authorize a new subscription.
  Receipt hashes accept unseen out-of-order updates; only STOP/deletion sets a
  replay cutoff. Inbound receipts precede effects, so uncertain attempts are not
  automatically repeated. Exactly-once recovery is not claimed.
- **Presentation:** Helper Telegram sessions expose text chat and image-description
  guidance, with unavailable browser media controls hidden. Registry language
  choices retain full tags; Telegram command menus use deterministic ISO 639-1
  aliases with English defaults. Labels are bounded to 20 Unicode characters.
  Oversized single sentences fall back to word/code-point chunks; this policy
  needs review and is not strict sentence-boundary acceptance for that edge case.

## P07 — SMS and simulator (13 November 2026)

- **Scope before implementation:** FR-SMS-01–12, FR-LANG-12/17 and channel
  privacy. P07 only on `phase-07-prompt`; P06 performance/review gates remain
  open. Reuse the conversation engine and P06 subscriptions, not parallel stores.
- **Agreed API contract:** `POST /v1/sms/inbound` takes `{id,from,text}` under
  `Authorization: Bearer DIMTS_SMS_GATEWAY_SECRET`; the separate secret is never
  bundled in the simulator. Return `{messages,stopped,lang}`, where messages
  contain `{id,text,encoding,units,segments,status}` and no phone number.
  IDs deduplicate by keyed phone identity; changing the body under an existing
  ID is a conflict. The simulator uses this same endpoint with operator-entered,
  memory-only settings. No real SMS operator is claimed or required for P07.
- **Gateway boundary:** Preserve the documented `send/onInbound/status` port;
  add optional idempotency metadata. The optional HTTPS adapter uses version
  `dimts.sms.gateway.v1`, a separate Bearer token, and POST actions `send` and
  `status`. Send accepts `{to,text,lang,idempotencyKey}` and requires a receipt
  with the same key plus `{id,segments,status}`. Status takes `{id}` and returns
  `{id,status}`. Both responses carry the version. Adapters must durably
  deduplicate before external delivery, including after receipt loss. Calls
  are bounded to 2.5 seconds each; two retries reuse the same key.
- **Privacy and recovery:** Store HMAC phone identities and permanent STOP
  tombstones. Persist no phone outside encrypted, explicitly consented P06
  subscriptions. Conversation/continuation and replay payloads are encrypted,
  bounded and retained only as needed; daily counters/delivery IDs are durable.
  STOP takes priority, revokes all matching P06 subscriptions across sessions,
  erases pending content, confirms once, and prevents later delivery.
- **Callback:** HELP/person asks for a separate Y. Only then may an optional
  authenticated HTTPS callback port receive the transient number. Its version
  is `dimts.sms.callback.v1`; payload `{from,sessionId,lang,idempotencyKey}` and
  matching accepted receipt. No durable callback phone store. Missing host
  configuration produces a localized unavailable response, not a fake request.
- **Encoding and continuation:** Count the actual transmitted text using the
  authoritative GSM-7/UCS-2 calculator, including extension units and UTF-16
  units. Normalize curly quotes/apostrophes only for SMS transmission and
  keyword matching. Prefer complete sentences, including Ethiopic full stops,
  within three segments including the continuation cue. An indivisible oversized
  sentence falls back to bounded word/code-point chunks so continuation makes
  progress without splitting surrogate pairs; cap at ten pages and never offer
  continuation beyond stored content. Source text and locale review status stay
  unchanged. Draft keywords/translations require native-language review.
- **Operational bounds and simulator:** Tutor/callback/subscription failures keep
  the pending inbound identity so retries can recover. STOP revokes outside
  the per-phone queue, erases P06 contacts before acquiring the confirmation
  lock, and retains only the canned confirmation intent for crash recovery.
  Three HTTP send attempts use 2.5-second deadlines; the first status read
  uses the send receipt, keeping delivery within P06's bound. STOP's single
  confirmation is permitted even after the daily cap; all other output is
  capped. The standalone simulator requires a test server and operator-entered
  test credentials; changing UI language does not change the numeric SMS menu.
  A new thread clears browser memory and cannot reset a server STOP tombstone.
- **P06 delivery compatibility:** Default application wiring routes every SMS
  digest through the native SMS service, including when a legacy host relay
  advertises SMS. Without configured native SMS, that channel is unavailable;
  it cannot bypass STOP or daily budgets. Host Telegram and accommodation
  delivery remain intact; explicit injected delivery ports remain test seams.

## P06 — jobs, alerts and private accommodation (13 November 2026)

- **Scope before implementation:** FR-JOB-01–11, FR-INT-07, FR-TUTOR-09,
  FR-SIMPLE-04, related FR-SMS-06/09 and FR-TG-01/11 delivery integration,
  and privacy rules. P06 only on the user-created `phase-06-prompt`.
- **Agreed API/domain/client contracts:** `POST /v1/jobs/import` accepts
  `{lang,postings}` containing schema.org JSON-LD, arrays or `@graph`; errors
  identify input indexes. Reuse the P02 parser, including its canonical URL
  provenance requirement; never invent a citation URL. Imports require a
  separate secret key in the existing host-key registry. Add `key_type` with
  a safe public default; existing widget keys do not gain import authority.
  `GET /v1/jobs?sessionId=...&lang=...&region=...&type=...` returns public jobs,
  configured channels, relay availability and glossary explanations. The API
  formats deadline/interview displays through P01's calendar formatter.
- **Subscriptions:** POST uses `{sessionId,clientRequestId,jobType?,region?,lang,
channel,contact,consent:{accepted:true,noticeVersion:"job-alerts-v1"}}`.
  Consent precedes contact entry. GET lists owned subscriptions without contact;
  DELETE by ID stops and erases contact. Encrypt contact with AES-256-GCM and
  retain only a keyed continuity hash. Bound consent to 30 days unless renewed
  explicitly. A daily digest uses durable delivery identities, an immutable
  retry snapshot and unique subscription/job receipts. Stop and delivery share
  a lock; outbound operations are bounded below one minute. Dry run sends nothing.
- **Accommodation:** the existing POST path uses explicit `action` values
  `draft`, `resume`, `approve`, `send`, `cancel`; owned IDs and revision checks
  prevent stale approvals. Draft fields are `sessionId,clientRequestId,jobId,
lang,needs,otherText?,name?,interviewAt?`. Needs are `sign_language_interpreter`,
  `step_free_access`, `written_questions`, `extra_time`,
  `screen_reader_friendly_test`, `other`. Name and interview
  time are optional. Persist private draft/review text encrypted; approval
  authorizes that exact revision/message. GET lists owned resumable records.
  Employer email comes from the posting's standard
  `hiringOrganization.contactPoint.email`; it is not a caller-controlled target
  and is omitted from public listings. Missing contact/relay is unavailable.
- **Delivery:** P06 defines versioned digest/accommodation ports and a real,
  optional host HTTP relay configured with an HTTPS URL and server-only secret.
  The relay must honor stable idempotency keys; network ambiguity never means
  successful delivery. Only configured channels are offered. Native SMS and
  Telegram adapters remain P07/P08 work; no successful no-op adapter is allowed.
- **Privacy boundaries:** Support I need is an in-memory client filter only;
  never send it in URLs, API payloads, logs or browser storage. Local resumable
  flow state excludes contact, names and accommodation choices/text. Domain
  deletion covers all career data and session deletion cascades private records;
  P11 owns the complete cross-channel `/v1/data/delete` endpoint. Existing
  anonymous consent metadata contains no content or learner identifiers.
  Opening careers opts into per-tab sessionStorage of only the session ID and
  rotating resume credential, scoped to API/public host key. This enables
  authorized Stop and encrypted draft recovery after reload. Store no bearer,
  contact, name or private draft there; clear on invalid/expired session or
  uninstall. Existing users who never open careers retain memory-only sessions.
- **Recovery and retention:** Commit a digest's immutable payload/identity and
  an accommodation's delivery-attempt marker before the network call. Approved
  requests cannot be edited; uncertain delivery must retry the same request,
  rather than cancel or replace it. The owned response exposes `sendAttempted`
  so reload preserves this restriction. Full data deletion remains available
  through the domain port. Daily budgets use UTC; private requests expire thirty
  days after the optional interview, or after creation if no date was provided.
  Startup and a sixty-second sweep remove expired career data independently of
  the optional alert timer. The three added career glossary terms and new
  Amharic/Oromo copy remain drafts pending native-language review.

## P05 — human help and sharing (13 November 2026)

- **Scope before implementation:** FR-HELP-04–19, regression coverage for
  FR-HELP-01–03, and help-related NFR-SEC, NFR-REL and NFR-PRIV. P05 only on
  the user's `phase-05-prompt`; no agent commit/push. Preserve existing
  request, claim, block, chat replay and session authentication contracts.
- **Fallback decision:** the user delegated the unspecified choice to the
  implementer. Use an explicit Leave a message action in the existing waiting
  request for waiting, five-minute timeout and outside-hours fallback. The
  SRS permits this alternative. Persist through the existing help chat, with
  the same authorization and retention; no second request type, contact field
  or implied callback delivery. Telegram/callback delivery requires the later
  channel integration and an actual configured destination/contact policy.
- **API/client agreement before coding:** authenticated
  `GET /v1/help/availability?sessionId=...` returns
  `{available,nextOpenAt?,waitTimeoutMs}` using validated UTC helper hours.
  Claims respect those hours; creating a waiting message request remains
  possible outside them. The default wait threshold is 300,000 ms, without
  a countdown. Availability describes schedule, not a promise of staffing.
- **Media contracts:** `POST /v1/help/{id}/ice` accepts learner `{sessionId}`
  or helper `{}`, returns `{iceServers,expiresAt?}`, and authorizes active
  participants. Metered secrets stay server-side; absent credentials use
  public STUN. `POST /v1/help/{id}/image?sessionId=...` accepts raw validated
  JPEG/PNG/WebP bytes up to 2 MiB, returns `{id,expiresAt}`. Authenticated
  `GET /v1/help/{id}/image` lists `{images:[{id,expiresAt}]}`;
  `GET /v1/help/{id}/image/{imageId}` returns authorized bytes. Learners own
  the request; helpers must be active and assigned. No original filenames,
  disk storage or public image URLs; delete on close/session end or at two hours.
  Use the Apache-2.0 `sharp` decoder for bounded full-image validation and
  metadata stripping; signature checks alone cannot validate compressed images.
  Bound decoded pictures to 16 million pixels, one frame, and five unexpired
  pictures per request. Retrieval rejects expired bytes at two hours; the
  running API's 60-second cleanup sweep removes expired database rows with
  up to one minute of scheduling lag. Close/session deletion is immediate.
- **Helper opt-in and aggregate outcomes:** authenticated GET/PATCH
  `/v1/helpers/profile` uses `{displayName:string|null}`, absent by default.
  Helper close may supply `resolved:boolean`; omission means unknown.
  `GET /v1/help/metrics` returns only
  `{closedCount,resolvedCount,unresolvedCount,totalWaitMs,totalResolutionMs}`.
  No content, request/session/helper identifiers or individual timing rows.
- **Transient sharing:** helper requests; learner accepts or declines before
  browser permission. Role-checked `share.*` and `rtc.*` frames are never
  persisted/replayed. No audio, recording or control; cap at 5 fps/300 kbps.
  Either-side stop, disconnect, hidden widget, session replacement and browser
  stop end media. Unsupported or failed capture offers picture and words.
  `help.joined` gains `helperJoined:boolean` and optional opted-in `helperName`
  so socket authentication is not mistaken for a person joining.
  A valid learner `share.accept` records only a random consent-row ID, channel,
  notice version `screen-share-v1`, purpose `screen-share` and timestamp in
  the existing consent log. No request/session/helper ID or content is stored.
  Failure to record consent prevents negotiation; decline records nothing.

## P04 — controlled browser voice (13 November 2026)

- **Requirements before implementation:** FR-VOICE-01–10/12, FR-UI-06,
  FR-LANG-05 and NFR-A11Y-07. FR-VOICE-11 is removed. The user authorized
  P04 only on `phase-04-prompt`; no commit or push by the agent.
- **Supported engines and privacy:** `DIMTS_STT_ENGINE` and
  `DIMTS_TTS_ENGINE` accept `none` (default) or `browser`. Browser STT must
  explicitly support on-device recognition and report the declared language
  available locally; TTS must select a matching local-service voice. No
  automatic language-model download, remote fallback, audio storage or audio
  cache. Existing question/passage consent is not consent to transmit audio.
  No selected engine requires server STT/TTS, so `/v1/stt` and `/v1/tts` are
  not introduced. Remote/server engines require a separately reviewed data
  policy, binding and endpoint contract before they can be selected.
- **Configuration transport:** extend each existing `/v1/languages` item
  with `voice: {engine: "browser", bcp_tag: string} | null`, reusing the
  locale voice declaration names. Existing `stt`/`tts` booleans describe the
  intersection of deployment selection and reviewed, non-draft pack flags.
  Preview never authorizes draft voice. Runtime browser capability may reduce
  these flags further. Keep Zod, OpenAPI and the widget in sync; no new
  configuration endpoint or private credentials are exposed.
- **Interaction and cleanup:** confidence below 0.5 or a non-finite confidence
  requests another attempt. Stop finalizes a recording; cancel discards it.
  Language/session changes, hide/close and disconnect cancel native work and
  invalidate late results. Voice does not fall back to another language;
  localized UI reasons keep the existing text fallback. Recording sounds are
  separately switchable; explicit voice review keeps transcript read-back,
  while the Read-aloud preference controls automatic tutor replies.
- **Evidence:** all shipped voice declarations/flags remain disabled until
  real per-language, per-direction eight-of-ten Android results and native
  review exist. Automated browser doubles prove behavior, not intelligibility
  or screen-reader support. Candidate sentences and pending results must be
  distinguished from approved evidence in `docs/VOICE_TEST.md`.

## P03 — widget, offline FAQ and Level 1 embedding (13 November 2026)

- **Requirements before implementation:** FR-UI-06/08–10/14/16/18–20;
  FR-CONV-11/12; FR-AI-05; FR-SIMPLE-02/03; FR-INT-01–04/11;
  NFR-A11Y-01–06; NFR-PERF-01/02/05/06/07; FR-LANG-06–08/14.
  The user reported P02 committed/pushed and authorized P03 only on
  `phase-03-prompt`. Preserve the existing API, widget and source-sync contracts.
- **Additive FAQ contract approval:** P03 explicitly authorizes
  `GET /v1/locales/{code}/faq`; this entry records that authorization and the
  agreed API/client contract before implementation. Return
  `{lang, dir, contentVersion, reviewedOn, items}`; `reviewedOn` is a date or
  null, and each item is `{id, question, answer, citations}` using the existing
  canonical Citation schema. The normal locale/preview visibility rules apply,
  but preview never publishes unreviewed answers. Unreviewed packs return no
  items and null review date. Reviewed items require exact, unambiguous active
  course provenance; omit unresolved, removed or ambiguous sources. Review
  metadata describes the pack, so a reviewed pack can still return no items.
  No reviewer identity is public. Hash the complete response for ETag and use
  `public, max-age=0, must-revalidate`; conditional requests may return 304.
  Cache only validated successful responses. Offline content is explicitly
  identified as saved content, never generated as a new course answer.
- **Review boundary:** locale additions remain authoring drafts under the
  existing pack status. Fixtures establish behavior, not human approval.
  Physical 1 GB Android memory, native assistive technology and co-designer
  acceptance require real evidence and remain open until supplied.
- **Consent and feedback:** keep cloud use off until an explicit session
  choice. Use the existing `remote-ai-v1` notice/session contract, rotate
  credentials through session resume, and block the next ask while a choice
  is pending or failed. Do not persist consent in browser preferences. Feedback
  uses only `{replyId, helpful}` plus the existing bearer authorization; P02
  retains anonymous topic counters and the bounded session streak.
  If a saved consent response is lost and the rotated resume token is rejected,
  recover through the existing new-session contract with remote AI off. Clear
  expired conversation/help state, preserve the unsent draft and preferences,
  and explain the fresh session in localized copy. Never replay an opt-in
  automatically or submit another question with uncertain consent.
  Detach the old help connection locally; a rotated-away credential cannot
  authenticate a server-side close, so recovery does not claim that closure.
- **Embedding and cleanup:** support the existing four-method public API and
  element events through a classic async bootstrap plus ES module chunks.
  Removing the installing script uninstalls its widget. Preserve unrelated
  host storage, service workers and pre-existing Lit diagnostic globals.
  Keep bundled Lit property metadata in a private build-time module; reuse a
  pre-existing host map for interoperability rather than deleting functional
  metadata. Browser tests exercise a fresh subclass and reinstall.
  Recheck all active, waiting and installing worker URLs before registration
  or unregistering: the host may replace a registration after widget startup.
  Nonces use the native nonce property. All user copy, including cold-start
  copy injected at build time, comes from locale packs.
- **Offline ownership:** cache only public widget assets, language UI and
  reviewed FAQ data scoped to the API origin/path. Prefetch the active FAQ
  without delaying chat; revalidate on browse, identify offline copies, and
  remove withdrawn answers. A saved FAQ can be used after a two-second wake
  timeout; user cancellation still aborts. Error responses are not cached.
  The host remains responsible for its own offline HTML/router; a third-party
  script cannot safely cache arbitrary host pages or replace a host worker.
- **Fonts and budgets:** retain the self-hosted regular Ethiopic font and
  browser-synthesized bold in the learner widget, avoiding a second 75 KB
  initial font download. Frozen assets remain unchanged. Measure the static
  import graph separately from deferred voice/help, and include the font,
  largest locale UI and conservative authored-FAQ representation in the first
  load budget. Timing tests use real compressed local HTTP responses with
  server-side latency and a shared body-rate cap, covering service-worker
  requests as well as page requests. Headers and small uploads are unshaped;
  this fixture does not establish production hosting or device performance.
  The classic bootstrap imports the complete widget module directly, avoiding
  a serial loader/facade round trip. The single entry retains DimtsAssistant
  and installEmbed exports plus internal Lit aliases needed by deferred help;
  those aliases are not a supported host API. The four-method window API is
  unchanged. Record first-visible browser-frame timestamps rather than the
  later time at which automation receives the observation.

## P02 — tutor and provider contracts (13 November 2026)

- **Requirements before implementation:** FR-CONV-05–09/13/14;
  FR-TUTOR-07–11/14; FR-AI-02–10; AR-01/06/08; NFR-MAINT-02,
  NFR-PRIV-03 and NFR-PERF-03. Follow P02's original prompt in
  `docs/REMAINING_WORK_PLAN.md` and Blueprint sections 6, 7 and 10.
  P01 was committed and pushed by the user; P02 is the only current scope.
- **Feedback boundary with P09:** implement the existing `POST /v1/feedback`
  contract using only `{replyId, helpful}` and the current session bearer.
  Resolve ownership server-side; unknown or other-session replies receive
  the same authentication failure. Retain no per-tap event. The existing
  `feedback_counter` stores only topic (first cited passage or `uncategorized`),
  language, date and counters, never a session/reply identifier or text.
  A session-local small integer, capped at two, records only its current
  negative streak. Helpful feedback and a consumed gentle-help offer reset
  it; session retention deletes it. P09 must reuse these counters and must
  not introduce session identifiers into aggregate rows.
- **Conversation signals:** select only the two most recent reply kinds,
  never message text or transcript history. Rules come from the locale pack;
  help/distress takes precedence over a greeting in a mixed message.
- **Answer cache:** use the existing PostgreSQL `answer_cache`, normalized
  question/language/Simple/content-version hash and 24-hour expiry. Only
  grounded answers are eligible; store a neutral cache ID and issue a fresh
  reply ID on retrieval. Citation and content-version checks remain in the
  engine. Source synchronization retains its atomic cache invalidation.
  Cache logs contain only a hit/miss enum, never keys, text or identifiers.
- **Review boundary:** committed P01 data remains unreviewed. No native
  language, model quality, physical-device or third-party latency evidence
  is inferred from mock adapters or successful configuration parsing.
- **Provider boundary:** native OpenAI/Gemini/xAI transports share the
  conformance contract with compatible local and offline adapters. Preserve
  explicit ladder order (including offline); only unspecified enabled
  bindings use priority order. Registry capabilities intersect declarations
  with the actual adapter. Remote payloads exclude glossary, job text,
  history and identity; those have no authorized remote data class here.
  Health, malformed retries and generation share one timeout budget.
- **Retrieval and FAQ provenance:** only matching, reviewed glossary mappings
  authorize other source languages, with same-language priority before SQL
  candidate limits. Raw FAQ source IDs resolve through the existing exact
  source/resource SHA-256 namespace, restricted to active retrieved passages;
  unknown or ambiguous matches decline. No public format or source-sync
  contract changes. Job date validation rejects impossible dates; metadata
  fields form complete extractable units while original descriptions remain.
- **Output validation:** known instruction-injection patterns are quarantined
  alongside untrusted-data separation, citation and language checks. This is
  not a claim to detect every attack. Wrong-language or overlong output gets
  one supported extractive retry, then localized notfound. Never clip words,
  remove qualifications or lower confidence floors to improve metrics.
- **Evaluation evidence:** report refusals and missing observations as well
  as successful answers. FAQ-adapter accuracy is separate from end-to-end
  answer recall. Real HTTP/PostgreSQL latency is measured at server entry to
  response completion with warm serial samples; client listener/network
  setup is excluded. CI runs the database suites serially to avoid measuring
  unrelated test load. All remaining blockers are in the progress record.

## P01 — language capability decisions (13 November 2026)

- **Requirements before implementation:** FR-LANG-01–05, 09–13, 15–17;
  FR-CONV-05/07 phrase data; FR-TUTOR-08/10 prompt/evaluation data;
  FR-AI-04/FR-UI-16 FAQ data; NFR-A11Y-07 voice-status data and the
  NFR-MAINT-02 locale coverage floor. Scope follows P01 in
  `docs/REMAINING_WORK_PLAN.md`, with Blueprint section 8 authoritative.
- **Truthful pack status:** English stays beta, Amharic/Oromo stay draft,
  and `ar-test` stays CI-only draft. Agent-authored translations and phrase
  lists are drafts. A human must review them; filling a reviewer field is
  not an automated review. Distress data also needs co-designer review.
  Contacts remain absent until verified by the host, as Blueprint section
  5 requires. No native-language, voice, or Android acceptance is claimed.
- **Content boundary:** use only the checked-in study-plan and sample-job
  sources for draft questions and FAQ provenance. Nine FAQ entries and 30
  glossary seeds each for `en`, `am` and `om` are useful review material, not the 30 FAQ /
  200 reviewed-term live target. Do not invent answers or pad lists.
- **Per-key fallback contract:** keep the existing locale UI JSON record
  and endpoint. Resolve missing keys through `meta.fallback`; the additive
  `X-Dimts-Locale-Fallback: 0|1` response header is exposed through CORS,
  documented in OpenAPI, retained on 304, and included in the ETag identity.
  API and widget changes are paired in this branch for team review. The
  widget announces a fallback once per active session. Transliteration
  mappings are language capabilities, so they are not inherited from a
  fallback language. Draft endpoint gating remains unchanged.
- **Input helper:** optional `transliteration.map.<latin>` and
  `transliteration.word.<latin>` keys carry suggestion data through the
  existing string-only UI contract. Common control labels obey key parity;
  these optional mapping prefixes are validated separately. Suggestions
  remain editable and require confirmation; Send remains a separate action.
- **Registry and preview:** both language pickers consume the existing
  `/v1/languages` metadata. Helper names, direction, font script and beta
  status come from that registry. Explicit `?lang_preview=1` is forwarded
  for pack inspection; it does not grant draft languages permission to
  create learner sessions or ask questions.
- **Existing-flow regression (FR-HELP-07):** the full browser run exposed
  a baseline WebSocket URL failure with `data-api="/v1"`. Resolve that URL
  against the page origin in both existing clients, as already done for
  static API requests. The test covers login/claim/chat/close with absolute
  and relative API roots; this preserves help behavior without implementing
  P05's remaining features or changing a help contract. Successful learner
  closure also shows the existing `help.ended` notice even if no WebSocket
  close frame arrives before the HTTP response.
- **Formatting:** use the blueprint's locale month names and ICU date
  templates, Western digits, UTC dates and deterministic Ethiopian
  conversion. This avoids substituting a host ICU month spelling for the
  required `ህዳር` fixture. Gregorian Oromo month names remain English pending
  the language lead's decision, as allowed by the SRS language guide.
- **Dependencies/tooling:** reuse existing YAML and ICU runtime dependencies.
  Add only Vitest's matching MIT-licensed V8 coverage provider as a development
  dependency to enforce the requested 70% locale coverage floor. Repair the
  pre-existing lockfile omission of four `packages/eval` workspace links;
  this does not implement P02. Keep CLI scaffolds atomic and prevent
  overwriting an existing language folder.
- **Acceptance evidence:** current checks and remaining blockers are recorded
  in `docs/IMPLEMENTATION_PROGRESS.md`; no unverified requirement is complete.

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
  running Playwright. The then-current browser run passed 10/10 tests,
  including zero critical/serious axe violations and storage-disabled behavior.
- **Implemented, acceptance criteria still outstanding:** text chat, citations,
  beta labels, persisted language/settings, read-aloud using browser speech
  synthesis, and data-saver caching. At that checkpoint, FR-UI-06 microphone
  cues were not implemented. Offline recovery restores static language/UI data
  only; FR-UI-16's offline FAQ is blocked by empty FAQ packs and the absence
  of a documented FAQ API contract. Do not fabricate course answers.
- **Other WP05 gaps at that checkpoint:** FR-UI-13 needed a self-hosted
  Ethiopic font. The specified 200% browser-zoom check, 8px spacing
  verification, focus-ring contrast audit, and FR-UI-18/19 acceptance criteria
  were outstanding. The help action emits the host event; the actual human
  handoff is WP07. Draft-language UI copy still needs language-lead review.
- **Deployment constraint:** service-worker support requires the widget module
  and `/service-worker.js` to be served from the embedding page's origin. The
  service worker caches shell assets; static API responses use the widget's
  separate CacheStorage logic. A cross-origin embed cannot install the worker
  for its host page.

## WP05 accessibility follow-up — requirements before implementation

- **FR-UI-02:** Help me now must be reachable within the first five tab stops
  on every screen.
- **FR-UI-07/08:** accessibility settings apply immediately and persist; the
  layout must reflow without horizontal scrolling at 320 CSS pixels and 200%
  text size.
- **FR-UI-10:** default and high-contrast text colors must meet 7:1 contrast;
  the focus ring remains at least 3px wide with a 2px offset.
- **Scope:** add browser coverage for chat keyboard order, 200% reflow, and the
  contrast tokens/disabled controls before changing the widget.

## WP05 accessibility follow-up — verified acceptance

- **FR-UI-02:** Help me now is the first welcome tab stop and the third chat
  tab stop (after language and settings), with fixed viewport placement.
- **FR-UI-07/08:** choosing 200% text applies immediately and persists across a
  page reload; at that setting the widget reflows at a 320 CSS-pixel viewport
  without horizontal overflow. This does not claim a separate browser-zoom
  simulation.
- **FR-UI-10:** default and high-contrast text, muted-text, and primary-button
  token pairs pass the 7:1 threshold. Disabled controls retain full opacity;
  keyboard focus remains a 3px outline with a 2px offset.
- **Verification:** `pnpm test:widget` passes 20/20, including axe checks with
  no critical/serious violations. Widget typecheck, targeted ESLint, Prettier,
  locale-copy validation, and `pnpm size` pass. The bundle is 29,604 compressed
  JavaScript bytes; initial-load assets are 30,750 compressed bytes.
- **Outstanding at that checkpoint:** FR-UI-06's moving ring/tone/haptic
  feedback, FR-UI-09's full spacing audit, FR-UI-13's Ethiopic font,
  FR-UI-14's on-demand voice/help loading, and FR-UI-16's offline FAQ required
  separate work. Offline course answers remain blocked on approved FAQ
  content and a documented contract.

## WP05 in-depth continuation — requirements before implementation

- **FR-UI-06:** the microphone state must be conveyed by its accessible name,
  visible moving ring, tone, and short vibration where supported; reduced-motion
  and silent operation must remain understandable.
- **FR-UI-09/11:** interactive targets require 48px minimum size with 8px
  spacing; animation must respect both `prefers-reduced-motion` and Stop motion.
- **FR-LANG-06:** language names are spoken on focus when TTS is available, and
  changing language must preserve the conversation and return focus to the
  picker.
- **FR-UI-13:** use a self-hosted Noto Sans Ethiopic subset only while Amharic
  is active; the widget must not make third-party font requests.
- **Scope:** add failing browser coverage for the voice cues/reduced-motion
  states, language focus behavior, target spacing, and conditional font load
  before implementation.

## WP05 in-depth continuation — verified acceptance

- **FR-UI-02:** Help me now remains fixed in the same viewport corner on the
  welcome and chat screens and is reachable within the first five tab stops.
- **FR-UI-06:** the 64px microphone is centered on a 320px viewport. Recording
  visibly animates a ring, plays the specified 660Hz start and 440Hz stop
  tones, and requests the specified vibration patterns when supported. The
  accessible pressed state remains clear without audio or motion; reduced
  motion disables the ring, and Stop motion disables both ring and vibration.
- **FR-UI-09/11:** 48px controls and 8px spacing are checked on welcome, chat,
  and settings at 320px. The motion tests cover both the media preference and
  the in-app setting.
- **FR-LANG-06:** the native language name is spoken on focus only when the
  selected language and injected TTS adapter support it. Changing language
  keeps existing messages and restores focus to the language picker.
- **FR-UI-13:** regular and bold Noto Sans Ethiopic subsets are self-hosted
  under the OFL license and registered only when Amharic is active. Browser
  tests verify no font request in English and only same-origin font requests
  when Amharic is active.
- **Verification:** the latest full widget run passed 27/27 tests, including
  axe checks with no critical/serious violations. Widget typecheck, targeted
  ESLint, stylesheet lint, localized-copy check, locale-pack validation, and
  the size gate pass. The gate measured 30,456 compressed widget JavaScript
  bytes and 31,602 compressed initial-load bytes.
- **Still outstanding:** FR-UI-14's on-demand voice/help code loading is not
  established; the widget currently receives voice adapters from its host and
  the build still inlines dynamic imports. FR-UI-16's offline FAQ remains
  blocked by empty FAQ packs and the lack of a documented FAQ API contract.
  Browser-zoom simulation and a manual focus-ring contrast audit are also
  outstanding. These criteria are not claimed complete.

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

## WP07 help backend contract staging

- **Requirements:** FR-HELP-01 says one activation creates a help request;
  FR-HELP-02 requires a preview of the language and optional last three
  questions, followed by one confirmation before sending. FR-HELP-05 requires
  configurable helper availability hours. FR-HELP-06 requires a
  language-filterable queue and atomic claiming. FR-HELP-13 limits handoff data
  to language, channel, optional last three questions, and chat. FR-HELP-15
  requires help data deletion at session end or retention expiry. FR-HELP-17
  requires a limit of five requests per hour per session and helper blocking.
- **Contract resolutions:** The Help me now action opens the preview; the
  explicit confirmation sends the request. `DIMTS_HELPER_HOURS` is a JSON
  weekly schedule using UTC and ISO weekdays (Monday=1 through Sunday=7),
  with each interval represented by `day`, `start` and `end` (`HH:mm`);
  overnight hours are represented by intervals on both days. An unset schedule
  does not restrict availability. This schedule format and flow clarification
  are recorded in the Blueprint.
- **Implementation boundary:** Do not invent missing public request/response
  fields or a block endpoint. The help-request, queue-response, and block
  contracts remain pending; implement only contracts fully specified by the
  Blueprint or compatible SRS detail. The schedule parser is internal until
  the availability response for the learner is specified. The five-per-hour
  limit remains for the request-creation increment.
- **Verified acceptance (first backend slice):** Helper login returns only a
  JWT for a valid helper token; invalid tokens and revoked helpers are rejected.
  Claim authentication and the one-winner HTTP behavior pass focused tests.
  `DIMTS_HELPER_HOURS` strictly parses UTC weekly intervals and the availability
  function passes fixed-time boundary tests. OpenAPI includes helper login and
  claim.
- **Validation:** All 48 API tests pass; 7 PostgreSQL integration tests are
  skipped because `DIMTS_TEST_DATABASE_URL` is unset. API build, lint,
  formatting, and `git diff --check` pass. The new PostgreSQL two-helper
  integration test is present but still needs a configured test database.
- **Still pending:** Help request creation and privacy-limited summary,
  language-filtered queue, end-help, learner availability response/UI,
  five-per-hour request limit, helper blocking, learner/helper interfaces, and
  widget reconnect/live-region behavior. The block behavior and public shapes
  noted above require contract resolution before implementation.

## WP07 WebSocket relay increment

- **Requirements:** FR-HELP-07 requires WebSocket chat with reconnect and
  message ordering. FR-HELP-13 limits helper handoff data to language, channel,
  optional last three questions, and chat messages.
- **Contract boundary:** Follow Blueprint section 7.3 for `/v1/help/ws`,
  first-message authentication within five seconds, close code `4401`, learner
  session-token or claimed-helper JWT authentication, `lastMessageId` replay,
  and the `help.joined`, `chat.message`, and throttled `chat.typing` frames.
  Chat text is capped at 2,000 characters, typing is limited to one frame per
  second per connection, and message IDs are idempotent. Leave WP09 share/RTC
  signaling out of this increment.
- **Verified acceptance:** WebSocket tests cover the five-second auth timeout,
  `4401` rejection, strict auth frames, learner and claimed-helper access,
  ordered chat delivery, duplicate suppression, reconnect replay, and typing
  throttling. PostgreSQL integration verifies token scoping, active/claimed
  helper checks, persisted ordering, replay cursors, duplicate handling, and
  rejection after closure. The API server attaches and closes the WebSocket
  runtime through its lifecycle.
- **Validation:** All 55 non-PostgreSQL API tests pass. All 8 PostgreSQL
  integration tests pass against an isolated temporary database. API build,
  lint, formatting, and `git diff --check` pass.
- **Still pending:** Widget-side reconnect and live-region behavior, help
  creation/queue/closure, availability response, the five-per-hour limit,
  helper blocking, and WP09 share/RTC signaling. Rooms are process-local as
  permitted for the single instance; multi-instance fan-out needs a broker.

## WP07 MVP help-flow contract — approved

- **Requirements:** FR-HELP-01/02 require explicit confirmation before request
  creation; FR-HELP-03/05 cover waiting and availability states; FR-HELP-06
  requires a language-filterable helper queue and atomic claim; FR-HELP-07
  requires ordered, reconnectable chat; FR-HELP-13 limits helper-visible data;
  FR-HELP-15 requires deletion at session end or retention expiry; FR-HELP-17
  requires request limits and helper blocking.
- **User-approved create contract:** `POST /v1/help` accepts the session
  identity and `includeSummary` boolean, and returns `{id, status}` with
  `status: "waiting"`. The server derives language and channel from the
  authenticated session; when enabled, the only context shared is the last
  three learner questions.
- **User-approved queue contract:** `GET /v1/help/queue` accepts an optional
  `lang` filter and returns `{requests:[{id, lang, channel, createdAt,
summary}]}`. `summary` is null when excluded; otherwise it contains only
  those last three questions. The documented close path remains
  `POST /v1/help/{id}/close`.
- **User-approved blocking effect:** a helper blocks only a specific request
  from that helper's own queue; other helpers and the learner's request remain
  unaffected.
- **User-approved blocking operation:** `POST /v1/help/{id}/block` requires a
  helper JWT and returns `{ok:true}`. It persists only a helper/request
  exclusion and does not close the request or hide it from other helpers or
  the learner.
- **Implementation boundary:** do not add screen-sharing, image transfer, or
  WebRTC behavior (WP09). Do not log learner messages, names, phone numbers,
  or Telegram IDs.

## WP07 learner/helper interface increment

- **Requirements:** FR-HELP-01/02 cover the learner preview, optional last
  three questions, opt-out switch, and explicit confirmation. FR-HELP-03
  covers the waiting state while tutor chat remains usable. FR-HELP-06/07
  cover the language-filtered helper queue, claim, ordered chat, reconnect,
  live announcements, and closure. FR-HELP-13/15/17 cover minimal handoff data,
  retention, request limits, and helper-specific blocking. FR-HELP-14 has
  automated accessibility checks in this increment.
- **Verified acceptance:** the learner can cancel before sending, send with or
  without the optional summary, keep asking the tutor while waiting, chat over
  the authenticated WebSocket, reconnect from the last received message
  without duplicates, and return to tutor mode when either side closes help.
  The helper console is a separate build entry; its JWT remains in memory. It
  filters the queue, refreshes every 15 seconds, politely announces new
  requests, blocks per helper, claims, chats, and closes. REST close broadcasts
  `help.closed` to both connected peers. The size gate measures the learner and
  helper JavaScript separately so the helper module is not charged to learner
  initial load.
- **Accessibility/locales:** browser tests report no critical or serious axe
  violations for the learner preview or helper console; the helper console
  reflows at 320px and its tested controls meet 48px targets. New strings use
  `ui.yaml` keys in `en`, `am`, and `om`; the draft Amharic and Afaan Oromoo
  values remain English pending language-lead translation review. This is not
  a manual screen-reader, zoom, or contrast sign-off.
- **Validation:** `pnpm test:widget` passes 32/32. The focused API and size-gate
  Vitest run passes 20/20. Workspace typecheck, API build, locale check, and
  lint pass. The size gate reports 32,892/61,440 compressed learner JavaScript
  bytes, 26,464/61,440 helper-console bytes, and 34,598/153,600 initial-load
  bytes.
- **Still pending:** FR-HELP-04 timeout fallback/callback, FR-HELP-05 outside-
  hours availability messaging and response shape, FR-HELP-14 manual keyboard,
  screen-reader, zoom, and contrast checks, optional FR-HELP-16 helper first
  name, and WP09 screen sharing. Helper rooms remain process-local, so
  multi-instance live fan-out still needs a broker. Availability and fallback
  contracts must be resolved before those behaviors are added.

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

## Interactive MVP entry point

- **Requirements:** FR-INT-09, FR-UI-01/02, and FR-HELP-01/02.
- **Decision:** Keep the root `index.html` as the offline Savanna reference
  catalog. Add a direct link to the separate Compose-served Dimts learner app;
  do not load the API-backed widget from a `file://` page.

### Verified acceptance

- The root page identifies the interactive app and links to
  `http://localhost:5173/`; README points to the local setup instructions.
- The widget's existing Compose HTML template mounts `<dimts-assistant>` and
  loads `dimts-widget.js`. `scripts/test-local-compose.mjs` checks those
  contents when the stack starts.
- **Runtime not verified in this environment:** Compose acceptance could not
  run because the Docker CLI cannot connect to the Docker Desktop Linux
  engine. Use the documented setup and `pnpm test:compose` when Docker is
  available.


## P09 — Anonymous feedback and teacher insights (13 November 2026)

- **Scope:** FR-CONV-12, FR-INSIGHT-01–04, FR-UI-20, NFR-PRIV-03. P09 only on
  `phase-09-prompt` branch. No commit/push authorized.
- **Reuse strategy:** P02 already provides `POST /v1/feedback` with anonymous
  aggregation to `feedback_counter` table. P03 provides widget reply controls.
  P09 extends with `GET /v1/insights` for teacher/host access and adds
  `insight_aggregate` population. No second feedback store.
- **Access control:** Host secret key (`X-Dimts-Key` header) grants insights
  access. LTI instructor access deferred to P10. Both paths use same response
  format and privacy rules.
- **Period and aggregation:** Day-only granularity (DATE column in schema).
  No rolling windows in P09. User can aggregate dates client-side. Small groups
  (<5 total count per topic/language/period) combined into single "Other" row.
- **Privacy enforcement:** No session IDs, question text, or learner identifiers
  in counters or CSV exports. Group suppression preserves privacy at source.
  CSV generation escapes formula-injection chars (=, +, -, @).
- **Storage:** Use existing `feedback_counter` (already stores helpful/unhelpful)
  and `insight_aggregate` (adds question_count, notfound_count recording).
  No new table needed. Migration: record question/notfound on reply save.
- **CSV format:** RFC 4180 with columns: topic_id, topic_label, lang, period,
  question_count, notfound_count, helpful, unhelpful. Filename includes date.
  Formula-injection defense: quote fields starting with =, +, -, @.
- **Teacher page:** Text summary before table. Semantic HTML table with caption,
  thead/tbody, scope="col". Filters for start/end date, language, group size.
  Loading/empty/error states. CSV download. Keyboard navigation. 320px/200% zoom.
- **Locale keys:** All insights.* keys added to en/am/om ui.yaml with native
  translations. Status: en beta, am/om draft (pending native review).
- **Implementation notes:** Host key verification is a stub (awaits real secret
  hashing scheme). Insights repository uses FULL OUTER JOIN to combine feedback
  and question/notfound counts. Service applies suppression in memory. Route
  returns JSON or CSV based on format param.
