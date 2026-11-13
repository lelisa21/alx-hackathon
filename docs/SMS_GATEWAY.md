# SMS gateway and simulator

P07 implements FR-SMS-01–12 using the existing conversation engine and P06
career service. `SimulatedSmsGateway` exercises delivery in process. It does
not send to a mobile network. No operator account, short code, or Ethiopian
operator agreement is bundled or claimed.

## Run the simulator

1. Apply the API migrations and configure the existing database, hash and
   encryption keys. Set `DIMTS_SMS_MODE=simulator` and a distinct
   `DIMTS_SMS_GATEWAY_SECRET` of at least 24 non-whitespace characters.
2. Build and serve the widget and API. Open `/sim/sms` on the widget server.
   In local Compose this is normally `http://localhost:5173/sim/sms`.
3. Enter the API address (`/v1` on Compose, or a full test API address ending
   in `/v1`), test gateway secret, and a synthetic E.164 phone number.
   Send any message, then reply `1`, `2`, or `3` to choose the SMS language.

The page language is independent of the numeric SMS language choice. Its
settings, secret, phone, draft and thread stay in memory; no browser storage
is used. New thread clears the secret, phone and conversation display. It
does not undo server STOP. Reusing a stopped number remains stopped after a
reload or server restart. The browser shows raw character count and the
encoding units/segments of normalized transmitted text. Curly apostrophes
and quotes become their straight GSM-7 equivalents for SMS transmission.

The simulator calls authenticated `POST /v1/sms/inbound`, exactly as a
gateway adapter does. Its body is `{id,from,text}`; callers must preserve
the same ID and exact body when retrying an uncertain request. The service
deduplicates by HMAC phone identity and ID, and rejects changed payloads
under an existing ID. The reply is `{messages,stopped,lang}`; each message
contains `{id,text,encoding,units,segments,status}` and no phone number.
Statuses are `queued`, `sent`, `delivered`, or `failed`. HTTP errors include
the problem code, locale message key, `lang`, and localized `message`.

## Conversation, consent and budgets

First contact offers `1 English`, `2 አማርኛ`, and `3 Afaan Oromoo`.
HELP/person, STOP, LANG, JOBS and numeric choices use the locale keyword
data; English equivalents work in each language. Language review flags are
unchanged. Draft translations and keyword lists still need native review.

HELP asks for a separate Y before a configured callback host receives the
transient phone number. An absent callback host returns an unavailable
message and creates no callback request. JOBS uses P06 subscription consent,
encrypted contacts, daily digests and the existing alert runner. It does not
create another subscription store. `JOBS`, then `2`, stops job alerts while
leaving tutoring available. STOP revokes all SMS subscriptions for that
contact, clears private conversation state, confirms once, and is permanent.
The default API composition ignores any legacy `sms` advertisement in
`DIMTS_JOBS_RELAY_CHANNELS`; all SMS digests use this native service, and SMS
is unavailable when its configuration is missing. Host Telegram and
accommodation delivery continue through their existing ports.

`DIMTS_SMS_DAILY_LIMIT` defaults to 20 outbound messages per number/day
(UTC). Replies and digests share that cap; STOP confirmation remains
available. New inbound IDs are limited to 30 per minute per number. STOP
and exact replays bypass the new-message burst counter. GSM-7 uses 160
units for one segment and 153 when concatenated; extension-table characters
consume two units. UCS-2 uses UTF-16 units, 70/67. Responses fit within three
segments including the localized continuation cue. Reply 1 continues only
the same pseudonymous session, with bounded content and expiry.

Phone numbers are HMAC identities outside consented P06 subscriptions.
Subscription contacts are encrypted using `DIMTS_ENC_KEY`; continuation and
replay payloads are also encrypted. The authenticated
`POST /v1/internal/retention` job clears expired `sms_conversation.private_enc`
and delivery records older than 24 hours. Session erasure also clears its
encrypted SMS state. Schedule retention alongside the existing API retention
work; STOP tombstones outlive private state and are not expired by this job.
Do not log phone numbers, learner text, names, message bodies or secrets.

## Replace the simulated gateway

The `SmsGateway` port exposes:

```ts
send(to, text, { lang, idempotencyKey }): Promise<{ id, segments }>
onInbound(handler): void
status(id): Promise<"queued" | "sent" | "delivered" | "failed">
```

An adapter registers the inbound handler with the shared SMS service. Its
upstream webhook translates the operator's payload to `{id,from,text}` and
authenticates with the separate inbound gateway secret. Validate the
operator's webhook signature before forwarding. Retain stable operator
message IDs; do not derive IDs from plaintext phone numbers or message text.

The optional `HttpSmsGateway` connects to a host-managed HTTPS bridge.
Set `DIMTS_SMS_MODE=gateway`, `DIMTS_SMS_GATEWAY_URL`, and
`DIMTS_SMS_GATEWAY_TOKEN`. The URL must have no embedded credentials,
query or fragment; URL and token are configured together. The outbound
token differs from `DIMTS_SMS_GATEWAY_SECRET`, which authenticates inbound
requests. Each call rejects redirects and has a 2.5-second timeout, keeping
the initial send and two retries within the bounded delivery operation.

The bridge receives JSON and `Authorization: Bearer <operator token>`.
Sending also includes `Idempotency-Key: <stable key>`:

```json
{
  "version": "dimts.sms.gateway.v1",
  "action": "send",
  "to": "+251900000001",
  "text": "Synthetic test message.",
  "lang": "en",
  "idempotencyKey": "stable-opaque-delivery-key"
}
```

Return a successful JSON receipt with the same version and idempotency key,
an opaque `id`, exact `segments`, and `status`. A `failed` acknowledgement,
wrong key, wrong segment count, malformed response or HTTP failure is a
failure. A status request sends `{version,action:"status",id}` and expects
`{version,id,status}`. The send acknowledgement supplies the initial status;
the adapter's status method can query the bridge for a subsequent status.

The bridge must durably deduplicate the key before accepting delivery and
return the same receipt after a lost response or process restart. A stable
key with a different payload must fail. The SMS service records the initial
attempt and at most two retries with that same key; a failed status does not
create a new message or reset the budget. The bridge must report actual
operator acceptance/delivery accurately, and must not acknowledge a no-op.

## Optional callback host

Configure `DIMTS_SMS_CALLBACK_URL` and `DIMTS_SMS_CALLBACK_SECRET` together.
The callback uses HTTPS, rejects redirects, and times out after five seconds.
After separate Y consent,
the host receives `Authorization: Bearer <callback secret>`,
`Idempotency-Key`, and JSON
`{version:"dimts.sms.callback.v1",from,sessionId,lang,idempotencyKey}`.
It must durably deduplicate before accepting the callback and return
`{version:"dimts.sms.callback.v1",accepted:true,idempotencyKey}`. This is
a host callback port, not an assertion that a helper is available or that a
call will occur. The API keeps no durable callback phone store.

## Automated evidence

`packages/sms/test` covers encoding, adapter conformance, retries, replay,
consent, caps, STOP and PostgreSQL persistence. `p07-routes.test.ts` covers
the API boundary and localized failures. `p07-sms.spec.ts` covers the real
simulator page with API doubles, including keyboard operation, narrow/RTL
layouts and accessibility. `p07-live.spec.ts` uses the built page, real HTTP
API, isolated PostgreSQL and simulated transport through production wiring;
it requires `DIMTS_TEST_DATABASE_URL`. No test result constitutes native
translation review or proves a real operator agreement.
