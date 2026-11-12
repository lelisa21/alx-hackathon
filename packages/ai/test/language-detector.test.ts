import { describe, expect, it } from "vitest";
import { FrancLanguageDetector } from "../src/language-detector.js";

describe("local language detection", () => {
  it("maps detected ISO language codes to configured BCP 47 locale tags", async () => {
    const detector = new FrancLanguageDetector(["en", "am", "om", "fr-CA"]);

    await expect(
      detector.detect(
        "Bonjour, comment puis-je organiser mes études et apprendre une nouvelle leçon chaque jour?",
      ),
    ).resolves.toMatchObject({
      language: "fr-CA",
      confidence: expect.any(Number),
    });
  });

  it("returns no guess for short text or a language without a locale pack", async () => {
    const detector = new FrancLanguageDetector(["en", "am", "om"]);

    await expect(detector.detect("OK?")).resolves.toBeNull();
    await expect(
      detector.detect(
        "Bonjour, comment puis-je organiser mes études et apprendre une nouvelle leçon chaque jour?",
      ),
    ).resolves.toBeNull();
  });

  it("reports confidence and alternatives for a supported Amharic question", async () => {
    const detector = new FrancLanguageDetector(["en", "am", "om"]);

    const result = await detector.detect(
      "እንዴት የትምህርት ዕቅድ አዘጋጅቼ የእያንዳንዱን ርዕስ በየቀኑ መማር እችላለሁ?",
    );

    expect(result?.language).toBe("am");
    expect(result?.confidence).toBeGreaterThan(0.25);
    expect(result?.alternatives).toEqual(expect.any(Array));
  });
});
