import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatDate,
  formatNumber,
  loadPacks,
  resolveUi,
  resolveVoice,
  toEthiopian,
  translate,
} from "../../packages/locales-tools/src/index.js";
import { normalise } from "../../packages/grounding/src/normalise.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../locales",
);
const packsForTest = () => loadPacks(root);
const fixtureRoots: string[] = [];
afterEach(() =>
  fixtureRoots
    .splice(0)
    .forEach((directory) =>
      rmSync(directory, { recursive: true, force: true }),
    ),
);

describe("P01 FR-LANG-04/05/16/17 locale runtime", () => {
  it("loads extensible data and handles missing/empty files without treating hidden staging folders as packs", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "dimts-runtime-"));
    fixtureRoots.push(directory);
    writeFileSync(path.join(directory, "notes.txt"), "fixture");
    for (const name of [".draft-hidden", "without-meta", "ti"])
      mkdirSync(path.join(directory, name));
    const meta = {
      ...packsForTest().get("en")!.meta,
      code: "ti",
      status: "draft",
    };
    writeFileSync(path.join(directory, "ti/meta.yaml"), JSON.stringify(meta));
    writeFileSync(path.join(directory, "ti/ui.yaml"), "[]\n");
    writeFileSync(path.join(directory, "ti/prompts.yaml"), "\n");
    const packs = loadPacks(directory);
    expect([...packs.keys()]).toEqual(["ti"]);
    expect(packs.get("ti")).toMatchObject({
      meta,
      ui: {},
      prompts: {},
      voice: {},
      glossary: {},
      sms: {},
      faq: {},
      checks: {},
    });
  });

  it("formats ICU variables, plurals and permitted inline text without rewriting display text", () => {
    const packs = packsForTest();
    const pack = packs.get("en")!;
    pack.ui.example =
      "<strong>{name}</strong>: {count, plural, one {# item} other {# items}}";
    expect(
      translate(packs, "en", "example", { name: "A", count: 2 }).text,
    ).toBe("<strong>A</strong>: 2 items");
    expect(
      translate(packs, "en", "example", { name: "B", count: 1 }).text,
    ).toBe("<strong>B</strong>: 1 item");
    for (const [lang, source] of [
      ["om", "Haasa'uu — Haasa’uu"],
      ["am", "ሠላም ሰላም"],
    ]) {
      packs.get(lang!)!.ui.original = source!;
      expect(translate(packs, lang!, "original").text).toBe(source);
      expect(normalise(source!, lang!)).not.toBe(source);
    }
  });

  it("resolves each missing UI key along om to am to en and reports actual sources", () => {
    const packs = packsForTest();
    packs.get("om")!.ui = { own: "Oromo", "transliteration.enable": "enable" };
    packs.get("am")!.ui = {
      middle: "Amharic",
      "transliteration.word.selam": "ሰላም",
      "transliteration.map.se": "ሰ",
    };
    packs.get("en")!.ui = { last: "English", own: "not selected" };
    expect(resolveUi(packs, "om")).toEqual({
      ui: {
        own: "Oromo",
        "transliteration.enable": "enable",
        middle: "Amharic",
        last: "English",
      },
      usedLanguages: ["om", "am", "en"],
      didFallback: true,
    });
    expect(translate(packs, "om", "last")).toEqual({
      text: "English",
      usedLang: "en",
      didFallback: true,
    });
    expect(resolveUi(packs, "am").ui["transliteration.word.selam"]).toBe("ሰላም");
  });

  it("terminates missing keys, unknown languages and cyclic fallback without changing stored packs", () => {
    const packs = packsForTest();
    packs.get("am")!.meta.fallback = "om";
    expect(translate(packs, "om", "missing")).toEqual({
      text: "missing",
      usedLang: "none",
      didFallback: true,
    });
    expect(resolveUi(packs, "unknown")).toEqual({
      ui: {},
      usedLanguages: [],
      didFallback: true,
    });
    const before = JSON.stringify([...packs]);
    resolveUi(packs, "om");
    expect(JSON.stringify([...packs])).toBe(before);
  });

  it("reports no fallback when requested data is present and preserves the literal ICU message in resolved UI", () => {
    const packs = packsForTest();
    const en = packs.get("en")!;
    en.ui = {
      greeting: "{person}: {count, plural, one {# item} other {# items}}",
    };
    expect(resolveUi(packs, "en")).toEqual({
      ui: en.ui,
      usedLanguages: ["en"],
      didFallback: false,
    });
    en.voice = { engine: "fixture", bcp_tag: "en-ET" };
    expect(resolveVoice(packs, "en")).toEqual({
      voice: en.voice,
      usedLang: "en",
      didFallback: false,
    });
    expect(resolveVoice(packs, "unknown")).toEqual({
      voice: null,
      usedLang: "none",
      didFallback: true,
    });
  });

  it("falls through missing or empty voice configuration without changing language or enabling engines", () => {
    const packs = packsForTest();
    packs.get("om")!.voice = { engine: "", bcp_tag: "" };
    packs.get("am")!.voice = { engine: null, bcp_tag: "am-ET" };
    packs.get("en")!.voice = { engine: "fixture", bcp_tag: "en-ET" };
    expect(resolveVoice(packs, "om")).toEqual({
      voice: packs.get("en")!.voice,
      usedLang: "en",
      didFallback: true,
    });
    expect(packs.get("om")!.meta.code).toBe("om");
    expect(packs.get("om")!.meta.tts).toBe(false);
    packs.get("en")!.voice = { engine: null, bcp_tag: null };
    expect(resolveVoice(packs, "om")).toEqual({
      voice: null,
      usedLang: "none",
      didFallback: true,
    });
    packs.get("am")!.meta.fallback = "om";
    expect(resolveVoice(packs, "om").voice).toBeNull();
  });
});

describe("P01 FR-LANG-12 calendar and number formatting", () => {
  it.each([
    ["2026-11-14", { y: 2019, m: 3, d: 5 }],
    ["2026-09-10", { y: 2018, m: 13, d: 5 }],
    ["2026-09-11", { y: 2019, m: 1, d: 1 }],
    ["2027-09-11", { y: 2019, m: 13, d: 6 }],
    ["2027-09-12", { y: 2020, m: 1, d: 1 }],
  ])(
    "converts %s in UTC including Pagume and leap-year boundaries",
    (date, expected) => {
      expect(toEthiopian(new Date(`${date}T23:59:59Z`))).toEqual(expected);
    },
  );

  it("uses pack month names and templates for both calendars, independent of ICU month spelling", () => {
    const packs = packsForTest();
    const date = new Date("2026-11-14T12:00:00Z");
    const am = packs.get("am")!;
    expect(formatDate(date, am.meta, am.ui)).toBe("ህዳር 5 2019 (ኖቬምበር 14 2026)");
    const om = packs.get("om")!;
    expect(formatDate(date, om.meta, om.ui)).toBe(
      "Sadaasa 5 2019 (November 14 2026)",
    );
    const en = packs.get("en")!;
    expect(formatDate(date, en.meta, en.ui)).toBe(
      "November 14 2026 (Hidar 5 2019)",
    );
    const messages = {
      ...am.ui,
      "month.3": "custom",
      "date.ethiopic": "{year}/{month}/{day}",
    };
    expect(formatDate(date, am.meta, messages)).toBe(
      "2019/custom/5 (ኖቬምበር 14 2026)",
    );
    expect(() => formatDate(new Date("invalid"), am.meta, am.ui)).toThrow(
      RangeError,
    );
  });

  it("uses Western digits and locale separators without modifying the value", () => {
    for (const pack of packsForTest().values()) {
      const result = formatNumber(12345.5, pack.meta, pack.ui);
      expect(result.replace(/[^0-9]/gu, "")).toBe("123455");
      expect(result).not.toMatch(/[\u0660-\u0669\u1369-\u137c]/u);
    }
    const pack = packsForTest().get("en")!;
    expect(
      formatNumber(
        12345.5,
        pack.meta,
        {},
        { useGrouping: false, minimumFractionDigits: 2 },
      ),
    ).toBe("12345.50");
  });

  it("fails explicitly for absent format data and uses UTC across an offset midnight", () => {
    const pack = packsForTest().get("en")!;
    const date = new Date("2026-11-15T01:00:00+03:00");
    expect(toEthiopian(date)).toEqual({ y: 2019, m: 3, d: 5 });
    const ui = { ...pack.ui };
    delete ui["date.ethiopic"];
    expect(() => formatDate(date, pack.meta, ui)).toThrow(
      "Missing date format key",
    );
    delete ui["month.3"];
    expect(() => formatDate(date, pack.meta, ui)).toThrow("Missing month key");
  });
});
