// FR-LANG: a host can publish unreviewed Amharic/Oromo packs as beta without
// faking review metadata or unlocking review-gated features.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPacks } from "@dimts/locales-tools";
import { parseConfig } from "../src/config.js";
import { withPreviewLanguages } from "../src/preview-languages.js";
import { getVoiceCapabilities } from "../src/voice-capabilities.js";

const packs = loadPacks(resolve("locales"));
const base = {
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: Buffer.alloc(32, 3).toString("base64"),
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
};

describe("DIMTS_PREVIEW_LANGS", () => {
  it("parses a comma list and defaults to none", () => {
    expect(parseConfig(base).DIMTS_PREVIEW_LANGS).toEqual([]);
    expect(
      parseConfig({ ...base, DIMTS_PREVIEW_LANGS: " am, om ," })
        .DIMTS_PREVIEW_LANGS,
    ).toEqual(["am", "om"]);
    expect(() =>
      parseConfig({ ...base, DIMTS_PREVIEW_LANGS: "am,<script>" }),
    ).toThrow();
  });

  it("publishes only the listed draft packs as beta", () => {
    expect(packs.get("am")?.meta.status).toBe("draft");
    const preview = withPreviewLanguages(packs, ["am", "om"]);
    expect(preview.get("am")?.meta.status).toBe("beta");
    expect(preview.get("om")?.meta.status).toBe("beta");
    expect(preview.get("ar-test")?.meta.status).toBe("draft");
    // The loaded packs are not mutated.
    expect(packs.get("am")?.meta.status).toBe("draft");
  });

  it("keeps review metadata, so voice stays gated", () => {
    const preview = withPreviewLanguages(packs, ["am"]);
    const am = preview.get("am")!;
    expect(am.meta.reviewed_by).toBeNull();
    expect(
      getVoiceCapabilities(am, {
        DIMTS_STT_ENGINE: "browser",
        DIMTS_TTS_ENGINE: "browser",
      }),
    ).toEqual({ stt: false, tts: false, voice: null });
  });

  it("rejects unknown codes instead of silently ignoring them", () => {
    expect(() => withPreviewLanguages(packs, ["xx"])).toThrow(/xx/u);
  });

  it("returns the same map when nothing is requested", () => {
    expect(withPreviewLanguages(packs, [])).toBe(packs);
  });
});
