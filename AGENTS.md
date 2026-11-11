# Contributor and agent instructions

## Authority

- `Dimts-System-Blueprint-v2.0.md` is authoritative where it supersedes the
  earlier SRS.
- Use the contracts in the blueprint; do not invent endpoint names, fields, or
  file formats.
- Work on one SRS work package at a time and respect its dependencies.

## Implementation rules

- Quote the requirement IDs before implementation; record verified acceptance
  criteria afterward.
- Write tests before implementation. Every MUST requirement needs automated
  coverage.
- Keep all user-facing copy in locale packs. Do not add literal UI strings.
- Use CSS logical properties rather than physical-direction properties.
- Never log message text, names, phone numbers, or Telegram IDs.
- Prefer accessible and privacy-preserving interpretations of ambiguity, and
  record decisions in `DECISIONS.md`.
- Keep dependencies minimal and compatible with the project's open-source
  release.
- Run the relevant tests, lint, typecheck, and UI accessibility checks before
  marking work complete.
