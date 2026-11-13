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

const OROMO_STOPWORDS = new Set([
  "akka",
  "ani",
  "fi",
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
function tokens(text: string): string[] {
  return (
    text
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
  const answerTokens = tokens(text);
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
