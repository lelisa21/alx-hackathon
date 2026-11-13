# P09 Investigation: Anonymous Feedback and Teacher Insights

**Status:** Investigation Complete  
**Date:** 13 November 2026  
**Authority:** Dimts-System-Blueprint-v2.0.md, REMAINING_WORK_PLAN.md P09 section

---

## 1. Requirement Quotes

### From P09 prompt (REMAINING_WORK_PLAN.md):

> Deliver privacy-preserving feedback collection and the complete instructor insights feature (domain aggregation, API, access control, accessible page, and CSV). Requirements: **FR-CONV-12, FR-INSIGHT-01–04, FR-UI-20, and NFR-PRIV-03**.

### Key Requirements by ID

**FR-CONV-12 (Feedback message controls - SRS):**

- One-tap helpful/not-helpful feedback
- Feedback controls on replies in the learner UI
- Copy, Helpful/Not helpful, and Read aloud controls on replies
- Shortcuts: Alt+Shift+M/H/L

**FR-INSIGHT-01 through FR-INSIGHT-04 (Teacher insights - SRS):**

- FR-INSIGHT-01: Aggregation of anonymized feedback data
- FR-INSIGHT-02: Access control (teacher/instructor access only)
- FR-INSIGHT-03: CSV export with privacy guarantees
- FR-INSIGHT-04: Teacher-facing insights page with semantic tables

**FR-UI-20 (Teacher page - SRS):**

- Text summary before any chart
- Semantic table headers
- Loading/empty/error states
- Filters for period and language
- CSV download
- No charts as the only representation
- Accessible design (keyboard/focus, logical properties)

**NFR-PRIV-03 (Privacy in aggregation - Blueprint):**

- Small groups below five combined into "Other"
- No question text, session IDs, or learner identifiers in counters/exports
- Strict data minimization in aggregates

---

## 2. Current State Analysis

### 2.1 Existing Feedback Infrastructure (from P02)

**Already Implemented:**

- `POST /v1/feedback` route in `packages/api/src/routes/core.ts` (lines 80-98)
- `FeedbackRequestSchema` and `FeedbackResponseSchema` in schemas.ts (lines 111-119)
- `ConversationStateStore` interface with `recordFeedback()` method
- PostgreSQL implementation in `packages/api/src/db/conversation-state.ts`
- Anonymous `feedback_counter` table (001_init.sql, line 142):
  ```sql
  CREATE TABLE feedback_counter (
    topic_id TEXT NOT NULL,
    lang TEXT NOT NULL,
    period DATE NOT NULL,
    helpful INTEGER NOT NULL DEFAULT 0,
    unhelpful INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (topic_id, lang, period)
  );
  ```
- Anonymous `insight_aggregate` table (001_init.sql, line 152):
  ```sql
  CREATE TABLE insight_aggregate (
    topic_id TEXT NOT NULL,
    lang TEXT NOT NULL,
    period DATE NOT NULL,
    question_count INTEGER NOT NULL DEFAULT 0,
    notfound_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (topic_id, lang, period)
  );
  ```

**Existing P02 Flow:**

1. Learner sends `POST /v1/feedback {replyId, helpful}` with Bearer token
2. API validates session ownership via token hash (sha256)
3. Resolves topic_id from reply's first citation (passageId) or "uncategorized"
4. Updates `feedback_counter` for (topic_id, lang, period) with helpful/unhelpful count
5. Updates `session.negative_feedback_streak` (for FR-CONV-06 two-negative rule)
6. No event history or session ID stored in aggregates

**UI Locale Keys Existing (all languages en/am/om):**

- `answer.copy`: "Copy"
- `answer.copied`: "Answer copied."
- `answer.copyFailed`: "Could not copy this answer."
- `answer.helpful`: "Helpful"
- `answer.notHelpful`: "Not helpful"
- `answer.feedbackSaved`: "Thank you for your feedback."
- `answer.feedbackFailed`: "Feedback could not be saved. Try again."

**Widget Implementation Status (P03):**

- Reply-level Copy, Helpful/Not helpful controls implemented
- Shortcuts Alt+Shift+M/H/L supported
- Message focus/live-region behavior preserved
- One-tap feedback sends only `{replyId, helpful}` (no text/session ID)

### 2.2 Gaps and Missing Components for P09

**Not yet implemented:**

1. **Insights package (`packages/insights`)** - currently empty (only stub index.ts)
2. **Aggregation domain logic** - no service for aggregating feedback + question counts
3. **GET /v1/insights route** - not wired
4. **Insights schema** - no Zod/OpenAPI contract for the response
5. **Teacher page UI** - not implemented in packages/widget
6. **CSV export** - no generation logic
7. **Access control** - no LTI instructor or host secret-key authorization
8. **insight_aggregate population** - question_count and notfound_count not being recorded
9. **Migration** - no new migration for P09-specific changes

### 2.3 Existing Citation/Topic Structure (P02)

**Reply Citations (in message.citations JSONB):**

```typescript
interface Citation {
  passageId: string; // lesson/topic ID, e.g. "unit-2-lesson-5"
  label: string; // display text e.g. "Unit 2: Reading Strategies"
  url: string; // source URL
  sourceLang: string; // language of the source
  sourceType: "course" | "job";
  timestamp?: number; // optional
}
```

**Topic Resolution (from conversation-state.ts line 35):**

- `topic_id` extracted from `citations[0].passageId` or defaults to "uncategorized"
- Stored in `feedback_counter` and `insight_aggregate`

### 2.4 Existing Negative Feedback Signal Storage (P02)

**In `session` table:**

- `negative_feedback_streak` INTEGER column (005_conversation_signals.sql)
- Bounded to 2 (max), resettable, resets on positive feedback or escalation
- **Lifetime:** Within session only; not persisted across sessions
- **Privacy:** Session-local, never in aggregates

---

## 3. Architecture Decisions Needed

### 3.1 Questions for User Input (Blocking Implementation)

**Q1: LTI Instructor vs. Host Secret Access?**

- Should `GET /v1/insights` require:
  - (A) LTI-validated instructor role (P10 responsibility), OR
  - (B) Host secret key (same as POST /jobs/import), OR
  - (C) Both paths?
- **Recommended:** Both paths; P10 provides LTI, P09 provides host key. Record decision in DECISIONS.md.

**Q2: Insights Period Granularity?**

- Should aggregates be by:
  - (A) Day (current `insight_aggregate` and `feedback_counter` schema with DATE), OR
  - (B) Day and rolling 7/30 day windows?
- **Recommended:** Day only (matches existing schema); user can aggregate dates client-side.

**Q3: CSV Column Order and Naming?**

- Required columns: topic_id, topic_label (optional), lang, period, question_count, notfound_count, helpful, unhelpful
- Additional columns (e.g., help_rate = helpful/(helpful+unhelpful))?
- **Recommended:** Minimal stable set; computed fields in docs.

### 3.2 Privacy Boundary Confirmed

✓ **No raw learner data in insights:**

- No question text
- No session IDs
- No identifiable information
- Small groups (<5) combined into "Other"

✓ **Storage Strategy:**

- Use existing `feedback_counter` (already contains helpful/unhelpful)
- Populate existing `insight_aggregate` (currently unused; needs question/notfound counts recorded)
- No new sensitive table needed

---

## 4. Implementation Structure

### 4.1 packages/insights Module (New)

**Purpose:** Domain logic for aggregating and filtering feedback/question data

**Exports:**

```typescript
// packages/insights/src/index.ts
export interface InsightQuery {
  startDate?: string; // ISO 8601 date YYYY-MM-DD
  endDate?: string;
  lang?: string; // BCP 47 code or null for all
  minCellSize?: number; // default 5; groups <5 become "Other"
}

export interface InsightRow {
  topicId: string;
  topicLabel: string | null; // label from passage if available, else null
  lang: string;
  period: string; // ISO 8601 date
  questionCount: number;
  notfoundCount: number;
  helpfulCount: number;
  unhelpfulCount: number;
}

export interface InsightsService {
  getRows(query: InsightQuery): Promise<InsightRow[]>;
  toCsv(rows: InsightRow[]): string; // RFC 4180 with formula-injection defense
}

export function createInsightsService(
  repository: InsightsRepository,
): InsightsService;
```

**Database Interface (InsightsRepository):**

```typescript
export interface InsightsRepository {
  queryInsights(query: InsightQuery): Promise<RawInsightRow[]>;
  topicLabel(topicId: string): Promise<string | null>;
}
```

**Implementation notes:**

- Join `feedback_counter` and `insight_aggregate` on (topic_id, lang, period)
- Apply small-cell suppression in memory (group rows with count<5 into "Other")
- CSV: escape fields, quote formula-starting cells (=, +, -, @)

### 4.2 API Additions (`packages/api/src/routes/insights.ts` - NEW)

**Route:** `GET /v1/insights`

**Authentication:**

- Bearer token (session) → should NOT have access (learner, not teacher)
- X-Dimts-Key (host secret) → admin/host access
- LTI instructor claim (P10 adds; for now, return 501 Not Implemented)

**Query Parameters:**

```typescript
const InsightsQuerySchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  lang: z.string().min(2).max(8).optional(),
  minCellSize: z.number().int().min(1).max(100).default(5),
  format: z.enum(["json", "csv"]).default("json"),
});
```

**Response (JSON):**

```typescript
export const InsightsResponseSchema = z.object({
  insights: z.array(InsightRowSchema),
  period: z.object({ start: z.string(), end: z.string() }),
  exportedAt: z.string().datetime(),
});
```

**Response (CSV):**

- Content-Type: `text/csv; charset=utf-8`
- Headers: `topic_id,topic_label,lang,period,question_count,notfound_count,helpful,unhelpful`
- Header: `Content-Disposition: attachment; filename="dimts-insights-{date}.csv"`

### 4.3 Schema and Migration

**New Zod schemas** in `packages/api/src/schemas.ts`:

- `InsightRowSchema`
- `InsightsQuerySchema`
- `InsightsResponseSchema`

**No new migration needed** — existing `feedback_counter` and `insight_aggregate` tables are sufficient. The gap is in recording question_count/notfound_count data (see 4.4).

### 4.4 Recording Aggregates (Recording Logic)

**In `packages/api/src/db/conversation-state.ts`:**

- Enhance `recordFeedback()` to already record question_count on first save (already does)
- Add `recordReplyKind(sessionId, clientMsgId, replyId, kind)` to increment `insight_aggregate.{question_count|notfound_count}`
  - Called after every `saveReply()` when kind is 'notfound'
  - Extract topic from reply citations[0].passageId (same as feedback)

**In `packages/api/src/routes/core.ts` (ask route):**

- After successful `await conversation(body)` (line 381), call `await repository.recordReplyKind(...)` with the reply kind

### 4.5 Teacher Page UI (`packages/widget/src/` - NEW)

**Location:** Separate export; lazy-loaded (like help-runtime.ts, career-runtime.ts)

**Files:**

- `insights-runtime.ts` — bootstrap and credential injection
- `insights-page.ts` (or `.tsx` if using Lit) — the UI component

**Features:**

- Semantic HTML table with caption, thead/tbody, scope="col"
- Text summary before table (e.g., "Across 3 languages and 15 lessons, 1,247 questions, 156 not found")
- Filters: startDate, endDate, lang (dropdown), minCellSize (numeric)
- Loading state (aria-busy) during fetch
- Error state with retry button
- CSV download button
- Keyboard navigation; focus trap in dialog if modal
- Responsive (320px, 200% zoom)
- CSS logical properties (no left/right)

**Authorization:**

- If opened via LTI (P10): instructor claim required
- If opened via host script: query param or header with host key

**Not a chart:** Use table as the only data view (per FR-UI-20)

### 4.6 OpenAPI and Zod Updates

**In openapi.ts:**

- Add `InsightsResponse` and `InsightsQuery` schemas
- Add `/v1/insights` endpoint docs with:
  - Query parameters (startDate, endDate, lang, format)
  - Responses: 200 (JSON/CSV), 401, 403, 429
  - Note: "Host secret key (X-Dimts-Key) required; LTI instructor access in P10"

---

## 5. Test Strategy (Test-First)

### 5.1 Unit Tests (`packages/insights/test/`)

- **Aggregation logic:** Join, filter, small-cell suppression, sorting
- **CSV generation:** Correct escaping, formula injection defense, CRLF line endings
- **Empty data:** Query returns no rows
- **Query validation:** Invalid dates, negative minCellSize, unknown language

### 5.2 API Route Tests (`packages/api/test/`)

- **Authentication:** 401 without X-Dimts-Key or valid LTI, 403 if key is invalid
- **Query validation:** Zod rejects invalid startDate, malformed lang, etc.
- **Small-cell suppression:** Groups with count<5 combined into single "Other" row
- **No raw data:** Verify no session IDs, question text, or identifiers in response
- **CSV format:** Correct headers, RFC 4180 compliance, formula injection chars escaped
- **Range queries:** startDate/endDate filters applied correctly
- **Language filter:** lang parameter narrows results
- **Access control:** Session bearer token gets 403 (not 401; learners exist)

### 5.3 Browser Tests (`packages/widget/e2e/`)

- **Table rendering:** Semantic headers, captions, no raw data visible
- **Accessibility:** axe checks (form labels, heading hierarchy, color contrast)
- **Keyboard:** Tab order, Enter to apply filters, Escape to close modal
- **Responsive:** Renders at 320px, 200% text zoom
- **Empty state:** "No data available" message shown
- **Error recovery:** Retry button appears on 500
- **CSV download:** Triggers download with correct filename

### 5.4 Integration Tests (`packages/api/test/p09-postgres.integration.test.ts`)

- Real PostgreSQL instance
- Feedback recorded → appears in insight_aggregate
- Question count incremented when reply kind recorded
- Notfound count incremented for notfound replies
- Small-cell suppression groups <5 into "Other"
- CSV export from aggregated data

---

## 6. Existing Tests Regression

**No changes to existing tests required** — P09 adds new routes and tables but does not modify:

- Existing feedback recording (P02 tests pass unchanged)
- Widget message controls (P03 tests pass unchanged)
- Negative feedback streak logic (P02 tests pass unchanged)

---

## 7. Locale Requirements (P01 Completed)

**Required UI keys (must exist before P09 implementation):**

- `insights.title` — "Learning Insights" or similar
- `insights.summary` — template for summary line
- `insights.table.topic` — "Topic" column header
- `insights.table.questions` — "Questions Asked" header
- `insights.table.notfound` — "Not Found" header
- `insights.table.helpful` — "Helpful" header
- `insights.table.unhelpful` — "Not Helpful" header
- `insights.table.period` — "Date" header
- `insights.table.language` — "Language" header
- `insights.filter.startDate`, `.endDate`, `.lang`, `.minCellSize` — filter labels
- `insights.csv.download` — button label
- `insights.empty` — "No data available"
- `insights.error.title` — "Could not load insights"
- `insights.loading` — "Loading..." (announced)

**Status:** All keys must be added to locale packs en/am/om `ui.yaml` by P01 or early P09.

---

## 8. Dependencies and Blockers

### 8.1 Hard Dependencies

- ✓ P02 complete: feedback route, conversation-state.ts, recordFeedback()
- ✓ P03 complete: widget reply controls, message focus
- Packs (P01): All feedback/insights locale keys must exist

### 8.2 Soft Dependencies (Can Work in Parallel)

- P10 (LTI): P09 implements host key path; LTI added later

### 8.3 Known Blockers

- **No LTI credentials available** → `GET /v1/insights` supports host key only; P10 adds LTI
- **CSV generation untested on real data** → Devise test cases before implementation
- **Teacher co-designer review** → Awaiting feedback on page layout, terminology

---

## 9. Existing Code Patterns to Follow

### 9.1 Repository Pattern

- Existing: `ApiRepository` interface in src/types.ts
- Extend with: `queryInsights(query)`, `recordReplyKind(sessionId, replyId, kind)`
- PostgreSQL adapter in `packages/api/src/db/insights-repository.ts`

### 9.2 Route Pattern

- Existing: `createCoreRouter()` in src/routes/core.ts (lines 79–98 feedback route)
- Match error handling: `sendProblem(response, status, code, messageKey)`
- Use `FeedbackRequestSchema` → adapt to `InsightsQuerySchema`

### 9.3 Schema Pattern

- Existing: Zod schemas in src/schemas.ts with `.strict()` and `.superRefine()`
- CSVSchema not needed; generate directly from rows

### 9.4 Widget Pattern

- Existing: `help-runtime.ts`, `career-runtime.ts` for lazy-loaded pages
- Match with: `insights-runtime.ts`, mount to a named div or LTI target

---

## 10. Verification Commands

**Build & Type:**

```bash
pnpm build
pnpm typecheck
pnpm lint
```

**Tests:**

```bash
pnpm exec vitest run packages/insights tests/p09-insights.test.ts --maxWorkers=1
pnpm exec vitest run packages/api/test/p09-*.test.ts --maxWorkers=1
pnpm test:widget --grep "P09|insights" --workers=1
```

**Locale validation:**

```bash
pnpm lang:check
```

**Bundle size:**

```bash
pnpm size
```

---

## 11. Summary of Gaps (Decisions Needed from User)

| Decision               | Options                         | Recommended | Impact                          |
| ---------------------- | ------------------------------- | ----------- | ------------------------------- |
| Q1: Insights auth      | LTI only, Host key only, Both   | Both        | Route design, P09 vs P10 scope  |
| Q2: Period granularity | Day only, Day + rolling windows | Day only    | Query complexity, export fields |
| Q3: CSV columns        | Minimal set, Include help_rate  | Minimal     | User can compute in spreadsheet |

---

## 12. Files Modified / Created

### Create:

- `packages/insights/src/index.ts` — InsightsService interface and factory
- `packages/insights/src/service.ts` — InsightsService implementation
- `packages/insights/src/repository.ts` — InsightsRepository interface
- `packages/insights/test/service.test.ts` — unit tests
- `packages/api/src/routes/insights.ts` — GET /v1/insights route
- `packages/api/src/db/insights-repository.ts` — PostgreSQL adapter
- `packages/api/test/p09-insights.test.ts` — route and integration tests
- `packages/api/test/p09-postgres.integration.test.ts` — end-to-end
- `packages/widget/src/insights-runtime.ts` — bootstrap
- `packages/widget/src/insights-page.ts` — UI component
- `packages/widget/e2e/p09-insights.spec.ts` — browser tests

### Modify:

- `packages/api/src/schemas.ts` — Add InsightsQuerySchema, InsightsResponseSchema
- `packages/api/src/openapi.ts` — Document GET /v1/insights
- `packages/api/src/routes/core.ts` — Add recordReplyKind() call in ask route
- `packages/api/src/types.ts` — Add InsightsRepository interface to ApiRepository
- `packages/api/src/app.ts` — Mount insights router
- `packages/widget/src/index.ts` — Export insights-runtime (lazy)
- `locales/*/ui.yaml` — Add insights.* locale keys
- `docs/API.md` — Document insights endpoint

### No migration needed (existing tables sufficient)

---

## 13. Decisions to Record in DECISIONS.md

- D31: Insights access control (host key path; LTI in P10)
- D32: Period granularity (day only, no rolling windows in P09)
- D33: CSV column set and formula-injection defense method
- D34: Small-cell suppression threshold (default 5 rows, min 1)
- D35: Topic label source (passage label or null if not found)
