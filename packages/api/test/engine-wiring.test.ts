// P02 FR-TUTOR-07/08, AR-06: reviewed glossary authorization and whole-term matching.
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadPacks } from "@dimts/locales-tools";
import { createEngineDependencies } from "../src/engine.js";
import type { ApiConfig } from "../src/config.js";

function fixture() {
  const packs = loadPacks(resolve("locales"));
  const pack = packs.get("om")!;
  pack.glossary = [
    {
      id: "learn",
      en: "learning goal",
      am: "የትምህርት ግብ",
      om: "kaayyoo barumsaa",
      fr: "objectif d'apprentissage",
      simple_definition: "A short learning goal.",
      do_not_translate: false,
    },
  ];
  const search = vi.fn(async () => []);
  const deps = createEngineDependencies({
    packs,
    grounding: { search, currentVersion: async () => "version" },
    providerRuntime: {
      activeProvider: "offline",
      providerOrder: ["offline"],
      answer: vi.fn(),
    },
    config: {
      DIMTS_CONFIDENCE_FLOOR: 0.6,
      DIMTS_LANGUAGE_DETECTION_CONFIDENCE: 0.8,
    } as ApiConfig,
  });
  return { packs, pack, search, deps };
}

describe("API engine locale wiring", () => {
  it.each([
    {
      status: "draft",
      reviewed_by: "Test fixture reviewer",
      reviewed_on: "2026-01-01",
    },
    { status: "beta", reviewed_by: null, reviewed_on: null },
    { status: "beta", reviewed_by: "TODO", reviewed_on: "2026-01-01" },
    {
      status: "beta",
      reviewed_by: "Test fixture reviewer",
      reviewed_on: "2099-01-01",
    },
    {
      status: "beta",
      reviewed_by: "Test fixture reviewer",
      reviewed_on: "2026-02-30",
    },
  ] as const)(
    "does not authorize cross-language retrieval from unreviewed/invalid metadata %#",
    async (metadata) => {
      const { pack, search, deps } = fixture();
      Object.assign(pack.meta, metadata);
      await deps.search("kaayyoo barumsaa", "om");
      expect(search).toHaveBeenCalledWith("kaayyoo barumsaa", "om", []);
    },
  );
  it("passes reviewed mappings with additional language keys, without definitions or entry IDs", async () => {
    const { pack, search, deps } = fixture();
    Object.assign(pack.meta, {
      status: "beta",
      reviewed_by: "Test fixture reviewer",
      reviewed_on: "2026-01-01",
    });
    await deps.search("kaayyoo barumsaa", "om");
    expect(search).toHaveBeenCalledWith("kaayyoo barumsaa", "om", [
      {
        en: "learning goal",
        am: "የትምህርት ግብ",
        om: "kaayyoo barumsaa",
        fr: "objectif d'apprentissage",
      },
    ]);
  });
  it("matches complete normalized glossary terms rather than substrings or unrelated single words", () => {
    const { pack, deps } = fixture();
    expect(deps.glossaryFor("kaayyoo?", "om")).toEqual([]);
    expect(deps.glossaryFor("kaayyoo barumsaa?", "om")).toEqual([
      { term: "kaayyoo barumsaa", meaning: "A short learning goal." },
    ]);
    pack.glossary = [
      { en: "goal", om: "kaayyoo", simple_definition: "One goal." },
      { en: "school", om: "barnoota", simple_definition: "Learning." },
    ];
    expect(deps.glossaryFor("kaay", "om")).toEqual([]);
    expect(deps.glossaryFor("kaayyoo!", "om")).toHaveLength(1);
  });
  it("accepts Oromo apostrophe and Amharic search variants without rewriting displayed glossary terms", () => {
    const { packs, deps } = fixture();
    packs.get("om")!.glossary = [
      { en: "work", om: "hojii'gaarii", simple_definition: "Good work." },
    ];
    expect(deps.glossaryFor("hojii’gaarii?", "om")[0]?.term).toBe(
      "hojii'gaarii",
    );
    packs.get("am")!.glossary = [
      { en: "work", am: "ሥራ", simple_definition: "Work." },
    ];
    expect(deps.glossaryFor("ስራ", "am")[0]?.term).toBe("ሥራ");
  });
  it("formats cross-language explanation variables while preserving the source code when no name is known", () => {
    const { deps } = fixture();
    expect(
      deps.translate("en", "from.other", { lang: "om", section: "Study" }),
    ).toContain("Afaan Oromoo");
    expect(
      deps.translate("en", "from.other", { lang: "fr", section: "Study" }),
    ).toContain("fr");
    expect(
      deps.translate("en", "from.other", { lang: "om", section: "Study" }),
    ).toContain("Study");
  });
});
