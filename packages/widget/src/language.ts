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
