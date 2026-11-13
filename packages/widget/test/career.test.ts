import { describe, expect, it } from "vitest";
import { filterBySupport, safeProgress } from "../src/career-runtime.js";

describe("P06 FR-JOB-01,03,04,05,06,08 / FR-SIMPLE-04", () => {
  it("filters support entirely in memory without changing postings", () => {
    const jobs = [
      { id: "a", accommodationsOffered: ["step_free", "extra_time"] },
      { id: "b", accommodationsOffered: ["extra_time"] },
    ];
    expect(filterBySupport(jobs, ["step_free"])).toEqual([jobs[0]]);
    expect(filterBySupport(jobs, [])).toEqual(jobs);
    expect(jobs[0]!.accommodationsOffered).toHaveLength(2);
  });
  it("matches explicit employer offering spelling without sending private choices", () => {
    expect(
      filterBySupport(
        [{ accommodationsOffered: ["step-free access"] }],
        ["step_free_access"],
      ),
    ).toHaveLength(1);
    expect(
      filterBySupport(
        [{ accommodationsOffered: ["access available"] }],
        ["step_free_access"],
      ),
    ).toHaveLength(0);
  });
  it("only persists non-sensitive progress and a server draft reference", () => {
    const input = {
      step: 6,
      jobType: "training",
      region: "Addis",
      lang: "en",
      channel: "sms",
      contact: "+251911111111",
      name: "Private",
      otherText: "Private support",
      needs: ["step_free"],
      support: ["extra_time"],
      consent: true,
      draftId: "draft-id",
      flow: "subscription",
      clientRequestId: "request-id",
    };
    expect(safeProgress(input)).toEqual({
      step: 4,
      jobType: "training",
      region: "Addis",
      lang: "en",
      channel: "sms",
      draftId: "draft-id",
      flow: "subscription",
      clientRequestId: "request-id",
    });
    expect(JSON.stringify(safeProgress(input))).not.toMatch(
      /Private|251911|step_free|extra_time|consent|contact/,
    );
  });
});
