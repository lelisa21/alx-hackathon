// Remote providers receive public job postings only with the job-posting class.
import { describe, expect, it } from "vitest";
import { permittedPassages } from "../src/provider.js";

const passages = [
  { id: "c", sourceType: "course" as const },
  { id: "j", sourceType: "job" as const },
];

describe("permittedPassages", () => {
  it("keeps job postings away from remote providers by default", () => {
    expect(
      permittedPassages(
        passages,
        new Set(["question", "course-passage"]),
        "remote",
      ),
    ).toEqual([passages[0]]);
  });

  it("sends job postings to remote providers only when authorized", () => {
    expect(
      permittedPassages(
        passages,
        new Set(["question", "course-passage", "job-posting"]),
        "remote",
      ),
    ).toEqual(passages);
    expect(
      permittedPassages(
        passages,
        new Set(["question", "job-posting"]),
        "remote",
      ),
    ).toEqual([passages[1]]);
  });

  it("keeps local providers on the course-passage class", () => {
    expect(
      permittedPassages(passages, new Set(["course-passage"]), "local"),
    ).toEqual(passages);
    expect(permittedPassages(passages, new Set(["question"]), "local")).toEqual(
      [],
    );
  });
});
