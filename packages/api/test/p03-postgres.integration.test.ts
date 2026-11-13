import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresGrounding,
  replaceContent,
  sourceHash,
  toPassages,
} from "@dimts/grounding";
import { loadPacks } from "@dimts/locales-tools";
import { applyMigrations } from "../src/db/migrate.js";
import { buildReviewedFaq } from "../src/faq.js";

const databaseUrl = process.env.DIMTS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("P03 PostgreSQL reviewed FAQ publication", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  const schema = `p03_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await applyMigrations(client, resolve("packages/api/migrations"));
    } finally {
      await client.end();
    }
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  it("publishes all resolved reviewed FAQ facts then removes retired sources and changes contentVersion", async () => {
    const content = await readFile(
      "content/sample-course/study-plan.md",
      "utf8",
    );
    const passages = toPassages({
      lessonId: "study-plan",
      baseUrl: "https://course.example/lessons/",
      content,
      format: "markdown",
      lang: "en",
    });
    await replaceContent(
      pool,
      passages,
      sourceHash([{ name: "study-plan.md", content }]),
    );
    const grounding = new PostgresGrounding(pool);
    const pack = loadPacks(resolve("locales")).get("en")!;
    expect(
      (
        await buildReviewedFaq(
          pack,
          await grounding.currentVersion(),
          grounding.resolveFaqCitations.bind(grounding),
        )
      ).items,
    ).toEqual([]);
    // Synthetic review approval only in this isolated fixture; repository metadata stays unreviewed.
    pack.meta.reviewed_by = "Integration fixture reviewer";
    pack.meta.reviewed_on = "2026-01-01";
    const before = await buildReviewedFaq(
      pack,
      await grounding.currentVersion(),
      grounding.resolveFaqCitations.bind(grounding),
    );
    expect(before.items).toHaveLength(9);
    expect(
      before.items.every((item) =>
        /^[a-f0-9]{64}$/u.test(item.citations[0]!.passageId),
      ),
    ).toBe(true);
    const replacement =
      "# Another lesson\n\nDifferent approved source material.";
    await replaceContent(
      pool,
      toPassages({
        lessonId: "other",
        baseUrl: "https://course.example/lessons/",
        content: replacement,
        format: "markdown",
        lang: "en",
      }),
      sourceHash([{ name: "other.md", content: replacement }]),
    );
    const after = await buildReviewedFaq(
      pack,
      await grounding.currentVersion(),
      grounding.resolveFaqCitations.bind(grounding),
    );
    expect(after.items).toEqual([]);
    expect(after.contentVersion).not.toBe(before.contentVersion);
  });
});
