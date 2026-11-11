# Local API

The API is a separate service from the frozen Savanna reference pages. It uses
the repository's PostgreSQL Compose service and never writes learner messages
or credentials to application logs.

## Start locally

1. Copy `.env.example` to `.env` and set a local PostgreSQL password.
2. Generate distinct values for `DIMTS_ENC_KEY` and `DIMTS_HASH_KEY` with
   `openssl rand -base64 32`. Generate a third distinct base64 value for
   `DIMTS_JWT_SECRET` and a `DIMTS_CRON_SECRET` with
   `openssl rand -base64 24`. Keep `.env` private and untracked.
3. Start PostgreSQL with `docker compose --profile local up -d --wait db`.
4. Run `pnpm migrate` to apply the PostgreSQL migrations once.
5. Add a host key row before creating browser sessions. Store only the SHA-256
   hash of the chosen host key and the allowed origins in `host_key`; never
   commit the raw key.
6. Run `pnpm api:start`. The service listens on port 3000 by default.

`GET /v1/health`, `GET /v1/languages`, `GET /v1/locales/{code}/ui`,
`GET /v1/openapi.yaml`, and `GET /v1/docs` are public. Draft packs are hidden
unless `?lang_preview=1` is supplied.
`POST /v1/sessions` requires `X-Dimts-Key` and an allowed browser origin.
`POST /v1/ask` requires the returned session bearer token and `sessionId`.

## Ingest course content

Set `DIMTS_CONTENT_BASE_URL` to the canonical directory URL for rendered lessons
and `DIMTS_DEFAULT_LANG` to the language of the content directory. After
migrations have run, use:

```powershell
pnpm content:ingest content/sample-course
```

Ingestion accepts Markdown and HTML lesson files in one directory. Each file
becomes one lesson; its filename (without extension) is the lesson id. Markdown
heading slugs or existing HTML heading ids are used as citation anchors. A
content directory is ingested in the language selected by `DIMTS_DEFAULT_LANG`.
HTML sections that contain lesson text must have heading ids; ingestion rejects
sections without a rendered anchor rather than creating broken citations. A
content update replaces the active passage set and clears `answer_cache` in a
single transaction. Transcript ingestion is deferred until the course
transcript format is confirmed.

WP03 provides the grounding index/search and citation-gated engine library.
The HTTP ask route still returns localized `notfound` replies for non-small-talk
questions until WP04 wires in the AI provider ladder.
