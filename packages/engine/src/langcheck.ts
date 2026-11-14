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

export function isAnswerInLanguage(text: string, lang: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;

  const base = languageBase(lang);
  const ethiopic = text.match(/[\u1200-\u137f]/gu)?.length ?? 0;
  if (base === "am") {
    return ethiopic / letters.length >= 0.3;
  }
  if (ethiopic / letters.length >= 0.3) return false;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if ((base === "en" || base === "om") && latin / letters.length < 0.7)
    return false;
  const answerTokens = tokens(text, base);
  if (base === "en")
    return (
      !answerTokens.some((token) => OROMO_STOPWORDS.has(token)) &&
      (answerTokens.some((token) => ENGLISH_STOPWORDS.has(token)) ||
        answerTokens.length <= 4)
    );
  if (base === "om")
    return (
      !answerTokens.some((token) => ENGLISH_STOPWORDS.has(token)) &&
      (answerTokens.some((token) => OROMO_STOPWORDS.has(token)) ||
        answerTokens.length <= 4)
    );
  return true;
}
