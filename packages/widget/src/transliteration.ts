/** Suggestions only: callers must keep the original input until explicit confirmation. */
export function hasTransliteration(ui: Record<string, unknown>): boolean {
  return Object.entries(ui).some(
    ([key, value]) =>
      key.startsWith("transliteration.map.") &&
      typeof value === "string" &&
      value.length > 0,
  );
}

export function suggestTransliteration(
  text: string,
  ui: Record<string, unknown>,
): string | null {
  const prefix = "transliteration.map.";
  const rules = Object.entries(ui)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].startsWith(prefix) &&
        typeof entry[1] === "string" &&
        entry[1].length > 0,
    )
    .map(([key, value]) => [key.slice(prefix.length), value] as const)
    .filter(([key]) => /^[a-z]+$/u.test(key))
    .sort(([left], [right]) => right.length - left.length);
  if (!rules.length) return null;
  const suggestion = text.replace(/[A-Za-z]+/gu, (word) => {
    const normalized = word.toLowerCase();
    const knownWord = ui[`transliteration.word.${normalized}`];
    if (typeof knownWord === "string" && knownWord) return knownWord;
    let remainder = normalized;
    let result = "";
    while (remainder) {
      const match = rules.find(([key]) => remainder.startsWith(key));
      // Preserve unfamiliar words whole, including their original case.
      if (!match) return word;
      result += match[1];
      remainder = remainder.slice(match[0].length);
    }
    return result;
  });
  return suggestion === text ? null : suggestion;
}
