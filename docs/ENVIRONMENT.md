# Environment variables

Every variable the Bridgely API reads, what it does, and where its value comes
from. `.env.example` has the same variables with safe placeholders; copy it to
`.env` for local work. On Render, set the `sync: false` values in the
dashboard (`render.yaml` already holds the rest).

The API validates everything at start and stops with a message naming the
bad variable. AI and voice keys that are still placeholders (for example
`REPLACE_WITH_YOUR_GEMINI_API_KEY`) do not stop the API: it logs
`ai_provider_disabled` / `cloud_voice_disabled` and serves learners with the
remaining providers.

## Generate the secrets once

```sh
openssl rand -base64 32   #ENC_KEY
openssl rand -base64 32   #HASH_KEY (a different value)
openssl rand -base64 48   #JWT_SECRET
openssl rand -base64 24   #CRON_SECRET
openssl rand -hex 24      #TELEGRAM_SECRET (letters/digits only)
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='   #SEED_HELPER_TOKEN
```

Without OpenSSL: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Keep each value distinct; the API rejects reused secrets.

## Core

| Variable                                    | Required   | What it does                                                                                                                 | Where the value comes from                                                |
| ------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `NODE_ENV`                                  | yes        | `development` locally, `production` when hosted. Production rejects Telegram polling, voice preview and plain-HTTP LTI URLs. | —                                                                         |
| `DATABASE_URL`                              | yes        | Postgres for the API.                                                                                                        | Neon dashboard → Connection string (pooled). Docker compose sets its own. |
| `DATABASE_URL_DIRECT`                       | migrations | Direct (non-pooled) connection used by migrations.                                                                           | Neon dashboard → Connection string, "Pooled connection" off.              |
| `POSTGRES_PASSWORD`                         | compose    | Password of the compose Postgres container. Changing it after the volume exists locks the API out of the data.               | Choose one.                                                               |
| `ENC_KEY`, `HASH_KEY`           | yes        | Encrypt contacts; hash identifiers. 32 random bytes each, base64.                                                            | Generate (above).                                                         |
| `JWT_SECRET`                          | yes        | Signs helper and LTI sessions. 32+ characters.                                                                               | Generate.                                                                 |
| `CRON_SECRET`                         | yes        | Bearer token for `POST /v1/internal/*` (alerts, retention, job sync).                                                        | Generate.                                                                 |
| `HOST_ORIGINS`                        | yes        | Comma list of page origins that embed the widget (`https://savanna.example`).                                                | The sites that load `Bridgely-host.js`.                                      |
| `PUBLIC_API_URL`                      | production | Public HTTPS base of this API (no `/v1`). Used to register the Telegram webhook on start.                                    | Render service URL, e.g. `https://Bridgely-api.onrender.com`.                |
| `CONTENT_BASE_URL`                    | yes        | Base of citation links (`<base>/<lang>/<lesson>#<section>`).                                                                 | The static site's `/learn/` URL.                                          |
| `DEFAULT_LANG`, `PREVIEW_LANGS` | no         | Default language; draft packs published as beta (`am,om,ti` in the deployment template). Tigrinya remains unreviewed beta.   | —                                                                         |
| `LOCAL_WIDGET_KEY`                    | compose    | Public widget key of the local web container (not a secret).                                                                 | Any string; the bootstrap creates the host.                               |
| `SEED_HELPER_TOKEN`                   | seed only  | Helper login token created by `pnpm seed`.                                                                                   | Generate.                                                                 |
| `PUBLIC_SOURCES`                      | no         | Extra public websites to index, as JSON. `[]` indexes only `content/savanna`.                                                | —                                                                         |

## AI answers

Ladder: **gemini-3.6-flash ? gemini-3.5-flash-lite ? gemini-3.1-flash-lite ?
OpenRouter (free models) ? offline**. Remote providers answer only after the
learner allows remote AI in the widget. Without consent, the offline extractive
answerer replies from the course text.

The Gemini model IDs are kept in `AI_PROVIDERS`. The API moves to the next
configured model when a provider is unavailable or rate-limited, then falls back
to OpenRouter or offline. Quotas depend on the Google AI project and model; see
[Google's current Gemini model catalog](https://ai.google.dev/gemini-api/docs/models).
| Variable                                                                                           | What it does                                                                                                                                                                   | Where the value comes from                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                                                                                   | Google AI Studio key for all Gemini models: answers, transcription and read-aloud.                                                                                             | <https://aistudio.google.com/apikey> → Create API key. Classic keys start with `AIza`, newer keys with `AQ.`.                                                                                                                          |
| `OPENROUTER_API_KEY`                                                                               | OpenRouter key for the free fallback models.                                                                                                                                   | <https://openrouter.ai/settings/keys> → Create key. Starts with `sk-or-`. Free (`:free`) models need no credits. If they fail with 404 "No endpoints found matching your data policy", enable free endpoints under Settings → Privacy. |
| `AI_PROVIDER`, `AI_LADDER`                                                             | First provider and the order to try (`gemini`, `gemini,gemini-flash-lite,gemini-lite,openrouter,offline`).                                                                     | —                                                                                                                                                                                                                                      |
| `AI_PROVIDERS`                                                                               | JSON list of provider bindings: adapter, model, key reference, timeout, data classes. **Model IDs are set here**; `GEMINI_MODEL` and `OPENROUTER_MODEL` are not read by Bridgely. | See `.env.example`.                                                                                                                                                                                                                    |
| `AI_MAX_TOKENS`, `AI_TEMPERATURE`, `AI_RECALL_FLOOR`, `AI_CONSENT_VERSION` | Answer budget, sampling, retrieval floor, consent text version.                                                                                                                | Defaults in `.env.example`.                                                                                                                                                                                                            |

OpenRouter binding (`adapter: "openrouter"`) sends `particle-ai/particle-1:free`
first, with `fallbackModels` `inclusionai/ling-3.2-flash:free` and
`nvidia/nemotron-3.5-super-vl:free` (OpenRouter routes at most three). They were
chosen on 2026-11-15 by live tests: all three answer Amharic and Afaan Oromoo in
1–7 s with reasoning off, and particle-1 declined an off-topic Amharic question
that nemotron accepted. Gemma `:free` models were rate limited upstream (429)
most of the time, and ERNIE rejects `reasoning: {enabled:false}` with 400, so
neither is in the list. Free model availability changes; check
<https://openrouter.ai/models?max_price=0> and the `ai_provider_failed` log.

Every failed provider attempt is logged as
`{"event":"ai_provider_failed","provider":…,"reason":…,"status":…,"vendorMessage":…}`
(never the question or answer). `reason` is one of `unauthorized`, `rejected`,
`rate_limited`, `model_not_found`, `vendor_unavailable`, `timeout`,
`not_verbatim`, `not_json`, `truncated`, `network_error`. A rejected key or
unknown model cools the provider down for 15 minutes; other failures for one.

## Voice

| Variable                               | What it does                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STT_ENGINE`, `TTS_ENGINE` | `browser` uses on-device speech where the browser supports the language; `none` hides voice.                                                                                                                                                                                                                           |
| `CLOUD_VOICE`                    | `gemini` adds cloud speech (after the learner's consent) for languages the device lacks. Uses `GEMINI_API_KEY`.                                                                                                                                                                                                        |
| `CLOUD_VOICE_LANGS`              | Languages cloud transcription serves (`en,am,om`).                                                                                                                                                                                                                                                                     |
| `CLOUD_VOICE_SPEAK_LANGS`        | Languages cloud read-aloud serves (`en,am`). Gemini TTS does not list Afaan Oromoo.                                                                                                                                                                                                                                    |
| `CLOUD_VOICE_STT_MODEL`          | Comma list tried in order: `gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite`. |
| `CLOUD_VOICE_TTS_MODEL`          | Comma list tried in order: `gemini-3.8-flash-lite-tts,gemini-3.8-flash-tts`.                                                                                                                                                                                                                                           |
| `VOICE_PREVIEW`                  | Development only: skip the native-speaker review gate. Production rejects `true`.                                                                                                                                                                                                                                      |

## Telegram

| Variable                    | What it does                                                                                          | Where the value comes from                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `TELEGRAM_TOKEN`      | Bot token. Empty disables the bot.                                                                    | Telegram → @BotFather → `/newbot` or `/token`. |
| `TELEGRAM_SECRET`     | Webhook secret Telegram sends back in `X-Telegram-Bot-Api-Secret-Token`. 24–256 of `A-Z a-z 0-9 _ -`. | Generate.                                      |
| `TELEGRAM_MODE`       | Empty: polling in development, webhook otherwise. Production rejects polling.                         | —                                              |
| `PUBLIC_TELEGRAM_BOT` | Bot username shown on the demo page.                                                                  | BotFather.                                     |

**Only one process can poll a bot token.** A second poller (another laptop, a
second container, a deploy in polling mode) makes Telegram answer `409
Conflict` to both, and the log shows
`telegram_setup_failed … "code":409`. Use a separate test bot locally, or stop
the other process. In production (webhook mode with `PUBLIC_API_URL`
set) the API registers the webhook itself on start and logs
`telegram_webhook_registered`.

## SMS

| Variable                                              | What it does                                                                                | Where the value comes from                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `SMS_MODE`                                      | `simulator` (the `/sim/sms` page, no network), `smsethiopia`, or `gateway` (custom bridge). | —                                                                                                             |
| `SMS_GATEWAY_TOKEN`                             | SMS Ethiopia campaign API key (40 characters) in `smsethiopia` mode.                        | <https://smsethiopia.com> → Console → API Keys. Trial keys only deliver to numbers verified in the dashboard. |
| `SMS_GATEWAY_SECRET`                            | Separate secret the simulator page uses for inbound messages.                               | Generate.                                                                                                     |
| `SMS_GATEWAY_URL`                               | Custom bridge URL (gateway mode only, with the token).                                      | Your operator bridge.                                                                                         |
| `SMS_CALLBACK_URL`, `SMS_CALLBACK_SECRET` | Optional host callback that receives a number after the learner consents. Both or neither.  | Your host platform.                                                                                           |
| `SMS_DAILY_LIMIT`                               | Messages per number per day.                                                                | —                                                                                                             |

## Jobs

| Variable                                                                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOB_SOURCES`                                                            | `ethiojobs,hahujobs,afriwork`. Ethiojobs imports from its public job pages (schema.org JobPosting). HahuJobs loads jobs from a private API and Afriwork lists no job pages, so both stay `needs_setup` until the platform gives a partner feed.                                                                                                                                                                                                                                                                                                                        |
| `HAHUJOBS_FEED_URL` / `_TOKEN`, `AFRIWORK_FEED_URL` / `_TOKEN`     | Partner feed URL (and token) once the platform grants one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `JOB_SYNC_LIMIT`, `JOB_SYNC_INTERVAL_MS`                           | Postings per sync (40) and interval (6 h).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `JOBS_ALERT_INTERVAL_MS`                                                 | How often job alerts are sent in-process (`3600000` = hourly). `0` means only an external scheduler calling `POST /v1/internal/alerts` with `CRON_SECRET`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `JOBS_RELAY_URL`, `JOBS_RELAY_SECRET`, `JOBS_RELAY_CHANNELS` | An HTTPS webhook on the _host_ platform that receives **interview-support requests** (a learner asking an employer for accommodations) and, optionally, delivers alerts itself. Job alerts do not need it: the Telegram bot and SMS deliver them. Without a relay the widget does not offer interview-support requests. Set URL and secret together (secret: 24+ characters) once the host (for example ALX staff) runs an endpoint that accepts `Bridgely.jobs.delivery.v1` POSTs and returns `{"version":"Bridgely.jobs.delivery.v1","accepted":true,"idempotencyKey":…}`. |

## Human help and LTI

| Variable                                                              | What it does                                                                                                                                                                                                                                                                              | Where the value comes from                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `HELPER_HOURS`                                                  | When human helpers can claim requests, as UTC weekly intervals (`day` 1 = Monday). Unset = always, `[]` = never. Ethiopia is UTC+3: Monday–Friday 09:00–17:00 local is `[{"day":1,"start":"06:00","end":"14:00"},…,{"day":5,…}]`. Outside these hours learners can still leave a message. | Your helper rota.                                              |
| `HELP_WAIT_TIMEOUT_MS`                                          | How long a learner waits before the leave-a-message path.                                                                                                                                                                                                                                 | —                                                              |
| `TURN_APP`, `TURN_API_KEY`                                | Metered TURN for video help behind strict networks. Both or neither (neither = public STUN).                                                                                                                                                                                              | <https://dashboard.metered.ca> → app subdomain and secret key. |
| `LTI_PLATFORMS`, `LTI_WIDGET_URL`, `LTI_WIDGET_KEY` | LTI 1.3 platforms (public metadata) and the widget the launch page loads.                                                                                                                                                                                                                 | The LMS's LTI tool registration.                               |

## Production checklist

1. Render → `Bridgely-api` → Environment: set every `sync: false` value
   (`DATABASE_URL`, `DATABASE_URL_DIRECT`, the four secrets,
   `HOST_ORIGINS`, `CONTENT_BASE_URL`, `PUBLIC_API_URL`,
   `TELEGRAM_TOKEN`, `TELEGRAM_SECRET`, `GEMINI_API_KEY`,
   `OPENROUTER_API_KEY`).
2. `Bridgely-widget-assets` → `PUBLIC_API` (`https://…/v1`) and
   `PUBLIC_WIDGET_KEY` (create the host with `pnpm admin`).
3. Deploy, then check `GET /v1/health` and the log for
   `telegram_webhook_registered`, and no `ai_provider_disabled`.
4. Stop any local process that polls the same Telegram token.
5. Render's free plan sleeps after 15 idle minutes: the first Telegram message
   or question after a sleep waits for the wake-up, and hourly job alerts run
   only while the service is awake. Use a paid instance, or an external cron
   calling `POST /v1/internal/alerts`, for dependable alerts.
