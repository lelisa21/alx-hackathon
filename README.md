# Dimts: multilingual learning assistant for ALX Savanna

Dimts answers learners' course questions in **English, Amharic and Afaan
Oromoo**, from the course content itself. Every answer links to the exact lesson
section it used. When there is no source, Dimts says so and offers a person.
The same engine serves the Savanna web widget, browser voice, SMS and
Telegram.

## Quick start

1. Start Docker Desktop (Linux containers).
2. First run only: copy `.env.example` to `.env` and set the secrets as
   described in [Local API setup](./docs/API.md#start-locally).
3. Build and start:

   ```powershell
   docker compose --profile local up --build -d --wait
   ```

   The API applies migrations and ingests `content/savanna` (all three
   languages) on start, and again whenever the content changes.

4. Open <http://localhost:5173/>.

If port 3000 is taken, set `DIMTS_COMPOSE_API_PORT=3001` in `.env`. Stop with
`docker compose --profile local down` (add `--volumes` to drop the database).

## What to open

| URL | What it shows |
| --- | --- |
| <http://localhost:5173/> | Demo hub with the live assistant |
| <http://localhost:5173/savanna/pages/homepage-v1-paced.html> | Savanna learner dashboard with the **Open Dimts** launcher |
| <http://localhost:5173/savanna/pages/concept-with-navigation.html> | Savanna concept page with the assistant |
| <http://localhost:5173/learn/> | Course library: the lessons Dimts answers from, in three languages; citations land here |
| <http://localhost:5173/sim/sms> | SMS simulator (enter `DIMTS_SMS_GATEWAY_SECRET`, any +251 test number) |
| <http://localhost:5173/helper> | Helper console for human help requests |
| <http://localhost:5173/v1/docs> | Integration guide: embed, REST, LTI, channels, content |
| Telegram | Message your bot (`DIMTS_TELEGRAM_TOKEN`), send `/start`, pick a language |

The Savanna pages in `pages/` and `assets/` are unmodified captures. nginx
adds one `<script async src="/dimts-host.js">` tag to each page as it serves
it, exactly as a real host would embed Dimts.

## Demo walkthrough

1. Open the Savanna dashboard and select **Open Dimts**. Choose a language;
   the picker starts in the browser's language.
2. Tap a starter question, or type one, for example:
   - English: *What score do I need to pass a course?*
   - Amharic: *ኮርስ ለማለፍ ምን ያህል ውጤት ያስፈልገኛል?*
   - Afaan Oromoo: *Jajjabeessi saffisaa maali?*
3. Open the citation chip. The lesson page opens at the highlighted section.
4. Tick **Allow remote AI for this session** and ask a paraphrase such as
   *If I only get 65 percent, will I earn the badge?* Gemini answers from the
   same cited passages. Without consent, answers come from offline extraction.
5. Ask something outside the course to see the honest not-found reply, or type
   *I need a person* to see the human-help offer.
6. Repeat a question in the SMS simulator or on Telegram.

Check the tutor end to end from the command line:

```powershell
node scripts/smoke-ask.mjs            # offline answers, all three languages
node scripts/smoke-ask.mjs --cloud    # with remote-AI consent
```

## Languages, AI and voice

- **Languages:** English is `beta`. Amharic and Afaan Oromoo packs and lesson
  translations are drafts awaiting native-speaker review.
  `DIMTS_PREVIEW_LANGS=am,om` shows them to learners while review-gated features
  (published FAQ answers, glossary cross-language retrieval, voice flags) stay
  off. See [DECISIONS.md](./DECISIONS.md).
- **AI:** offline extraction by default. Configure Gemini or any
  OpenAI-compatible provider in `DIMTS_AI_PROVIDERS` (example in
  `.env.example`). Remote providers run only after the learner consents.
- **Voice:** browser speech, so audio never leaves the device. Local
  development can use `DIMTS_VOICE_PREVIEW=true` with
  `DIMTS_STT_ENGINE=browser` and `DIMTS_TTS_ENGINE=browser`. Production
  requires the device review in [VOICE_TEST.md](./docs/VOICE_TEST.md); the
  preview flag is rejected there.

## Adding course content

Put one Markdown lesson per language in `content/savanna/<lang>/`, using the
same file name for the same lesson. Phrase `##` headings as learner questions
and keep sentences to 12 words or fewer. Restart the API container, or run
`pnpm content:ingest content/savanna --if-changed`. Lesson pages are rebuilt in
the web image by `scripts/build-lessons.mjs`.

## Operations and release readiness

To deploy the hosted stack (Render + Neon), follow [docs/DEPLOY.md](./docs/DEPLOY.md).

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


