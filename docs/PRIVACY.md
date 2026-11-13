# Dimts privacy policy (English source)

Last reviewed for implementation accuracy: 13 November 2026. This is the
English source policy for the MVP; it is not legal advice or evidence of
production deployment. Amharic and Afaan Oromoo policy translations and the
required native-speaker review remain outstanding. Do not present those
translations as reviewed or the language gates as passed.

## What Dimts stores and why

Dimts uses pseudonymous sessions rather than learner accounts. To answer a
question and resume an authorized flow, the API stores a random session
identifier, channel, language, timestamps, consent state, and hashes of
session/resume credentials. The API stores only credential hashes, not the
session token values. Chat messages and replies are stored for the session
retention window so that the service can provide a conversation and retry
responses. The service does not need a learner's name to answer questions.

Career alerts require separate consent. Contact details are encrypted for
delivery and represented by a keyed hash for matching and stop handling; they
are not written to application logs. Stopping an alert or allowing consent to
expire removes the active subscription and its encrypted contact data.
Accommodation requests and help requests are associated with the session so
they can be delivered and deleted with it.

If a learner requests human help, the service may share the selected language,
channel, optional recent questions, and help conversation. Screen sharing is
learner-initiated, view-only, has no audio or recording, and can be stopped.
The optional picture fallback accepts JPEG, PNG, or WebP up to 2 MiB, strips
metadata, and stores the image in PostgreSQL rather than a public file store.
Pictures are inaccessible after expiry and the running API removes expired
rows during its cleanup sweep.

Consent to remote AI is separate and per-session. Remote providers are used
only when enabled by the host and allowed by the learner; otherwise the
configured local/offline path is used. A remote provider receives the
question and only the relevant course passages allowed by the provider
policy. Dimts does not include advertising or analytics.

## Retention and deletion

- Inactive sessions are eligible for deletion after 24 hours. The scheduled
  retention route removes the session and its linked messages, help records,
  images, and session-bound career data. The sweep runs daily at 06:00 UTC
  when the hosted workflow and API are available; an outage can delay physical
  cleanup until a later successful run.
- Help pictures expire after two hours. While the API is running, an
  application cleanup sweep runs at one-minute intervals; expired pictures
  are also inaccessible when their expiry has passed. An asleep or unavailable
  host can delay physical row removal.
- Active alert subscriptions retain encrypted contact data only while consent
  is active. Stopped or expired subscriptions are cleaned up by the career
  cleanup and retention jobs.
- The shared answer cache has no session identifier and expires after 24
  hours. It is not deleted by an individual session deletion because it is not
  linked to that session.
- Teacher insights are anonymous aggregates, suppress small groups, and do
  not contain chat text or session IDs. Permitted aggregates may remain after
  a learner deletes a session. Minimal HMAC stop/replay metadata may remain
  until its own expiry to prevent unwanted re-contact or replay.

In the web widget, open **Settings**, choose **Delete my data**, review the
confirmation, and confirm. Telegram learners can send `/privacy` and choose
the deletion confirmation button. The API contract is `POST /v1/data/delete`;
it requires the session's bearer token, commits deletion before returning
success, and is safe to retry. A failed request is shown as a failure and can
be retried. Session deletion is also used by the channel runtimes. For SMS
provider or host-specific deletion help, contact the organization that
operates that gateway; do not send a phone number or message text in a public
issue.

The end-of-event purge has a dry-run default. It preserves course passages,
jobs, platform/host configuration, anonymous aggregates, and the unlinked
answer cache; `--apply` is required to remove personal/session rows and helper
records. Operators should review the dry-run counts and back up any data
needed for lawful operations before applying it.

## Service providers and network traffic

The local/offline tutor path does not require an AI provider. A hosted
deployment may use a database, AI provider, SMS gateway, Telegram, or
WebRTC/TURN relay depending on operator configuration and learner action.
Telegram and SMS operators necessarily process the messages sent through
their channel. The default WebRTC configuration uses Google's public STUN
service, which receives connection metadata such as participant IP
addresses. When Metered TURN is configured, its relay receives participant
IP addresses, traffic timing/volume, and encrypted media packets. See the
[help privacy notes below](#third-party-network-services). Operators must
review and disclose the policies of every provider they enable.

The repository includes a Render deployment template and a Neon free-tier
runbook, but no hosted deployment or provider account was verified for this
release. Do not treat this policy as proof that a particular deployment has
been configured securely.

## Help privacy notes

These technical notes cover human help. See [HELP.md](HELP.md),
[DECISIONS.md](../DECISIONS.md), the
[system blueprint](../Dimts-System-Blueprint-v2.0.md), and
[implementation progress](IMPLEMENTATION_PROGRESS.md) for contracts and
verification status.

The helper handoff is limited to language, channel, optional last three
learner questions and the help conversation. Summary sharing starts on and
can be disabled in one action before requesting help. The optional helper
first name is absent until the helper explicitly saves it and can be removed.
The waiting-message fallback uses the existing request and collects no
callback contact details. Aggregate outcome reporting excludes content and
request, session and helper identifiers.

Screen capture starts only after a helper request, learner agreement and
browser permission. The system provides a view-only video stream without
audio capture, remote control or recording. Explicitly selected screen
pictures may contain sensitive visible information, so the interface asks
the learner to check the picture before sending. The API accepts validated
JPEG/PNG/WebP up to 2 MiB, strips metadata and stores bytes in PostgreSQL,
not public files. Authorized participants retrieve them. Pictures expire
after two hours or at request/session end, whichever comes first; retention
and deletion must be verified in the deployment. Live media and helper object
URLs are cleared during session cleanup.

## Third-party network services

The approved default STUN endpoint is `stun:stun.l.google.com:19302`.
STUN discovery sends network traffic to Google and exposes connection
metadata, including the participant's public IP address, to that service.
It does not send chat or picture content as part of STUN discovery. This is
not a claim that the service receives no learner data.

When Metered TURN is configured, the server requests temporary credentials
from `https://<DIMTS_TURN_APP>.metered.live/api/v1/turn/credential`.
The application API secret stays server-side. The browser receives the
temporary TURN username/password and relay addresses, not that API secret.
The configured relay endpoints use `global.relay.metered.ca` over UDP/TCP
port 80 or TLS/TCP port 443. The implementation requests one-hour credentials
and reports their expiry; deployments must verify provider-side expiration.

A TURN relay receives participant IP addresses, traffic timing/volume and
encrypted WebRTC media packets. Encryption does not conceal this connection
metadata from the relay operator. Peers also exchange connection information
through authenticated signaling. Application consent and cleanup tests do
not establish the third-party provider's logging or retention practices.
Review those practices before deployment and complete the P11 language-review
requirements. P05 selects no coturn path; a local TURN service does not
replace this production assessment.

Logs and shared test artifacts must not include chat text, names, phone
numbers, Telegram IDs, helper/session tokens, TURN credentials or secrets.
Use synthetic content and content-free test results for operational evidence.
