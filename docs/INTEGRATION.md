# Level 1 widget embedding

Serve the widget build (`pnpm --filter @dimts/widget build`) from an approved
static origin. Keep the generated files together: the classic bootstrap,
ES modules and deferred chunks, service worker, manifest, and fonts.
Enable gzip or Brotli for JavaScript, CSS, and JSON at the serving origin;
the startup and size budgets measure compressed transfers. The included Nginx
configuration enables gzip for these response types, including proxied locale
and FAQ JSON. Hosts must verify their deployed `Content-Encoding` headers.
The async bootstrap requests the complete `dimts-widget.js` module directly;
there is no intermediate loader/shared-runtime download before the launcher.
Voice and help modules remain deferred until used.

```html
<script
  async
  src="/dimts/dimts-embed.js"
  nonce="SERVER_GENERATED_NONCE"
  data-host-key="PUBLIC_HOST_IDENTIFIER"
  data-api="https://api.example.org/v1"
  data-lang="en"
  data-theme="light"
  data-position="end"
  data-simple="false"
></script>
```

The server must generate a fresh unpredictable nonce per HTML response and put
the same value in the response CSP and script attribute. The placeholder above
is not a production nonce. No inline script is needed. See
[`examples/embed-level1.html`](../examples/embed-level1.html) for a blank-host
example. This example uses a configurable API origin; it is a generic host
contract, not an ALX Savanna deployment.

## Current ALX Savanna integration boundary

There is no Savanna-specific connector, platform registration, or private
course content configured in this repository. Generic LTI 1.3 metadata can be
loaded from the host's `DIMTS_LTI_PLATFORMS` setting, but the prototype is not
yet an operational LMS launch: `/v1/lti/jwks` publishes an empty key set, and
the current login response does not complete the browser OIDC redirect flow.
Do not register this build as an LTI tool. The usable integration surfaces are
the Level 1 widget embed and REST API described here and in [API.md](./API.md).
An authorized host must serve the widget, register its origin and public host
identifier with the API, and set the API URL and CSP. No Savanna session cookie,
learner roster, or role-specific content is read.

Course content enters through the generic public-sitemap connector or a
host-owned `ContentSource`/`HostAuth` adapter documented in [API.md](./API.md).
the adapter must only publish content authorized for every learner using that
source. There is no Savanna API endpoint or credential assumed by Dimts, and
the current widget/REST contract is not connected to an LMS/LTI launch.
The demonstration recorded for this work used only
[`content/sample-course`](../content/sample-course); it is not ALX course
material or evidence of a Savanna connection.

`data-host-key` is a **public identifier**, visible in browser requests. Configure
the API's allowed origins for this host. Do not put an API provider credential or
private host credential here. Session creation is origin restricted; changing a
script attribute cannot grant permission from an unapproved origin.

Supported attributes are `data-lang` (installed language code), `data-theme`
(`light`, `dark`, or `contrast`), `data-position` (`start` or `end`, following
document direction), `data-simple` (`true` or `false`), and `data-api` (API base,
with or without `/v1`). The explicit language takes precedence over a remembered
preference. Unsupported/draft languages are not silently enabled. Install one
script per document. The launcher is closed initially; the session can initialize
without recording, speaking, or consenting to remote processing.

Only `window.Dimts` is added to the public JavaScript API:

```js
window.Dimts.open();
window.Dimts.close();
window.Dimts.setLanguage("om");
window.Dimts.escalate();
```

Call these from a host-owned external script after the widget is installed.
`dimts:opened`, `dimts:closed`, `dimts:language`, and `dimts:escalated` are dispatched
on the assistant element and bubble across its shadow root to the document.
Language events carry `{lang}`; escalation carries the current `{lang}`. Text,
identifiers, and conversation history are never event payloads. Escalation opens
the existing learner confirmation flow; it does not silently submit a help request.

The embed uses shadow DOM for its launcher and panel. Host page selectors do not
style the controls. Bundled Lit property metadata lives in a private module cell;
an existing host Lit metadata map is reused without replacement. Functional
metadata is retained across uninstall/reinstall, while optional version diagnostic
globals introduced by the embed are removed. Accessible custom properties can be set on `dimts-embed` or
`dimts-assistant`: `--dimts-surface`, `--dimts-text`, `--dimts-muted`,
`--dimts-primary`, `--dimts-primary-text`, `--dimts-border`, `--dimts-focus`,
`--dimts-font-family`, and `--dimts-radius`. Colors accept opaque hex or integer
`rgb(...)`; font families accept names/lists, not external URLs; radius is bounded
to 32px or 2rem/em. The guard restores the theme palette when text is below 7:1 or
control/focus contrast below 3:1. High contrast overrides ordinary host colors.

## Content Security Policy

For a same-origin static installation and a separate API, start with:

```http
Content-Security-Policy: default-src 'none'; script-src 'self' 'nonce-SERVER_GENERATED_NONCE'; style-src 'nonce-SERVER_GENERATED_NONCE'; connect-src 'self' https://api.example.org wss://api.example.org; font-src 'self'; img-src 'self' data:; worker-src 'self'; base-uri 'none'; object-src 'none'
```

Add the approved widget static origin to `script-src` and `font-src` if distinct.
`connect-src` permits locale/API requests and the existing help WebSocket. The
script nonce is copied to owned shadow styles. No `unsafe-eval` or
`unsafe-inline` is required. Additional host scripts/styles need the host's own
directives. A third-party static origin cannot register a service worker for the
host page: serve the worker and widget shell from the host origin for offline
reload support. Cross-origin embedding still has a complete online text path and
reports unavailable offline installation honestly.

Dimts caches only its owned shell, locale UI, and reviewed FAQ. The host must
provide its own offline HTML/router response (or keep the current page open).
Installing Dimts does not make an arbitrary uncached host page reload offline.

## Uninstall and storage

Remove the original installing script element to uninstall. A scoped observer
removes the owned DOM, click/language listeners, widget timers/voice/help work,
and the public API. Widget-owned settings/cache are cleared; the optional language
preference may remain. Host application settings and unrelated service workers
must remain untouched. Removing and re-adding a script installs a fresh instance.

The widget does not rely on third-party cookies. Browser storage failures are
caught: ordinary online text interaction still works, with no persistence promise.
No provider secrets are shipped in browser assets.

## Start locally and seed sample content

Follow [API.md's local setup](./API.md#local-api): copy `.env.example` to
`.env`, configure local secrets/origin, then start PostgreSQL/API/widget and
provision a local host key. The Docker Compose startup command there requires
Docker Desktop. To try the tracked, non-Savanna sample course after startup,
run `pnpm content:ingest content/sample-course`. Do not treat that fixture as
real course/job data.

## Local Level 1 embed smoke test

This tests the generic widget contract on a local HTTP host; it is not a
Savanna connection. From the repository root:

1. Build the widget with `pnpm --filter @dimts/widget build`.
2. In `.env`, allow the page origin `http://localhost:5500` in
   `DIMTS_HOST_ORIGINS`. Set `DIMTS_LOCAL_WIDGET_KEY` to a non-secret local
   public identifier, then use that same value for `data-host-key` in
   `examples/embed-level1.html`. Never use an AI provider credential as a host
   key.
3. Start the stack with `docker compose --profile local up --build -d --wait`.
   If the sample course is needed, run `pnpm content:ingest content/sample-course`.
4. In a separate terminal at the repository root, run
   `python -m http.server 5500`, then open
   `http://localhost:5500/examples/embed-level1.html`.
5. Confirm the launcher loads and the browser can create a session through
   `http://localhost:3000/v1`. The browser `Origin`, configured
   `DIMTS_HOST_ORIGINS`, and public host identifier must match. This example
   uses the offline provider unless a host explicitly configures a remote
   provider and a learner grants consent.

Serve the page over HTTP, not `file://`; the API rejects an unapproved or
missing browser origin. For a real Savanna dev instance, use its actual HTTPS
origin, serve the widget from a host-approved static location, and configure
that exact origin and CSP with the host administrator. The frozen pages under
`savanna_static_pages/` are reference captures and do not provide a running
Savanna host, authenticated course access, or a connector. Level 2 REST is
available through the API contract and [`examples/api-level2.http`](../examples/api-level2.http);
LTI is not ready for platform registration. A private Savanna source still
requires an authorized host-owned `ContentSource`/`HostAuth` adapter.

## Reproducible checks and limits

Run `pnpm test:widget --workers=1` and `pnpm size` after building. The embed tests
exercise one-script installation, API shape/events, nonce CSP, disabled storage,
theme rejection, and removal. The performance test uses real gzip HTTP responses
with server-enforced 400ms minimum first-byte latency and a shared FIFO link
capped at 50,000 compressed body bytes per second. This covers every request,
including service-worker fetches and precaching; page-only CDP throttling cannot
prove that boundary. Browser cache is disabled, responses use `no-store`, and
`throttled-startup.json` records browser timing plus server byte/timing records.
Browser animation frames timestamp the first visible launcher and the first
visible enabled composer, avoiding automation-bridge reporting delays.
HTTP headers and small request uploads are not bandwidth-shaped. No Playwright
route fulfillment is used for timed requests. The size gate follows static imports, reports deferred chunks
separately, and counts initial bootstrap, shared JavaScript, CSS/fonts, and the
largest compressed locale UI response. The total also reserves an initial FAQ
prefetch budget based on all currently authored FAQ text, hashed citation IDs,
and 256 additional compressed bytes per entry for deployed canonical labels/URLs.
This build-only estimate grants no review approval: current unreviewed packs serve
empty FAQ lists. It is not a guarantee for arbitrarily large future FAQ/source
data; remeasure the deployed response when that data changes.

These browser checks are not evidence of the 100MB memory limit on a 1GB Android
phone, physical TalkBack/NVDA behavior, or co-designer acceptance. Record those
separately in the repository progress log after real testing. The browser suite
separately checks 200% widget text and CSS page render scaling; neither replaces
a manual check using the browser's native zoom controls with assistive technology.

## Verify Phases 1-6

Run the connected automated checks from the repository root:

```powershell
pnpm verify:phases-1-6
```

Set `DIMTS_TEST_DATABASE_URL` to a disposable PostgreSQL database first. The
command fails before running if it is absent, rather than letting PostgreSQL
integration tests silently skip. It builds the workspace, runs typecheck,
lint, locale validation, core and locale coverage gates, the complete Vitest
suite, widget Playwright/axe and compressed cold-start checks, the offline
grounded evaluation, and the bundle-size gate. Install the Playwright Chromium runtime once with
`pnpm exec playwright install chromium` if it is not already present.

This command verifies the offline provider and configured local database; it
does not claim native-speaker review, real cloud-provider quality, physical
Android or assistive-technology results, a deployed TURN/host relay, or an
ALX Savanna connector. The separate `pnpm test:compose` check requires Docker
Desktop and validates the Compose deployment path.
