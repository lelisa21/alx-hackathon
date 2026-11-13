// FR-VOICE-01/02/12, FR-LANG-05, NFR-A11Y-07: advertise only reviewed, configured voice.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadPacks } from "@dimts/locales-tools";
import type { LangPack } from "@dimts/locales-tools";
import { parseConfig } from "../src/config.js";
import { createCoreRouter } from "../src/routes/core.js";
import { LanguageListSchema, LanguageSchema } from "../src/schemas.js";
import { generateOpenApiYaml } from "../src/openapi.js";
import type { ApiRepository } from "../src/types.js";

const packs = loadPacks(resolve("locales"));
const environment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost/test",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "a-long-test-signing-secret-with-32-characters",
  DIMTS_CRON_SECRET: "a-long-test-cron-secret-with-24-characters",
};
const browserEngines = {
  DIMTS_STT_ENGINE: "browser",
  DIMTS_TTS_ENGINE: "browser",
};
const unavailable = { stt: false, tts: false, voice: null };
const browserVoice = { engine: "browser", bcp_tag: "en-US" };

function reviewed(): LangPack {
  const pack = structuredClone(packs.get("en")!);
  pack.meta = {
    ...pack.meta,
    stt: true,
    tts: true,
    reviewed_by: "Language reviewer fixture",
    reviewed_on: "2026-01-01",
  };
  pack.voice = { ...browserVoice };
  return pack;
}

function application(
  currentPacks = new Map([["en", reviewed()]]),
  engines: Record<string, unknown> = browserEngines,
) {
  const app = express();
  app.use(
    "/v1",
    createCoreRouter({
      config: parseConfig({ ...environment, ...engines }),
      repository: {} as ApiRepository,
      packs: currentPacks,
    }),
  );
  return app;
}

async function language(pack = reviewed(), engines = browserEngines) {
  const result = await request(
    application(new Map([[pack.meta.code, pack]]), engines),
  ).get("/v1/languages?lang_preview=1");
  expect(result.status).toBe(200);
  return result.body.languages[0];
}

describe("P04 engine configuration", () => {
  it("defaults both directions to none and accepts only the supported browser adapter", () => {
    expect(parseConfig(environment)).toMatchObject({
      DIMTS_STT_ENGINE: "none",
      DIMTS_TTS_ENGINE: "none",
    });
    expect(parseConfig({ ...environment, ...browserEngines })).toMatchObject(
      browserEngines,
    );
  });

  it.each(["DIMTS_STT_ENGINE", "DIMTS_TTS_ENGINE"])(
    "rejects unsupported %s at startup without claiming server support",
    (key) => {
      for (const value of ["whisper", "piper", "cloud", "Browser", "", null])
        expect(() => parseConfig({ ...environment, [key]: value })).toThrow(
          key,
        );
    },
  );
});

describe("P04 language capability publication", () => {
  it("requires explicit deployment selection even for a reviewed voice pack", async () => {
    const result = await request(application(undefined, {})).get(
      "/v1/languages",
    );
    expect(result.body.languages[0]).toMatchObject(unavailable);
  });

  it.each(["beta", "live"] as const)(
    "publishes a reviewed %s browser declaration without reviewer identity",
    async (status) => {
      const pack = reviewed();
      pack.meta.status = status;
      const result = await language(pack);
      expect(result).toMatchObject({
        stt: true,
        tts: true,
        voice: browserVoice,
      });
      expect(LanguageSchema.parse(result)).toEqual(result);
      expect(JSON.stringify(result)).not.toContain(pack.meta.reviewed_by);
      expect(JSON.stringify(result)).not.toContain(pack.meta.reviewed_on);
    },
  );

  it.each([
    ["none", "browser", false, true],
    ["browser", "none", true, false],
    ["none", "none", false, false],
  ] as const)(
    "honors independent deployment settings STT=%s and TTS=%s",
    async (sttEngine, ttsEngine, stt, tts) => {
      expect(
        await language(reviewed(), {
          DIMTS_STT_ENGINE: sttEngine,
          DIMTS_TTS_ENGINE: ttsEngine,
        }),
      ).toMatchObject({ stt, tts, voice: stt || tts ? browserVoice : null });
    },
  );

  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])(
    "honors independent approved flags STT=%s and TTS=%s",
    async (stt, tts) => {
      const pack = reviewed();
      pack.meta.stt = stt!;
      pack.meta.tts = tts!;
      expect(await language(pack)).toMatchObject({
        stt,
        tts,
        voice: stt || tts ? browserVoice : null,
      });
    },
  );

  it.each([null, "", " ", "pending", "TODO", "unknown", "none", "tbd"])(
    "does not treat reviewer placeholder %s as voice approval",
    async (reviewer) => {
      const pack = reviewed();
      pack.meta.reviewed_by = reviewer;
      expect(await language(pack)).toMatchObject(unavailable);
    },
  );

  it.each([null, "today", "2026-02-30", "2999-01-01", "2026-1-1"])(
    "requires an actual non-future review date (%s)",
    async (date) => {
      const pack = reviewed();
      pack.meta.reviewed_on = date;
      expect(await language(pack)).toMatchObject(unavailable);
    },
  );

  it("never escalates a draft voice flag through preview", async () => {
    const pack = reviewed();
    pack.meta.status = "draft";
    const app = application(new Map([["en", pack]]));
    expect((await request(app).get("/v1/languages")).body.languages).toEqual(
      [],
    );
    expect(await language(pack)).toMatchObject({
      status: "draft",
      ...unavailable,
    });
  });

  it.each([
    {},
    { engine: null, bcp_tag: null },
    { engine: "whisper", bcp_tag: "en-US" },
    { engine: "browser", bcp_tag: "" },
    { engine: "browser", bcp_tag: "en_US" },
    { engine: "browser", bcp_tag: "am-ET" },
    { engine: "browser", bcp_tag: "en-Cyrl" },
  ])("requires a supported, valid, matching declaration %j", async (voice) => {
    const pack = reviewed();
    pack.voice = voice;
    expect(await language(pack)).toMatchObject(unavailable);
  });

  it("publishes no voice for any shipped pack, including preview", async () => {
    for (const suffix of ["", "?lang_preview=1"]) {
      const result = await request(application(packs)).get(
        `/v1/languages${suffix}`,
      );
      expect(result.status).toBe(200);
      expect(LanguageListSchema.parse(result.body)).toEqual(result.body);
      expect(result.body.languages.length).toBeGreaterThan(0);
      for (const item of result.body.languages)
        expect(item).toMatchObject(unavailable);
    }
  });

  it("does not register imaginary server STT or TTS endpoints", async () => {
    const app = application();
    for (const endpoint of ["stt", "tts"])
      expect((await request(app).post(`/v1/${endpoint}`).send({})).status).toBe(
        404,
      );
    const spec = parse(generateOpenApiYaml());
    expect(spec.paths).not.toHaveProperty("/v1/stt");
    expect(spec.paths).not.toHaveProperty("/v1/tts");
  });

  it("enforces the additive strict declaration schema and keeps generated OpenAPI synced", async () => {
    const value = await language();
    expect(
      LanguageSchema.safeParse({ ...value, voice: undefined }).success,
    ).toBe(false);
    expect(LanguageSchema.safeParse({ ...value, voice: null }).success).toBe(
      false,
    );
    for (const voice of [
      { engine: "server", bcp_tag: "en-US" },
      { engine: "browser", bcp_tag: "en_US" },
      { engine: "browser", bcp_tag: "am-ET" },
      { ...browserVoice, endpoint: "https://voice.example" },
    ])
      expect(LanguageSchema.safeParse({ ...value, voice }).success).toBe(false);
    const generated = generateOpenApiYaml();
    expect(await readFile(resolve("packages/api/openapi.yaml"), "utf8")).toBe(
      generated,
    );
    const schema =
      parse(generated).components.schemas.LanguageList.properties.languages
        .items;
    expect(schema.required).toContain("voice");
    expect(schema.properties.voice).toBeDefined();
  });
});
