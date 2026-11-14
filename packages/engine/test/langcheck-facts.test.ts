import { describe, expect, it } from "vitest";
import { isAnswerInLanguage } from "../src/langcheck.js";

describe("job-posting fact lines", () => {
  const facts =
    "Accountant. Green Hope trading PLC. Addis Ababa, Addis Ababa, Ethiopia.";

  it("are rejected as prose but accepted as quoted job facts", () => {
    expect(isAnswerInLanguage(facts, "en")).toBe(false);
    expect(isAnswerInLanguage(facts, "en", { factsOnly: true })).toBe(true);
  });

  it("still reject the other language's function words and scripts", () => {
    expect(
      isAnswerInLanguage("Hojii kana irratti hojjechuu danda'a.", "en", {
        factsOnly: true,
      }),
    ).toBe(false);
    expect(
      isAnswerInLanguage("የሂሳብ ሠራተኛ። አዲስ አበባ።", "en", { factsOnly: true }),
    ).toBe(false);
  });
});
