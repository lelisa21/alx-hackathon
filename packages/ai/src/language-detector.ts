import { francAll } from "franc";
import { iso6393 } from "iso-639-3";
import type { LanguageDetection, LanguageDetector } from "@dimts/engine";

export class FrancLanguageDetector implements LanguageDetector {
  private readonly languageTags = new Map<string, string>();

  constructor(supportedLanguages: string[]) {
    for (const language of supportedLanguages) {
      const primary = language.split("-")[0]?.toLowerCase();
      if (!primary) continue;
      const entry = iso6393.find(
        ({ iso6391, iso6393: code }) => iso6391 === primary || code === primary,
      );
      if (entry && !this.languageTags.has(entry.iso6393)) {
        this.languageTags.set(entry.iso6393, language);
      }
    }

    for (const language of supportedLanguages) {
      const primary = language.split("-")[0]?.toLowerCase();
      if (!primary) continue;
      const entry = iso6393.find(
        ({ iso6391, iso6393: code }) => iso6391 === primary || code === primary,
      );
      if (entry && primary === language.toLowerCase()) {
        this.languageTags.set(entry.iso6393, language);
      }
    }
  }

  async detect(text: string): Promise<LanguageDetection | null> {
    const candidates = francAll(text);
    const best = candidates[0];
    if (!best || best[0] === "und") return null;

    const language = this.languageTags.get(best[0]);
    if (!language) return null;

    const secondScore = candidates[1]?.[1] ?? 0;
    const confidence = Math.max(0, Math.min(1, best[1] - secondScore));
    const alternatives = candidates.slice(1, 6).flatMap(([code, score]) => {
      const alternative = this.languageTags.get(code);
      return alternative ? [{ language: alternative, confidence: score }] : [];
    });

    return { language, confidence, alternatives };
  }
}
