// Requirements: FR-TUTOR-09, FR-JOB-07, AR-05.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseJobPostingPassages } from "../src/job-posting.js";

describe("schema.org JobPosting passages", () => {
  it("extracts the sample job needed for grounded job answers", () => {
    const posting = JSON.parse(
      readFileSync(
        path.resolve("content/sample-jobs/sample-job.jsonld"),
        "utf8",
      ),
    ) as unknown;
    const result = parseJobPostingPassages(posting, { lang: "en" });

    expect(result.errors).toEqual([]);
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]?.sourceType).toBe("job");
    expect(result.passages[0]?.text).toContain("English is not required");
  });

  it("extracts a cited job passage from JSON-LD with stable identifiers", () => {
    const posting = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      "@id": "https://jobs.example/openings/teacher#posting",
      url: "https://jobs.example/openings/teacher",
      title: "Community Tutor",
      description: "Teach foundational skills. Support adult learners.",
      datePosted: "2026-10-01",
      validThrough: "2026-12-01",
      hiringOrganization: { name: "Learning Centre" },
      jobLocation: {
        address: { addressLocality: "Addis Ababa", addressCountry: "ET" },
      },
    };

    const result = parseJobPostingPassages(posting, { lang: "en" });

    expect(result.errors).toEqual([]);
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]).toMatchObject({
      id: expect.stringMatching(/^job-[a-f0-9]{16}$/u),
      lessonId: expect.stringMatching(/^job-[a-f0-9]{16}$/u),
      lessonTitle: "Community Tutor",
      sectionTitle: "Community Tutor",
      url: posting.url,
      lang: "en",
      sourceType: "job",
    });
    expect(result.passages[0]?.text).toContain("Community Tutor");
    expect(result.passages[0]?.text).toContain("Addis Ababa");
    expect(result.passages[0]?.text).toContain("2026-12-01");
    expect(result.passages[0]?.text).toContain("Teach foundational skills.");

    const repeated = parseJobPostingPassages(posting, { lang: "en" });
    expect(repeated.passages[0]?.id).toBe(result.passages[0]?.id);
  });

  it("handles @graph imports and reports invalid items without discarding valid postings", () => {
    const result = parseJobPostingPassages(
      {
        "@graph": [
          {
            "@type": "JobPosting",
            url: "https://jobs.example/one",
            title: "Library Assistant",
            description: "Help visitors.",
            datePosted: "2026-10-01",
            hiringOrganization: { name: "Library" },
            jobLocation: { address: { addressLocality: "Hawassa" } },
          },
          {
            "@type": "JobPosting",
            url: "https://jobs.example/invalid",
            description: "Missing required posting fields.",
          },
        ],
      },
      { lang: "om" },
    );

    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]?.lang).toBe("om");
    expect(result.errors).toEqual([
      { index: 1, reason: "invalid_job_posting" },
    ]);
  });

  it("does not create passages for non-JobPosting objects or unsafe citation URLs", () => {
    const result = parseJobPostingPassages(
      [
        { "@type": "Organization", name: "Not a posting" },
        {
          "@type": "JobPosting",
          url: "javascript:alert(1)",
          title: "Unsafe link",
          description: "No",
          datePosted: "2026-10-01",
          hiringOrganization: { name: "Unknown" },
          jobLocation: { address: { addressLocality: "Dire Dawa" } },
        },
      ],
      { lang: "en" },
    );

    expect(result.passages).toEqual([]);
    expect(result.errors).toEqual([
      { index: 0, reason: "unsupported_type" },
      { index: 1, reason: "invalid_job_posting" },
    ]);
  });
});
