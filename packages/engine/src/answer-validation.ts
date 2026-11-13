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
