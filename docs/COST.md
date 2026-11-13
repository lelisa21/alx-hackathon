# Cost and budget controls

**Checked:** 13 November 2026. These are provider plan limits, not a quote,
bill, or guarantee that an application deployment will remain free.

## Budget controls in the repository

- `pnpm usage` reports `pg_database_size`, the ten largest user tables,
  session/message counts, and warns at the configured 600 MiB budget
  (`DIMTS_DB_BUDGET_MB`). The query uses PostgreSQL's own `pg_database_size`
  value as the database total.
- Individual active sessions are retained for 24 hours after inactivity;
  help images expire after two hours; alert contact data is deleted when
  consent is stopped or expires; answer-cache entries expire after 24 hours.
- The normal tutor path is offline unless the operator configures and enables
  a provider. Remote AI, Telegram, SMS gateway, and Metered TURN can incur
  costs outside the repository and must be budgeted independently.
- `pnpm purge:dry-run` is read-only. `pnpm purge:event` requires the explicit
  apply path and deletes event/session personal data while preserving the
  course corpus and permitted anonymous aggregates.

## Cost statement

No hosted account, usage invoice, AI usage, SMS delivery, TURN relay, or
production database was available to measure. Therefore this repository does
not claim an actual monthly cost or that all usage is free. Operators must
check current provider pricing, set billing alerts/spend limits where
available, and disable optional paid integrations until approved.

See [FREE_TIER.md](FREE_TIER.md) for dated provider limits and fallback
behavior, and [PRIVACY.md](PRIVACY.md) for data processed by optional
providers.
