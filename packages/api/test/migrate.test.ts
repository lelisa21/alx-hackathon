import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../src/db/migrate.js";

function fakeClient(failOn?: string) {
  const statements: string[] = [];
  const query = vi.fn(async (text: string) => {
    statements.push(text.trim().split(/\s+/u).slice(0, 2).join(" "));
    if (failOn && text.includes(failOn)) throw new Error("boom");
    return { rows: [] };
  });
  return { client: { query } as unknown as pg.Client, statements, query };
}

describe("migration runner", () => {
  it("serialises concurrent deploys with an advisory lock and releases it", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dimts-migrate-"));
    await writeFile(path.join(directory, "001_a.sql"), "SELECT 1;");
    const { client, query } = fakeClient();

    expect(await applyMigrations(client, directory)).toEqual(["001_a.sql"]);

    const texts = query.mock.calls.map(([text]) => String(text));
    expect(texts[0]).toContain("pg_advisory_lock");
    expect(texts.at(-1)).toContain("pg_advisory_unlock");
  });

  it("releases the lock when a migration fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dimts-migrate-"));
    await writeFile(path.join(directory, "001_bad.sql"), "SELECT broken;");
    const { client, query } = fakeClient("SELECT broken");

    await expect(applyMigrations(client, directory)).rejects.toThrow("boom");
    const texts = query.mock.calls.map(([text]) => String(text));
    expect(texts).toContain("ROLLBACK");
    expect(texts.at(-1)).toContain("pg_advisory_unlock");
  });
});
