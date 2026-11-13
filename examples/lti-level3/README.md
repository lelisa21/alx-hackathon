# LTI 1.3 Integration Guide (Level 3)

**Integration Level 3:** Platform launches Dimts via LTI 1.3 (IMS Learning Tools Interoperability) with OIDC login and signed JWT token validation.

## Quick Start

### Platform registration checklist

1. **Admin registers platform in Dimts**
   - POST /v1/lti/login endpoint
   - Platform issuer URL: `https://your-lms.example.com`
   - OAuth client ID: `dimts-client-prod`
   - OAuth endpoints for OIDC redirect
   - JWKS public key URL: `https://your-lms.example.com/.well-known/jwks.json`
   - Deployment ID (if using multiple Dimts instances on same LMS): `deployment-prod-001`

2. **Platform adds Dimts OIDC client**
   - Redirect URI: `https://api.example.com/v1/lti/launch`
   - Scopes: `openid` (id_token signed JWT only)
   - Response type: `id_token` (no authorization code)

3. **Platform configures tool deep link or course integration**
   - Launch URL: `https://api.example.com/v1/lti/launch?login_hint={login_hint}`
   - Tool placement: course content, question menu, help widget, etc.

### Learner launch flow

```
Learner clicks "Ask Dimts" in LMS course
        ↓
LMS initiates OIDC login
    POST /lti/login to Dimts with learner hint
        ↓
Dimts returns state, nonce, auth endpoint
        ↓
Learner redirects to LMS auth, grants consent
        ↓
LMS returns signed id_token to Dimts
    POST /lti/launch with id_token, state
        ↓
Dimts validates:
  - JWT signature (platform JWKS)
  - issuer, audience (client_id), deployment
  - state (5 min expiry), nonce (one-time)
  - exp (≤5 min in future), sub, roles
        ↓
Dimts creates pseudonymous session
  - No account created
  - Learner role: normal session
  - Instructor role: insightsAccess flag set
        ↓
Dimts returns sessionId, sessionToken, roles
        ↓
LMS displays Dimts widget or redirects to session
        ↓
Learner can ask, get answers, request help
```

### Instructor access to insights

Instructors launched via LTI with `#Instructor` role:

```
Instructor clicks "Class Insights" in LMS
    ↓
LTI launch (same flow, but roles includes Instructor)
    ↓
Dimts sets insightsAccess=true in session
    ↓
Session bearer token grants GET /v1/insights access
    ↓
Instructor sees aggregated, privacy-safe insights
  (small-cell suppression, no learner names)
```

## Security guarantees

### Token validation (required)

1. **Signature verification** — JWT signed by platform's JWKS
2. **Issuer check** — `iss` matches registered platform URL
3. **Audience check** — `aud` matches registered `client_id`
4. **Deployment check** — `deployment_id` matches if configured
5. **Nonce check** — One-time use (replay prevention)
6. **State check** — Expires in 5 minutes
7. **Expiry check** — `exp` ≤ 5 minutes in future (5-minute max token lifetime)

### Session security

- **Pseudonymous** — No account creation; session tied to platform + user_id hash
- **Short-lived** — 24-hour session expiry
- **HttpOnly cookie** — sessionToken never readable by JavaScript
- **No learner PII stored** — Only platform issuer, deployment, platform user_id for audit

### Insights access control (P09 + P10)

- **Host key** (`X-Dimts-Key` header) — Server-to-server access
- **LTI instructor role** — Bearer token from learner/instructor launch + `insightsAccess` flag
- **Both paths** — Same response format, privacy rules

## API contracts

### POST /lti/login

**Request**
```json
{
  "iss": "https://lms.example.com",
  "client_id": "dimts-client-123",
  "login_hint": "learner-456",
  "target_link_uri": "https://app.example.com/lti/launch",
  "lti_message_hint": "context-789"
}
```

**Response (200)**
```json
{
  "state": "base64url_encoded_state",
  "nonce": "32_character_hex_nonce",
  "authLoginUrl": "https://lms.example.com/auth/login",
  "redirectUri": "https://api.example.com/v1/lti/launch"
}
```

**Errors**
- 400: Invalid request (validation)
- 404: Platform not registered
- 500: Server error

### POST /lti/launch

**Request**
```json
{
  "id_token": "eyJhbGc...",
  "state": "base64url_encoded_state"
}
```

**Response (200)**
```json
{
  "sessionId": "session-abc123def456",
  "sessionToken": "random_session_token_64_hex",
  "roles": ["Learner"],
  "insightsAccess": false,
  "contextId": "course-123"
}
```

**Errors**
- 400: Invalid request
- 401: Invalid token (signature, claims validation)
- 403: Invalid/expired state, token replay, nonce replay
- 500: Session creation failed

### GET /lti/jwks

**Response (200)**
```json
{
  "keys": []
}
```

## Example: Platform registration curl

```bash
# Step 1: Register platform (admin only)
curl -X POST https://api.example.com/v1/lti/login \
  -H "Content-Type: application/json" \
  -H "X-Dimts-Key: admin-secret-key" \
  -d '{
    "iss": "https://lms.example.com",
    "client_id": "dimts-client-123",
    "login_hint": "test-learner",
    "target_link_uri": "https://app.example.com/lti/launch",
    "lti_message_hint": "test-context"
  }'

# Step 2: Platform auth redirects learner to Dimts launch
curl -X POST https://api.example.com/v1/lti/launch \
  -H "Content-Type: application/json" \
  -d '{
    "id_token": "eyJhbGc...(signed JWT from platform)...",
    "state": "c3RhdGUtYWJjZGVm"
  }'

# Response:
# {
#   "sessionId": "session-abc123",
#   "sessionToken": "token_hex_64_char",
#   "roles": ["Learner"],
#   "insightsAccess": false
# }
```

## Troubleshooting

### "Platform not registered" (404)

- Issuer URL in request must exactly match registered platform's issuer

### "Invalid token" (401)

- Check JWT signature against platform JWKS URL
- Verify issuer, audience (client_id), deployment ID match registration
- Confirm platform's private key is used to sign

### "Invalid state" (403)

- State expires after 5 minutes
- State must be from POST /lti/login response, not cached

### "Nonce replay" (403)

- Each id_token must use a fresh nonce from POST /lti/login
- Nonce can only be used once (one-time use enforced)

### "Token replay" (403)

- id_token signature hash already seen
- If retrying, get a new id_token from platform auth flow

## Notes

- All timestamps are Unix epoch (seconds)
- Deployment ID is optional; if provided, must match registration
- Role URLs must match IMS vocab: `http://purl.imsglobal.org/vocab/lis/v2/institution/person#{Role}`
- Deep linking and content hints are supported in context claim
- Screen sharing via RTC is handled by existing help flow (P05)
