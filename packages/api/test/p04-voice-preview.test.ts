// FR-VOICE-01/02: developers can try browser voice before the device protocol
// is complete, without ever exposing unreviewed voice in production.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPacks } from "@dimts/locales-tools";
import { parseConfig } from "../src/config.js";
import { getVoiceCapabilities } from "../src/voice-capabilities.js";

const packs = loadPacks(resolve("locales"));
const base = {
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: Buffer.alloc(32, 3).toString("base64"),
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
  DIMTS_STT_ENGINE: "browser",
  DIMTS_TTS_ENGINE: "browser",
};

describe("development voice preview", () => {
  it("keeps unreviewed packs silent without the preview flag", () => {
    const config = parseConfig({ ...base, NODE_ENV: "development" });
    expect(getVoiceCapabilities(packs.get("en")!, config)).toEqual({
      stt: false,
      tts: false,
      voice: null,
    });
  });

  it("enables browser voice with a matching BCP 47 tag in development", () => {
    const config = parseConfig({
      ...base,
      NODE_ENV: "development",
      DIMTS_VOICE_PREVIEW: "true",
    });
    expect(getVoiceCapabilities(packs.get("en")!, config)).toEqual({
      stt: true,
      tts: true,
      voice: { engine: "browser", bcp_tag: "en-US" },
    });
    expect(getVoiceCapabilities(packs.get("am")!, config).voice).toEqual({
      engine: "browser",
      bcp_tag: "am-ET",
    });
  });

  it("still honours a disabled engine", () => {
    const config = parseConfig({
      ...base,
      NODE_ENV: "development",
      DIMTS_VOICE_PREVIEW: "true",
      DIMTS_TTS_ENGINE: "none",
    });
    expect(getVoiceCapabilities(packs.get("en")!, config)).toMatchObject({
      stt: true,
      tts: false,
    });
  });

  it("is rejected outside development", () => {
    expect(() =>
      parseConfig({
        ...base,
        NODE_ENV: "production",
        DIMTS_VOICE_PREVIEW: "true",
      }),
    ).toThrow(/DIMTS_VOICE_PREVIEW/u);
  });
});
