import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const verifier = fileURLToPath(
  new URL("../scripts/verify-phases-1-6.mjs", import.meta.url),
);

describe("Phases 1-6 verification command", () => {
  it("fails before running checks when PostgreSQL integration is not configured", () => {
    const result = spawnSync(process.execPath, [verifier], {
      encoding: "utf8",
      env: { ...process.env, DIMTS_TEST_DATABASE_URL: "" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DIMTS_TEST_DATABASE_URL");
  });

  it("refuses a remote database URL before running destructive integration tests", () => {
    const result = spawnSync(process.execPath, [verifier], {
      encoding: "utf8",
      env: {
        ...process.env,
        DIMTS_TEST_DATABASE_URL: "postgresql://test:secret@db.example.org/test",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("local PostgreSQL");
    expect(result.stderr).not.toContain("secret");
  });
});
