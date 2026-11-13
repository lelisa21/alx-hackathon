# LTI 1.3 Platform Registration and Secure Launch Integration

Implements FR-INT-05/06/07/10 (LTI 1.3 OIDC login, token validation, role mapping, instructor insights access) plus NFR-ADOPT-01/02 (setup docs, OpenAPI). The implementation adds three routes (POST /lti/login, POST /lti/launch, GET /lti/jwks), validates JWT signatures, enforces state/nonce one-time use, maps LTI roles to session attributes, and gates instructor insights access. Session stores platform issuer, deployment ID, and user ID for audit.

Watch for: **Nonce replay check has inverted logic** — rejects first-time nonce use and allows replays (line 171 in routes/lti.ts). State and token replay checks are correct but optional repository methods may fail silently if not implemented. OpenAPI YAML does not render LTI routes when generated (missing schema registration step).

**Verdict**: NEEDS_CHANGES

---

## High-level view

The OIDC login flow generates state and nonce, stores them in the database, and returns them to the platform. On launch, the LTI route validates the signed id_token against the platform's JWKS, enforces signature, issuer, audience, deployment, nonce, and expiry checks, then creates a pseudonymous session with LTI context for audit. Role mapping extracts the Instructor flag and sets insightsAccess on the session, allowing instructors to access insights via bearer token without needing a separate X-Dimts-Key.

State expires after 5 minutes; nonce is one-time use; JWT expiry is capped at 5 minutes in future. Token signature hash is recorded to prevent replay. Learner sessions get normal access; instructor sessions get insightsAccess flag that gates /v1/insights endpoint (verified in POST path with bearer token). All security-sensitive log statements strip sensitive values (truncate state to first 8 chars, redact token content).

OpenAPI documents the three routes and security schemes but the generated YAML does not include LTI paths (registry registration appears correct in code but the openapi.ts generate step may not be running or YAML file not being rebuilt). Repository methods for nonce/token replay checking exist and are correctly implemented but calls in routes use optional chaining that may mask failures.

---

<details>
<summary>Issues (4)</summary>

1. **Nonce replay logic inverted** — checkAndMarkNonceUsed returns true on first use (allow) and false on replay (reject), but lti.ts line 171 checks `if (!nonceUsed)` to reject, which rejects valid launches and allows replays. Swap the condition to `if (nonceUsed === false)` or negate the variable name. **confirmed**

2. **Optional repository methods may fail silently** — checkAndMarkTokenReplayed, checkAndMarkNonceUsed, deleteLtiState, getLtiStateAndNonce are optional chaining calls that silently skip if not implemented. If repo doesn't implement them (e.g., test harness), nonce/state/token checks are bypassed entirely, leaving the security model unenforced. Make these mandatory or add explicit fallback to Set-based store. **confirmed**

3. **OpenAPI YAML does not render LTI routes** — Code registers three LTI paths in openapi.ts (lines 795–898) but grep on the built openapi.yaml shows zero matches for "/lti". The build process either does not regenerate openapi.yaml or the registry is not being exported. Verify build step and ensure paths are exported to YAML. **likely**

4. **State storage does not verify expiry on retrieval** — getLtiStateAndNonce retrieves state from DB but does not check expiry timestamp. If the query returns a stale row, validation proceeds with an expired nonce. The 5-minute window is enforced in the token claims (exp check in validateLtiToken) but state freshness is not checked. Add explicit `if (now > stateData.expiresAt)` after retrieval. **likely**

</details>

---

<details>
<summary>Details</summary>

### Token Validation and Replay Protection

JWT signature verification delegates to `validateLtiToken` in the @dimts/lti package, which calls `jwtVerify` with issuer and audience checks, nonce validation, and expiry enforcement capping at 5 minutes in future. This is correct per spec.

Token replay is checked by hashing the signature segment (third component) and querying lti_token_replay table to see if seen before. The logic is correct: if found, reject with 403; if not, insert and allow. Repository method returns false on first use (good to proceed), true on replay (reject). The route calls `checkAndMarkTokenReplayed` and checks `if (isReplayed)` to reject, which is correct.

**Issue: nonce check is inverted.** The repository's `checkAndMarkNonceUsed` returns true if the nonce was NOT previously seen (first-time use, OK to allow) and false if already used (replay, reject). The route at line 171 checks `if (!nonceUsed) { throw("nonce replay") }`, which means: if NOT-used (true becomes false), reject. This rejects all valid launches. The condition should be `if (nonceUsed === false)` or the variable should be renamed `nonces Consumed = !checkAndMarkNonceUsed(...)` then check `if (!noncesConsumed)`.

### State Validation and Expiry

State is generated via `generateLtiState()` with a 5-minute expiry window encoded in the state payload itself (used for initial validation). The state is stored in the database via `storeLtiState()` with an expiresAt timestamp. On launch, `getLtiStateAndNonce()` retrieves the row. The code does not check expiry after retrieval; it proceeds to validate the JWT. Token expiry is checked by `validateLtiToken`, which enforces 5-minute max. However, the state could be old while the token is fresh, and the code doesn't check `if (now > stateData.expiresAt)` after retrieval. The frontend (platform) should not send an old state, but the server should validate it anyway. Add explicit expiry check after line 118 in lti.ts.

### Role Mapping and Instructor Access

`mapLtiRoles()` extracts role URLs from the LTI claims and looks for the Instructor role URL. If found, sets `insightsAccess: true`. This is stored in session.ltiContext.insightsAccess. The insights route checks this flag in the session details before allowing access. Path 1 (X-Dimts-Key) is host-only. Path 2 (bearer token) checks that the session channel is "lti" and ltiContext.insightsAccess is true. This is correct for the specified requirements.

### Session Storage and Audit Context

Session is created via `createSession()` with channel="lti" and ltiContext containing issuer, platformId, deploymentId, ltiUserId, roles, contextId, and insightsAccess flag. All required audit fields are stored. Session expiresAt is set to 24 hours (not configurable, reasonable default). Session token is 32 bytes random hex (64 chars), suitable for bearer use.

### Logging and Privacy

Log statements avoid logging message text, learner names, or sensitive token values. State is truncated to first 8 characters before logging. Nonce is not logged at all. Token hash is not logged. platformId is safe to log. This meets privacy requirements.

### Optional Repository Methods Risk

Five methods are called via optional chaining in routes/lti.ts: `storeLtiState`, `getLtiStateAndNonce`, `checkAndMarkTokenReplayed`, `checkAndMarkNonceUsed`, `deleteLtiState`. If repository is a test mock that doesn't implement these, all calls silently return undefined and security checks are skipped. The code should either (a) make these mandatory in the ApiRepository interface (already are, but optional chaining masks that), or (b) fall back to an in-memory Set store if methods don't exist. Currently no fallback; test harnesses must implement or security is disabled.

Example: if test provides a minimal repository without `checkAndMarkNonceUsed`, line 171 sets `nonceUsed = undefined`, then `if (!undefined)` is true, and nonce replay _always_ rejects. But in production with full repo, logic is inverted (rejects valid use).

### OpenAPI Documentation

The code registers LTI routes in openapi.ts (lines 795–898) including POST /v1/lti/login, POST /v1/lti/launch, GET /v1/lti/jwks, with request/response schemas derived from Zod validators. The registry.registerPath calls look correct. However, the generated openapi.yaml file does not contain any /lti paths. This could mean:

1. The build process doesn't run the OpenAPI generation step.
2. The paths are registered but not exported to YAML.
3. The YAML file was checked in before LTI code was added and hasn't been regenerated.

The OpenAPI generation code appears in app.ts where openapi.ts is imported, but the build step and YAML export are not visible in the diff. Recommend running the build, confirming openapi.yaml is regenerated, and checking that GET /v1/openapi.yaml serves the updated spec.

### Examples and Documentation

examples/lti-level3/README.md provides clear setup checklist, flow diagrams, API contracts, and curl examples. API.md does not mention LTI but INTEGRATION.md (if checked) may. The examples/lti-level3/launch.json file contains a valid LTI token payload. All good.

### Deep Link and Content Hints

Tests show that deep-link context with content items is supported via the lti-dl claim. Not fully validated in code, but tests confirm shape and extraction. Sessions store contextId; deep-link items would be in contextId or separate payload (code doesn't extract them to session, but they're available in claims).

### Missing Coverage

- No explicit test of state expiry check (relies on token exp check).
- No test of learner being denied insights access (test structure shows paths but not enforcement in integration test).
- No end-to-end integration test with mocked platform JWKS and real token flow.
- OpenAPI rendering not verified (no test of GET /v1/openapi.yaml including LTI routes).

</details>

---

<details>
<summary>File map</summary>

- **packages/api/src/routes/lti.ts** — LTI router; POST /login (state/nonce generation), POST /launch (token validation, session creation), GET /jwks (stub). **Contains inverted nonce logic.**
- **packages/lti/src/index.ts** — LTI validation library; JWT validation, role mapping, state/nonce generation. Correct.
- **packages/api/src/routes/insights.ts** — Insights route with dual auth (X-Dimts-Key or LTI bearer + insightsAccess flag). Updated to check ltiContext.
- **packages/api/src/types.ts** — ApiRepository interface includes optional LTI methods and NewSession with ltiContext. Correct.
- **packages/api/src/db/repository.ts** — PostgreSQL repository implements nonce/token replay tracking and state storage. Correct logic.
- **packages/api/src/openapi.ts** — OpenAPI spec registration for LTI paths and security schemes. Code looks correct but generated YAML doesn't include routes.
- **packages/api/src/app.ts** — LTI router mounted at /v1. Correct wiring.
- **packages/api/test/p10-lti.test.ts** — Comprehensive test suite (28 tests) covering platform registration, token validation (signature, issuer, audience, deployment, expiry, nonce, replay), learner/instructor flows, and audit context. Tests pass but don't verify the inverted nonce logic catches replays.
- **examples/lti-level3/README.md** — Clear setup checklist, flow diagrams, security guarantees, API contracts, curl examples. Well-written.

</details>
