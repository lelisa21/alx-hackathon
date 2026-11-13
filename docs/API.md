# Local API

The API is a separate service from the frozen Savanna reference pages. It uses
the repository's PostgreSQL Compose service and never writes learner messages
or credentials to application logs.

## Start locally

1. Copy `.env.example` to `.env` and set a local PostgreSQL password using only
   letters, digits, hyphens, and underscores. Compose also places it in the API
   connection URL and environment interpolation.
2. Replace the four secret placeholders with distinct random values. In
   PowerShell, this generates four independent base64 values:

   ```powershell
   $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
   1..4 | ForEach-Object {
     $bytes = New-Object byte[] 32
     $rng.GetBytes($bytes)
     [Convert]::ToBase64String($bytes)
   }
   $rng.Dispose()
   ```

   Use separate generated values for `DIMTS_ENC_KEY`, `DIMTS_HASH_KEY`,
   `DIMTS_JWT_SECRET`, and `DIMTS_CRON_SECRET`; the first two must decode to
   32 bytes. Keep `.env` private and untracked.

3. Set `DIMTS_LOCAL_WIDGET_KEY` and make sure `DIMTS_HOST_ORIGINS` matches the
   widget origin. The widget key is a public identifier for local development;
   do not reuse it in production.
4. Start the local stack with `docker compose --profile local up --build -d --wait`.
   Compose starts PostgreSQL, runs migrations and local-host bootstrap before
   the API becomes healthy, and serves the widget shell at
   `http://localhost:5173`. The API is also available at
   `http://localhost:3000`. Override the API and widget
   `DIMTS_COMPOSE_*_PORT` values to avoid local port conflicts, and update
   `DIMTS_HOST_ORIGINS` if the widget port changes.
5. To stop the stack while preserving the database, run
   `docker compose --profile local down`. To remove the local database too, use
   `docker compose --profile local down --volumes`.

PostgreSQL is private to the internal backend network; use
`docker compose --profile local exec db psql -U dimts -d dimts` for local
database access. The API and widget share a separate edge bridge for the
loopback-published host ports and API integrations. All published ports bind
only to loopback. The configured AI provider defaults to offline; no provider
credentials are required for the local stack.

`GET /v1/health`, `GET /v1/languages`, `GET /v1/locales/{code}/ui`,
`GET /v1/openapi.yaml`, and `GET /v1/docs` are public. Draft packs are hidden
unless `?lang_preview=1` is supplied.
`POST /v1/sessions` requires `X-Dimts-Key` and an allowed browser origin.
`POST /v1/ask` requires the returned session bearer token and `sessionId`.

## Voice capability configuration

`DIMTS_STT_ENGINE` and `DIMTS_TTS_ENGINE` independently accept `none` (the
default) or `browser`; unsupported values fail API startup. Browser voice
requires on-device recognition and a matching local-service synthesis voice.
No selected adapter needs a server audio transport, so `/v1/stt` and `/v1/tts`
are not implemented or advertised. Remote/server engines need a separately
reviewed data policy, adapter and API contract. Question/passage consent does
not authorize sending audio. Audio is never stored or cached.

Each `GET /v1/languages` item includes the existing fields plus
`voice: {engine: "browser", bcp_tag: string} | null`. `stt` and `tts` are true
only when that direction is configured as `browser`, its pack flag is true,
and the pack has a valid browser declaration matching its language and script,
non-placeholder reviewer, real non-future review date, and beta/live status.
The declaration is null when neither direction is available. Review metadata
and identities are not exposed. `?lang_preview=1` makes draft text packs visible
but never enables their voice. Clients must also check actual device support;
the API does not claim that a particular browser has a suitable local voice.

Pack flags represent human approval of the per-language, per-direction
eight-of-ten device protocol in [VOICE_TEST.md](VOICE_TEST.md); they are not
inferred from authored sentences or automated test fixtures. All shipped
voice flags remain false until that evidence and native review are supplied.

## Embed the widget

Build the static ES module with `pnpm --filter @dimts/widget build`, then serve
`packages/widget/dist/dimts-widget.js` from the host page. Register the allowed
host origin and its public widget key with the API before using the component:

```html
<script type="module" async src="/assets/dimts-widget.js"></script>
<dimts-assistant
  data-api="https://api.example.org/v1"
  data-host-key="public-widget-key"
></dimts-assistant>
```

For offline shell support, also serve the built
`packages/widget/dist/service-worker.js` as `/service-worker.js` from the same
origin as the embedding page and widget module. A cross-origin widget module
cannot register a service worker for the host page. The worker caches the
widget entry and its static import graph from `dimts-assets.json`; voice and
help chunks remain on demand. Only Dimts-owned assets and the configured API's
public language/UI/FAQ GET routes are cached. The widget separately caches
validated reviewed FAQ responses, so cached questions remain usable when the
API is asleep or offline. No session, ask, feedback, or help response is cached.
See [INTEGRATION.md](INTEGRATION.md) for the asynchronous script-tag, CSP, and
uninstall contract.

The widget loads visible language packs, asks the API for a pseudonymous
session, and keeps the bearer token in memory. The host can call
`window.Dimts.open()`, `close()`, `setLanguage(code)`, or `escalate()`.
`dimts:opened`, `dimts:closed`, `dimts:language`, and `dimts:escalated` events
are dispatched on `window`. It renders in a shadow root so host styles do not
change its controls.

The helper console is a separate module; serve it only on a helper-facing page
so learner pages do not load helper code:

```html
<script type="module" async src="/assets/dimts-helper-console.js"></script>
<dimts-helper-console
  data-api="https://api.example.org/v1"
  data-language="en"
></dimts-helper-console>
```

Helpers enter their token in the console; do not embed it in page markup. The
learner Help me now action previews the language and optional last three learner
questions before creating a request. Learners can keep using tutor chat while
waiting, then chat with and close the assigned helper request. The console
supports language-filtered queues, request blocking, claiming, chat, and close.
Its `en`, `am`, and `om` UI strings are served from locale packs; Amharic and
Afaan Oromoo wording still requires language-lead translation review.
The open console refreshes its waiting queue every 15 seconds and announces
new requests. The outside-hours availability response and timeout callback or
Telegram fallback are not part of this increment; screen sharing remains WP09.

Run `pnpm test:widget` to build the widget and run its browser flows, including
storage-disabled behavior, reflow, axe checks, and offline shell/language-cache
recovery. Read-aloud via browser speech synthesis is available when selected;
production microphone recognition remains gated on device and provider review.

## Reviewed offline FAQ

`GET /v1/locales/{code}/faq` is a public, credential-free response. The optional
`lang_preview=1` follows the language/UI preview contract; it never authorizes
publishing draft answers. The canonical Zod/OpenAPI response is:

```json
{
  "lang": "en",
  "dir": "ltr",
  "contentVersion": "active-source-version",
  "reviewedOn": "2026-01-01",
  "items": [
    {
      "id": "deterministic-faq-digest",
      "question": "Example reviewed question?",
      "answer": "Example reviewed answer.",
      "citations": [
        {
          "passageId": "active-stored-passage-id",
          "label": "Lesson / Section",
          "url": "https://course.example/lesson#section",
          "sourceLang": "en",
          "sourceType": "course"
        }
      ]
    }
  ]
}
```

The example illustrates the shape, not reviewed production content. A pack
must be non-draft and have a non-placeholder reviewer and a valid, non-future
review date. The reviewer name is not exposed. Each answer must resolve its
authoring `source` to exactly one active course passage in its stored source
namespace. Missing, retired, ambiguous, or unsafe source links are omitted;
there is no fuzzy source matching or synthesized answer. Citation shape is the
same as `/ask`, including optional `timestamp`. Unreviewed packs return
`reviewedOn: null, items: []`; reviewed packs with no resolvable material retain
their review date and return an empty list. A missing language or a draft
without preview returns 404. At this increment the repository's en/am/om packs
remain unreviewed, so production responses are honestly empty until language
review and source publication are complete.

Successful responses send `ETag` over the complete representation (including
active content version) and `Cache-Control: public, max-age=0, must-revalidate`.
`If-None-Match` permits a 304. The widget fetches with `credentials: omit`,
validates the language, review date, answer and citation shapes, and keys the
cache by absolute API URL, locale, and preview flag. The active language's FAQ
is prefetched without blocking the UI; every browse attempts revalidation.
A successful empty response replaces older answers; 403/404 removes them.
Errors are never cached. During network failure, only an already validated
representation is shown, with a localized saved-on-device notice. When a
reviewed copy is available and revalidation takes over two seconds, the request
is cancelled and that saved copy remains usable. Language change or uninstall
cancellation never returns content to a disconnected screen;
offline copies can be older than the current server content. No arbitrary
learner question is answered or stored by this browser FAQ path. Disabled
CacheStorage leaves network and in-memory operation available. Uninstall
removes the FAQ cache with the other Dimts-owned storage.

## Dynamic course content

The static site is only the web shell; course passages are read by the API from
PostgreSQL at question time and are not compiled into the widget. Re-running
content ingestion replaces the active passage set and invalidates cached
answers, so subsequent questions use the updated source. The current ingestion
command reads Markdown or HTML from a directory:

```powershell
pnpm content:ingest content/sample-course
```

`FR-INT-08` supports two integration paths.

**Public website, no host code:** set `DIMTS_PUBLIC_SOURCES` to an approved
HTTPS XML sitemap and language. The connector indexes only same-origin HTML
pages explicitly listed in that sitemap, then rechecks them on the normal
reconciliation schedule.

```dotenv
DIMTS_PUBLIC_SOURCES=[{"id":"course-site","sitemapUrl":"https://learn.example/sitemap.xml","language":"en","pageSize":25}]
```

The API validates source registrations at startup. Reconciliation runs every
five minutes by default; set `DIMTS_SOURCE_SYNC_INTERVAL_MS` (1,000 through
86,400,000) to change the interval.

The public connector follows same-origin sitemap indexes, caps discovery at
250 pages, rejects redirects and private-network targets, and pins outbound
requests to public IPv4 addresses. It fetches HTML only (up to 1 MiB per page,
32 MiB total per snapshot). No links outside the approved origin are followed.
A website without a
published XML sitemap needs a private adapter or a sitemap added by its owner.

**Private platform, small backend adapter:** pass the host's existing
authorization and content functions through the `ContentSource`/`HostAuth`
ports. No platform-specific API is assumed by Dimts. The adapter must scope
discovery to content that should be visible to every learner using that
source. Per-learner or role-specific content must not be added to a shared
index; per-user ACL filtering is not implemented yet.

```ts
const app = buildApp({
  sourceSync: {
    sources: [
      {
        id: "course",
        auth: hostAuth,
        list: (input, signal) => hostContent.listPublished(input, signal),
        fetch: (resourceId, signal) =>
          hostContent.fetchPublished(resourceId, signal),
      },
    ],
    intervalMs: 5 * 60 * 1000,
  },
});

await app.locals.sourceSyncReady;
```

The host-owned adapter boundary also supports an authorized Telegram content
adapter. This package wires the generic boundary only; the native Telegram
adapter remains WP08. Index only material explicitly authorized for all
learners using that source, never learner direct messages or private-chat
history.

On startup Dimts performs full discovery before the API begins listening, then
runs scheduled reconciliation and publishes complete generations atomically.
Failed syncs preserve the last good generation. The host authenticates its
native content-change events before calling
`app.locals.sourceSyncManager.notify(sourceId, changes)`; Dimts then fetches
authoritative content through the adapter. There is no generic public webhook
route or payload. With the default PostgreSQL repository, the API creates the
source store automatically; when using a custom repository, pass a conforming
`SourceSyncStore` as `sourceSync.store`. The default error log omits source
identifiers, upstream error messages, and document text; custom `onError`
callbacks must preserve that privacy boundary. Directory ingestion remains
available for development.

Per-question language detection is now local and confidence-gated: detection
runs against the installed language packs, and short, unsupported, or
ambiguous text keeps the request's selected language. It changes only that
answer turn, not the saved session preference. Configure the confidence
threshold with `DIMTS_LANGUAGE_DETECTION_CONFIDENCE`; the detector never sends
question text to a third party. Cross-language retrieval remains capability
and evaluation dependent.

The API accepts arbitrary provider IDs and has a capability-aware adapter
registry. Registered adapters are `offline`, `openai-compatible` (including
local open-model servers), and the native `openai`, `gemini` and `xai`
adapters. Native wire contracts are tested with fixtures; credentials,
evaluated models and real-service latency still require host verification.
See [local AI setup](./LOCAL_AI.md) for profiles and protocol references.
Custom providers are described by
`DIMTS_AI_PROVIDERS` JSON entries (`id`, `adapter`, `endpoint`, `model`,
`credentialRef`, `privacyClass`, `allowedDataClasses`, `evaluatedLanguages`,
`enabled`, `priority`, `timeoutMs`, and declared `capabilities`). A `credentialRef`
names an environment variable; the secret value is never returned by the API.
Unknown adapter IDs and unresolved enabled credentials fail at startup.
Likewise, Node/Express/PostgreSQL are the current reference adapters;
replacing a stack requires a conforming implementation, not zero-effort
substitution.

The selected provider and explicit `DIMTS_AI_LADDER` order take precedence;
remaining enabled bindings follow in priority order. An explicitly placed
offline step keeps its position. Remote calls require host enablement and
current session consent. They receive only policy-allowed question and course
passage data, without identity, history, glossary or job text. Job passages
remain available to local/offline providers. Provider identity appears in
`GET /v1/health` and the authenticated helper console, never learner replies.

## Human help availability, media and service quality (P05)

Requirements: FR-HELP-01–18 (the SRS has no FR-HELP-19), NFR-SEC,
NFR-REL and NFR-PRIV. The existing confirmed request remains
`POST /v1/help {sessionId,includeSummary}`. The same request and ordered
WebSocket chat retain a leave-message fallback while waiting, after the
configured timeout and outside hours. No callback contact or Telegram
destination is collected. The tutor stays usable while waiting.

- `GET /v1/help/availability?sessionId=…` requires the session bearer and
  returns `{available,nextOpenAt?,waitTimeoutMs}`. Availability means the UTC
  schedule permits help, not proof that a helper is online. `nextOpenAt` is an
  ISO timestamp and is absent for an empty schedule. The default wait is
  300000 ms; `DIMTS_HELP_WAIT_TIMEOUT_MS` accepts 1000–3600000. Claims outside
  the validated `DIMTS_HELPER_HOURS` intervals return 409; confirmed waiting
  requests and existing conversations remain usable.
- `POST /v1/help/{id}/ice` accepts `{sessionId}` from the owning learner or
  `{}` from the assigned helper JWT. Only claimed requests qualify. The
  response is `{iceServers:[{urls,username?,credential?}],expiresAt?}` with
  `Cache-Control: no-store`. `DIMTS_TURN_APP` is the Metered app subdomain;
  `DIMTS_TURN_API_KEY` is its server-only secret key. Configure both or neither.
  The server creates credentials with a one-hour lifetime and omits the
  application secret and provider API key from responses. Unconfigured or
  failed TURN returns `stun:stun.l.google.com:19302`. Metered documents up to
  two minutes of propagation for new credentials; a cold first share can
  require retry or the picture/words fallback. Real TURN/NAT quality remains
  a host validation step. See the [provider API](https://www.metered.ca/docs/turn-server-service/creating-turn-credentials/).
- `POST /v1/help/{id}/image?sessionId=…` accepts raw `image/jpeg`, `image/png`
  or `image/webp` bytes with the owning learner bearer; no multipart envelope.
  Maximum input and retained output size is 2097152 bytes. Full pixel decoding
  rejects corrupt/truncated images, type mismatches, animation and images
  above 16 million pixels. Re-encoding removes EXIF/GPS/comments. At most five
  unexpired pictures are retained per request. Success 201 is `{id,expiresAt}`;
  invalid content is 400, oversize 413, unavailable request/storage slot 404.
- `GET /v1/help/{id}/image` returns `{images:[{id,expiresAt}]}` in creation
  order. `GET /v1/help/{id}/image/{imageId}` returns private image bytes with
  `no-store` and `nosniff`. Learners supply sessionId in the query and their
  bearer; helpers supply their JWT. Only the owning learner or the active,
  assigned helper can retrieve media; waiting pictures are private to their
  learner. Helpers poll metadata and choose to fetch a picture.

Pictures reside only in PostgreSQL. Read-time expiration prevents access at
two hours; startup plus a 60-second sweep removes expired bytes (at most one
minute scheduling lag while the API runs). The retention job also removes
expired images. A database trigger removes pictures atomically on request
close, clears the summary and deletes chat rows; session deletion cascades
through help data. A request-row lock
serializes upload with close. After restart, the first sweep removes expired
bytes. No image data, filenames or peer identity is logged.

`GET/PATCH /v1/helpers/profile` requires an active helper JWT. Its exact body
and response are `{displayName:string|null}` (trimmed 1–40 characters, null
removes it). Default is null regardless of the existing private staff name.
An explicit update refreshes active `help.joined` frames. Helper close accepts
an optional `{resolved:boolean}`; omission remains unknown. Learner close
continues to accept only `{sessionId}`. `GET /v1/help/metrics` is helper-only
and returns `{closedCount,resolvedCount,unresolvedCount,totalWaitMs,totalResolutionMs}`.
Durations total only claimed requests when closed; unknown outcomes contribute
only to closedCount. One database aggregate contains no request/session/helper
IDs, language, content or contact fields. It survives session deletion.

Automated evidence is in `p05-help.test.ts`, `p05-media.test.ts` and
`p05-postgres.integration.test.ts`; the PostgreSQL suite requires an isolated
`DIMTS_TEST_DATABASE_URL`. Physical device, real TURN, bandwidth and human
accessibility evidence are separate release checks.

## Feedback and conversation signals

`POST /v1/feedback` accepts only `{ "replyId": "...", "helpful": false }`
with the owning session's current bearer token. Success is `{ "ok": true }`.
The server resolves the session from the reply; the client sends no session
ID or text. An unknown reply, wrong token or other-session reply returns the
same 401 response. Extra body fields are rejected.

Migration `005_conversation_signals.sql` adds a session-only negative-feedback
streak bounded to 0–2. Helpful feedback or a consumed gentle-help offer resets
it. Anonymous `feedback_counter` rows retain only topic (first cited passage,
or `uncategorized`), language, UTC date and counts. No per-tap event is stored.
This is the storage boundary for P09's later insights work.

Two recent not-found replies or two negative taps trigger a localized gentle
help offer before another provider call. Explicit help/person and distress
phrases also bypass generation. Only the two recent reply kinds are queried.
The answer cache uses the existing `answer_cache` table, excludes personalized
state, expires after 24 hours and is invalidated by content publication. The
engine revalidates cached citations and content version before reuse.

## Ingest course content

Set `DIMTS_CONTENT_BASE_URL` to the canonical directory URL for rendered lessons
and `DIMTS_DEFAULT_LANG` to the language of the content directory. After
migrations and local host bootstrap have run, use:

```powershell
pnpm content:ingest content/sample-course
```

Ingestion accepts Markdown and HTML lesson files in one directory. Each file
becomes one lesson; its filename (without extension) is the lesson id. Markdown
heading slugs or existing HTML heading ids are used as citation anchors. A
content directory is ingested in the language selected by `DIMTS_DEFAULT_LANG`.
HTML sections that contain lesson text must have heading ids; ingestion rejects
sections without a rendered anchor rather than creating broken citations. A
content update atomically replaces the `legacy` source generation and clears
`answer_cache`; it does not replace generations owned by other configured
sources. Transcript ingestion is deferred until the course transcript format
is confirmed.

WP03 provides the grounding index/search and citation-gated engine library.
WP04 provides the provider ladder. The API can use the offline, local, and
configured cloud adapters; cloud remains opt-in through API configuration.

## P06 career gateway

Requirements: FR-JOB-01–11, FR-INT-07, FR-TUTOR-09, FR-SIMPLE-04;
FR-SMS-06/09 and FR-TG-01/11 delivery integration; NFR-PRIV-02/04/06.
OpenAPI and `jobs-schemas.ts` define the exact strict request/response shapes.
All learner endpoints require the session bearer and `sessionId` in the body
or query. Career responses use `Cache-Control: no-store`. Public/beta locale
packs are accepted; draft and unknown locales are rejected.

- `POST /v1/jobs/import`: `{lang,postings}` where `postings` is a JSON-LD
  item, array or `@graph`. `X-Dimts-Key` must hash to a `host_key` row whose
  `key_type` is `secret`. Migration 007 defaults existing rows to `public`.
  Provision a separate server-only random secret through trusted deployment
  administration; store its SHA-256 hash, never promote the widget key.
  Required posting fields are `title`, `description`, `datePosted`,
  `hiringOrganization`, `jobLocation`, and the canonical `url` required by
  the existing P02 citation parser. Unknown posting fields are ignored.
  The response is `{imported,errors:[{index,reason}]}`. Valid items and their
  passages publish in one transaction; invalid items are reported by index.
- `GET /v1/jobs?sessionId=…&lang=en&region=…&type=…` returns
  `{jobs,channels,relayAvailable,glossary}`. Filters are optional bounded
  strings. Jobs expose `id,title,description,organization,location,region,
jobType,datePosted,deadline,deadlineDisplay,url,lang,accommodationsOffered`.
  Region, job type and deadline may be null. `deadlineDisplay` uses the
  learner calendar and the other calendar in brackets. Employer email is
  never public. Glossary entries are `{term,meaning}` from the selected
  locale pack. The private support filter is not an API field; sending it
  is rejected. Channels list only configured real delivery adapters.
- `POST /v1/subscriptions`: `{sessionId,clientRequestId,jobType?,region?,lang,
channel,contact,consent:{accepted:true,noticeVersion:"job-alerts-v1"}}`.
  Channel is `sms` or `telegram`. Show localized consent before collecting
  contact. Success 201 returns `{id,status}` without contact. Reusing the
  request ID is idempotent. Contact is encrypted with `DIMTS_ENC_KEY`, and
  continuity uses keyed hashing with the distinct `DIMTS_HASH_KEY`.
  Consent expires after 30 days; metadata contains timestamp, channel and
  notice version only.
- `GET /v1/subscriptions?sessionId=…` returns `{subscriptions:[{id,status,
jobType?,region?,lang,channel}]}`. `DELETE /v1/subscriptions/{id}?sessionId=…`
  stops only an owned subscription, erases contact and returns `{ok:true}`.
  The domain's shared stop ports are the integration boundary for P07/P08
  STOP commands. A bounded in-flight send and row locking keep Stop below
  one minute. Stopped and expired subscriptions cannot start a send.
- `POST /v1/accommodation-requests` accepts a discriminated action. `draft`
  takes `{sessionId,clientRequestId,jobId,lang,needs,otherText?,name?,interviewAt?}`.
  Needs are `sign_language_interpreter`, `step_free_access`,
  `written_questions`, `extra_time`, `screen_reader_friendly_test`, `other`.
  `interviewAt` is an optional ISO date/time including a timezone. No name,
  diagnosis or proof is required; diagnosis/proof fields are rejected.
  `resume` and `cancel` take `{sessionId,id}`. `approve` and `send` require
  `{sessionId,id,revision}`. Each body also includes its `action`.
  Responses are `{id,jobId,lang,revision,status,sendAttempted,message,needs,otherText?,name?,
interviewAt?,interviewDisplay?}`. Draft edits create a new revision;
  approval freezes the exact message. Review
  the exact server-rendered message, approve its current revision, then send
  separately. Target email is resolved only from the imported posting's
  `hiringOrganization.contactPoint.email`; callers cannot choose a recipient.
  Anonymous requests are supported. Private draft data is encrypted.
  `sendAttempted` exposes only the durable boolean delivery marker, persisted
  before the external call. Once true, clients must offer retry of the same
  approved revision and must not offer draft editing or cancellation,
  including after reload. A lost receipt is not permission to create another
  delivery key for the same request.
- `GET /v1/accommodation-requests?sessionId=…` returns
  `{requests:[{id,jobId,status}]}` for owned resumable metadata. Use the
  `resume` action to retrieve the exact private payload. Only safe IDs need
  browser persistence. Cancellation before a delivery attempt clears private
  draft contents.
- `POST /v1/internal/alerts?dry=1` uses `Bearer DIMTS_CRON_SECRET`. Returns
  aggregate `{matched,sent,skipped,failed}` only. Dry run has no writes or
  sends. The daily digest is unique per subscriber/date and each job is
  unique per subscriber. Uncertain retries keep the original durable key.
  `DIMTS_JOBS_ALERT_INTERVAL_MS=0` (default) delegates scheduling to an
  external caller. Values 60000–86400000 enable a bounded in-process
  interval; daily limits still apply. `/internal/retention` also clears
  expired consent contacts and old private requests. Independent startup and
  60-second cleanup runs also erase expired contacts and requests while the
  API is online, even when automatic alert delivery is disabled. Private
  requests expire 30 days after the interview, or 30 days after a draft
  without an interview date.

Invalid input is 400; invalid session/host authentication is 401; an unknown
owned resource is 404; stale revisions are 409; abuse limits are 429;
unavailable delivery or failed confirmation is 503 with a locale message
key. Responses and logs do not echo sensitive failure details.

### Host HTTP delivery contract

Set `DIMTS_JOBS_RELAY_URL` and `DIMTS_JOBS_RELAY_SECRET` together. The URL
must be HTTPS without user information, query or fragment. Requests reject
redirects and expire after ten seconds. `DIMTS_JOBS_RELAY_CHANNELS` is an
optional comma-separated list declaring host adapters; its default is empty.
After P07, the default API composition takes SMS exclusively through the native
SMS service: a legacy `sms` host advertisement is ignored, and absent native
SMS configuration leaves SMS unavailable. After P08, Telegram likewise requires
the native Telegram adapter; a legacy host channel advertisement cannot bypass
its STOP, consent or queue controls. A configured relay supports
accommodation delivery even when alert channels are empty. Missing relay
configuration never produces a successful no-op. SMS delivery is now
implemented by P07; native Telegram delivery is implemented by P08.

The API POSTs JSON with `Authorization: Bearer <relay secret>` and
`Idempotency-Key: <stable key>`:

```json
{
  "version": "dimts.jobs.delivery.v1",
  "kind": "accommodation",
  "to": "employer@example.org",
  "message": "Synthetic approved request",
  "lang": "en",
  "idempotencyKey": "accommodation:<request-id>:<revision>"
}
```

For `kind:"digest"`, fields are `channel,contact,lang,text,jobs,idempotencyKey`
instead of `to,message`; `jobs` contains the same public job data without
the derived `deadlineDisplay`. The host must durably deduplicate the stable
key before accepting delivery and return 2xx JSON exactly confirming:

```json
{
  "version": "dimts.jobs.delivery.v1",
  "accepted": true,
  "idempotencyKey": "the-original-key"
}
```

The host must return this same receipt for repeats without sending again,
including after a lost response or API restart. An empty, malformed,
wrong-key or unsuccessful response counts as failure. The API performs
one attempt per runner/user action; retries keep the same key. The host's
Telegram adapter must enforce channel rate limits. Native SMS enforces the
GSM-7/UCS-2 segmentation/shortening policy and per-number daily budget
(default 20). Accept only after durable queueing with the applicable policies;
do not acknowledge a no-op. The API already batches at most one daily digest.
No message body, contact, name or Telegram identifier may be logged.

P06 provides feature-specific `JobsService.deleteData({sessionId})` and
database cascades. The complete shared `/v1/data/delete` endpoint remains
P11; P06 does not expose a partial endpoint claiming to erase all user data.

Automated API evidence: `p06-contract.test.ts`, `p06-routes.test.ts` and
`p06-flow.integration.test.ts` (real isolated PostgreSQL plus synthetic local
HTTP relay, gated by `DIMTS_TEST_DATABASE_URL`);
domain/database and browser evidence are recorded with P06's acceptance
checks in `IMPLEMENTATION_PROGRESS.md`.

## SMS inbound and simulator (P07)

`POST /v1/sms/inbound` is shared by the gateway and `/sim/sms` browser page.
It requires `Authorization: Bearer DIMTS_SMS_GATEWAY_SECRET`, a separate
credential of at least 24 non-whitespace characters. An absent secret or
unavailable service returns 503. Authentication runs before the SMS JSON
parser and body validation. Every SMS response is `Cache-Control: no-store`.

The strict body is `{id,from,text}`. `id` is 1–128 characters: it starts with
an ASCII letter or digit and then accepts letters, digits, `.`, `_`, `:`, or
`-`. `from` is an E.164 number with `+` and 7–15 digits. `text` is nonempty
and contains at most 1000 Unicode code points. JSON bodies are limited to
16 KiB, including escaped Unicode. No caller-supplied session, language or
extra fields are accepted; the phone's pseudonymous session determines the
language after numeric menu selection.

Successful responses are
`{messages:[{id,text,encoding,units,segments,status}],stopped,lang}`.
`encoding` is `gsm7` or `ucs2`, and `status` is `queued`, `sent`, `delivered`
or `failed`. Counts describe the actual normalized transmitted text. Each
message fits within three segments. No response includes a phone number.
The same inbound ID and exact body can be retried without repeating side
effects; a changed payload under an existing ID returns 409. A stopped
conversation returns `stopped:true` and no further messages after its one
confirmation.

SMS problems retain `{type,title,status,code,messageKey}` and add
`{lang,message}` for locale-resolved copy. `Content-Language` identifies the
response language. Before session lookup, errors use English; domain errors
use the established conversation language. Invalid input is 400, invalid
gateway authentication 401, replay conflict 409, oversized JSON 413, abuse
limits 429, unexpected internal failure 500, and unavailable/uncertain
delivery 503. Errors do not echo input or raw transport details. A 429
includes `Retry-After: 60`; the daily outbound cap may require waiting until
the next UTC day.

`DIMTS_SMS_MODE=simulator` uses in-process simulated delivery and makes no
mobile-network call. `gateway` mode requires paired HTTPS
`DIMTS_SMS_GATEWAY_URL`/`DIMTS_SMS_GATEWAY_TOKEN`. An optional paired HTTPS
`DIMTS_SMS_CALLBACK_URL`/`DIMTS_SMS_CALLBACK_SECRET` enables the separate-Y
callback host port. Missing callback configuration reports unavailability.
The inbound secret must differ from encryption/hash/JWT/cron/relay/channel
credentials. `DIMTS_SMS_DAILY_LIMIT` is 1–1000, default 20. The domain applies
30 new inbound IDs per minute per phone; STOP bypasses the burst and daily
cap. P06 alert runs use the same native SMS delivery adapter and budget.

The standalone simulator holds its secret, number, draft and thread only
in page memory. Enter test settings manually; do not embed a gateway secret
in HTML, a query string, or a frontend environment variable. Its New thread
action clears the page and does not reverse permanent STOP. See
[`SMS_GATEWAY.md`](SMS_GATEWAY.md) for adapter protocols, consent, privacy,
retry semantics and local setup.

The existing authenticated `/v1/internal/retention` operation clears expired
SMS private ciphertext and SMS delivery metadata older than 24 hours.
Session erasure clears linked SMS ciphertext. Permanent STOP tombstones are
retained; retention does not resume messaging for a stopped number.

## Telegram private chats (P08)

`POST /v1/telegram/webhook` accepts Telegram's native update envelope, verified
with `X-Telegram-Bot-Api-Secret-Token: DIMTS_TELEGRAM_SECRET` before JSON parsing.
Bodies are limited to 64 KiB. Success is `{"ok":true}`; nonprivate updates are
ignored. Invalid credentials return 401, invalid updates 400, oversized bodies
413, and unavailable adapters 503. Safe error responses include localized
recovery copy, never the submitted content or credentials.

`DIMTS_TELEGRAM_TOKEN` enables the native grammY adapter.
`DIMTS_TELEGRAM_MODE=webhook` is the default; explicit `polling` is allowed only
outside production. Both modes use shared sessions, conversation, help and P06
jobs services. Telegram jobs delivery uses the same native transport, consent
checks and permanent STOP enforcement. No additional public session-creation
channel is enabled. The helper queue includes `channel: "telegram"`.

Apply migration 009 and follow [`TELEGRAM.md`](TELEGRAM.md) for webhook setup,
commands, voice capability limits, replay semantics and retention. Live bot,
language and device acceptance remains separate from fixture verification.
