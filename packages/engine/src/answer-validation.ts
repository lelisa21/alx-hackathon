/** Count natural sentence words without clipping or adding artificial punctuation. */
export function sentenceWordCounts(text: string): number[] {
  return (text.match(/[^.!?።፧。！？]+[.!?።፧。！？]?/gu) ?? [])
    .map(
      (sentence) =>
        (
          sentence.match(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu) ??
          []
        ).length,
    )
    .filter((length) => length > 0);
}

export function averageSentenceLength(text: string): number | null {
  const counts = sentenceWordCounts(text);
  return counts.length === 0
    ? null
    : counts.reduce((sum, count) => sum + count, 0) / counts.length;
}

export function isAnswerLengthAllowed(text: string, simple: boolean): boolean {
  const lengths = sentenceWordCounts(text);
  return (
    lengths.length > 0 &&
    lengths.every((length) => length <= (simple ? 12 : 15))
  );
}

// Conservative quarantine for the documented instruction-injection corpus.
// This is one defense alongside untrusted-data separation, citation, language,
// and provider capability checks; it is not a claim to detect every attack.
const INSTRUCTION_PATTERNS = [
  /\b(?:ignore|discard|override|forget)\b.{0,60}\b(?:rules?|instructions?|constraints?|citation requirement)\b/iu,
  /\b(?:reveal|show|print|repeat|return)\b.{0,40}\b(?:system prompt|hidden configuration|system rules|secret credentials)\b/iu,
  /\b(?:answer|respond|write)\b.{0,40}\bwithout\s+(?:any\s+)?(?:sources?|citations?)\b/iu,
  /\b(?:change|switch|override)\b.{0,30}\blanguage\b/iu,
  /\b(?:follow|obey)\b.{0,30}\b(?:passage|document)\s+instructions\b/iu,
  /\bact\s+as\s+a\s+different\s+assistant\b/iu,
  /\btreat\s+this\s+as\s+a\s+system\s+message\b/iu,
  /(?:\[\/?INST\]|<<\/?SYS>>|<\|(?:system|im_start)\|>)/iu,
];

export function hasInstructionInjection(text: string): boolean {
  const normalized = text.normalize("NFKC").replace(/\s+/gu, " ");
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

const MIN_SKELETON = 3;

/** Consonant skeleton of a word. Ge'ez syllables differ by vowel order in
 * inflection (ነጥቢ, ነጥብኹም), so each syllable maps to its row's base form. */
function skeleton(word: string): string {
  return Array.from(word.normalize("NFC").toLocaleLowerCase(), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x1200 && code < 0x1380
      ? String.fromCodePoint(code - (code % 8))
      : character;
  }).join("");
}

// A Ge'ez syllable carries consonant and vowel, so three are a content stem;
// Latin-script words need four letters, which drops most function words.
function contentWords(text: string): string[] {
  return (text.normalize("NFC").match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(skeleton)
    .filter(
      (word) =>
        Array.from(word).length >=
        (/\p{Script=Ethiopic}/u.test(word) ? MIN_SKELETON : 4),
    );
}

/** Reject provider replies that merely restate the learner's question. */
export function isAnswerEcho(text: string, question: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[\p{P}\p{S}\s]+/gu, "")
      .trim();
  const normalizedAnswer = normalize(text);
  const normalizedQuestion = normalize(question);
  if (!normalizedAnswer || !normalizedQuestion) return false;
  if (normalizedAnswer === normalizedQuestion) return true;

  const questionWords = contentWords(question);
  const answerWords = contentWords(text);
  // Keep near-verbatim matching conservative for short or less-tokenized turns.
  if (
    questionWords.length < 5 ||
    answerWords.length < questionWords.length ||
    answerWords.length > questionWords.length + 2
  )
    return false;
  const matched = questionWords.filter((word) =>
    answerWords.some((candidate) => candidate === word),
  ).length;
  return matched / questionWords.length >= 0.9;
}

/**
 * A grounded answer may rephrase, but it must stay inside its sources:
 * every number must appear in the cited passages, and at least half of its
 * content words must share a stem with words of the same-language passages
 * (a reply quoting English job postings in Amharic checks numbers only).
 */
export function isAnswerSupported(
  text: string,
  passages: { text: string; lang: string }[],
  lang: string,
): boolean {
  if (!passages.length) return false;
  const source = passages.map((passage) => passage.text).join(" ");
  const numbers = text.match(/\d+(?:[.,]\d+)?/gu) ?? [];
  if (numbers.some((value) => !source.includes(value))) return false;
  const base = (code: string) => code.toLowerCase().split("-")[0];
  const sameLanguage = passages.filter(
    (passage) => base(passage.lang) === base(lang),
  );
  if (!sameLanguage.length) return true;
  const sourceWords = contentWords(
    sameLanguage.map((passage) => passage.text).join(" "),
  );
  const answerWords = contentWords(text);
  if (answerWords.length < 3) return true;
  const supported = answerWords.filter((word) =>
    sourceWords.some(
      (sourceWord) =>
        sourceWord.includes(word) ||
        word.includes(sourceWord) ||
        (Array.from(word).slice(0, 4).join("") ===
          Array.from(sourceWord).slice(0, 4).join("") &&
          Array.from(word).length >= 4),
    ),
  ).length;
  return supported / answerWords.length >= 0.5;
}
