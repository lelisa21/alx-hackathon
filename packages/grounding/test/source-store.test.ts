// AR-06, FR-AI-08: preserve atomic generations and cache invalidation during P02.
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresSourceSyncStore } from "../src/source-store.js";
import { toPassages } from "../src/ingest.js";

function storeFixture(fail?: string) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    void values;
    if (fail && sql.includes(fail))
      throw new Error("Injected database failure.");
    if (sql.includes("SELECT source_id, status"))
      return { rows: [{ source_id: "source", status: "staging" }] };
    if (sql.includes("SELECT generation_id"))
      return { rows: [{ generation_id: "previous" }] };
    if (sql.includes("AS removed")) return { rows: [{ removed: 2 }] };
    if (sql.includes("SELECT generation.cursor"))
      return { rows: [{ cursor: "resume" }] };
    if (sql.includes("AS active")) return { rows: [{ active: true }] };
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn();
  const pool = {
    query,
    connect: async () => ({ query, release }),
  } as unknown as Pool;
  return { store: new PostgresSourceSyncStore(pool), query, release };
}

describe("persistent source generation boundary", () => {
  it("publishes an active generation and cache invalidation in one transaction", async () => {
    const { store, query, release } = storeFixture();
    expect(
      await store.publishGeneration("next", {
        snapshotRevision: "r2",
        cursor: "c2",
        discovered: 2,
        indexed: 2,
        removed: 0,
      }),
    ).toEqual({ removed: 2 });
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql[0]).toBe("BEGIN");
    expect(sql.at(-1)).toBe("COMMIT");
    expect(
      sql.findIndex((statement) =>
        statement.includes("INSERT INTO active_source_generation"),
      ),
    ).toBeLessThan(sql.indexOf("DELETE FROM answer_cache"));
    expect(sql.indexOf("DELETE FROM answer_cache")).toBeLessThan(
      sql.indexOf("COMMIT"),
    );
    expect(release).toHaveBeenCalledOnce();
  });
  it("rolls back publication when cache invalidation fails, leaving the previous generation active", async () => {
    const { store, query, release } = storeFixture("DELETE FROM answer_cache");
    await expect(
      store.publishGeneration("next", {
        discovered: 1,
        indexed: 1,
        removed: 0,
      }),
    ).rejects.toThrow("Injected database failure");
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
  it("rejects a document belonging to another source before staged-content mutation", async () => {
    const { store, query } = storeFixture();
    await expect(
      store.stageResource(
        "next",
        {
          sourceId: "other",
          resourceId: "doc",
          revision: "r1",
          canonicalUrl: "https://example.test/doc",
          mediaType: "text/markdown",
          body: "Text",
        },
        [],
      ),
    ).rejects.toThrow("does not match");
    expect(query.mock.calls.some(([sql]) => /INSERT|DELETE/u.test(sql))).toBe(
      false,
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
  it("stages source provenance with stable document-scoped passage identities and removes only that resource", async () => {
    const { store, query } = storeFixture();
    const body = "# Lesson\n\nChoose one goal.";
    const passages = toPassages({
      lessonId: "lesson",
      content: body,
      format: "markdown",
      baseUrl: "https://example.test/",
      lang: "en",
    });
    const document = {
      sourceId: "source",
      resourceId: "doc",
      revision: "r1",
      canonicalUrl: "https://example.test/lesson",
      mediaType: "text/markdown",
      body,
    };
    await store.stageResource("one", document, passages);
    await store.stageResource("two", document, passages);
    const inserts = query.mock.calls.filter(([sql]) =>
      sql.includes("INSERT INTO passage"),
    );
    expect(inserts[0]?.[1]?.[0]).toBe(inserts[1]?.[1]?.[0]);
    expect(inserts[0]?.[1]?.slice(-2)).toEqual(["source", "doc"]);
    await store.removeResource("two", "doc");
    expect(
      query.mock.calls
        .filter(([sql]) => sql.includes("DELETE FROM source_resource_revision"))
        .at(-1)?.[1],
    ).toEqual(["two", "source", "doc"]);
  });
  it("copies the active snapshot before incremental mutation and preserves the resume cursor", async () => {
    const { store, query } = storeFixture();
    expect(await store.getCursor("source")).toBe("resume");
    expect(await store.hasActiveGeneration("source")).toBe(true);
    const generation = await store.beginGeneration("source", "incremental");
    expect(generation).not.toBe("previous");
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql.includes("FROM passage") && values?.[1] === "previous",
      ),
    ).toBe(true);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("cursor = previous.cursor"),
      ),
    ).toBe(true);
    await store.abortGeneration(generation);
    expect(query.mock.calls.at(-1)?.[0]).toContain("status = 'staging'");
  });
});
