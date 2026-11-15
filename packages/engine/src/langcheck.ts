const ENGLISH_STOPWORDS = new Set([
  "a",
  "and",
  "are",
  "as",
  "can",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
  "you",
  "your",
]);

// Common Oromo function words. None of them is an English word, so English
// answers containing one are still rejected as mixed-language output.
const OROMO_STOPWORDS = new Set([
  "akka",
  "ani",
  "dha",
  "ergasii",
  "fi",
  "gara",
  "garuu",
  "hin",
  "isin",
  "jira",
  "kana",
  "osoo",
  "qaba",
  "sana",
  "waliin",
  "yeroo",
  "ykn",
  "keessan",
  "keessa",
  "keessatti",
  "kan",
  "kun",
  "maal",
  "irraa",
  "irratti",
  "isaan",
  "ishee",
  "isa",
  "ni",
  "yoo",
  // Added 2026-11-15: "Furtuu Amma na gargaaraa jedhu filadhaa." (select the
  // Help me now button) has none of the words above and was rejected as
  // not Oromo, so a correct quoted answer became "not found".
  "amma",
  "na",
  "nu",
  "jedhu",
  "itti",
  "irra",
  "booda",
  "dura",
  "kanaaf",
  "immoo",
  "akkasumas",
  "hunda",
  "tokko",
]);
// Oromo writes the glottal stop (hudhaa) with an apostrophe inside words, as in
// "danda'a". Splitting there would yield tokens such as "a" that match English
// stopwords and reject correct Oromo answers, so join the word first.
const OROMO_APOSTROPHES =
  /(?<=\p{L})[\u2018\u2019\u02bb\u02bc\u00b4`'](?=\p{L})/gu;

function tokens(text: string, lang = ""): string[] {
  const joined =
    languageBase(lang) === "om" ? text.replace(OROMO_APOSTROPHES, "") : text;
  return (
    joined
      .normalize("NFC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function languageBase(lang: string): string {
  return lang.toLowerCase().split("-")[0] ?? lang.toLowerCase();
}

// Amharic and Tigrinya share the Ge'ez script, so the script alone cannot tell
// a Tigrinya reply from an Amharic one. These markers can: letters Amharic
// does not use (the ቐ and ኸ rows), Tigrinya's word-initial ኣ, each language's
// most frequent function words, and their polite-plural verb endings.
const TIGRINYA_WORDS = new Set([
  "እዩ",
  "እዮም",
  "እያ",
  "እየ",
  "ኢዩ",
  "ኢኹም",
  "ኣብ",
  "ናይ",
  "ምስ",
  "ከም",
  "እንታይ",
  "ብኸመይ",
  "ኣሎ",
  "ኣለዉ",
  "ኣለኹ",
  "ድማ",
  "ከኣ",
  "ብዛዕባ",
  "ናብ",
  "ካብ",
  "የለን",
  "ኩሉ",
  "እዚ",
  "እቲ",
  "ነዚ",
  "ንዚ",
]);
const AMHARIC_WORDS = new Set([
  "ነው",
  "ናቸው",
  "ነበር",
  "እና",
  "ወይም",
  "ላይ",
  "ውስጥ",
  "ጋር",
  "ይህ",
  "ይህን",
  "እንዴት",
  "ምንድን",
  "ምንድነው",
  "አለ",
  "አሉ",
  "እንደ",
  "በጣም",
  "ሁሉም",
  "እርስዎ",
  "የእርስዎ",
  "ይችላሉ",
  "ያለ",
]);
const TIGRINYA_LETTERS = /[ቐ-ቖኸ-ኾ]/gu;

/** Evidence for Amharic versus Tigrinya in Ge'ez-script text. */
export function ethiopicLanguageScores(text: string): {
  am: number;
  ti: number;
} {
  const words = text.normalize("NFC").match(/[\p{L}\p{N}]+/gu) ?? [];
  let ti = Math.min(3, text.match(TIGRINYA_LETTERS)?.length ?? 0);
  let am = 0;
  for (const word of words) {
    if (
      TIGRINYA_WORDS.has(word) ||
      word.startsWith("ኣ") ||
      /(?:ኩም|ኹም)$/u.test(word)
    )
      ti += 1;
    if (AMHARIC_WORDS.has(word) || /ዎታል$/u.test(word)) am += 1;
  }
  return { am, ti };
}

/**
 * `factsOnly`: the answer quotes job-posting fact lines (title, employer,
 * place), which are names with no function words. They still must use the
 * language's script and contain no function words of the other language.
 */
export function isAnswerInLanguage(
  text: string,
  lang: string,
  options: { factsOnly?: boolean } = {},
): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;

  const base = languageBase(lang);
  const ethiopic = text.match(/[\u1200-\u137f]/gu)?.length ?? 0;
  if (base === "am" || base === "ti") {
    if (ethiopic / letters.length < 0.3) return false;
    // Reject only clear evidence of the other Ge'ez-script language; a short
    // answer with no markers either way is accepted.
    const scores = ethiopicLanguageScores(text);
    const own = base === "am" ? scores.am : scores.ti;
    const other = base === "am" ? scores.ti : scores.am;
    return !(other >= 2 && other > own);
  }
  if (ethiopic / letters.length >= 0.3) return false;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if ((base === "en" || base === "om") && latin / letters.length < 0.7)
    return false;
  const answerTokens = tokens(text, base);
  if (base === "en")
    return (
      !answerTokens.some((token) => OROMO_STOPWORDS.has(token)) &&
      (Boolean(options.factsOnly) ||
        answerTokens.some((token) => ENGLISH_STOPWORDS.has(token)) ||
        answerTokens.length <= 4)
    );
  if (base === "om")
    return (
      !answerTokens.some((token) => ENGLISH_STOPWORDS.has(token)) &&
      (Boolean(options.factsOnly) ||
        answerTokens.some((token) => OROMO_STOPWORDS.has(token)) ||
        answerTokens.length <= 4)
    );
  return true;
}
