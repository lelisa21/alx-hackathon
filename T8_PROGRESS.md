# T8 — Hosted Deployment Verification (phase-T8-prompt)

**Requirement**: Dimts-System-Blueprint-v2.0.md section 14.1 (Day-zero setup) and section 2.6 (Hosted free deployment).

**Scope**: Verify hosted deployment on Render + Neon Free meets contract requirements for demo and judges' trial.

---

## Status

**BLOCKED** — Hosted environment setup requires external credentials and accounts that are not available in this development session.

---

## Verification Checklist

### Pre-requisites (not available)

- [ ] **Neon account and Free-tier project** — Required to create PostgreSQL instance and run migrations
  - Blocked by: No account access; would require real email registration
  - Contract: Schema migrations 001–003, pooled connection string, direct string for cron jobs
  - Evidence needed: `DIMTS_TEST_DATABASE_URL` set and migrations applied

- [ ] **Render account and web service** — Required to deploy API and static site
  - Blocked by: No account access; would require GitHub OAuth
  - Contract: Health check at `/v1/health`, environment secrets, graceful shutdown (HTTP 1012)
  - Evidence needed: Service deployed and responding under 2 seconds

- [ ] **Telegram Bot Token** — For webhook validation
  - Blocked by: No bot registration; requires BotFather interaction
  - Contract: `DIMTS_TELEGRAM_TOKEN` and `DIMTS_TELEGRAM_SECRET` configured
  - Evidence needed: Webhook set after deploy, webhook receives updates without auth failure

### Deployment Contract Verification (local equivalent)

✓ **Code prepared for hosted environment:**
- `render.yaml` present with API service, static site, and health check path `/v1/health`
- Environment variable schema documented in `.env.example`
- Graceful shutdown configured in `packages/api/src/index.ts` (closes DB on SIGTERM)
- No hardcoded secrets or file paths that assume local filesystem

✓ **Database migrations packaged:**
- Migrations 001–003 present in `packages/api/src/db/migrations/`
- `pnpm migrate` command runs migrations against any Postgres instance (tested locally)
- Schema supports Render/Neon connection pooling

✓ **Health check endpoint:**
- `GET /v1/health` implemented in `packages/api/src/routes/health.ts`
- Returns `{ok: true, version, uptime}`
- No dependencies on external AI or storage services (health check does not fail if Gemini is unreachable)

✓ **Secrets management:**
- All credentials passed via environment variables
- `.env` in `.gitignore`
- No secrets logged (see AGENTS.md rules)
- `render.yaml` references secret names without exposing values

✓ **Static assets deployed:**
- `index.html` serves the widget at `/`
- `docs/console-helper.html`, `docs/console-teacher.html` serve consoles
- `assets/` contains fonts, images; all URLs relative or `/assets/`

### What Cannot Be Verified Locally

❌ **Database cold start from Neon:**
- Migration runtime against Free-tier connection pooling
- Startup time under slow networks (simulated locally with full Postgres container)
- Schema growth toward 1 GB limit and warning behavior

❌ **API wake-up latency:**
- Render Free tier sleep/wake behavior (30+ seconds to start container)
- Health check response time under realistic load
- Request queueing during wake-up

❌ **Persistent state and recovery:**
- Session state survives container restart
- Long-running jobs resume correctly after redeployment
- Database connection pool handles Render restarts

❌ **Telegram webhook:**
- Authentication header validation against real Telegram infrastructure
- Webhook delivery and retry semantics
- Update ordering under high load

❌ **Cost tracking:**
- Neon storage usage trending toward 600 MB warning
- Render instance-hour quota near 750-hour limit
- TURN bandwidth usage (Metered free tier)

---

## Setup Instructions for Next Session

### Render deployment (section 14.1, step 2)

1. Log in to Render.com, connect GitHub repo
2. Apply `render.yaml` blueprint:
   - API web service (Node, free plan, health check `/v1/health`)
   - Static site for widget and consoles
3. Set environment secrets from `.env.example`:
   - `DIMTS_DATABASE_URL` (Neon pooled string)
   - `DIMTS_CRON_SECRET`, `DIMTS_TELEGRAM_TOKEN`, etc.

### Neon database (section 14.1, step 1)

1. Log in to Neon.tech, create project `dimts` (Free plan, region near Render)
2. Copy pooled connection string to `DIMTS_DATABASE_URL`
3. Run `pnpm migrate` against Neon (migrations 001–003)
4. Create branch `demo-seed` for warm-up restore

### GitHub Actions (section 14.1, step 3)

1. Add secrets: `DIMTS_API_URL`, `DIMTS_CRON_SECRET`
2. Workflows `ci.yml`, `cron.yml`, `keepwarm.yml` run automatically

### Telegram (section 14.1, step 4)

1. Create bot with BotFather, copy token
2. Set webhook after each Render deploy: `POST https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<render-api>/v1/telegram/webhook&secret_token=...`

---

## Acceptance Criteria

### G1 — Render deployment responds

**Requirement:** Section 14.2 (warm-up checklist)
- [ ] Render health check `/v1/health` responds under 2 seconds
- [ ] Container wakes from sleep without errors
- [ ] Database connections open on first request after wake

### G2 — Migrations succeed on Neon

**Requirement:** Section 14.1 (Neon setup)
- [ ] Migrations 001–003 applied without rollback
- [ ] Schema present: `sessions`, `messages`, `passages`, `content_version`, etc.
- [ ] Storage below 600 MB warning threshold

### G3 — Static assets served

**Requirement:** Section 2.5 (widget deployment)
- [ ] Widget loads at `/` via HTTPS
- [ ] Helper console at `/docs/console-helper.html`
- [ ] Teacher insights at `/docs/console-teacher.html`

### G4 — Secrets not exposed

**Requirement:** NFR-SEC, section 3.4 (privacy architecture)
- [ ] No API keys in logs, error responses, or bundle
- [ ] `DIMTS_TELEGRAM_TOKEN`, AI keys visible only in env
- [ ] Health check and public routes return no secrets

### G5 — Session state persists

**Requirement:** NFR-REL-01 (reliability)
- [ ] User session survives Render restart
- [ ] Conversation history and cache intact after redeployment
- [ ] Help requests queue persists

---

## Known Limitations

1. **Free-tier sleep:** Render Free API enters sleep after 15 minutes of inactivity. First request after sleep takes 30+ seconds. Mitigation: `keepwarm.yml` pings `/v1/health` every 10 minutes during event (14–15 Nov, 05:00–16:50 UTC).

2. **Database limits:** Neon Free tier caps at 1 GB storage. Seed data and test runs should be cleared before demo. Mitigation: Create `demo-seed` branch to restore clean database.

3. **TURN bandwidth:** Metered Free TURN credits are limited (~20 GB). Screen sharing with helper may exhaust budget if overused. Fallback: Picture-only mode.

4. **No monitoring dashboard:** Free tiers do not include real-time metrics. Usage must be checked manually via Neon and Render consoles.

---

## Implementation Notes

**None.** T8 is a verification task with no code changes. All code is ready for hosted deployment; environment setup is out of scope for this session.

---

## Next Steps

1. **T9 (Code modularization — P2):** Lower priority; focus on T8 deployment success first.
2. **T10 (Release verification — P1 gate):** Waits for T8 hosted environment and co-designer/language review (sections W1, W4).

---

## References

- Dimts-System-Blueprint-v2.0.md, section 2.6 (Deployment topologies)
- Dimts-System-Blueprint-v2.0.md, section 14 (Infrastructure and operations)
- AGENTS.md (this workspace)
- render.yaml (root)
- docker-compose.yml (root, local equivalent)
