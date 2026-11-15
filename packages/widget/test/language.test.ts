import { describe, expect, it } from "vitest";
import { suggestLanguageOptions } from "../src/language.js";

const languages = [
  { code: "en", script: "Latn" },
  { code: "am", script: "Ethi" },
  { code: "om", script: "Latn" },
  { code: "ti", script: "Ethi" },
];

describe("language suggestions", () => {
  it("offers Amharic and Tigrinya for Ethiopic text without switching automatically", () => {
    expect(suggestLanguageOptions("ሰላም", languages)).toEqual(["am", "ti"]);
    expect(suggestLanguageOptions("ምናባዊ ረዳት ምንድን ነው?", languages)).toEqual([
      "am",
      "ti",
    ]);
    expect(suggestLanguageOptions("ቨርቹዋል ሓጋዚ እንታይ እዩ?", languages)).toEqual([
      "ti",
      "am",
    ]);
  });

  it("offers Afaan Oromoo and English for Latin text", () => {
    expect(suggestLanguageOptions("Hello there", languages)).toEqual([
      "om",
      "en",
    ]);
  });

  it("does not suggest a language when matching packs are unavailable", () => {
    expect(suggestLanguageOptions("ሰላም", [languages[0]!])).toEqual([]);
    expect(suggestLanguageOptions("123 !?", languages)).toEqual([]);
  });
});
