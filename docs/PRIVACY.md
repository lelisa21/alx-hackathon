# Help privacy notes — partial P05 scope

These technical notes cover human help only. They are not the full translated
privacy policy or P11 release sign-off. See [HELP.md](HELP.md),
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
Review those practices before deployment and complete P11's full privacy
policy and language-review requirements. P05 selects no coturn path; P11's
optional local Compose profile does not replace this production assessment.

Logs and shared test artifacts must not include chat text, names, phone
numbers, Telegram IDs, helper/session tokens, TURN credentials or secrets.
Use synthetic content and content-free test results for operational evidence.
