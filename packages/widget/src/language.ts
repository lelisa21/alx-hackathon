export interface LanguageOption {
  code: string;
  script: string;
}

export function suggestLanguageOptions(
  text: string,
  languages: readonly LanguageOption[],
): string[] {
  const available = new Set(languages.map(({ code }) => code));
  if (/\p{Script=Ethiopic}/u.test(text)) {
    return available.has("am") ? ["am"] : [];
  }
  if (/\p{Script=Latin}/u.test(text)) {
    return ["om", "en"].filter((code) => available.has(code));
  }
  return [];
}
