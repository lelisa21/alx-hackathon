import { describe, expect, it } from "vitest";
import {
  hasTransliteration,
  suggestTransliteration,
} from "../src/transliteration.js";

const mapping = {
  "transliteration.word.selam": "ሰላም",
  "transliteration.map.se": "ሰ",
  "transliteration.map.la": "ላ",
  "transliteration.map.m": "ም",
  "transliteration.map.sh": "ሽ",
  "transliteration.map.she": "ሸ",
  "transliteration.map.s": "ስ",
};

describe("FR-LANG-15 optional transliteration suggestions", () => {
  it("offers selam from pack data, preserving the original input", () => {
    const input = "Selam!";
    expect(suggestTransliteration(input, mapping)).toBe("ሰላም!");
    expect(input).toBe("Selam!");
    expect(hasTransliteration(mapping)).toBe(true);
  });

  it("uses longest syllable matches and preserves existing Ethiopic text and punctuation", () => {
    expect(suggestTransliteration("she la m ሰላም 123", mapping)).toBe(
      "ሸ ላ ም ሰላም 123",
    );
  });

  it("leaves an unknown Latin word intact rather than rewriting half a word", () => {
    expect(suggestTransliteration("selam unknown", mapping)).toBe(
      "ሰላም unknown",
    );
    expect(suggestTransliteration("unknown", mapping)).toBeNull();
  });

  it("does nothing without mapping data or for direct Ge'ez input", () => {
    expect(hasTransliteration({})).toBe(false);
    expect(suggestTransliteration("selam", {})).toBeNull();
    expect(suggestTransliteration("ሰላም", mapping)).toBeNull();
    expect(suggestTransliteration("", mapping)).toBeNull();
  });
});
