const AMHARIC_SEARCH_PAIRS: [string, string][] = [
  [String.fromCodePoint(0x1230), String.fromCodePoint(0x1235)],
];

export function wordGrams(word: string): string[] {
  const characters = Array.from(` ${word} `);
  const grams: string[] = [];
  for (let index = 0; index + 3 <= characters.length; index += 1) {
    grams.push(characters.slice(index, index + 3).join(""));
  }
  return grams;
}

function wordGramVariants(word: string): string[] {
  const variants = new Set([word]);
  for (const [first, second] of AMHARIC_SEARCH_PAIRS) {
    for (const variant of [...variants]) {
      if (variant.includes(first))
        variants.add(variant.replaceAll(first, second));
      if (variant.includes(second))
        variants.add(variant.replaceAll(second, first));
    }
  }
  return [...variants].flatMap(wordGrams);
}

export function textGrams(text: string): string[] {
  const grams = new Set<string>();
  for (const word of text.split(" ")) {
    if (!word) continue;
    for (const gram of wordGramVariants(word)) grams.add(gram);
  }
  return [...grams];
}

export function queryTokens(normalisedText: string): string[] {
  return normalisedText
    .split(" ")
    .filter((token) => token && Array.from(token).length >= 2);
}

export function confidence(tokens: string[], passageNorm: string): number {
  if (tokens.length === 0) return 0;

  const passageWords = [...new Set(passageNorm.split(" ").filter(Boolean))].map(
    (word) => new Set(wordGramVariants(word)),
  );
  let matched = 0;
  let similaritySum = 0;

  for (const token of tokens) {
    const tokenGrams = new Set(wordGramVariants(token));
    let best = 0;
    for (const passageWord of passageWords) {
      let shared = 0;
      for (const gram of tokenGrams) {
        if (passageWord.has(gram)) shared += 1;
      }
      if (tokenGrams.size > 0) {
        best = Math.max(best, shared / tokenGrams.size);
      }
    }
    similaritySum += best;
    if (best >= 0.6) matched += 1;
  }

  const matchedWordShare = matched / tokens.length;
  const meanBestSimilarity = similaritySum / tokens.length;
  return Math.max(
    0,
    Math.min(1, 0.6 * matchedWordShare + 0.4 * meanBestSimilarity),
  );
}
