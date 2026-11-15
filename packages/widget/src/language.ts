export interface LanguageOption {
  code: string;
  script: string;
}

export type VoiceNavigationAction =
  | { action: "sms" }
  | { action: "helper" }
  | { action: "sign" }
  | { action: "settings" }
  | { action: "language"; lang: string };

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
      ["እዩ", "እንታይ", "ብኸመይ", "ናይ", "እዚ", "ኣብ", "ምስ", "ስለምንታይ", "ደሓን", "የቐንየለይ"].includes(word),
  ).length;
  const am = words.filter(
    (word) =>
      /ዎታል$/u.test(word) ||
      ["ነው", "እንዴት", "ምንድን", "ይህ", "እና", "ውስጥ", "ለምን", "አዎ", "አይደለም", "አመሰግናለሁ"].includes(word),
  ).length;
  return ti > am;
}

const FR_REGEX = /\b(?:bonjour|merci|comment|pourquoi|est-ce|aide|cours|leçon|avec|dans|pour|une|des|les|oui|non|salut)\b/i;

export function looksFrench(text: string): boolean {
  if (/[éèêëàâîïôùûçœæ]/iu.test(text)) return true;
  if (/\b(?:l'|d'|c'|j'|qu'|n'|s')/iu.test(text) && FR_REGEX.test(text)) return true;
  return FR_REGEX.test(text);
}

const SO_REGEX = /\b(?:waa|iyo|maxay|waxay|sidee|xaggee|goorma|mahadsanid|haye|maya|fadlan|casharkan|tahay|ayaad|barashada|isla|kasta)\b/i;

export function looksSomali(text: string): boolean {
  return SO_REGEX.test(text);
}

const SW_REGEX = /\b(?:habari|jambo|kwa|katika|yake|yangu|kwanini|vipi|asante|ndiyo|hapana|tafadhali|sawa|kujifunza|maswali|somo|hili|nataka)\b/i;

export function looksSwahili(text: string): boolean {
  return SW_REGEX.test(text);
}

const OM_REGEX = /\b(?:akkam|maal|eessa|maaliif|yoom|akkamitti|galatoomaa|barnoota|sagalee|mallattoo|gaaffii|eeyyee|lakki|barachuu|barbaada|jira|waan|booda|keessatti|fayyadamuun)\b/i;

export function looksOromo(text: string): boolean {
  if (looksSomali(text) || looksFrench(text)) return false;
  if (OM_REGEX.test(text)) return true;
  if (/(?:[a-z]{2,}'[a-z]+|[a-z]+')/iu.test(text) && !/\b(?:l'|d'|c'|j'|qu'|n'|s')/iu.test(text)) return true;
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

  // 1. Ethiopic script (Amharic vs Tigrinya)
  if (/\p{Script=Ethiopic}/u.test(trimmed)) {
    const tiLikelier = looksTigrinya(trimmed);
    if (tiLikelier && available.has("ti")) return "ti";
    if (available.has("am")) return "am";
    if (available.has("ti")) return "ti";
  }

  // 2. Arabic script
  if (/\p{Script=Arabic}/u.test(trimmed)) {
    if (available.has("ar")) return "ar";
    if (available.has("ar-test")) return "ar-test";
  }

  // 3. Latin script differentiation
  if (/\p{Script=Latin}/u.test(trimmed)) {
    if (looksFrench(trimmed) && available.has("fr")) return "fr";
    if (looksSomali(trimmed) && available.has("so")) return "so";
    if (looksSwahili(trimmed) && available.has("sw")) return "sw";
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
    const order = looksTigrinya(text) ? ["ti", "am"] : ["am", "ti"];
    return order.filter((code) => available.has(code));
  }
  if (/\p{Script=Arabic}/u.test(text)) {
    return ["ar", "ar-test"].filter((code) => available.has(code));
  }
  if (/\p{Script=Latin}/u.test(text)) {
    if (looksFrench(text) && available.has("fr")) return ["fr", "en"].filter((c) => available.has(c));
    if (looksSwahili(text) && available.has("sw")) return ["sw", "en"].filter((c) => available.has(c));
    if (looksSomali(text) && available.has("so")) return ["so", "en"].filter((c) => available.has(c));
    return ["om", "en"].filter((code) => available.has(code));
  }
  return [];
}

/** Matches natural voice phrases intended as app navigation rather than questions. */
export function matchVoiceNavigationCommand(phrase: string): VoiceNavigationAction | null {
  const normalized = phrase.toLowerCase().trim().replace(/[.,!?;:]/gu, "");
  if (!normalized) return null;

  // Language switching commands
  const langMatch = /^(?:change\s+language\s+to|switch\s+(?:language\s+)?to|speak|use)\s+(amharic|oromo|afaan\s+oromoo|tigrinya|english|french|swahili|somali|arabic)$/i.exec(normalized);
  if (langMatch && langMatch[1]) {
    const raw = langMatch[1].toLowerCase().replace(/\s+/g, "");
    const map: Record<string, string> = {
      amharic: "am",
      oromo: "om",
      afaanoromoo: "om",
      tigrinya: "ti",
      english: "en",
      french: "fr",
      swahili: "sw",
      somali: "so",
      arabic: "ar",
    };
    if (map[raw]) return { action: "language", lang: map[raw]! };
  }

  // SMS Simulator navigation
  if (
    /^(?:go\s+to\s+sms|open\s+sms(?:\s+simulator)?|sms(?:\s+mode)?|text\s+messages?)$/i.test(
      normalized,
    )
  ) {
    return { action: "sms" };
  }

  // Human help / Helper console
  if (
    /^(?:open\s+(?:human\s+)?help|talk\s+to\s+(?:a\s+)?person|human\s+helper|support\s+assistant|connect\s+helper)$/i.test(
      normalized,
    )
  ) {
    return { action: "helper" };
  }

  // Ethiopian Sign Language Visual Studio
  if (
    /^(?:open\s+)?(?:sign\s+language|ethsl|gestures|visual\s+signs)$/i.test(
      normalized,
    )
  ) {
    return { action: "sign" };
  }

  // Settings
  if (/^(?:open\s+)?(?:settings|preferences|options)$/i.test(normalized)) {
    return { action: "settings" };
  }

  return null;
}
