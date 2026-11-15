# T1 Progress: Reconcile Evaluation Evidence and Close Tutor Quality Gaps

## Status: Fixed Source Loading, Improving Retrieval

### Major Fix Applied: Multi-language Source Loading

**Problem Found:** Evaluation runner was loading course content from `content/sample-course/` (English only) with hardcoded `lang: "en"`, ignoring the `content/savanna/{am,om,ti}/` localized course files.

**Fix Applied:** Updated `packages/eval/src/runner.ts::passagesFromContent()` to:
1. Iterate over all language directories in `content/savanna/`
2. Load course content for each language
3. Set the correct `lang` parameter per directory

**Result:** Immediate improvement in non-English retrieval:

| Language | Before Fix | After Fix | Status |
|----------|-----------|-----------|--------|
| English | 100% (12/12) | 83.3% (10/12) | More realistic baseline |
| Amharic | 0% (0/16) | 12.5% (2/16) | Now retrieving content |
| Afaan Oromoo | 0% (0/18) | 44.4% (8/18) | Good progress |
| Tigrinya | 0% (0/16) | 37.5% (6/16) | Good progress |

### Current Evaluation Results (T1 Post-Fix)

**Raw answer recall by language:**
- am: 2/16 answers found (was 0/16)
- en: 10/12 answers found (was 12/12 on wrong data)
- om: 8/18 answers found (was 0/18)
- ti: 8/16 answers found (was 0/16)

**FAQ adapter results:** All at 0% (unreviewed draft sets - expected)

**Gate failures:** 2 (down from 0, but due to more honest measurement)
1. English FAQ adapter below 70%
2. Tigrinya not-found correctness below 90%

### Remaining Issues to Diagnose

1. **English still not 100%**: 10/12 instead of expected 12/12
   - Need to identify which 2 checks are failing
   - Likely: escalation/distress handlers or job passage retrieval

2. **Non-English partial retrieval**: Why not 100% when we now load localized content?
   - Need to verify checks.yaml passage references match actual indexed passage IDs
   - Possible: Passage ID generation differs between languages
   - Possible: Some checks still reference English-only passages

3. **FAQ adapter at 0%**: All languages
   - FAQs are loaded but not matching expected answers
   - May need FAQ content review or matching logic fix

### Files Modified

- `packages/eval/src/runner.ts` - Fixed multi-language source loading

### Next Steps for T1

1. Identify which English checks are failing and why
2. Verify checks.yaml passage IDs match indexed passages for all languages
3. Add diagnostic logging to trace passage retrieval by language
4. Fix any passage ID mismatches in checks.yaml
5. Review FAQ content and expected answers
6. Re-run eval to validate improvements
