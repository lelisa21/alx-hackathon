import { describe, expect, it } from "vitest";
import { sourceHash, toPassages } from "../src/ingest.js";
import { confidence, queryTokens, textGrams, wordGrams } from "../src/grams.js";
import { normalise } from "../src/normalise.js";
import { replaceContent } from "../src/repository.js";
import { rankPassages } from "../src/search.js";
import type { ContentPool } from "../src/repository.js";

describe("WP03 grounding", () => {
  it("chunks Markdown into bounded, citable passages", () => {
    const body = Array.from({ length: 301 }, (_, index) => `word${index}`).join(
      " ",
    );
    const passages = toPassages({
      lessonId: "study-plan",
      content: `# Study plan\n\n## First steps\n\n${body}`,
      format: "markdown",
      baseUrl: "https://course.example/lessons/",
      lang: "en",
    });

    expect(passages).toHaveLength(2);
    expect(passages[0]).toMatchObject({
      lessonTitle: "Study plan",
      sectionTitle: "First steps",
      anchor: "first-steps",
      url: "https://course.example/lessons/study-plan#first-steps",
    });
    expect(passages[0]?.text.split(/\s+/u)).toHaveLength(300);
    expect(passages[1]?.text).toBe("word300");
  });

  it("rejects unheaded Markdown content that cannot produce a citation anchor", () => {
    expect(() =>
      toPassages({
        lessonId: "study-plan",
        content: "This lesson has no heading.",
        format: "markdown",
        baseUrl: "https://course.example/lessons/",
        lang: "en",
      }),
    ).toThrow(/heading/u);
  });

  it("ingests HTML headings and paragraphs with source anchors", () => {
    const passages = toPassages({
      lessonId: "study-plan",
      content:
        '<h1>Study plan</h1><h2 id="first-steps">First steps</h2><p>Set one goal.</p>',
      format: "html",
      baseUrl: "https://course.example/lessons/",
      lang: "en",
    });

    expect(passages[0]).toMatchObject({
      sectionTitle: "First steps",
      anchor: "first-steps",
      url: "https://course.example/lessons/study-plan#first-steps",
      text: "Set one goal.",
    });
  });

  it("rejects HTML sections without a rendered heading id", () => {
    expect(() =>
      toPassages({
        lessonId: "study-plan",
        content: "<h1>Study plan</h1><h2>First steps</h2><p>Set one goal.</p>",
        format: "html",
        baseUrl: "https://course.example/lessons/",
        lang: "en",
      }),
    ).toThrow(/heading id/u);
  });

  it("normalises Ethiopic row variants and word punctuation for search only", () => {
    expect(normalise("ኀ", "am")).toBe(normalise("ሀ", "am"));
    const alternateSyllables = Array.from({ length: 8 }, (_, index) =>
      String.fromCodePoint(0x1220 + index),
    ).join("");
    const canonicalSyllables = Array.from({ length: 8 }, (_, index) =>
      String.fromCodePoint(0x1230 + index),
    ).join("");
    expect(normalise(alternateSyllables, "am")).toBe(
      normalise(canonicalSyllables, "am"),
    );
    expect(normalise("ሐ ሠ ዐ ፀ፡", "am")).toBe("ሀ ሰ አ ጸ");
    const results = rankPassages(
      "ሰራ",
      "am",
      [
        {
          id: "work-lesson",
          text: "ሥራ",
          textNorm: normalise("ሥራ", "am"),
          label: "Work / Introduction",
          url: "https://course.example/work#introduction",
          lang: "am",
          sourceType: "course",
        },
      ],
      [],
    );
    expect(results[0]?.id).toBe("work-lesson");
    expect(results[0]?.score).toBeGreaterThan(0.8);
  });

  it("normalises Oromo apostrophe variants and ignores apostrophes", () => {
    expect(normalise("BA’E", "om")).toBe(normalise("bae", "om"));
    expect(normalise("ba'e", "om")).toBe(normalise("bae", "om"));
  });

  it("builds Unicode character trigrams and excludes one-character query tokens", () => {
    expect(wordGrams("ሀ")).toEqual([" ሀ "]);
    expect(textGrams("ሀ ለ")).toContain(" ለ ");
    expect(queryTokens("ሀ ለም ሰላም")).toEqual(["ለም", "ሰላም"]);
  });

  it("scores passages in the range 0..1 and returns the best five", () => {
    const passages = Array.from({ length: 6 }, (_, index) => ({
      id: `passage-${index}`,
      text: "A study plan sets a learning goal.",
      textNorm: "a study plan sets a learning goal",
      label: `Lesson / section ${index}`,
      url: `https://course.example/lessons/lesson#section-${index}`,
      lang: "en",
      sourceType: "course" as const,
    }));

    const results = rankPassages("study plan", "en", passages, []);

    expect(results).toHaveLength(5);
    expect(results[0]?.score).toBeGreaterThan(0);
    expect(results.every(({ score }) => score >= 0 && score <= 1)).toBe(true);
    expect(
      confidence(["study", "plan"], "study plan sets goals"),
    ).toBeGreaterThan(0.8);
  });

  it("expands an Amharic question to matching English course terms", () => {
    const results = rankPassages(
      "ትምህርት እቅድ",
      "am",
      [
        {
          id: "lesson-study-plan",
          text: "A study plan helps organize learning.",
          textNorm: "a study plan helps organize learning",
          label: "Study plan / Introduction",
          url: "https://course.example/lessons/study-plan#introduction",
          lang: "en",
          sourceType: "course",
        },
      ],
      [
        { en: "study plan", am: "ትምህርት እቅድ" },
        { en: "learning", am: "ትምህርት" },
      ],
    );

    expect(results[0]?.id).toBe("lesson-study-plan");
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it("hashes the complete source deterministically, including URL and language", () => {
    const docs = [
      { name: "b.md", content: "Second" },
      { name: "a.md", content: "First" },
    ];

    expect(sourceHash(docs)).toBe(sourceHash([...docs].reverse()));
    expect(sourceHash(docs, { lang: "en" })).not.toBe(
      sourceHash(docs, { lang: "am" }),
    );
    expect(sourceHash(docs, { baseUrl: "https://one.example/" })).not.toBe(
      sourceHash(docs, { baseUrl: "https://two.example/" }),
    );
  });

  it("replaces passages and invalidates cached replies in one transaction", async () => {
    const statements: string[] = [];
    const pool: ContentPool = {
      connect: async () => ({
        query: async (text) => {
          statements.push(text.trim());
          return { rows: [] };
        },
        release: () => undefined,
      }),
    };
    const passages = toPassages({
      lessonId: "study-plan",
      content: "# Study plan\n\nChoose one goal.",
      format: "markdown",
      baseUrl: "https://course.example/lessons/",
      lang: "en",
    });

    await replaceContent(
      pool,
      passages,
      sourceHash([{ name: "lesson.md", content: "Choose one goal." }]),
    );

    expect(statements[0]).toBe("BEGIN");
    expect(statements.some((sql) => sql.includes("DELETE FROM passage"))).toBe(
      true,
    );
    expect(
      statements.some((sql) => sql.includes("DELETE FROM answer_cache")),
    ).toBe(true);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("rolls back a failed content replacement", async () => {
    const statements: string[] = [];
    const pool: ContentPool = {
      connect: async () => ({
        query: async (text) => {
          statements.push(text.trim());
          if (text.includes("INSERT INTO passage")) {
            throw new Error("insert failed");
          }
          return { rows: [] };
        },
        release: () => undefined,
      }),
    };

    await expect(
      replaceContent(
        pool,
        toPassages({
          lessonId: "study-plan",
          content: "# Study plan\n\nChoose one goal.",
          format: "markdown",
          baseUrl: "https://course.example/lessons/",
          lang: "en",
        }),
        sourceHash([{ name: "lesson.md", content: "Choose one goal." }]),
      ),
    ).rejects.toThrow("insert failed");
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });
});
