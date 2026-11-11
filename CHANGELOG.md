# Changelog

## Unreleased

- Add the initial pnpm workspace, package skeletons, strict TypeScript setup,
  CI validation, and local PostgreSQL Compose profile.
- Import the authorized Savanna static-page reference captures and shared assets.
- Add WP01 locale pack loading, fallback translation, validation, date and
  language-suggestion utilities, draft packs, and the `pnpm lang:check` command.
- Add the WP02 Express API foundation: validated secrets, session credentials,
  structured errors, health/language/locale/session/ask routes, PostgreSQL
  migrations, rate limits, and generated OpenAPI.
- Add WP03 content ingestion, Unicode search normalization, PostgreSQL GIN
  trigram retrieval, confidence scoring, and citation-gated engine replies.
