import { describe, expect, it } from "vitest";
import {
  countSms,
  normalizeForSms,
  normalizeSmsKeyword,
  paginateSms,
} from "../src/segments.js";

describe("FR-SMS-03/04/12 exact transmitted encoding and continuation", () => {
  it.each([
    ["a".repeat(160), "gsm7", 160, 1],
    ["a".repeat(161), "gsm7", 161, 2],
    ["a".repeat(306), "gsm7", 306, 2],
    ["a".repeat(307), "gsm7", 307, 3],
    ["ሀ".repeat(70), "ucs2", 70, 1],
    ["ሀ".repeat(71), "ucs2", 71, 2],
    ["ሀ".repeat(134), "ucs2", 134, 2],
    ["^{}\\[~]|€\f", "gsm7", 20, 1],
    ["^".repeat(81), "gsm7", 162, 2],
    ["🙂".repeat(36), "ucs2", 72, 2],
    ["", "gsm7", 0, 1],
  ])("counts %s", (text, encoding, units, segments) => {
    expect(countSms(String(text))).toMatchObject({ encoding, units, segments });
  });
  it("normalizes only SMS quotes and keyword comparisons, preserving source text", () => {
    const source = "‘Afaan’ “Oromoo”";
    expect(normalizeForSms(source)).toBe("'Afaan' \"Oromoo\"");
    expect(countSms(source).encoding).toBe("gsm7");
    expect(source).toBe("‘Afaan’ “Oromoo”");
    expect(normalizeSmsKeyword("  HÉLP  ")).toBe("help");
    expect(normalizeSmsKeyword("Ba’e")).toBe(normalizeSmsKeyword("ba'e"));
  });
  it.each(["en", "om", "am"])(
    "paginates %s sentences, including the localized more line within budget",
    (lang) => {
      const sentence =
        lang === "am"
          ? "ይህ አጭር አረፍተ ነገር ነው።"
          : "This is one complete sentence.";
      const more = lang === "am" ? "ለተጨማሪ 1 ይላኩ።" : "Reply 1 for more.";
      const pages = paginateSms(
        Array(22).fill(sentence).join(" "),
        lang,
        more,
        3,
      );
      expect(pages.length).toBeGreaterThan(1);
      for (const page of pages)
        expect(countSms(page).segments).toBeLessThanOrEqual(3);
      for (const page of pages.slice(0, -1)) {
        expect(page.endsWith(more)).toBe(true);
        expect(page.slice(0, -more.length).trim()).toMatch(/[.።]$/u);
      }
      expect(pages.at(-1)).not.toContain(more);
    },
  );
  it("bounds pathological input and makes progress without breaking surrogate pairs", () => {
    const pages = paginateSms("🙂".repeat(1000), "en", "More: 1", 3, 4);
    expect(pages).toHaveLength(4);
    expect(pages.at(-1)).not.toContain("More: 1");
    for (const page of pages) {
      expect(countSms(page).segments).toBeLessThanOrEqual(3);
      expect(page.isWellFormed()).toBe(true);
    }
    expect(() => paginateSms("x", "en", "more", 0)).toThrow();
  });
});
