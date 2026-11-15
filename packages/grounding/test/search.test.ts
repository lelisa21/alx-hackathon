import { describe, expect, it } from "vitest";
import {
  expandTokens,
  rankPassages,
  retrievalLanguages,
} from "../src/search.js";
import type { SearchCandidate } from "../src/search.js";

const candidate = (
  overrides: Partial<SearchCandidate> & Pick<SearchCandidate, "id" | "lang">,
): SearchCandidate => ({
  id: overrides.id,
  lang: overrides.lang,
  text: overrides.text ?? "A study plan helps learning.",
  textNorm: overrides.textNorm ?? "a study plan helps learning",
  label: overrides.label ?? "Course / Study plan",
  url: overrides.url ?? "https://course.example/study-plan",
  sourceType: overrides.sourceType ?? "course",
  ...(overrides.timestamp === undefined
    ? {}
    : { timestamp: overrides.timestamp }),
});

describe("multilingual grounding search", () => {
  it("allows only base-language glossary matches and non-empty reviewed forms", () => {
    const glossary = [
      { en: "learning plan", am: "የትምህርት ዕቅድ", om: "karoora barnootaa" },
      { en: "   ", am: "unmatched term" },
      { en: "job", am: "" },
    ];

    expect(retrievalLanguages("learning plan", "en-US", glossary)).toEqual([
      "en-US",
      "en",
      "am",
      "om",
    ]);
    expect(retrievalLanguages("learning goals", "en", glossary)).toEqual([
      "en",
    ]);
  });

  it("expands matching query terms using the selected language or a known form", () => {
    expect(
      expandTokens(["learning", "plan"], "en-GB", [
        { en: "learning plan", am: "የትምህርት ዕቅድ" },
        { en: "career", am: "ሙያ", om: "ogummaa" },
      ]),
    ).toContain("እቅድ");

    expect(
      expandTokens(["career"], "xx", [
        { am: "career", om: "ogummaa", en: "   " },
      ]),
    ).toEqual(["career", "ogummaa"]);
    expect(
      expandTokens(["unrelated"], "en", [{ en: "study plan", am: "ዕቅድ" }]),
    ).toEqual(["unrelated"]);
  });

  it("filters unapproved source languages and preserves unmapped query terms", () => {
    const results = rankPassages(
      "study plan tomorrow",
      "en",
      [
        candidate({
          id: "translated",
          lang: "am",
          text: "የትምህርት ዕቅድ tomorrow",
          textNorm: "የትምህርት ዕቅድ tomorrow",
        }),
        candidate({ id: "unapproved", lang: "om" }),
      ],
      [{ en: "study plan", am: "የትምህርት ዕቅድ" }],
    );

    expect(results.map(({ id }) => id)).toEqual(["translated"]);
    expect(results[0]?.score).toBeGreaterThan(0);
    expect(
      rankPassages("?!", "en", [candidate({ id: "empty", lang: "en" })], []),
    ).toEqual([]);
  });

  it("uses deterministic language and ID tie-breaking and bounds result limits", () => {
    const candidates = [
      candidate({ id: "b-english", lang: "en" }),
      candidate({ id: "a-english", lang: "en", timestamp: 12 }),
      candidate({ id: "amharic", lang: "am" }),
    ];
    const glossary = [{ en: "study plan", am: "study plan" }];

    const ranked = rankPassages("study plan", "en", candidates, glossary, 10);
    expect(ranked.map(({ id }) => id)).toEqual([
      "a-english",
      "b-english",
      "amharic",
    ]);
    expect(ranked[0]).toHaveProperty("timestamp", 12);
    expect(
      rankPassages("study plan", "en", candidates, glossary, 1.8),
    ).toHaveLength(1);
    expect(rankPassages("study plan", "en", candidates, glossary, -1)).toEqual(
      [],
    );
  });
});
