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
