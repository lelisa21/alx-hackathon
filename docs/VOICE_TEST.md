# Voice and screen-reader evidence

Recorded 13 November 2026 for P01. **Status: not tested on a physical device.**
This is an evidence register and test protocol, not a voice acceptance sign-off.
Production adapters remain P04 work.

Requirements: **FR-VOICE-01** requires the same ten sentences per language on
a real mid-range Android phone, with at least eight intelligible results
before enabling an engine. **NFR-A11Y-07** requires a record of the screen
reader and voice that correctly reads each live language. **FR-LANG-12**
requires the calendar display to be verified on the target Android device.

The authoritative protocol is in [Blueprint section 10](../Dimts-System-Blueprint-v2.0.md)
and the acceptance text is in [SRS FR-VOICE-01 and NFR-A11Y-07](../Dimts-SRS-v1.2-complete.md).
The blueprint supersedes obsolete SRS engine assumptions. See
[the add-language checklist](./ADD_A_LANGUAGE.md) before changing pack status.

## Current evidence

- **English (`en`):** beta text pack, no reviewer recorded. STT and TTS flags
  are false. Engine and BCP tag are null. Android STT, Android TTS, TalkBack
  interface reading and NVDA interface reading have not been tested here.
- **Amharic (`am`):** unreviewed draft text pack. STT and TTS flags are false.
  Engine and BCP tag are null. Android STT, Android TTS, TalkBack interface
  reading and NVDA interface reading have not been tested here. Availability
  and intelligibility of an Ethiopic screen-reader voice are unknown.
- **Afaan Oromoo (`om`):** unreviewed draft text pack. STT and TTS flags are
  false. Engine and BCP tag are null. Android STT, Android TTS, TalkBack
  interface reading and NVDA interface reading have not been tested here.
- **Pseudo-RTL (`ar-test`):** CI-only draft layout fixture, not an Arabic
  translation or a production voice candidate. Engine and BCP tag are null.

Mock-adapter browser tests are useful interaction checks. They do not establish
real microphone recognition, native pronunciation, screen-reader intelligibility,
or the eight-of-ten engine threshold. No engine is approved by this document.

## Physical-device protocol

1. Ask the language lead and co-designer to agree on ten short sentences per
   language. Include ordinary course questions, a request for help, dates,
   numbers, glossary terms and unfamiliar words. Record the exact approved
   sentence set and its revision before comparing engines; do not change the
   sentences between candidates to improve a score.
2. Record the test date, device model, Android version, browser and version,
   engine and version, language/BCP tag, network conditions and whether the
   engine sends audio to a remote service. Obtain the relevant consent before
   enabling a remote engine. Do not store learner recordings or identifiers.
3. Test STT and TTS separately on that device. For each of the ten sentences,
   have a native speaker judge whether the intended meaning is intelligible.
   Record the sentence number, pass/fail and a brief technical observation.
   Keep recognition success separate from synthesized-speech intelligibility.
4. Record the totals separately for STT and TTS. An engine with fewer than
   eight intelligible sentences stays disabled for that language. Retain
   failures in the evidence; a missing result is not a passing result.
5. With TalkBack on Android and NVDA on a supported desktop browser, record
   the installed voice name and language, versions and whether the interface
   reads correctly. Exercise language selection, message input, replies,
   transcript review, settings and help. Record actual limitations separately
   for each screen-reader/language combination.
6. If no usable Ethiopic screen-reader voice is installed, record that fact
   and test the explicit Read aloud alternative with an approved TTS adapter.
   Do not describe an unavailable or untested adapter as an accessible
   alternative. Typed interaction and visible unsupported reasons must remain
   usable while voice is disabled.
7. On the target Android device, verify 14 November 2026 in both calendars.
   Amharic must display `ህዳር 5 2019` with the Gregorian date in brackets;
   Afaan Oromoo uses the pack's Ethiopian month name `Sadaasa`. Confirm
   western digits, legibility, screen-reader output and no date shift across
   device time zones. The exact Afaan Oromoo month wording still needs native
   review; desktop unit tests alone do not meet the device criterion.
8. Record reviewer approval and the engine decision. Only then update the
   matching locale `voice.yaml`, capability flags and real review metadata.
   Re-run `pnpm lang:check` and the relevant browser tests. Store the actual
   result and reviewer reference here; never replace “not tested” with a pass
   solely because configuration validation succeeds.

## Outstanding evidence

The approved ten-sentence sets, physical device, engine comparison, native
reviewer/co-designer sign-off, TalkBack/NVDA results and Android calendar
verification are all outstanding. FR-VOICE-01, NFR-A11Y-07 and the physical-device
portion of FR-LANG-12 are not marked complete.
