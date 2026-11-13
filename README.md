# Quick start: interactive Dimts MVP

The root `index.html` is an offline Savanna reference catalog. To run the
interactive learner widget with its API:

1. Start Docker Desktop and make sure its Linux container engine is running.
2. On first run, create `.env` from `.env.example` and set the local secrets as
   described in [Local API setup](./docs/API.md#start-locally).
3. From the repository root, build and start the app:

   ```powershell
   docker compose --profile local up --build -d --wait
   ```

4. Open [http://localhost:5173/](http://localhost:5173/). Check
   [http://localhost:5173/v1/health](http://localhost:5173/v1/health) to confirm
   the API is ready through the widget's proxy.
5. To stop the app and preserve local data:

   ```powershell
   docker compose --profile local down
   ```

If the browser says **Failed to Load Page**, first check that Docker Desktop is
running, then run `docker compose --profile local ps`. Start or inspect the
services with:

```powershell
docker compose --profile local up --build -d --wait
docker compose --profile local logs --tail=100 api widget
```

If startup reports that host port `3000` is already allocated, use another API
port in the same PowerShell window:

```powershell
$env:DIMTS_COMPOSE_API_PORT = "3001"
docker compose --profile local up --build -d --wait
```

See [Local API setup](./docs/API.md#start-locally) for port conflicts and
configuration. Opening `index.html` directly still shows only the offline
reference pages.

## Operations and release readiness

The [integration contract](./docs/INTEGRATION.md), [privacy policy](./docs/PRIVACY.md),
[free-tier notes](./docs/FREE_TIER.md), [cost controls](./docs/COST.md),
[accessibility evidence](./docs/WCAG_REPORT.md), [release gates](./docs/GATE_CHECKLIST.md),
and [co-creation log](./docs/COCREATION_LOG.md) document verified behavior and
remaining acceptance work. The release checklist is currently blocked on
human/device and hosted-deployment evidence; automated tests do not substitute
for those gates.

For sample local data, set `DIMTS_SEED_HELPER_TOKEN` in `.env` to a newly
generated 32-byte base64url value, then run:

```powershell
docker compose --profile local --profile seed run --rm seed
```

`pnpm seed` performs the same course/job/helper seeding when
`DATABASE_URL_DIRECT` points to a database reachable from the host.
`pnpm usage` reports database size and the largest tables.
`pnpm purge:dry-run` only reports personal-data counts;
`pnpm purge:event` is destructive and must only be run after reviewing the
dry-run output.

For an optional local scheduler that calls the documented retention and alert
routes at 06:00 and 07:30 UTC, start Compose with the `scheduler` profile. The
optional `local-ai` profile runs Ollama; it does not change the default offline
provider or automatically enable a model. See [local AI setup](./docs/LOCAL_AI.md).

## Grounded tutor evaluation

Run `pnpm eval` to regenerate [the full evaluation](./docs/EVAL.md).
The 13 November 2026 draft-data run covers 44 questions in normal and Simple
modes (88 runs). The snapshot below is not final language acceptance.

| Language | Questions | Retrieval hit rate | Actual / expected answers, both modes | Citation validity | Not-found correctness |
| --- | ---: | ---: | ---: | ---: | ---: |
| English | 13 | 100% | 2 / 12 | 100% | 100% |
| Amharic | 15 | 0% | 0 / 16 | n/a | 100% |
| Afaan Oromoo | 16 | 0% | 0 / 18 | n/a | 100% |

English answer recall is 16.7%; its returned sentences average eight words
in both modes. Amharic/Oromo answer quality is unverified because the corpus
has no reviewed cross-language mappings or translated source passages.
The separate offline FAQ adapter matches 9/9 draft entries per language;
this does not bypass the engine's retrieval/confidence gate. Human review,
broader sourced content, and real local/cloud model evaluation remain open.
See [local provider setup](./docs/LOCAL_AI.md) and
[implementation progress](./docs/IMPLEMENTATION_PROGRESS.md).

## Savanna static pages

Three Savanna learner pages, frozen from the **local dev app** into plain HTML + CSS so they can be
opened offline and used as a reference for front-end and accessibility work.

Open `index.html` (or any file in `pages/`) directly with `file://` — double-clicking works, no
server needed.

## What is here

| Page | Learner / course | What it shows |
|------|------------------|----------------|
| `pages/homepage-v1-paced.html` | Björn Sibanda — **WR 100: Fundamentals of Effective Communication**, cohort F26-SEM-16W (31 Aug – 20 Dec 2026), week 10 of 15 | Courses dropdown (3 courses), week strip with **every week preloaded**, "continue where you left off", immediate deliverables, period progress, overall score (59.56%, "slightly behind"), upcoming events |
| `pages/homepage-v1-self-paced.html` | Amara Nwosu — **VA-1: VA Foundations & Professional Identity** | Course-progression gauge (16% against the 70% graduation threshold), 1 of 3 modules complete, **working module switcher**, **preloaded programme modal**, pacing boost (11 days left), upcoming events |
| `pages/concept-with-navigation.html` | Amara Nwosu — concept *"The Future of the VA Industry"* | Curriculum navigation panel (read / current / unread states) beside a full authored concept: callouts, numbered card grid, two-column comparison, icon lists, "Mark as complete". The "Need a Fast Track?" block and the Padlet reflection block are removed on request. |


## Layout

```
savanna_static_pages/
├── index.html                 landing page linking the three captures
├── pages/*.html               the frozen pages (relative links into ../assets)
├── assets/
   ├── css/                   the application's own stylesheets, unminified — application_alx.css 
   │                          (sprockets, themed), app.css (esbuild), Google Fonts, Typekit —
   │                          plus static-page.css, the only one written for these pages
   ├── fonts/                 76 font files, all referenced by the stylesheets above
   ├── img/                   51 images: logos, icons, concept artwork, substituted embeds
   └── js/                    popper.js + bootstrap.bundle.js (the exact files the live app
                              serves through sprockets) + static-page.js
```

Everything is shared: the three pages point at the same `assets/` tree, nothing is duplicated and
nothing is minified or gzipped. Captures are additive, so each run ends by dropping assets no
published page references any more — otherwise the Rive stills from retired week panels would
pile up run after run.

## What still works

These are live in the frozen pages, driven by `assets/js/static-page.js` against content that was
pre-rendered during the capture and parked in `<template>` elements (so nothing is duplicated in
the accessibility tree and no id appears twice):

| Control | Page | Behaviour |
|---|---|---|
| **Hamburger** | all | Collapses the sidebar to its 70px icon rail and back, remembered in `localStorage` under `sidebar-collapsed`. It moves the same three things the app does: `body.sidebar-collapsed`, `expanded` on `#sidebar`, and the labels (React wrote `display` inline on each, so `assets/css/static-page.css` overrides them from the body class). |
| **Week strip** | paced homepage | Every week of the course was rendered server-side at capture time; clicking one swaps the panel below it and moves the `active` state. The chevrons and the scroll-into-view of the selected week are reimplemented from the component's own sidecar JS. |
| **Score details modal** | paced homepage | Server-rendered per week, so it opens on its own — including the one that arrives with a week you switch to. |
| **My activities** | self-paced homepage | Each module's activity list was rendered at capture time; clicking a module swaps the panel beside it, as `HomepageSelfPacedActivities.tsx` does. |
| **Programme modal** | self-paced homepage | "Program details" normally fetches `/dashboards/program_structure.json` on first open — the capture opens it once so the fetched tree is baked in. Its course and module accordions expand and collapse: React renders only the body of an *open* section, so the capture opens each one to materialise its content, pairs every toggle with the element it controls (`data-static-collapse-toggle` / `data-static-collapse-body`) and closes again the ones the app had closed. |
| **Courses dropdown** | all | Server-rendered markup, so Bootstrap's dropdown opens it with no help: three courses across a programme group and "Other courses". |
| **Curriculum bar** | all | The bar fixed under the header pads the content by its own height and slides away on scroll down, as `CurrentCurriculumScrollBehavior.tsx` does. |
| Dropdowns, modals, accordions, collapse, tooltips | all | Bootstrap's own bundle. |

Everything else is inert.


