# Voice and screen-reader evidence

Updated 13 November 2026 for P04. **Status: not tested on a physical device.**
This is an evidence register and test protocol, not a voice acceptance sign-off.

P04 implements browser STT and TTS behind the existing interfaces. Set
`DIMTS_STT_ENGINE=browser` and/or `DIMTS_TTS_ENGINE=browser` to allow an
approved pack's corresponding capability; both default to `none`. A pack needs
non-draft status, valid review metadata, its approved `stt`/`tts` flag, and
`voice.yaml` with `engine: browser` and the tested `bcp_tag`. Runtime capability
checks may still disable voice. Preview does not authorize draft voice.

Recognition requires explicitly available on-device processing; synthesis uses
only a matching local-service voice. These checks use the
[Web Speech API's local-processing and voice contracts](https://webaudio.github.io/web-speech-api/).
The widget does not install language models, upload audio, silently select a
remote voice, or store recordings. Unsupported browsers retain text and a
localized reason. No server engine is selected or supported in this increment,
so `/v1/stt` and `/v1/tts` are not added. A future server/Telegram voice path
needs an engine selection, data-policy review and explicit endpoint contract;
the current browser adapter cannot transcribe a Telegram audio attachment.

Recording sounds can be disabled separately. An explicit voice-input action
still permits transcript/error read-back when local TTS is available; the
reply Read-aloud preference governs automatic reading of tutor replies.

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

P04 automated evidence: 43 browser-adapter unit tests, 36 API capability tests
and eight new native-API-double browser scenarios passed, including voice-review
accessibility checks. The full browser regression passed 101 functional and
accessibility cases plus the separate startup check. See
[implementation progress](./IMPLEMENTATION_PROGRESS.md) for commands, limits
and the full-suite benchmark rerun. These results do not change any physical
device or reviewer status below.

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

## Fixed candidate corpus — P04-2026-11-13-1

The following sentences reproduce `q-<language>-001` through `010` from the
existing draft checks. They are **not approved linguistic evidence**. A native
reviewer must approve or revise the set before testing; revision requires a
new corpus version and rerunning every compared engine on that same version.
Use the exact ten sentences for both STT and TTS, without recording audio in
this repository. The job named below is a fictional test fixture.

### English (`en-US` candidate)

1. How many topics should I choose this week?
2. How should I write my study goal?
3. Where should I record my study times?
4. Why should I leave space between study sessions?
5. When should I review my progress?
6. How many minutes must each study session last?
7. Which calendar app should I install?
8. What is tomorrow's weather?
9. Who won yesterday's football match?
10. Where is the Community Garden Assistant job?

### Amharic (`am-ET` candidate)

1. በዚህ ሳምንት ስንት ርዕሶችን ልምረጥ?
2. የጥናት ግቤን እንዴት ልጻፍ?
3. የጥናት ጊዜዎቼን የት ልመዝግብ?
4. በጥናት ጊዜዎች መካከል ክፍተት ለምን ልተው?
5. እድገቴን መቼ ልገምግም?
6. እያንዳንዱ የጥናት ጊዜ ስንት ደቂቃ መሆን አለበት?
7. የትኛውን የቀን መቁጠሪያ መተግበሪያ ልጫን?
8. የነገው የአየር ሁኔታ ምንድን ነው?
9. የትናንቱን የእግር ኳስ ጨዋታ ማን አሸነፈ?
10. የማኅበረሰብ አትክልት ስፍራ ረዳት ስራ የት ነው?

### Afaan Oromoo (`om-ET` candidate)

1. Torban kana mata duree meeqa filachuu qaba?
2. Kaayyoo qo'annoo koo akkamitti barreessuu qaba?
3. Yeroo qo'annoo koo eessatti galmeessuu qaba?
4. Yeroo qo'annoo gidduutti maaliif boqonnaa kaa'uu qaba?
5. Guddina koo yoom ilaaluun qaba?
6. Yeroon qo'annoo tokko daqiiqaa meeqa turuu qaba?
7. Appii kalaandarii kam fe'achuu qaba?
8. Haalli qilleensaa boruu maal fakkaata?
9. Tapha kubbaa miilaa kaleessaa eenyutu mo'e?
10. Hojiin gargaaraa iddoo biqiltuu hawaasaa eessa jira?

## Result records to complete on a real device

All six direction results are **not tested / not approved**, not zero scores:
English browser STT and TTS; Amharic browser STT and TTS; Afaan Oromoo browser
STT and TTS. The six screen-reader combinations (en/am/om × TalkBack/NVDA)
are likewise **not tested**. No usable Ethiopic voice has been verified; Read
aloud is an alternative only after a local TTS voice passes the protocol.

For each language, engine and direction, record: corpus revision/approval,
date, device/OS/browser/engine versions, BCP tag, network mode, sentence 1–10
pass/fail, intelligible total, reviewer reference and enable/disable decision.
For each language/screen reader record its version and installed voice, reading
result for interface/review/reply controls, limitations and the tested Read
aloud alternative. Keep failed and unavailable engines visible in the record.
Only an actual result of at least 8/10 permits that direction's pack flag.
Afaan Oromoo's visible voice Beta explanation must accompany an approved
capability while the pack has beta status; it never implies a passing result.

## Outstanding evidence

The approved ten-sentence sets, physical device, engine comparison, native
reviewer/co-designer sign-off, TalkBack/NVDA results and Android calendar
verification are all outstanding. FR-VOICE-01, NFR-A11Y-07 and the physical-device
portion of FR-LANG-12 are not marked complete.
