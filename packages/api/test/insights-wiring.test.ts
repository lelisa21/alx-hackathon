import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPostgresRepository } from "../src/db/repository.js";
import type { SavedReply } from "../src/types.js";

function savedReply(): SavedReply {
  return {
    sessionId: "session-test",
    clientMsgId: "client-message-test",
    reply: {
      id: "reply-test",
      kind: "notfound",
      text: "No source found.",
      lang: "en",
      dir: "ltr",
      citations: [],
      actions: [],
      contentVersion: "content-v1",
    },
  };
}

function repositoryWithInsertResult(rowCount: number) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({
      rowCount,
      rows: rowCount ? [{ id: "reply-test" }] : [],
    })
    .mockResolvedValueOnce({}) // aggregate upsert, when inserted
    .mockResolvedValueOnce({}); // COMMIT
  const client = { query, release: vi.fn() };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
  return { repository: createPostgresRepository(pool), query, client };
}

describe("P09 conversation aggregate wiring", () => {
  it("records one anonymous not-found outcome in the reply transaction", async () => {
    const { repository, query, client } = repositoryWithInsertResult(1);

    await repository.saveReply(savedReply());

    expect(query.mock.calls[2]?.[0]).toContain("INSERT INTO insight_aggregate");
    expect(query.mock.calls[2]?.[1]).toEqual(["uncategorized", "en", 1]);
    expect(query.mock.calls.map(([sql]) => sql)).toContain("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("does not count an idempotent reply replay twice", async () => {
    const { repository, query } = repositoryWithInsertResult(0);

    await repository.saveReply(savedReply());

    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO insight_aggregate"),
      ),
    ).toBe(false);
    expect(query.mock.calls.map(([sql]) => sql)).toContain("COMMIT");
  });
});
