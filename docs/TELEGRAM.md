# Telegram private-chat channel

P08 connects the production grammY transport to the existing tutor, sessions,
jobs and helper console. It does not create a separate answer engine or alert
store. No live bot token, webhook registration or real delivery is claimed.

## Configuration and webhook

Apply migrations through `009_telegram_channel.sql`. Set `DIMTS_TELEGRAM_TOKEN`
from BotFather and a distinct `DIMTS_TELEGRAM_SECRET` (24–256 characters from
`A-Z`, `a-z`, `0-9`, `_`, `-`). `DIMTS_TELEGRAM_MODE=webhook` is the default.
Without a token the adapter stays disabled. Production rejects polling mode.

An operator must register the deployed HTTPS `/v1/telegram/webhook` URL using
Telegram's `setWebhook`, with `secret_token` equal to the configured secret and
`allowed_updates` containing `message` and `callback_query`. Keep credentials in
the operator's secret store; never paste the token URL into logs or repository
files. This repository does not register a webhook automatically.

Telegram sends `X-Telegram-Bot-Api-Secret-Token`. The API compares it in constant
time before parsing a maximum 64 KiB body. Missing/wrong credentials return 401;
disabled or polling-only webhook mode returns 503. Supported fields are strictly
validated, then names and unused profile metadata are dropped. Nonprivate,
channel and unsupported update kinds are acknowledged without effects. A
private unsupported attachment receives a localized request for text.

Success returns only `{"ok":true}`. Safe errors contain a localized message and
`/help`, never an ID, token, transcript or upstream error. Responses are no-store.
The same service handles webhook and polling updates. For local development,
explicitly select `DIMTS_TELEGRAM_MODE=polling` and ensure that the bot has no
active webhook. Polling stops with the application; production always uses the
verified webhook boundary.

## Learner and helper flows

- `/start` shows privacy, language choices and an optional read-aloud toggle.
  `/language` uses the existing visible language registry; draft packs are not
  silently promoted. Command descriptions are localized, using two-letter
  platform language aliases and English defaults. Button labels use
  words and fit Telegram's 20-character product limit.
- Text uses the shared session/ask path, cloud consent stays off, and source
  citations are plain links. Questions retain the existing 1000 Unicode-character
  limit; oversized questions get a friendly explanation. `/simple` changes the
  existing engine's reply mode.
- `/help` creates a real request without an automatic summary. Learner/helper
  messages use the shared durable relay and appear in the existing console.
  `/endhelp` closes it and returns to tutoring. The Telegram console view is
  text-only: no unavailable browser sharing, ICE or image polling is offered.
  Describe-image guidance remains available. No Telegram callback/contact
  collection policy is approved, so the existing leave-message path is used.
- `/jobs` searches real P06 jobs and displays the shared localized deadline
  formatter. Alert setup collects type, region and language, then requires
  review, separate consent and final confirmation. Consent-critical buttons
  belong to the current setup. `ALL`, `0` and the localized all-label mean no
  filter. Active subscriptions expose a Stop action.
- `/stop` permanently revokes all alerts for that contact, including subscriptions
  created from another channel. It clears pending voice/help activity and
  encrypted contacts. STOP and confirmed deletion cancel queued sends and retries;
  messages already accepted by Telegram cannot be recalled. Tutoring remains
  available. SQL guards prevent web forms
  from reactivating a stopped Telegram contact.
- `/privacy` explains retention and offers explicit confirmation to delete
  conversation/help data and saved alert contacts. Minimal keyed stop metadata
  remains to prevent an old update from restarting alerts.

## Voice capability and acceptance boundary

P04 currently selects `none` or browser voice. These cannot process a Telegram
attachment on the server. The default bot therefore reports voice/read-aloud
unavailable and retains text. Production **FR-TG-02/03 voice acceptance remains
unverified** until a compatible file adapter, credentials where needed, and
language/device review are provided.

The shared `@dimts/voice` file ports permit an explicit implementation to be
injected through `createTelegramVoice`. Tests use synthetic audio and fixture
adapters; they do not claim real transcription accuracy. Downloaded audio is
limited to 60 seconds/8 MiB, verified against supported OGG/MP3/MP4 signatures and
MIME types, held in memory and zeroed after use. Transcription/synthesis have a
30-second deadline. A transcript is shown with Send and Say again and expires
after five minutes. Only Send can ask the shared tutor. Synthesized audio follows
equivalent cited text; unavailable audio produces a textual limitation.

## Delivery, replay and privacy

The send queue spaces messages roughly one second apart per chat. Confirmed
transient Telegram rejections (429/5xx) use up to three attempts, respecting
retry delays within bounds. The Bot API has no send-message idempotency key:
an unknown network outcome is marked uncertain and is **not blindly resent**.
Local/durable receipts suppress duplicate effects, including after restart;
they cannot prove exactly-once remote delivery after a lost response.

Text is split at sentence boundaries within 4096 UTF-16 units, preserving its
content. A single oversized sentence/token falls back to word/code-point chunks
without splitting surrogate pairs. That edge-case policy needs review; strict
sentence-boundary acceptance is not claimed for an indivisible oversized input.

Chat continuity uses HMAC with `DIMTS_HASH_KEY`. IDs are not stored in session
or channel state. Only explicitly consented active P06 subscriptions store an
AES-GCM encrypted contact. Pending transcript/job/help state is encrypted and
expires after 24 hours; voice review expires sooner. Delivery/update metadata
is bounded and retained for 24 hours. Unseen out-of-order updates are processed;
old updates at a deletion cutoff cannot revive deleted state.

Helper delivery keeps at most 1000 transient in-memory routes, expires them
after 24 hours and rechecks database authorization before sending. After a
process restart, the next private inbound restores routing and replays existing
helper messages with delivery deduplication. No unconsented ID is persisted to
make that routing survive restart. Session deletion cascades through private
state; schedule the existing authenticated `/v1/internal/retention` operation.

## Verification

`packages/telegram/test` covers transport, update validation, commands, consent,
replay, STOP, persistence and voice review. `p08-flow.integration.test.ts` uses
real PostgreSQL, HTTP and helper WebSockets with a synthetic Bot API transport.
The helper browser case in `p05-helper.spec.ts` checks Telegram queue/claim/chat/
close, text-only media behavior, axe and 320 px reflow. See
`docs/IMPLEMENTATION_PROGRESS.md` for actual results and outstanding gates.

Protocol references: [Telegram Bot API](https://core.telegram.org/bots/api),
[webhook verification](https://core.telegram.org/bots/api#setwebhook),
[message sending](https://core.telegram.org/bots/api#sendmessage),
[file downloads](https://core.telegram.org/bots/api#getfile), and
[retry parameters](https://core.telegram.org/bots/api#responseparameters).
