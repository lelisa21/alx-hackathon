# P10 LTI 1.3 and OpenAPI: Code Review

LTI 1.3 integration with OIDC login flow and JWT validation is implemented with comprehensive security tests. Session binding to platform identity is pseudonymous and role-based insights access is wired. However, the OpenAPI schema has not been updated with LTI routes, and insights authorization logic requires completion.

**Watch for:**
- **confirmed** OpenAPI schema missing LTI endpoints (`/lti/login`, `/lti/launch`, `/lti/jwks`) and insights security scheme
- **confirmed** Insights route accepts `X-Dimts-Key` or session bearer but lacks LTI instructor role verification in the authorize path
- **confirmed** One test failing: token signature validation test has incorrect assertion (doesn't throw as expected)
- **likely** LTI session nonce/state/token replay detection uses in-memory storage that won't survive restart or horizontal scaling

**Verdict**: NEEDS_CHANGES

---

## High-level view

LTI 1.3 token validation is complete: the `@dimts/lti` package validates signatures against platform JWKS, enforces issuer/audience/deployment matching, rejects replayed nonces and tokens, and applies 5-minute expiry limits. The route handlers in `packages/api/src/routes/lti.ts` implement login/launch flows and parse role claims to determine instructor access.

Session creation ties LTI identity to a pseudonymous session ID derived from platform and user hash, with launch context stored for audit (platform issuer, deployment, user ID, roles, course context). The integration with `createSession()` appears sound for channel=lti binding.

However, two blocking gaps remain. First, the OpenAPI schema (`packages/api/openapi.yaml`) does not document the three LTI routes or their request/response schemas; the generated spec is incomplete. Second, the insights route accepts both host key and bearer token but the code comment in `insights.ts` says "LTI path implemented in P10" — the actual LTI instructor path is stubbed and not implemented. The insights repository method `verifyHostKey` is called, but there is no corresponding code to extract and verify an LTI instructor session from the bearer token and check the `insightsAccess` flag.

Security testing is thorough (signature, nonce replay, state expiry, deployment mismatch, token age), but three concerns remain unaddressed: in-memory nonce/state/token-hash stores are not persistent across restarts, session context is not validated against a real platform registry, and the test suite has one failing assertion that masks test correctness.

---

<details>
<summary>Issues (5)</summary>

1. **OpenAPI schema incomplete** — LTI routes and request/response schemas not added to `packages/api/openapi.yaml`. The generated spec will not document `/v1/lti/login`, `/v1/lti/launch`, `/v1/lti/jwks`, or the LTI security scheme. Update `packages/api/src/openapi.ts` to register LTI path definitions and schemas.

2. **Insights bearer token path not implemented** — `packages/api/src/routes/insights.ts` comment says "LTI path implemented in P10" but the code only checks `X-Dimts-Key`. No code extracts the bearer token, verifies it as a valid session, or checks `insightsAccess` flag. Implement the LTI instructor authorization path: parse bearer token, validate session, check `insightsAccess` flag, or reject with 401.

3. **Nonce/state/token-hash store is in-memory** — `stateToNonce` and `tokenHashSeen` in `routes/lti.ts` and `nonceSeen` in the router options will not survive API restart or horizontal scaling. Replay attacks are possible if the process restarts before token-hash cleanup or if requests hit different instances. Move to Redis or PostgreSQL: store with expiry key, check before validation, and delete on success.

4. **Test assertion incorrect** — `p10-lti.test.ts` line 156 test "rejects token with invalid signature" expects a thrown error but the test's mock function does not actually throw under the bad-signature condition. The signature validation is incomplete: `badToken.split(".")[2].length < 10` is not a real signature check. Fix the test to use actual jose library validation or stub it properly.

5. **Platform registry not validated** — Session creation stores `ltiContext` with platform config details but does not validate that the platform is registered in the database or that deployment IDs match a live enrollment. The `platformConfigs` map is initialized as an empty `new Map()` by default and never populated. Clarify whether platform configs should be loaded from the database at startup or passed in at router creation time; ensure deployment ID is checked against the database record.

</details>

---

## Token validation and security (confirmed)

The `validateLtiToken` function in `packages/lti/src/index.ts` enforces all required JWT claims: valid signature (against JWKS), issuer, audience (client_id), deployment ID (if configured), nonce (one-time use, enforced by caller), and expiry within 5 minutes. The signature is verified using `jose.jwtVerify` against a remote JWKS endpoint, which is correct for LTI 1.3.

Nonce handling is split between the library (comparison only) and the route handler (tracking in a Set). The route handler adds each validated nonce to `nonceSeen` and checks replay before validation. State expiry is enforced at the route level: `stateToNonce` entries expire after 5 minutes and are checked before token validation proceeds.

Token replay is detected by hashing the signature (third segment of the JWT) and storing it in `tokenHashSeen`. The check happens after nonce validation but before session creation, which is the correct order.

All of these checks are necessary and implemented correctly. However, the in-memory storage means they will be lost on restart, and horizontal scaling will allow an attacker on a different instance to replay a token that was already validated elsewhere.

## Login and launch flows (likely)

The login route (`POST /lti/login`) accepts the OIDC login request, looks up the platform by issuer in `platformConfigs`, generates a state and nonce, stores them in `stateToNonce` with a 5-minute expiry, and returns the state, nonce, and platform auth URL to the client. The logic is sound, but the platform lookup depends on `platformConfigs` being populated; by default, it is empty and all requests will return 404.

The launch route (`POST /lti/launch`) validates state expiry, retrieves the platform config, calls `validateLtiToken` with the stored nonce, checks token and nonce replay, maps roles to determine instructor access, derives a pseudonymous session ID from the LTI user ID (using `deriveLtiSessionKey`), and calls `repository.createSession` with channel=lti and `ltiContext` containing platform, deployment, user ID, roles, and context ID.

The session creation logic assumes `repository.createSession` accepts an `ltiContext` field. The code does not show whether the repository interface actually supports this field or whether it is silently ignored. If the field is not persisted, the audit context (issuer, deployment, user ID) will be lost, breaking compliance with FR-INT-07.

Role mapping uses `mapLtiRoles` to extract instructor status from the IMS LTI roles URL. The mapping extracts the fragment identifier (e.g., "Instructor") and checks for the full instructor URL. Learner role sets `insightsAccess: false`; instructor role sets it to `true`. This is correct.

## Session pseudonymity and audit context (confirmed)

The launch handler derives a session ID using `deriveLtiSessionKey(issuer, platformId, ltiUserId)`, which returns a prefixed key but notes in the comment that "actual session ID generation in API". The route then constructs the session ID as `"session-" + Buffer.from(claims.sub).toString("hex").slice(0, 12).padEnd(12, "0")`. This is a deterministic hash based on the platform user ID, ensuring the same platform+user combination always maps to the same session (or at least the same prefix), which supports session resumption.

The session is stored with `ltiContext` containing issuer, platformId, deploymentId, ltiUserId, roles, contextId, insightsAccess, and timestamp. This audit context is required for FR-INT-07 and FR-INT-10 (instructor role tracking for insights access). However, without confirmation that `repository.createSession` persists the `ltiContext` field, this cannot be fully verified.

## Insights authorization (likely)

The insights route in `packages/api/src/routes/insights.ts` checks for host key authorization first (`X-Dimts-Key`) and calls `repository.verifyHostKey`. If that succeeds, the route is authorized. The code comment says "LTI path implemented in P10; bearer token with insightsAccess", but there is no corresponding code. The function only checks `isAuthorized` before the host-key path; if that fails, it returns 401 without trying the bearer token path.

For LTI instructor access to work (FR-INT-10), the route must extract the bearer token from the Authorization header, validate it as a session token in the repository, check the session's `ltiContext.insightsAccess` flag, and only then grant access. This path is completely missing.

## OpenAPI schema (confirmed)

The OpenAPI specification at `packages/api/openapi.yaml` is generated from `packages/api/src/openapi.ts` using `@asteasolutions/zod-to-openapi`. The file registers routes, request/response schemas, and security schemes. Searching for "lti" in the schema yields no results, confirming that no LTI routes or schemas have been registered in the OpenAPI generation code.

To fix this, `openapi.ts` must register three `registerPath` definitions:
- `POST /v1/lti/login` with `LtiLoginRequestSchema` (iss, client_id, login_hint, target_link_uri, lti_message_hint)
- `POST /v1/lti/launch` with `LtiLaunchRequestSchema` (id_token, state) → `LtiLaunchResponseSchema` (sessionId, sessionToken, roles, insightsAccess, contextId)
- `GET /v1/lti/jwks` → JWKS response (keys array)

A new security scheme for LTI JWT validation is not needed; the bearer token used for insights access should reference the existing `sessionBearer` scheme.

## Test coverage (confirmed)

The test suite `p10-lti.test.ts` has 28 tests covering:
- Platform registration storage and state/nonce generation
- JWT validation (issuer, audience, deployment, nonce, expiry, replay)
- Learner and instructor launch flows
- Session context storage
- Insights access control (learner denied, instructor granted, both X-Dimts-Key and bearer token paths)
- OpenAPI documentation

27 tests pass. One test fails: "rejects token with invalid signature" at line 156. The test creates a malformed JWT and expects the assertion to throw an error on calling the code under test. However, the test's mock function checks `badToken.split(".")[2].length < 10` as a proxy for signature validation, which does not actually validate the signature. The test should either use `jose.jwtVerify` with a known-bad signature or stub the validation properly. The failing test masks whether actual signature validation is working.

Additional test gaps: no tests verify that platform configs are loaded from the database or that deployment IDs are validated against a live enrollment; no tests verify that restarting the API clears nonce/state/token-hash storage and allows replays; no tests verify that insights bearer token path extracts and checks the session's `insightsAccess` flag.

## Repository interface assumption (likely)

The launch handler calls `repository.createSession` with a new field `ltiContext` that does not appear to be defined in the existing session schema. If this field is not supported by the repository, it will be silently ignored, and the audit context required by FR-INT-07 will be lost. The code assumes this works but does not validate it. This must be verified or corrected in the repository schema.

## Documentation (confirmed)

The LTI integration guide at `examples/lti-level3/README.md` is clear and comprehensive, covering platform registration, learner/instructor launch flows, security guarantees, API contracts, and troubleshooting. The HTTP examples at `examples/api-level2.http` include sample requests for LTI login, learner launch, instructor launch, and insights access. These are well-written and executable with minimal changes (replacing placeholder token/state values).

However, the examples assume platform configs are already registered (the `/lti/login` route would return 404 without them), and there is no documented path for an admin to register a platform. If platform registration is only possible via a separate admin API or database insert, that must be documented.

