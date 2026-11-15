# Bridgely deep implementation and release analysis

Reviewed: 15 November 2026  
Authority: `Bridgely-System-Blueprint-v2.0.md`, then the SRS acceptance text.  
Evidence reviewed: `AGENTS.md`, `DECISIONS.md`, `IMPLEMENTATION_PROGRESS.md`,
`REMAINING_WORK_PLAN.md`, `GATE_CHECKLIST.md`, `WCAG_REPORT.md`, `EVAL.md`,
the repository worktree status, and the current package/work-package map.

## Executive assessment

The repository has substantial implementation breadth, but release readiness is
blocked by evidence and product quality, not by a single missing subsystem. The
highest user-impact gap is the grounded tutor's low measured answer recall:
English 2/12 (16.7%), Amharic 0/16, and Afaan Oromoo 0/18. Amharic and Afaan
Oromoo also lack reviewed source/evaluation material, so those results cannot
be repaired responsibly by tuning retrieval against invented translations.
The latest evaluation is explicitly offline and does not measure deployed
PostgreSQL or real model latency.

The current working tree contains extensive uncommitted changes across API,
widget, locales, tests, and documentation. Treat that state as active user work:
do not reset, stash, checkout another branch, or fold unrelated edits into a
fix. Several files changed in this tree are themselves the newest evidence and
must be reconciled before a release claim is made.

The best sequence is: establish a trustworthy baseline and align the status
documents; close the P09 database-backed acceptance for the newly delivered
insights path; obtain the language/content inputs needed for tutor evaluation;
then address tutor behavior and external/release gates in dependency order. Human
review, host credentials, a physical Android device, and a working Docker or
hosted environment are external prerequisites, not code tasks that can be
claimed complete locally.

## Current state by outcome

| Outcome | Evidence now | Assessment |
| --- | --- | --- |
| Architecture and contracts | Blueprint defines stable REST, ports, privacy boundaries, and package dependencies. | Strong foundation; preserve contracts and do not invent endpoints/fields. |
| Core tutor | Offline evaluation has 2/12 English expected answers, 0/16 Amharic, 0/18 Oromo. Citations and language metrics are n/a when no answer exists. | Release-blocking quality gap; more tuning without reviewed data will be misleading. |
| Insights (P09) | Latest progress documents page, aggregate event wiring, role checks, minimum cell size, focused tests and axe run. | Implementation advanced; PostgreSQL, LMS/hosted and human acceptance remain open. |
| LTI (P10) | Follow-up records RS256/JWKS validation, persistent replay protection, opaque session IDs, and instructor authorization. | Local evidence exists; real LMS launch is unverified. Deep link/grade passback/tool signing are not current launch requirements. |
| Accessibility | Browser automation is partial; G1/G2/G5/G7/G13 remain blocked and other gates partial. | Cannot pass from axe or Playwright alone; needs co-designer and device evidence. |
| Language and content | en is beta; am/om are draft. Sample source data is English-only and checked-in multilingual FAQ sets are explicitly unreviewed. | Human review and representative authorized source material are prerequisites. |
| Channels/integrations | Local contracts/simulators and protocol tests exist. Telegram, human help, jobs relays and LMS are not verified against live configured systems. | Keep production claims bounded to actual deployments and credentials. |
| Operations | Full tests/typecheck/lint/eval are reported passing in prior snapshots; Compose and hosted checks are environment-limited. | Revalidate after current worktree changes; no current-turn test run was performed. |

## Findings and risks

### 1. Tutor usefulness is the primary product risk

**Requirements:** FR-TUTOR-01–18, FR-CONV-05–09/13/14, FR-AI-02–10,
FR-LANG-01–17, AR-01/06/08, and applicable NFR-PERF requirements.

The most important measurement is answer recall, not the green aggregate gate
summary. `EVAL.md` says 0 measured gate failures while also listing eight
acceptance blockers. The blockers correctly prevent that measurement from being
read as product acceptance. Amharic and Oromo retrieval against English course
material is 0%; the answer-language and citation rates are n/a because there
are no answers. English recall is 16.7%. The offline FAQ adapter's 100% values
are separately measured at its adapter boundary using unreviewed draft sets;
they do not demonstrate engine retrieval or end-to-end tutor quality.

**Failure mode:** tuning ranking, thresholds, or language checks against
unreviewed or synthetic content can improve a fixture score while making actual
learner answers less reliable. Promoting draft locales or enabling a remote
provider would also overstate acceptance.

**Required order:** obtain qualified review and authorized representative
course/job material; freeze a reviewed per-language question set; run the full
retrieval-to-answer evaluation; then adjust one identified failure class at a
time while preserving citation, not-found, injection, cache and language
regressions. Do not enable an unsupported language/provider profile based on
offline timing or adapter-only results.

### 2. P09 needs database-backed acceptance after the current changes

**Requirements:** FR-CONV-12, FR-INSIGHT-01–04, NFR-PRIV-03, NFR-A11Y-01,
FR-INT-05/06.

The newest progress entry and current remaining-work prose indicate that the
instructor page, aggregate event wiring, host/LTI authorization, minimum-five
suppression floor, export, and focused browser/API tests are now implemented.
The same remaining-work document's P09 implementation table still says the
page and aggregate event wiring are open. This is a status contradiction, not
a reason to redo the feature.

The consequential remaining technical check is the database path: transaction
and idempotency behavior, aggregate persistence, host-key lookup, migration
compatibility, and CSV/JSON authorization with PostgreSQL. Fixture-backed tests
do not fully exercise PostgreSQL semantics. Then verify the instructor flow in
a real LMS and hosted deployment. Keep aggregation strictly anonymous; the
minimum cell-size floor must remain five even if a caller asks for a smaller
threshold.

### 3. P10 evidence is split across newer and historical sections

**Requirements:** FR-INT-05/06/07/10, FR-INSIGHT instructor authorization,
NFR-PRIV-03.

The 14 November follow-up documents real RS256 validation against mocked JWKS,
static platform wiring, persistent replay checks and bearer-hash based
instructor access. A later historical P10 paragraph still says browser OIDC,
platform validation, and related behavior are unimplemented. The newer evidence
should govern, but the stale paragraph can mislead implementation and release
planning. Real LMS verification remains open. Keep optional tool-originated
signing, deep-link responses, and grade passback out of scope unless product
scope and contract change.

### 4. Human and device gates are release work, not unit-test work

**Requirements:** NFR-A11Y-01–07, NFR-A11Y-07 language/device obligations,
and G1–G13.

G1 NVDA, G2 TalkBack on physical Android, G5 sound-off equivalence, G7
announcement/focus order, and G13 criterion-level WCAG evidence are blocked.
G3/G4/G6/G8–G12 are partial. Widget automation and axe checks cover useful
regressions, but they cannot establish unaided task success, actual assistive
technology behavior, screen-share stop behavior across real peers, or every
applicable WCAG criterion. Record tester, device/AT, date, observed result and
follow-up in the evidence documents; leave gates blocked until then.

### 5. External-service evidence is conditional on real operator inputs

P05/P06/P08/P10 need host credentials, configured endpoints, or platform access
for their production acceptance. Do not create guessed support contacts,
credentials, or vendor-specific contract fields. SMS's real carrier connection
is explicitly outside this release scope; the simulator and documented gateway
port are the acceptance target. Voice capability remains unavailable until
language review, an adapter, device tests, and its data policy are all in place.

### 6. Environment and verification evidence is stale relative to the worktree

The plan reports a local `.env` parse error at line 47 and no Docker Linux engine
in the last verification environment. Do not print or copy `.env` values while
diagnosing it. Use `.env.example` for safe Compose interpolation checks, and
run PostgreSQL/Compose checks only when the relevant service is available. The
current tree has many code and test changes after the previously recorded 836
test snapshot; that snapshot is historical until relevant checks are rerun.
`pnpm format:check` has a documented 307-file baseline issue, so format changed
files selectively rather than rewriting unrelated files.

## Documentation and process defects

1. `REMAINING_WORK_PLAN.md` has inconsistent P09 status: its delivered-work
   table is stale while workflow 3 describes the newly delivered page and
   aggregate wiring.
2. `IMPLEMENTATION_PROGRESS.md` contains historical P10 claims contradicted by
   the newer P10 follow-up. Retain history but label/supersede it explicitly so
   readers can tell which behavior is current.
3. Blueprint IDs are WP00–WP15; the repository's implementation history calls
   increments P01–P11. These labels are not interchangeable. Use the SRS
   requirement IDs and named dependency links when planning fixes; do not infer
   that P09 means Blueprint WP09.
4. Current evidence files combine implementation status, measured acceptance,
   and external release blockers. Keep those three states distinct in future
   updates: implemented, locally verified, and accepted/release-ready.

## Ordered fix plan

Work one package at a time, quote its requirement IDs before implementation,
write regression tests first, then record verified acceptance criteria. The
order below respects dependencies and avoids implying that unavailable human
inputs can be replaced with code.

### Step 0 — protect and reconcile the active baseline

Review the existing diff as user work; do not reset/stash it. Identify which
changes are intentionally part of the current P09/P10 follow-up. Reconcile the
P09 table and supersede stale P10 status text. This prevents the next fix from
being based on contradictory state. Documentation-only reconciliation does
not change contracts.

### Step 1 — close P09 PostgreSQL acceptance

**Requirements:** FR-INSIGHT-01–04, FR-CONV-12, NFR-PRIV-03, FR-INT-05/06.
Use the configured test PostgreSQL database if available. Add/fix only
test-first database regressions for migration and aggregate write/replay,
privacy suppression, both supported authorization paths, and export behavior.
Then verify the insights page through the API against persisted aggregates.
Exit only with relevant DB tests passing and documented limitations for real LMS
and human review.

This is the first contained engineering task because the corresponding code is
already present in the active diff and its remaining acceptance is specific.
It does not depend on inventing translations or provider credentials.

### Step 2 — satisfy P01 language and content prerequisites

**Requirements:** FR-LANG-01–17, FR-TUTOR-08/10, FR-CONV-05/07,
NFR-A11Y-07, AR-06/07. Arrange real review of packs, privacy/help/distress
copy, and language-specific capability data. Add authorized representative
course/job passages and reviewed evaluation questions. Record provenance and
review metadata truthfully. This step may proceed operationally while Step 1
is implemented, but P02 acceptance depending on it must wait.

### Step 3 — improve and accept the core tutor (P02)

**Requirements:** FR-CONV-05–09/13/14, FR-TUTOR-07–11/14,
FR-AI-02–10, AR-01/06/08, NFR-PRIV-03, NFR-PERF-03. Use the reviewed test
set to classify misses (source coverage, retrieval, confidence/not-found,
language validation, provider output). Pick the highest-volume failure class,
write a failing regression, implement a bounded correction, rerun per-language
recall/citation/language/Simple metrics, and check privacy and latency. Do not
mix multiple failure classes into a single tuning pass.

### Step 4 — verify other externally dependent packages

P05/P06/P08/P10: run real configured help, job, Telegram and LMS flows only
with host authorization and supplied credentials. Record test environment and
scope. Preserve simulator-only SMS acceptance. Keep production claims limited
to the services actually exercised.

### Step 5 — close human accessibility and operations gates

**Requirements:** NFR-A11Y-01–07, NFR-SEC-01–12, NFR-REL-01–03,
NFR-COST-03–06, NFR-OPS-01/02, and G1–G13. Complete co-designer/NVDA/
TalkBack and language reviews; then run hosted configuration, retention,
scheduled jobs, performance, database sizing, audit/secret scan, clean Compose
restart, and rehearsal evidence. Update `GATE_CHECKLIST.md` only from measured
results. Overall release status stays blocked until all mandatory gates pass.

## Decision for the next work session

Start with Step 1, P09 PostgreSQL acceptance, after the active diff is reviewed
and its test database availability is established. Do not start by tuning the
tutor against the current unreviewed multilingual fixtures. If the database is
unavailable, the next useful work is Step 0 reconciliation and P09 test design;
mark database acceptance pending rather than claiming a pass.

## Acceptance boundary

This document is an analysis and work order. It does not claim release
acceptance, change the Blueprint/SRS contracts, or replace the evidence in the
individual package records. Every implementation step still needs requirement
IDs, test-first regressions for MUST criteria, relevant verification, and an
updated verified-acceptance record.
