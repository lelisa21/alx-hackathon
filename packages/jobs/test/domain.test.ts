import { describe, expect, it } from "vitest";
import {
  ContactCipher,
  normalizePostings,
  validateAccommodation,
  JobsError,
} from "../src/index.js";

const posting = {
  "@type": "JobPosting",
  title: "Developer",
  description: "Build accessible software.",
  datePosted: "2026-11-01",
  hiringOrganization: {
    name: "Example",
    contactPoint: { email: "jobs@example.org" },
  },
  jobLocation: { address: { addressRegion: "Addis Ababa" } },
  url: "https://example.org/jobs/1",
  employmentType: "FULL_TIME",
  accommodationsOffered: ["written_questions"],
  unknown: "discard me",
};

describe("FR-INT-07/FR-JOB-07 import contract", () => {
  it("preserves parser identity, tolerates unknown fields and reports graph input indices", () => {
    const result = normalizePostings(
      {
        "@graph": [posting, { ...posting, title: null }, { "@type": "Thing" }],
      },
      "en",
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.errors).toEqual([
      { index: 1, reason: "invalid_job_posting" },
      { index: 2, reason: "unsupported_type" },
    ]);
    const job = result.jobs[0]!;
    expect(job.publicJob).toMatchObject({
      title: "Developer",
      organization: "Example",
      region: "Addis Ababa",
      jobType: "FULL_TIME",
      accommodationsOffered: ["written_questions"],
    });
    expect(JSON.stringify(job.publicJob)).not.toContain("jobs@example.org");
    expect(JSON.stringify(job)).not.toContain("discard me");
    expect(job.passage.sourceType).toBe("job");
    expect(normalizePostings(posting, "en").jobs[0]?.publicJob.id).toBe(
      job.publicJob.id,
    );
    expect(normalizePostings(posting, "am").jobs[0]?.publicJob.id).not.toBe(
      job.publicJob.id,
    );
  });
  it("rejects malformed required fields and dates and unsafe employer contacts", () => {
    for (const field of [
      "title",
      "description",
      "datePosted",
      "hiringOrganization",
      "jobLocation",
    ]) {
      expect(
        normalizePostings({ ...posting, [field]: null }, "en").jobs,
      ).toHaveLength(0);
    }
    expect(
      normalizePostings({ ...posting, validThrough: "2026-02-30" }, "en").jobs,
    ).toHaveLength(0);
    const result = normalizePostings(
      {
        ...posting,
        hiringOrganization: {
          name: "Example",
          contactPoint: { email: "a@example.org\r\nBcc:b@example.org" },
        },
      },
      "en",
    );
    expect(result.jobs[0]?.employerEmail).toBeNull();
  });
});

describe("FR-JOB-03/10 contact protection", () => {
  it("encrypts with authenticated random AES-256-GCM and hashes using a separate key", () => {
    const cipher = new ContactCipher(Buffer.alloc(32, 1), Buffer.alloc(32, 2));
    const encrypted = cipher.encrypt("+251900000001", "subscription:a");
    expect(encrypted.includes(Buffer.from("+251900000001"))).toBe(false);
    expect(cipher.decrypt(encrypted, "subscription:a")).toBe("+251900000001");
    expect(cipher.encrypt("+251900000001", "subscription:a")).not.toEqual(
      encrypted,
    );
    expect(() => cipher.decrypt(encrypted, "subscription:b")).toThrow();
    const corrupted = Buffer.from(encrypted);
    corrupted[corrupted.length - 1] ^= 1;
    expect(() => cipher.decrypt(corrupted, "subscription:a")).toThrow();
    expect(cipher.hash("sms", "+251900000001")).toBe(
      cipher.hash("sms", "+251900000001"),
    );
    expect(cipher.hash("sms", "12")).not.toBe(cipher.hash("telegram", "12"));
    expect(
      () => new ContactCipher(Buffer.alloc(8), Buffer.alloc(32)),
    ).toThrow();
  });
});

describe("FR-JOB-04/05 private accommodation inputs", () => {
  it("accepts choices without requiring a name and validates other and dates", () => {
    expect(() =>
      validateAccommodation({ needs: ["written_questions"] }),
    ).not.toThrow();
    expect(() => validateAccommodation({ needs: ["other"] })).toThrow(
      JobsError,
    );
    expect(() =>
      validateAccommodation({
        needs: ["written_questions"],
        otherText: "private extra",
      }),
    ).toThrow(JobsError);
    expect(() => validateAccommodation({ needs: ["diagnosis"] })).toThrow(
      JobsError,
    );
    expect(() =>
      validateAccommodation({
        needs: ["written_questions"],
        interviewAt: "2026-02-30T12:00:00Z",
      }),
    ).toThrow(JobsError);
  });
});
