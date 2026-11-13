# Add a Dimts language

Authority: Blueprint section 8 and SRS FR-LANG-01–05, 09–13, 15–17.
Use Node.js >=22.18 and the repository-pinned pnpm 10.12.1. Run commands
from the repository root. The English starter is beta and has unreviewed
content; copying it does not create a reviewed translation.

1. **Create a draft.** Run `pnpm lang:new ti` (replace `ti` with a canonical
   BCP 47 tag). The command copies all eight English YAML files, preserves
   keys, clears review and voice claims, sets `fallback: en`, and refuses
   existing folders or invalid tags. Creation is atomic; an invalid source
   pack is rejected. Run `pnpm lang:check`; the draft should pass immediately.
2. **Set metadata.** Edit native/English names, script, direction, calendar,
   SMS encoding/budget and fallback in `meta.yaml`. Keep `status: draft` and
   null review fields. A fallback must exist and must not form a cycle.
   The initial Oromo chain remains `om → am → en`. `ar-test` is CI-only.
3. **Translate all interface copy.** Edit `ui.yaml`, preserving key names and
   ICU variable names/types. Use polite register and one glossary term per
   concept. Include singular/plural `other` forms. Only `b`, `br`, `code`,
   `em`, `i`, and `strong` inline tags without attributes are allowed. Never
   insert executable code. Components render pack text safely. Stored Oromo
   uses straight apostrophes; search input may contain approved variants.
4. **Set dates and numbers.** Translate `month.1`–`month.13` and
   `gmonth.1`–`gmonth.12`, and preserve the variables in `date.ethiopic`,
   `date.gregorian`, and `date.dual`. Set `number.locale` and retain
   `number.numbering_system: latn`. Format UTC dates through
   `formatDate(date, pack.meta, pack.ui)` and numbers through `formatNumber`.
   Check month 13 and leap-day boundaries as well as 14 November 2026.
5. **Write rules and channel copy.** Complete `prompts.yaml`: supplied
   passages only, requested reply language, short sentences, no professional
   advice, and notfound when unsupported. Add at least five natural help
   phrases, greetings/thanks, and distress phrases reviewed with the
   co-designer. Keep emergency/support contacts out of packs: the host must
   supply verified values. Translate `sms.yaml` templates/keywords; retain
   English command equivalents and validate final SMS lengths separately
   when integrating P07. Never store learner text or identifiers in logs.
6. **Prepare sourced content.** Write glossary entries with `id`, `en`,
   `am`, `om`, `simple_definition`, and boolean `do_not_translate`; add a
   mapping for the new language where applicable. Live packs require 200
   distinct reviewed entries. Write 30 distinct, sourced FAQ entries with
   `q`, `a`, and `source` (the existing passage ID, not an invented URL).
   Validate the IDs against the authorized course index. Do not pad lists
   with repeated questions or fabricate course facts to satisfy counts.
7. **Prepare evaluation and optional input support.** In `checks.yaml`,
   supply at least ten questions: five in-course, two near misses, two
   off-topic and one job question; add help, distress and injection cases.
   Fields are `id`, `question`, `expect`, optional `expect_passages`, and
   `notes`; an expected answer needs at least one passage ID. Include search
   spelling variants while preserving source/display text. Optional
   transliteration data uses `transliteration.map.<latin>` syllables and
   `transliteration.word.<latin>` exceptions in `ui.yaml`. These capabilities
   are never inherited from fallback packs; learners explicitly enable,
   edit, and confirm suggestions before a separate Send action.
8. **Run automated checks and preview.** Run `pnpm lang:check`,
   `pnpm test:lang`, `pnpm typecheck`, `pnpm lint`, and `pnpm test:widget`.
   Restart the API to load the new folder and use `?lang_preview=1` to
   inspect drafts. Check fallback and the once-per-session notice, 320px
   layout, 200% text, RTL when applicable, keyboard order and axe findings.
   The draft scaffolding test must remain below five minutes.
9. **Obtain real review and device evidence.** A native speaker corrects
   all copy and glossary entries; a second reader reads the screens aloud.
   Back-translate the 20 most important strings. Review sensitive distress
   language with the co-designer. Follow `docs/VOICE_TEST.md` on the target
   Android device and with NVDA/TalkBack. Keep STT/TTS false and engine/tag
   null until real configuration and the ten-sentence test justify enabling
   them. Record actual reviewers, dates, evidence and unresolved issues.
10. **Promote only verified capabilities.** Set `reviewed_by`/`reviewed_on`
    to real review information; never an agent or placeholder sign-off.
    Amharic/Oromo beta requires native review. Live also requires glossary,
    FAQ and evaluation targets, device and co-designer evidence, and the
    applicable P02/P04 checks. Run all gates again, review the diff, and
    submit for team review. Passing the structural checker alone is not
    proof of translation quality or device accessibility.

`pnpm test:lang` enforces at least 70% statements, branches, functions and
lines in locale runtime, validation and scaffolding. CLI entry wrappers are
exercised separately. Coverage output is local under `coverage/locales/`.

Current P01 content is a review seed: English beta; Amharic/Oromo draft;
30 glossary terms and nine sourced FAQs each for `en`, `am` and `om`.
None is a live pack; `ar-test` is only a CI layout fixture.
See `docs/IMPLEMENTATION_PROGRESS.md` for current measured checks and blockers.
