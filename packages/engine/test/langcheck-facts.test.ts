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

describe("Oromo imperative sentences", () => {
  it("accepts a short instruction built from common function words", () => {
    expect(
      isAnswerInLanguage("Furtuu Amma na gargaaraa jedhu filadhaa.", "om"),
    ).toBe(true);
    expect(isAnswerInLanguage("Select the Help me now button.", "om")).toBe(
      false,
    );
  });
});

describe("Amharic and Tigrinya share the Ge'ez script", () => {
  const amharic = "70 በመቶ ወይም ከዚያ በላይ ውጤት ያስፈልግዎታል። ይህ ውጤት የኮርሱን ባጅ ያስገኝልዎታል።";
  const tigrinya = "70% ወይ ካብኡ ንላዕሊ ነጥቢ የድልየኩም። እዚ ነጥቢ ናይ ኮርስኩም ባጅ የውህበኩም።";

  it("accepts each language and rejects the other", () => {
    expect(isAnswerInLanguage(amharic, "am")).toBe(true);
    expect(isAnswerInLanguage(amharic, "ti")).toBe(false);
    expect(isAnswerInLanguage(tigrinya, "ti")).toBe(true);
    expect(isAnswerInLanguage(tigrinya, "am")).toBe(false);
  });

  it("accepts short neutral replies in either", () => {
    expect(isAnswerInLanguage("ሰላም።", "am")).toBe(true);
    expect(isAnswerInLanguage("ሰላም።", "ti")).toBe(true);
  });
});

describe("grounded in-depth answers", () => {
  it("accepts a rephrased answer built from the passage", async () => {
    const { isAnswerSupported } = await import("../src/answer-validation.js");
    const passage = {
      lang: "en",
      text: "Your overall score is a weighted average of graded tasks. Each graded task has a weight. A weekly task has a weight of 1%.",
    };
    expect(
      isAnswerSupported(
        "Your overall score averages your graded tasks by weight. Weekly tasks each weigh 1%.",
        [passage],
        "en",
      ),
    ).toBe(true);
  });

  it("rejects invented numbers and unrelated content", async () => {
    const { isAnswerSupported } = await import("../src/answer-validation.js");
    const passage = {
      lang: "en",
      text: "You need a score of 70% or higher. This score earns your course badge.",
    };
    expect(
      isAnswerSupported("You need a score of 80% or higher.", [passage], "en"),
    ).toBe(false);
    expect(
      isAnswerSupported(
        "Install Python, configure your laptop firewall, then deploy with Docker containers.",
        [passage],
        "en",
      ),
    ).toBe(false);
  });

  it("matches Ge'ez inflections through the consonant skeleton", async () => {
    const { isAnswerSupported } = await import("../src/answer-validation.js");
    const passage = {
      lang: "ti",
      text: "70% ወይ ካብኡ ንላዕሊ ነጥቢ የድልየኩም። እዚ ነጥቢ ናይ ኮርስኩም ባጅ የውህበኩም።",
    };
    expect(
      isAnswerSupported(
        "ኮርስ ንምሕላፍ 70% ነጥቢ የድልየኩም። እዚ ነጥብኹም ባጅ የውህበኩም።",
        [passage],
        "ti",
      ),
    ).toBe(true);
  });
});
