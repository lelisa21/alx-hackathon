# Local API

The API is a separate service from the frozen Savanna reference pages. It uses
the repository's PostgreSQL Compose service and never writes learner messages
or credentials to application logs.

## Start locally

1. Copy `.env.example` to `.env` and set a local PostgreSQL password.
2. Generate distinct values for `DIMTS_ENC_KEY` and `DIMTS_HASH_KEY` with
   `openssl rand -base64 32`. Generate a third distinct base64 value for
   `DIMTS_JWT_SECRET` and a `DIMTS_CRON_SECRET` with
   `openssl rand -base64 24`. Keep `.env` private and untracked.
3. Start PostgreSQL with `docker compose --profile local up -d --wait db`.
4. Set `DIMTS_LOCAL_WIDGET_KEY` in `.env` and ensure
   `DIMTS_HOST_ORIGINS` contains the host page origin. The widget key is a
   public identifier for local development; do not reuse it in production.
5. Run `pnpm local:bootstrap` to apply pending migrations and upsert the
   allowed local host. Only its SHA-256 hash is stored in `host_key`.
6. Run `pnpm api:start`. The service listens on port 3000 by default.

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
widget shell assets; the widget separately caches static language/UI API
responses. These caches can restore the language picker, but they do not
provide offline course answers: the FAQ packs are empty and no FAQ API contract
is defined.

The widget loads visible language packs, asks the API for a pseudonymous
session, and keeps the bearer token in memory. The host can call
`window.Dimts.open()`, `close()`, `setLanguage(code)`, or `escalate()`.
`dimts:opened`, `dimts:closed`, `dimts:language`, and `dimts:escalated` events
are dispatched on `window`. It renders in a shadow root so host styles do not
change its controls.

Run `pnpm test:widget` to build the widget and run its browser flows, including
storage-disabled behavior, reflow, axe checks, and offline shell/language-cache
recovery. Read-aloud via browser speech synthesis is available when selected;
microphone recognition and the later human-help workflow are not implemented
in this increment.

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

On startup Dimts performs full discovery, then runs scheduled reconciliation
(five minutes by default, configurable) and publishes complete generations
atomically. Failed syncs preserve the last good generation. The host
authenticates its native content-change events before calling
`app.locals.sourceSyncManager.notify(sourceId, changes)`; Dimts then fetches
authoritative content through the adapter. There is no generic public webhook
route or payload. When using a custom repository, provide a conforming
`SourceSyncStore`; otherwise the API uses PostgreSQL. Directory ingestion
remains available for development.

Per-question language detection is now local and confidence-gated: detection
runs against the installed language packs, and short, unsupported, or
ambiguous text keeps the request's selected language. It changes only that
answer turn, not the saved session preference. Configure the confidence
threshold with `DIMTS_LANGUAGE_DETECTION_CONFIDENCE`; the detector never sends
question text to a third party. Cross-language retrieval remains capability
and evaluation dependent.

The API now accepts arbitrary provider IDs and has a capability-aware adapter
registry, but only the OpenAI-compatible adapter is registered. OpenAI and xAI
endpoints that conform to that protocol can use it; native Gemini/OpenAI/xAI
adapters remain unimplemented. Custom providers are described by
`DIMTS_AI_PROVIDERS` JSON entries (`id`, `adapter`, `endpoint`, `model`,
`credentialRef`, `enabled`, `priority`, `timeoutMs`, and declared
`capabilities`). A `credentialRef`
names an environment variable; the secret value is never returned by the API.
Unknown adapter IDs and unresolved enabled credentials fail at startup.
Likewise, Node/Express/PostgreSQL are the current reference adapters;
replacing a stack requires a conforming implementation, not zero-effort
substitution.

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
