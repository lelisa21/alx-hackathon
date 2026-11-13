// FR-AI-04, AR-06: resolve authoring references only against retrieved active source provenance.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresGrounding } from "../src/repository.js";

const source = "study-plan#choose-one-goal-0";
function row(
  sourceId = "legacy",
  resourceId = "study-plan",
  original = source,
) {
  return {
    id: createHash("sha256")
      .update(JSON.stringify([sourceId, resourceId, original]))
      .digest("hex"),
    source_id: sourceId,
    source_resource_id: resourceId,
  };
}
function fixture(rows: ReturnType<typeof row>[]) {
  const query = vi.fn(async () => ({ rows }));
  return {
    query,
    grounding: new PostgresGrounding({ query } as unknown as Pool),
  };
}

describe("FAQ provenance resolution", () => {
  it("resolves an authoring ID to the exact stored namespace ID", async () => {
    const passage = row();
    const { grounding, query } = fixture([passage]);
    expect(await grounding.resolveFaqSource(source, [passage.id])).toBe(
      passage.id,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("active_source_generation"),
      [[passage.id]],
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining("p.id = ANY"), [
      [passage.id],
    ]);
  });
  it("accepts an already-canonical retrieved ID, while rejecting aliases belonging to different chunks", async () => {
    const passage = row();
    const { grounding } = fixture([passage]);
    expect(await grounding.resolveFaqSource(passage.id, [passage.id])).toBe(
      passage.id,
    );
    expect(
      await grounding.resolveFaqSource("study-plan#choose-one-goal-1", [
        passage.id,
      ]),
    ).toBeNull();
  });
  it("fails closed when the same raw reference is ambiguous across sources", async () => {
    const passages = [row("one"), row("two")];
    const { grounding } = fixture(passages);
    expect(
      await grounding.resolveFaqSource(
        source,
        passages.map((p) => p.id),
      ),
    ).toBeNull();
  });
  it("does not revive inactive or non-retrieved passages", async () => {
    const passage = row();
    const { grounding } = fixture([]);
    expect(await grounding.resolveFaqSource(source, [passage.id])).toBeNull();
    const outOfScope = fixture([passage]);
    expect(
      await outOfScope.grounding.resolveFaqSource(source, [
        "different-retrieved-id",
      ]),
    ).toBeNull();
  });
  it("never queries for empty references or absent retrieval results", async () => {
    const { grounding, query } = fixture([]);
    expect(await grounding.resolveFaqSource("", ["one"])).toBeNull();
    expect(await grounding.resolveFaqSource(source, [])).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
