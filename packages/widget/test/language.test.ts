import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  matchVoiceNavigationCommand,
  suggestLanguageOptions,
} from "../src/language.js";

const languages = [
  { code: "en", script: "Latn" },
  { code: "am", script: "Ethi" },
  { code: "om", script: "Latn" },
  { code: "ti", script: "Ethi" },
  { code: "so", script: "Latn" },
  { code: "sw", script: "Latn" },
  { code: "ar", script: "Arab" },
  { code: "fr", script: "Latn" },
];
const availableCodes = languages.map((l) => l.code);

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
    expect(suggestLanguageOptions("Hello there", languages.slice(0, 4))).toEqual([
      "om",
      "en",
    ]);
  });

  it("does not suggest a language when matching packs are unavailable", () => {
    expect(suggestLanguageOptions("ሰላም", [languages[0]!])).toEqual([]);
    expect(suggestLanguageOptions("123 !?", languages)).toEqual([]);
  });
});

describe("multilingual language detection", () => {
  it("detects Amharic and Tigrinya from Ethiopic sentences", () => {
    expect(detectLanguage("ይህ ትምህርት ምንድን ነው?", availableCodes)).toBe("am");
    expect(detectLanguage("እዚ ትምህርቲ እንታይ እዩ?", availableCodes)).toBe("ti");
    expect(detectLanguage("ቐዳማይ ክፍሊ", availableCodes)).toBe("ti");
    expect(detectLanguage("አመሰግናለሁ", availableCodes)).toBe("am");
  });

  it("detects Afaan Oromoo with Qubee patterns and words", () => {
    expect(detectLanguage("Akkam jirtu, barnoota kana barachuu barbaada", availableCodes)).toBe("om");
    expect(detectLanguage("Gaaffii qaba, eessa jira?", availableCodes)).toBe("om");
    expect(detectLanguage("ta'e", availableCodes)).toBe("om");
  });

  it("detects Arabic script", () => {
    expect(detectLanguage("مرحبا بك في بريدجلي", availableCodes)).toBe("ar");
    expect(detectLanguage("كيف يمكنني تعلم هذا الدرس؟", availableCodes)).toBe("ar");
  });

  it("detects French with diacritics and keywords", () => {
    expect(detectLanguage("Bonjour, comment puis-je vous aider?", availableCodes)).toBe("fr");
    expect(detectLanguage("Merci beaucoup pour l'aide", availableCodes)).toBe("fr");
  });

  it("detects Swahili with common prefixes and keywords", () => {
    expect(detectLanguage("Habari yako, nataka kujifunza somo hili", availableCodes)).toBe("sw");
    expect(detectLanguage("Asante sana kwa msaada", availableCodes)).toBe("sw");
  });

  it("detects Somali with Somali vocabulary", () => {
    expect(detectLanguage("Sidee ayaad tahay, mahadsanid", availableCodes)).toBe("so");
    expect(detectLanguage("Waa maxay casharkan?", availableCodes)).toBe("so");
  });

  it("detects English for standard queries", () => {
    expect(detectLanguage("What is the next lesson?", availableCodes)).toBe("en");
    expect(detectLanguage("How do I request human help?", availableCodes)).toBe("en");
  });

  it("falls back gracefully when the detected language is not in available languages", () => {
    expect(detectLanguage("مرحبا", ["en", "am", "om"])).toBe("en");
    expect(detectLanguage("Bonjour", ["en", "am", "om"])).toBe("en");
  });
});

describe("voice navigation commands", () => {
  it("matches SMS simulator navigation voice commands", () => {
    expect(matchVoiceNavigationCommand("go to sms")).toEqual({ action: "sms" });
    expect(matchVoiceNavigationCommand("open sms simulator")).toEqual({ action: "sms" });
    expect(matchVoiceNavigationCommand("text message")).toEqual({ action: "sms" });
  });

  it("matches human helper navigation voice commands", () => {
    expect(matchVoiceNavigationCommand("open human help")).toEqual({ action: "helper" });
    expect(matchVoiceNavigationCommand("talk to a person")).toEqual({ action: "helper" });
    expect(matchVoiceNavigationCommand("support assistant")).toEqual({ action: "helper" });
  });

  it("matches Ethiopian sign language visual studio commands", () => {
    expect(matchVoiceNavigationCommand("sign language")).toEqual({ action: "sign" });
    expect(matchVoiceNavigationCommand("open ethsl")).toEqual({ action: "sign" });
    expect(matchVoiceNavigationCommand("gestures")).toEqual({ action: "sign" });
  });

  it("matches settings toggle commands", () => {
    expect(matchVoiceNavigationCommand("open settings")).toEqual({ action: "settings" });
    expect(matchVoiceNavigationCommand("preferences")).toEqual({ action: "settings" });
  });

  it("matches language switch commands", () => {
    expect(matchVoiceNavigationCommand("change language to amharic")).toEqual({
      action: "language",
      lang: "am",
    });
    expect(matchVoiceNavigationCommand("switch to oromo")).toEqual({
      action: "language",
      lang: "om",
    });
    expect(matchVoiceNavigationCommand("speak tigrinya")).toEqual({
      action: "language",
      lang: "ti",
    });
  });

  it("returns null for regular queries", () => {
    expect(matchVoiceNavigationCommand("What is photosynthesis?")).toBeNull();
    expect(matchVoiceNavigationCommand("Help me with chapter two")).toBeNull();
  });
});
