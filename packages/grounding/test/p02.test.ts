// FR-TUTOR-07/09, AR-06: only reviewed mappings supplied by the caller enable cross-language retrieval.
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { rankPassages } from "../src/search.js";
import { PostgresGrounding } from "../src/repository.js";
import { parseJobPostingPassages } from "../src/job-posting.js";

const candidate = {
  id: "p",
  text: "study plan",
  textNorm: "study plan",
  label: "Study",
  url: "https://example.test/study",
  lang: "en",
  sourceType: "course" as const,
};
const posting = {
  "@type": "JobPosting",
  url: "https://jobs.example/one",
  title: "Tutor",
  description: "Help learners.",
  datePosted: "2026-10-01",
  validThrough: "2026-12-01",
  hiringOrganization: { name: "School" },
  jobLocation: { address: { addressLocality: "Hawassa" } },
};

describe("P02 grounding contracts", () => {
  it("does not retrieve foreign-language passages without a matching reviewed mapping", () => {
    expect(rankPassages("study plan", "om", [candidate], [])).toEqual([]);
    expect(
      rankPassages(
        "study plan",
        "om",
        [candidate],
        [{ en: "water", om: "bishaan" }],
      ),
    ).toEqual([]);
  });
  it("prioritizes relevant same-language passages before mapped cross-language candidates", () => {
    const results = rankPassages(
      "karoora",
      "om",
      [candidate, { ...candidate, id: "om", lang: "om", textNorm: "karoora" }],
      [{ en: "study plan", om: "karoora" }],
    );
    expect(results.map(({ id }) => id)).toEqual(["om", "p"]);
    expect(results.map(({ score }) => score)).toEqual([1, 1]);
  });
  it("filters SQL candidate languages before its bounded candidate limit", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await new PostgresGrounding({ query } as unknown as Pool).search(
      "study plan",
      "om",
    );
    expect(query.mock.calls[0]?.[0]).toMatch(/p\.lang = ANY/);
    expect(query.mock.calls[0]?.[1]).toContainEqual(["om"]);
  });
  it.each(["2026-02-30", "2026-13-01", "tomorrow", "01/02/2026"])(
    "rejects invalid/non-ISO job dates (%s) without leaking their contents",
    (datePosted) => {
      const result = parseJobPostingPassages(
        [posting, { ...posting, datePosted }],
        { lang: "en" },
      );
      expect(result.errors).toEqual([
        { index: 1, reason: "invalid_job_posting" },
      ]);
      expect(result.passages).toHaveLength(1);
    },
  );
  it.each([
    "title",
    "description",
    "datePosted",
    "url",
    "hiringOrganization",
    "jobLocation",
  ])("requires JobPosting %s", (key) => {
    expect(
      parseJobPostingPassages({ ...posting, [key]: null }, { lang: "en" })
        .errors,
    ).toEqual([{ index: 0, reason: "invalid_job_posting" }]);
  });
  it("keeps provenance and stable IDs across description revisions, while stripping executable markup", () => {
    const result = parseJobPostingPassages(
      {
        "@graph": [
          {
            ...posting,
            "@type": ["Thing", "https://schema.org/JobPosting"],
            description: "<script>secret()</script><p>Updated duties.</p>",
          },
        ],
      },
      { lang: "en" },
    );
    expect(result.passages[0]?.id).toBe(
      parseJobPostingPassages(posting, { lang: "en" }).passages[0]?.id,
    );
    expect(result.passages[0]?.url).toBe(posting.url);
    expect(result.passages[0]?.text).not.toContain("secret");
    expect(result.passages[0]?.text).toContain("Updated duties.");
  });
  it("keeps complete JobPosting metadata units sentence-delimited for extractive replies without invented labels", () => {
    const passage = parseJobPostingPassages(posting, { lang: "en" })
      .passages[0]!;
    expect(passage.text.split("\n").slice(0, 3)).toEqual([
      "Tutor.",
      "School.",
      "Hawassa.",
    ]);
    expect(passage.text).toContain(posting.description);
    expect(passage.text).toContain("2026-12-01.");
  });
});
