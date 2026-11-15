# Hosted deployment (Render + Neon)

This is the runbook for the hosted reference topology (blueprint 2.6 and 14.1).
For local Compose, see [API.md](API.md#start-locally). Free-tier limits are in
[FREE_TIER.md](FREE_TIER.md).

## What gets deployed

| Piece                 | Where                              | Notes                                                                    |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `Bridgely-api`           | Render web service (`render.yaml`) | Runs migrations, then the API. Health check: `GET /v1/health`.           |
| `Bridgely-widget-assets` | Render static site (`render.yaml`) | `Bridgely-widget.js`, lazy chunks, fonts, helper console and SMS simulator. |
| PostgreSQL            | Neon                               | Pooled URL for the API, direct URL for migrations and admin commands.    |
| Scheduled jobs        | GitHub Actions `cron.yml`          | Retention 06:00 UTC (24 h privacy deletion), job alerts 07:30 UTC.       |
| Keep-warm (optional)  | GitHub Actions `keepwarm.yml`      | Event window only: 14-15 November, 05:00-16:50 UTC.                      |

## 1. Database (Neon)

1. Create a project and copy both connection strings. Use
   `sslmode=verify-full` for both URLs to keep certificate and hostname
   verification explicit with current and upcoming `pg` versions.
   - Pooled (host contains `-pooler`) becomes `DATABASE_URL`.
   - Direct becomes `DATABASE_URL_DIRECT`.
2. Nothing else is needed here: the API start command applies migrations.

## 2. Secrets

Generate four distinct values. The API refuses to start if any is missing,
malformed, or reused.

```sh
openssl rand -base64 32   #ENC_KEY  (exactly 32 bytes, base64)
openssl rand -base64 32   #HASH_KEY (exactly 32 bytes, base64)
openssl rand -base64 48   #JWT_SECRET (32+ characters)
openssl rand -hex 24      #CRON_SECRET (24+ characters)
```

Never commit them, reuse the local `.env` values, or put them in browser code.

## 3. Render

1. New, then Blueprint, select this repository. Render reads `render.yaml`.
2. Fill the prompted values for `Bridgely-api`:
   `DATABASE_URL`, `DATABASE_URL_DIRECT`, the four secrets, and
   `HOST_ORIGINS`: a comma-separated list of the exact HTTPS origins
   (scheme and host, no path) of every page that embeds the widget, including
   the static site itself (its lesson pages embed the assistant).
   Also set `CONTENT_BASE_URL` to `https://<static-site>/learn/`.
   `PREVIEW_LANGS=am,om,ti` is preset so Amharic, Afaan Oromoo, and
   Tigrinya are offered as beta while their packs await native review.
3. For `Bridgely-widget-assets`, set `PUBLIC_API` to
   `https://<api-host>/v1` and `PUBLIC_WIDGET_KEY` to the public host key
   created in section 4. The build bakes them into `Bridgely-host.js`; redeploy the static
   site after creating the key.
4. Deploy. The first API start applies all migrations; later starts print
   `No pending migrations.`
5. Check `https://<api-host>/v1/health` returns `"db": true`, then
   `https://<static-site>/learn/` lists the lessons.

Optional integrations stay disabled until configured in the Render
environment; the API validates each at start:

- AI providers: `AI_PROVIDER`, `AI_LADDER`, `AI_PROVIDERS`
  plus the credential variable each binding names. See [LOCAL_AI.md](LOCAL_AI.md).
- Telegram: `TELEGRAM_TOKEN` and a distinct `TELEGRAM_SECRET`.
  Webhook mode registers the webhook on API startup when `PUBLIC_API_URL` is
  the public HTTPS base URL. Polling is rejected in production; see
  [TELEGRAM.md](TELEGRAM.md).
- SMS gateway, job relay, TURN, helper hours: see `.env.example`.
- LTI 1.3: `LTI_PLATFORMS`. Register
  `https://<api-host>/v1/lti/launch` as the tool's redirect URI.

## 4. Provision host keys and helpers

The API stores only SHA-256 hashes of host keys and helper tokens. Run these
from a trusted machine with `DATABASE_URL_DIRECT` set to the Neon direct URL.
The secret is read from `PROVISION_SECRET`, never from the command line.

Public widget key (a public identifier, restricted to the listed origins):

```sh
PROVISION_SECRET='<public widget id>' pnpm admin host-key \
  --id host-widget --name "Host widget" --type public \
  --origins https://learn.example.org
```

Server-to-server secret key for `POST /v1/jobs/import` and `GET /v1/insights`
(32+ random characters, kept server side):

```sh
PROVISION_SECRET="$(openssl rand -base64 48)" pnpm admin host-key \
  --id host-server --name "Host server" --type secret
```

Record that secret before running the command; only its hash is stored.

Helper account (32-byte base64url token, exchanged at `POST /v1/helpers/login`):

```sh
PROVISION_SECRET="$(node -p "require('crypto').randomBytes(32).toString('base64url')")" \
  pnpm admin helper --id helper-1 --name "Helper One" --langs en,am
```

Re-running a command with the same `--id` rotates that key or token.

## 5. Ingest course content

Each API start ingests `content/savanna` (English, Amharic, Afaan Oromoo) when
it changed since the last start, so a normal deploy needs no manual step. To
ingest another content folder by hand:

```sh
DATABASE_URL='<direct url>'DEFAULT_LANG=en \
 CONTENT_BASE_URL='https://<lessons>/' pnpm content:ingest <content directory> --if-changed
```

Or configure `PUBLIC_SOURCES` for sitemap synchronisation. The sample
seed (`pnpm seed`) is for local development only.

## 6. Embed the widget

```html
<script type="module" src="https://<assets-host>/Bridgely-widget.js"></script>
<bridgely-assistant
  data-api="https://<api-host>/v1"
  data-host-key="<public widget id>"
></bridgely-assistant>
```

The page's origin must be in both `HOST_ORIGINS` and the host key's
`--origins`. The static site sends `Access-Control-Allow-Origin: *`, which
cross-origin module scripts and fonts require.

## 7. Scheduled jobs

In GitHub, Settings, Secrets and variables, Actions, add `API_URL`
(`https://<api-host>`) and `CRON_SECRET` (same value as Render). Then
run the `cron` workflow once manually and confirm `retention: HTTP 200`.
Without this, the 24-hour retention deletion never runs on the hosted stack.

## 8. Verify

```sh
API=https://<api-host>
curl -s $API/v1/health
curl -s -X POST $API/v1/sessions -H 'content-type: application/json' \
  -H 'origin: https://learn.example.org' -H 'x-Bridgely-key: <public widget id>' \
  -d '{"lang":"en"}'
```

The session call returns `sessionId` and `sessionToken`; use them for
`POST /v1/ask` with `Authorization: Bearer <sessionToken>`.

## Self-hosting with the Docker image

`docker build --target api` produces the API image; its default command
starts the server only. Run `node packages/api/dist/db/migrate.js` (needs
`DATABASE_URL_DIRECT`) before the first start and after upgrades, and
`node packages/api/dist/db/admin.js` for provisioning. Terminate TLS in front of it;
the API trusts one proxy hop for client IP and protocol.
