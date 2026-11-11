# Dimts

Dimts is the Track 3 multilingual assistant and live-help module for the Digital
Bridge Accessibility Hackathon. The authoritative architecture and product
decisions are in [Dimts-System-Blueprint-v2.0.md](./Dimts-System-Blueprint-v2.0.md);
the detailed requirements are in [Dimts-SRS-v1.2-complete.md](./Dimts-SRS-v1.2-complete.md).

## Prerequisites

- Node.js 22.18 or newer
- Corepack (included with supported Node.js releases)
- Docker Desktop for the local PostgreSQL service

## Setup

From the project root in PowerShell:

```powershell
corepack enable
corepack pnpm install
Copy-Item .env.example .env
```

Edit `.env` and set a unique local `POSTGRES_PASSWORD`, then start PostgreSQL:

```powershell
docker compose --profile local up -d db
```

Run the current workspace checks:

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

This is the WP00 foundation. Application services, migrations, end-to-end tests,
and deploy configuration will be added in their dependent work packages; the
Compose profile currently starts only the local database.

## Workspace map

- `packages/` — widget, API, engine, grounding, provider adapters, channels,
  services, and locale tooling
- `locales/` — English, Amharic, Afaan Oromoo, and CI-only RTL test pack
- `content/` — sample course and job data
- `tests/` — end-to-end, accessibility, grounding, and language suites
- `docs/`, `examples/`, and `scripts/` — project documentation, integration
  examples, and developer tooling

## Development rules

See [AGENTS.md](./AGENTS.md) for implementation constraints and
[DECISIONS.md](./DECISIONS.md) for recorded setup decisions.
