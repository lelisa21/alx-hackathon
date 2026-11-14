# Free-tier deployment notes

**Provider limits checked:** 13 November 2026. Limits can change; re-check the
linked provider pages before creating or renewing a service. A free plan is
not a production-availability commitment.

| Service                 | Free allowance/limit checked                                                                                                                                                               | Consequence and fallback                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render web service      | 750 free instance-hours per workspace/month; a free web service spins down after 15 minutes without inbound traffic and may take about one minute to start. Local filesystem is ephemeral. | Cold requests and downtime are expected; keep persistent state in PostgreSQL. The bounded keepwarm workflow is limited to 14-15 November 2026, 05:00-16:50 UTC; it does not guarantee uptime. Use local Compose for a backup. |
| Render static site      | Free to deploy; counts against included outbound bandwidth and build-pipeline minutes.                                                                                                     | Serve the built widget assets; check current included usage in the Render dashboard.                                                                                                                                          |
| Render Postgres         | 1 GB, expires 30 days after creation, no backups.                                                                                                                                          | Not selected for persistent MVP data. Do not use for the event data store.                                                                                                                                                    |
| Neon Free               | 100 CU-hours/project, 1 GB/project and 20 GB/account total storage, 5 GB/project public network transfer, scale-to-zero after five minutes, and no uptime SLA.                             | Suitable only for a small demo subject to its limits; local PostgreSQL remains the offline fallback. Back up/export before relying on data.                                                                                   |
| GitHub Actions          | Repository/workspace allowance depends on account plan and current GitHub policy; not measured here.                                                                                       | Monitor included usage. Scheduled workflows require repository secrets and can be disabled or delayed.                                                                                                                        |
| AI, Telegram, SMS, TURN | No free quota or no-charge status is assumed.                                                                                                                                              | Optional integrations are off unless configured; use the offline tutor, web channel, or local Compose fallback.                                                                                                               |

The Render free-plan limitations are documented at
[Render free instances](https://render.com/docs/free) and
[Render static sites](https://render.com/docs/static-sites). Neon Free
limits are documented at
[Neon plans](https://neon.com/docs/introduction/plans).

## Local offline fallback

The app and PostgreSQL can run through Docker Compose without Render, Neon, or
an AI account. `DIMTS_AI_PROVIDER=offline` is the default in the sample
configuration. After the container images and dependencies are available,
the core offline flow does not make an AI-provider request. A clean machine
still needs Docker and an initial image/dependency download; offline operation
has not been verified on this machine because Docker is unavailable.

Follow [DEPLOY.md](DEPLOY.md) for the hosted Render/Neon steps. The
[`render.yaml`](../render.yaml) build and start commands, migrations,
provisioning and the production API flow were verified locally against
PostgreSQL 17 in production mode. A real Render/Neon deployment, provider
controls and actual free-tier usage still need to be measured on the hosted
stack.
