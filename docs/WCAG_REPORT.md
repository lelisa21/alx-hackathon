# WCAG 2.2 AA evidence report

**Status:** incomplete; this report does not claim WCAG 2.2 AA conformance or
pass the release gate. Automated browser checks cannot replace assistive
technology or co-designer testing.

## Automated coverage

`pnpm a11y` runs the widget Playwright suite. The P03 accessibility matrix
covers English, Amharic, Afaan Oromoo, and the CI-only pseudo-RTL fixture;
light and high-contrast themes; 320 px and desktop widths; and the audited
welcome, chat, settings, help, FAQ, and helper screens. It checks serious and
critical axe violations, visible control target size, language/direction
metadata, and horizontal overflow. The pseudo-RTL fixture is not a production
Arabic translation.

| Check                                                                      | Result                                                                           | Evidence                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Critical/serious axe violations on automated widget screens                | Run in CI; attach the matching `pnpm a11y` job output before release.            | `.github/workflows/ci.yml`; `packages/widget/e2e/p03-a11y.spec.ts` |
| Contrast theme, narrow viewport, target size, language/direction, overflow | Run in the same Playwright matrix; does not establish all WCAG success criteria. | `packages/widget/e2e/p03-a11y.spec.ts`                             |
| Keyboard, screen-reader announcement/focus, zoom, help and helper flows    | Partially covered by browser automation; human task evidence is still required.  | `packages/widget/e2e/`; `docs/COCREATION_LOG.md`                   |

## Manual evidence still required

| Requirement                        | Result                  | Required evidence                                                        |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| G1 / NVDA main task                | Not performed           | Co-designer completes the full task unaided with NVDA.                   |
| G2 / TalkBack                      | Not performed           | Co-designer completes the full task on a real Android phone.             |
| G3 / keyboard-only main task       | Not performed           | Co-designer completes the full task without assistance.                  |
| G4 / 200% zoom and 320 px          | Partial automation only | Human review across the task; no clipping or overlap.                    |
| G5 / sound off                     | Not performed           | Human verifies visible and screen-reader equivalents.                    |
| G7 / announcement and focus order  | Not performed           | NVDA/TalkBack transcript and observed focus evidence.                    |
| G10 / help access                  | Partial automation only | Human verifies touch, keyboard, and screen-reader reachability.          |
| G11 / stop sharing and fallback    | Browser regression only | Real device test of stop on both sides and picture fallback.             |
| G12 / helper console               | Partial automation only | Human keyboard and assistive-technology review.                          |
| Criterion-by-criterion WCAG report | Incomplete              | Add a result, evidence, tester, and date for every applicable criterion. |

Do not mark this report complete until the required human and criterion-level
evidence has been recorded. See [GATE_CHECKLIST.md](GATE_CHECKLIST.md).
