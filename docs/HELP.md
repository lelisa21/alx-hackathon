# Human help operations and acceptance

Scope: P05, FR-HELP-04–19 with FR-HELP-01–03 regression coverage and the
help-related security, reliability and privacy requirements. The
[system blueprint](../Dimts-System-Blueprint-v2.0.md) supersedes conflicting
parts of the [SRS](../Dimts-SRS-v1.2-complete.md). The agreed contracts and
fallback choice are in [DECISIONS.md](../DECISIONS.md). Current test results
and outstanding gates belong in [implementation progress](IMPLEMENTATION_PROGRESS.md).
This protocol does not itself certify acceptance.

## Configure and operate

`DIMTS_HELPER_HOURS` is a JSON array of UTC intervals: `day` is ISO weekday
1–7, `start` and `end` are `HH:mm`, and start must precede end. Intervals on
the same day cannot overlap. For example,
`[{"day":1,"start":"08:00","end":"17:00"}]` opens Monday 08:00–17:00 UTC;
the end boundary is excluded. An omitted setting means no schedule
restriction; `[]` means no open intervals. Availability describes the
configured schedule, not live staffing. Claims are restricted by that
schedule, while learners can still create a waiting request and leave a message.

`DIMTS_HELP_WAIT_TIMEOUT_MS` defaults to `300000` (five minutes); accepted
values are 1000–3600000. The learner receives a fallback offer without a
countdown. The user-approved fallback is **Leave a message in this existing
request**. It uses the same authenticated chat and retention rules. It does
not collect contact details or promise a callback or Telegram delivery.
The tutor remains available while the learner waits.

Helpers sign in with their provisioned token. The queue shows oldest requests
first, language filters and waiting minutes. New requests have visible and
polite announcements; sound starts off and requires helper opt-in. Helpers
claim one request, chat, request screen view, or ask the learner to describe
the screen. A first name is absent by default. The helper must explicitly
save it; saving an empty value removes the preference. Ending help can
record resolved, unresolved or unknown. Reporting contains only aggregate
counts and duration totals, without message text, names or identifiers.

Screen capture requires a helper request, learner consent and browser
permission. **Not now** keeps chat available. The shared view has no audio,
remote control or recording; the requested profile caps video at 5 fps and
300 kbps and can reduce quality. Stop is available on both sides, with
Alt+Shift+S where shortcuts are enabled. Media also stops on disconnect,
hidden surfaces or session cleanup. A picture or description remains an
alternative when capture or connection fails.

Configure `DIMTS_TURN_APP` and `DIMTS_TURN_API_KEY` together for Metered.
The API requests expiring credentials; application secrets stay server-side.
Without that configuration, or if credential retrieval fails, the response
uses public STUN. STUN alone cannot guarantee connectivity across restrictive
networks. No coturn path is selected in P05; P11 owns the optional local
Compose profile. Production uses Metered/public STUN. See the scoped
[help privacy notes](PRIVACY.md) for third-party network exposure.

Learners explicitly select JPEG, PNG or WebP pictures, at most 2 MiB. The
API validates image content, removes metadata and stores bytes in PostgreSQL.
Images are limited to one frame, 16 million pixels and five unexpired pictures
per request. Expired retrieval is rejected at two hours; the running API's
60-second deletion sweep can lag by up to one minute. Close/session deletion
is immediate. A stopped API must run cleanup when restarted.
Assigned helpers retrieve pictures through authenticated endpoints. Pictures
expire after two hours and are deleted on request/session end; helper object
URLs are cleared on close or disconnect. Verify the deployment's retention
job as well as expiry rejection at the retrieval endpoint.

## Evidence to record

Automated suites cover schedule boundaries, authorization, concurrent claim,
rate limits, replay, consent/decline, track cleanup, pictures, aggregate
metrics, localized controls and browser accessibility. Browser media doubles
prove application behavior; they do not establish physical-browser capture,
TURN reachability or readable sharing on a weak network. Record actual command
results in implementation progress; do not infer passing results from this list.

Manual and deployment acceptance remains **pending** until dated evidence
includes all of the following:

1. Record the build revision, browser/OS, network conditions, locale, reviewer
   and result. Use synthetic questions and pictures; omit tokens, credentials,
   names, message content and network identifiers from shared evidence.
2. Run learner and helper against PostgreSQL and real WebSocket clients.
   Verify outside hours, configured timeout, summary opt-out, leave-message
   replay, simultaneous claim, reconnect, name opt-in/removal and either-side end.
3. On supported desktop browsers, verify no capture before consent, browser
   permission dismissal, browser-native stop and the helper's received view.
   Measure both sides' tracks ending within one second of each stop action.
4. Exercise an unsupported mobile browser and denied capture; complete help
   using an explicitly selected picture and a description. Test expired,
   malformed and oversized images and verify database deletion after close,
   session deletion and scheduled retention.
5. Exercise a real restrictive network requiring TURN and a physical or
   controlled 3G connection. Confirm the selected relay path, readable screen
   text, bitrate/frame-rate limits, quality reduction and usable fallback.
   Redact credentials and addresses from any retained network evidence.
6. Complete keyboard-only, NVDA, physical TalkBack, 200% zoom, 320px reflow,
   sound-off, contrast and pseudo-RTL checks. Check focus, one announcement per
   new message and the persistent Stop control. Record axe separately from
   manual screen-reader and co-designer sign-off.

Native-language review, real-device/network checks and the broader release
privacy/accessibility gates remain pending unless their own evidence records
explicitly say otherwise.
