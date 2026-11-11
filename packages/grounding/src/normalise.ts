const ETHIOPIC_ROW_ALIASES = new Map<number, number>([
  [0x1210, 0x1200],
  [0x1280, 0x1200],
  [0x1220, 0x1230],
  [0x12d0, 0x12a0],
  [0x1340, 0x1338],
]);
const ETHIOPIC_WORDSPACE = "\u1361";
const ETHIOPIC_FULLSTOP = "\u1362";
const OROMO_APOSTROPHES = /[\u2018\u2019\u02bb\u02bc\u00b4`']/gu;

function cleanSearchText(value: string): string {
  return value
    .replaceAll(ETHIOPIC_WORDSPACE, " ")
    .replaceAll(ETHIOPIC_FULLSTOP, " ")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

function normaliseAmharic(value: string): string {
  let output = "";
  for (const character of value.normalize("NFC")) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;

    if (codePoint >= 0x1200 && codePoint < 0x1360) {
      const row = codePoint - (codePoint % 8);
      const canonicalRow = ETHIOPIC_ROW_ALIASES.get(row);
      output += String.fromCodePoint(
        canonicalRow === undefined
          ? codePoint
          : canonicalRow + (codePoint - row),
      );
    } else {
      output += character;
    }
  }
  return cleanSearchText(output.toLowerCase());
}

function normaliseOromo(value: string): string {
  return cleanSearchText(
    value.normalize("NFC").toLowerCase().replace(OROMO_APOSTROPHES, ""),
  );
}

export function normalise(value: string, lang: string): string {
  const baseLanguage = lang.toLowerCase().split("-")[0];
  if (baseLanguage === "am") return normaliseAmharic(value);
  if (baseLanguage === "om") return normaliseOromo(value);
  return cleanSearchText(value.normalize("NFC").toLowerCase());
}

export function tokenize(value: string, lang: string): string[] {
  return normalise(value, lang)
    .split(" ")
    .filter((token) => Array.from(token).length >= 2);
}
