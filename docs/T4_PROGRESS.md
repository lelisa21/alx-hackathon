# T4 Progress: Complete Insights Acceptance and Instructor Access

## Status: Implementation Complete, Testing Blocked by Environment

### Implementation Summary

**All T4 requirements are implemented per design decisions D31-D35:**

1. ✓ **Host Key Authorization** (D31)
   - GET /v1/insights requires X-Dimts-Key header
   - LTI instructor role support added in P10
   - Learner sessions rejected at 403

2. ✓ **Period Granularity** (D32)
   - Day-only granularity using DATE schema
   - No rolling windows (client-side aggregation supported)

3. ✓ **CSV Export** (D33)
   - Minimal stable columns: topic_id, topic_label, lang, period, helpful, unhelpful
   - RFC 4180 compliant
   - Formula injection defense (=, +, -, @ escaping)

4. ✓ **Privacy Boundary** (D35)
   - Joins only aggregate tables (feedback_counter, insight_aggregate)
   - No joins with session, message, or identifying tables
   - `topicLabel()` resolves passage metadata only
   - No session IDs or learner identifiers in aggregates

5. ✓ **Question/Not-found Recording**
   - New replies increment insight_aggregate in same transaction
   - Idempotent replays do not double-count
   - Both question_count and notfound_count tracked

6. ✓ **Locale Keys**
   - insights.* keys in en/am/om/ti ui.yaml
   - All UI copy from language packs (no hardcoded strings)
   - Status: en beta, others draft (pending native review)

7. ✓ **Instructor Page**
   - Delivered as insights-page.ts widget component
   - LTI launch with insightsAccess renders page
   - Response: no-store, private; Referrer-Policy: no-referrer
   - Respects existing CSP rules

### Code Files Implementing T4

- `packages/api/src/db/insights-repository.ts` - QueryInsights and topicLabel (fixed in T2)
- `packages/api/src/routes/insights.ts` - GET /v1/insights endpoint
- `packages/api/src/db/repository.ts` - saveReply aggregate recording
- `packages/widget/src/insights-page.ts` - Instructor UI component
- `packages/api/test/p09-insights.test.ts` - Unit tests (unit tests pass locally)
- `packages/api/test/insights-wiring.test.ts` - Aggregate wiring tests
- `packages/widget/e2e/p09-insights.spec.ts` - E2E tests (blocked by Playwright)
- `DECISIONS.md` - Design decisions D31-D35 documented

### Unit Test Coverage

**All local tests pass:**
- ✓ Host key authorization
- ✓ Invalid key rejection
- ✓ JSON response format
- ✓ LTI instructor access (bearer token validation)
- ✓ LTI learner rejection (no insights access)
- ✓ CSV export format
- ✓ Language filtering
- ✓ Date range filtering
- ✓ minCellSize privacy floor enforcement
- ✓ No session ID exposure
- ✓ No question text exposure
- ✓ Aggregate idempotency (no double-count on replay)

### T4 Acceptance Criteria Status

**Locally Verified:**
- [x] Aggregate structure correct (topic_id, lang, period, counts)
- [x] Privacy floor enforced (minCellSize >= 5)
- [x] Authorization validated (host key and LTI instructor)
- [x] Learner/public keys rejected
- [x] No private data in response
- [x] Idempotency logic correct

**Requires PostgreSQL Database:**
- [ ] Aggregate increments exactly once on initial reply (needs real DB transaction)
- [ ] Small-cell suppression at/under/over five (needs test data)
- [ ] Date/lang filters work correctly (needs actual data)
- [ ] CSV injection defenses verified (needs formatted output)

**Requires Hosted Environment:**
- [ ] LTI launch instructor flow
- [ ] Real LMS platform integration
- [ ] Session persistence and replay

**Requires Manual Accessibility Review:**
- [ ] Keyboard navigation (WCAG 2.4.3 Focus Order)
- [ ] NVDA/TalkBack announcement
- [ ] 200% zoom at 320px viewport
- [ ] Color contrast (WCAG AA 7:1)
- [ ] Loading/error state announcements

### Design Decisions Applied

| Decision | Status | Evidence |
|----------|--------|----------|
| D31 - Host key auth | ✓ Implemented | X-Dimts-Key header validated |
| D32 - Day granularity | ✓ Implemented | DATE columns in schema |
| D33 - CSV format | ✓ Implemented | RFC 4180, formula escaping |
| D34 - minCellSize floor | ✓ Implemented | Enforced at API boundary |
| D35 - Privacy join | ✓ Implemented | aggregate tables only |

### Known Limitations

**This environment lacks:**
- Real PostgreSQL database (for aggregate state verification)
- HTTP client for request/response testing
- Playwright browser automation (for e2e widget tests)
- Real LMS platform (for LTI flows)
- Accessibility devices (NVDA, TalkBack, screen readers)

**What Can Be Tested in CI:**
- Unit tests with mocks - ✓ passing
- OpenAPI contract validation - ✓ complete
- Code formatting/linting - ✓ passing
- TypeScript compilation - ✓ passing

**What Requires CI with Database:**
- PostgreSQL aggregate persistence tests
- Transaction idempotency verification
- Privacy floor validation with large datasets

**What Requires Hosted/Device Environment:**
- LTI instructor launch and access flow
- Real browser Playwright tests
- Accessibility criterion-level review (WCAG 2.2 AA)

### Next Steps for Complete T4

1. **PostgreSQL Integration (CI):**
   ```bash
   DIMTS_TEST_DATABASE_URL=postgres://... pnpm test p09-insights
   ```

2. **Playwright E2E (CI with browser):**
   ```bash
   pnpm test:widget p09-insights.spec.ts
   ```

3. **Accessibility Manual Review:**
   - Run on real NVDA + Windows
   - Test on real TalkBack + Android
   - Record evidence in WCAG_REPORT.md

4. **LTI Launch Flow:**
   - Deploy to real LMS
   - Verify instructor access
   - Confirm learner rejection

### Status Summary

**Local Verification:** ✓ Unit tests pass, contracts correct, privacy enforced  
**Database Verification:** ⊘ Requires PostgreSQL (blocked by Docker)  
**E2E Testing:** ⊘ Requires Playwright (blocked by test environment)  
**Accessibility Review:** ⊘ Requires manual device testing  
**Overall T4 Completeness:** ~60% (implementation verified locally, behavioral testing pending)
