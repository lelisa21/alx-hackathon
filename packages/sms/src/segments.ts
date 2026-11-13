// SRS 22B.3 / Blueprint D19. This module is browser-safe.
const basic = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const extended = new Set(Array.from("^{}\\[~]|€\f"));
export interface SmsCount {
  encoding: "gsm7" | "ucs2";
  units: number;
  segments: number;
  perSegment: number;
}
export function normalizeForSms(text: string): string {
  return text.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"');
}
export function normalizeSmsKeyword(text: string): string {
  return normalizeForSms(text)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/'/gu, "")
    .trim()
    .toLowerCase();
}
export function countSms(raw: string): SmsCount {
  const text = normalizeForSms(raw);
  let units = 0;
  for (const character of text) {
    if (basic.has(character)) units++;
    else if (extended.has(character)) units += 2;
    else
      return {
        encoding: "ucs2",
        units: text.length,
        segments: text.length <= 70 ? 1 : Math.ceil(text.length / 67),
        perSegment: text.length <= 70 ? 70 : 67,
      };
  }
  return {
    encoding: "gsm7",
    units,
    segments: units <= 160 ? 1 : Math.ceil(units / 153),
    perSegment: units <= 160 ? 160 : 153,
  };
}
/** Whole sentences when possible; bounded fallback for a single oversized sentence. */
export function paginateSms(
  raw: string,
  lang: string,
  moreLine: string,
  maxSegments = 3,
  maxPages = 10,
): string[] {
  if (
    !Number.isInteger(maxSegments) ||
    maxSegments < 1 ||
    maxSegments > 3 ||
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 10
  )
    throw new RangeError("Invalid SMS budget");
  const cue = normalizeForSms(moreLine).trim();
  if (!cue || countSms(cue).segments > maxSegments)
    throw new RangeError("SMS continuation cue exceeds budget");
  let remaining = normalizeForSms(raw).trim();
  const pages: string[] = [];
  const boundary =
    lang === "am" ? /(?<=[።.!?])\s+|\n+/u : /(?<=[.!?።])\s+|\n+/u;
  while (remaining && pages.length < maxPages) {
    if (countSms(remaining).segments <= maxSegments) {
      pages.push(remaining);
      break;
    }
    const last = pages.length === maxPages - 1;
    const suffix = last ? "..." : `\n${cue}`;
    let selected = "";
    for (const sentence of remaining.split(boundary)) {
      const candidate = selected ? `${selected} ${sentence}` : sentence;
      if (countSms(candidate + suffix).segments > maxSegments) break;
      selected = candidate;
    }
    if (!selected) {
      for (const character of remaining) {
        if (countSms(selected + character + suffix).segments > maxSegments)
          break;
        selected += character;
      }
      const wordBoundary = selected.lastIndexOf(" ");
      if (wordBoundary > selected.length / 2)
        selected = selected.slice(0, wordBoundary);
    }
    if (!selected) throw new RangeError("SMS budget cannot fit content");
    pages.push(selected.trimEnd() + suffix);
    // Sentence whitespace may have been folded; consume the corresponding source tokens.
    const words = selected.trim().split(/\s+/u);
    let offset = 0;
    for (const word of words) {
      const start = remaining.indexOf(word, offset);
      offset = start + word.length;
    }
    remaining = remaining.slice(offset).trimStart();
  }
  return pages;
}
