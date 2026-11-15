export interface LanguageOption {
  code: string;
  script: string;
}

/** True when Ge'ez-script text shows Tigrinya rather than Amharic markers:
 * letters Amharic does not use (ቐ, ኸ rows), word-initial ኣ, or common
 * Tigrinya function words. Short neutral text (ሰላም) shows neither. */
export function looksTigrinya(text: string): boolean {
  if (/[ቐ-ቖኸ-ኾ]/u.test(text)) return true;
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const ti = words.filter(
    (word) =>
      word.startsWith("ኣ") ||
      /(?:ኩም|ኹም)$/u.test(word) ||
      ["እዩ", "እንታይ", "ብኸመይ", "ናይ", "እዚ", "ኣብ", "ምስ"].includes(word),
  ).length;
  const am = words.filter(
    (word) =>
      /ዎታል$/u.test(word) ||
      ["ነው", "እንዴት", "ምንድን", "ይህ", "እና", "ውስጥ"].includes(word),
  ).length;
  return ti > am;
}

const OM_REGEX = /\b(?:akkam|maal|eessa|maaliif|yoom|akkamitti|galatoomaa|barnoota|sagalee|mallattoo|gaaffii|eeyyee|lakki)\b/i;

export function looksOromo(text: string): boolean {
  if (/'[a-zA-Z]/u.test(text)) return true;
  if (OM_REGEX.test(text)) return true;
  const doubleVowels = (text.match(/(?:aa|ee|ii|oo|uu)/gi) ?? []).length;
  return doubleVowels >= 2;
}

export function detectLanguage(
  text: string,
  availableLanguages: readonly string[],
  fallback = "en",
): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  const available = new Set(availableLanguages);

  if (/\p{Script=Ethiopic}/u.test(trimmed)) {
    const tiLikelier = looksTigrinya(trimmed);
    if (tiLikelier && available.has("ti")) return "ti";
    if (available.has("am")) return "am";
    if (available.has("ti")) return "ti";
  }

  if (/\p{Script=Latin}/u.test(trimmed)) {
    if (looksOromo(trimmed) && available.has("om")) return "om";
    if (available.has("en")) return "en";
  }

  return available.has(fallback) ? fallback : (availableLanguages[0] ?? "en");
}

export function suggestLanguageOptions(
  text: string,
  languages: readonly LanguageOption[],
): string[] {
  const available = new Set(languages.map(({ code }) => code));
  if (/\p{Script=Ethiopic}/u.test(text)) {
    // Amharic and Tigrinya share the script: offer both, likelier first.
    const order = looksTigrinya(text) ? ["ti", "am"] : ["am", "ti"];
    return order.filter((code) => available.has(code));
  }
  if (/\p{Script=Latin}/u.test(text)) {
    return ["om", "en"].filter((code) => available.has(code));
  }
  return [];
}
