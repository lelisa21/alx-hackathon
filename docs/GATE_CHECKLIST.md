# Release gate checklist

**Overall status: BLOCKED.** The automated suite is necessary but does not
replace a signed co-designer accessibility gate, native-language review,
deployment verification, or event rehearsal. Checkboxes are intentionally
not marked complete without evidence.

| Gate | Required result                                                         | Current status | Evidence or blocker                                                                |
| ---- | ----------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| G1   | Main task unaided with NVDA                                             | Blocked        | No NVDA/co-designer run recorded.                                                  |
| G2   | Main task with TalkBack on a real Android phone                         | Blocked        | No physical Android run recorded.                                                  |
| G3   | Main task keyboard-only                                                 | Partial        | Playwright controls are covered; no co-designer task run recorded.                 |
| G4   | 200% zoom and 320 px without clipping                                   | Partial        | 320 px browser matrix exists; full 200% task review is outstanding.                |
| G5   | Sound off with visible and screen-reader equivalents                    | Blocked        | No human sound-off task run recorded.                                              |
| G6   | Zero serious/critical axe findings on every screen, language, and theme | Partial        | Local `pnpm test:widget`: 137 passed, 2 skipped; attach CI results before release. |
| G7   | Messages announced once/in order; focus at reply start                  | Blocked        | Requires NVDA/TalkBack evidence.                                                   |
| G8   | Pseudo-RTL pack works                                                   | Partial        | `ar-test` Playwright fixture; it is not a real Arabic pack or human review.        |
| G9   | Keyboard language switch preserves conversation                         | Partial        | Browser regression exists; human task run outstanding.                             |
| G10  | Help reachable by touch, keyboard, and screen reader                    | Partial        | Browser coverage exists; screen-reader task run outstanding.                       |
| G11  | One-action stop on both sharing sides and picture fallback              | Partial        | Browser tests exist; real-device/peer evidence outstanding.                        |
| G12  | Helper console passes G3-G7                                             | Partial        | Automated checks exist; manual review outstanding.                                 |
| G13  | WCAG report current and criterion-level                                 | Blocked        | `WCAG_REPORT.md` explicitly records incomplete evidence.                           |

Additional P11 release blockers:

- Native-speaker review of Amharic/Afaan Oromoo strings and privacy-policy
  translations; no review metadata has been invented.
- Hosted Render/Neon setup, secrets, TLS/CSP/origin checks, provider policies,
  cron delivery, and actual free-tier use have not been verified.
- Warm 50-session non-AI p95 performance measurement and production database
  size have not been measured in this environment.
- Docker's Linux engine is unavailable in the current environment. Compose
  interpolation passes with `.env.example`, but a container/restart run was
  not performed here; the local `.env` also has a parse error at line 47.
- The former grounding branch-coverage failure is resolved on `dev`:
  `pnpm test:core -- --maxWorkers=1` passes 246 tests with 74.95% grounding
  branch coverage against the unchanged 70% floor.
- `pnpm eval` reports zero measured gate failures and eight acceptance
  blockers; Amharic/Afaan Oromoo answer recall is 0%, English answer recall
  is 16.7%, and provider-backed targets remain unverified. See `EVAL.md`.
- Dependency audit at the high-severity threshold passes, with one moderate
  advisory remaining. The secret scan is configured in CI; no CI result is
  available for this worktree.
- Human privacy/legal review and the integration owner's approval are not
  recorded.

See [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md),
[WCAG_REPORT.md](WCAG_REPORT.md), and [FREE_TIER.md](FREE_TIER.md).
