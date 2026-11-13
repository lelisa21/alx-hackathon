import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresGrounding } from "../src/repository.js";

const source = "lesson#section-0";
const row = (namespace = "legacy") => ({
  id: createHash("sha256")
    .update(JSON.stringify([namespace, "lesson", source]))
    .digest("hex"),
  source_id: namespace,
  source_resource_id: "lesson",
  lesson_title: "Lesson",
  section_title: "Section",
  url: "https://course.example/lesson#section",
  lang: "en",
  source_type: "course",
  ts_start: null,
});
describe("reviewed FAQ exact active citation resolution", () => {
  it("resolves authoring or stored IDs with active-only namespace lookup", async () => {
    const current = row();
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            source_id: current.source_id,
            source_resource_id: current.source_resource_id,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [current] });
    const result = await new PostgresGrounding({
      query,
    } as unknown as Pool).resolveFaqCitations([source, current.id, "missing"]);
    expect(result.get(source)).toEqual({
      passageId: current.id,
      label: "Lesson / Section",
      url: current.url,
      sourceLang: "en",
      sourceType: "course",
    });
    expect(result.get(current.id)).toEqual(result.get(source));
    expect(result.has("missing")).toBe(false);
    for (const call of query.mock.calls)
      expect(call[0]).toMatch(/JOIN active_source_generation/);
    expect(query.mock.calls[1]?.[0]).toMatch(/p\.id = ANY/);
  });
  it("omits ambiguous raw references across namespaces and performs no work for empty requests", async () => {
    const first = row(),
      second = row("another");
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [first, second] })
      .mockResolvedValueOnce({ rows: [first, second] });
    const grounding = new PostgresGrounding({ query } as unknown as Pool);
    expect(await grounding.resolveFaqCitations([])).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
    expect((await grounding.resolveFaqCitations([source])).has(source)).toBe(
      false,
    );
  });
});
