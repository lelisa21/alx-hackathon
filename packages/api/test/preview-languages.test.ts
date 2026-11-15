// FR-LANG: a host can publish unreviewed language packs as beta without
// faking review metadata or unlocking review-gated features.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPacks } from "@bridgely/locales-tools";
import { parseConfig } from "../src/config.js";
import { withPreviewLanguages } from "../src/preview-languages.js";
import { getVoiceCapabilities } from "../src/voice-capabilities.js";

const packs = loadPacks(resolve("locales"));
const base = {
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
 ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
 HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
 JWT_SECRET: Buffer.alloc(32, 3).toString("base64"),
 CRON_SECRET: "a-cron-secret-that-is-long-enough",
};

describe("PREVIEW_LANGS", () => {
  it("parses a comma list and defaults to none", () => {
    expect(parseConfig(base).PREVIEW_LANGS).toEqual([]);
    expect(
      parseConfig({ ...base,PREVIEW_LANGS: " am, om ," })
        .PREVIEW_LANGS,
    ).toEqual(["am", "om"]);
    expect(() =>
      parseConfig({ ...base,PREVIEW_LANGS: "am,<script>" }),
    ).toThrow();
  });

  it("publishes only the listed draft packs as beta", () => {
    expect(packs.get("am")?.meta.status).toBe("draft");
    expect(packs.get("ti")?.meta.status).toBe("draft");
    const preview = withPreviewLanguages(packs, ["am", "om", "ti"]);
    expect(preview.get("am")?.meta.status).toBe("beta");
    expect(preview.get("om")?.meta.status).toBe("beta");
    expect(preview.get("ti")?.meta.status).toBe("beta");
    expect(preview.get("ar-test")?.meta.status).toBe("draft");
    // The loaded packs are not mutated.
    expect(packs.get("am")?.meta.status).toBe("draft");
  });

  it("publishes an explicitly public-preview pack without unlocking review gates", () => {
    const ti = withPreviewLanguages(packs, []).get("ti")!;

    expect(ti.meta).toMatchObject({
      status: "beta",
      public_preview: true,
      reviewed_by: null,
      reviewed_on: null,
      stt: false,
      tts: false,
    });
    expect(
      getVoiceCapabilities(ti, {
        STT_ENGINE: "browser",
        TTS_ENGINE: "browser",
      }),
    ).toEqual({ stt: false, tts: false, voice: null });
  });

  it("keeps review metadata, so voice stays gated", () => {
    const preview = withPreviewLanguages(packs, ["am"]);
    const am = preview.get("am")!;
    expect(am.meta.reviewed_by).toBeNull();
    expect(
      getVoiceCapabilities(am, {
       STT_ENGINE: "browser",
       TTS_ENGINE: "browser",
      }),
    ).toEqual({ stt: false, tts: false, voice: null });
  });

  it("keeps Tigrinya reviewer and voice gates in preview", () => {
    const ti = withPreviewLanguages(packs, ["ti"]).get("ti")!;
    expect(ti.meta).toMatchObject({
      status: "beta",
      reviewed_by: null,
      reviewed_on: null,
      stt: false,
      tts: false,
    });
    expect(
      getVoiceCapabilities(ti, {
       STT_ENGINE: "browser",
       TTS_ENGINE: "browser",
      }),
    ).toEqual({ stt: false, tts: false, voice: null });
  });

  it("rejects unknown codes instead of silently ignoring them", () => {
    expect(() => withPreviewLanguages(packs, ["xx"])).toThrow(/xx/u);
  });

  it("returns the same map when nothing is requested", () => {
    const noPublicPreview = new Map(
      [...packs].map(([code, pack]) => [
        code,
        { ...pack, meta: { ...pack.meta, public_preview: false } },
      ]),
    );
    expect(withPreviewLanguages(noPublicPreview, [])).toBe(noPublicPreview);
  });
});
