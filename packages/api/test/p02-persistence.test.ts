import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPostgresAnswerCache } from "../src/db/answer-cache.js";
import { createPostgresConversationStore } from "../src/db/conversation-state.js";

const answer = {
  id: "original-reply",
  kind: "answer",
  text: "Choose one learning goal.",
  lang: "en",
  dir: "ltr",
  citations: [
    {
      passageId: "goals",
      label: "Goals",
      url: "https://course.example/goals",
      sourceLang: "en",
      sourceType: "course",
    },
  ],
  actions: [],
  contentVersion: "version-1",
} as const;
const key = "a".repeat(64);

describe("P02 durable ports and privacy boundaries", () => {
  it("stores only validated answers with a neutral ID, expires reads, and rejects corrupt cache entries", async () => {
    const query = vi.fn(async () => ({
      rows: [{ reply: structuredClone(answer) }],
    }));
    const pool = { query } as unknown as Pool;
    const cache = createPostgresAnswerCache(pool);
    await cache.set(key, structuredClone(answer));
    const payload = JSON.parse(String(query.mock.calls[0]?.[1]?.[1]));
    expect(payload.id).toBe("cached");
    expect(payload).not.toHaveProperty("sessionId");
    expect(payload).not.toHaveProperty("clientMsgId");
    expect((await cache.get(key))?.text).toBe(answer.text);
    expect(query.mock.calls.at(-1)?.[0]).toMatch(/created_at.*24 hours/su);
    query.mockResolvedValueOnce({
      rows: [{ reply: { ...answer, citations: [] } }],
    });
    expect(await cache.get(key)).toBeNull();
    query.mockClear();
    await cache.set(key, {
      ...structuredClone(answer),
      kind: "distress",
      citations: [],
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("reads at most two reply kinds without selecting transcript content", async () => {
    const query = vi.fn(async () => ({
      rows: [{ kind: "notfound" }, { kind: "answer" }],
    }));
    const store = createPostgresConversationStore({ query } as unknown as Pool);
    expect(await store.recentReplyKinds("session-test")).toEqual([
      "answer",
      "notfound",
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(/SELECT kind\s+FROM message/u);
    expect(sql).toMatch(/LIMIT 2/u);
    expect(sql).not.toMatch(/SELECT\s+\*|SELECT.*\btext\b/u);
  });

  it("rejects another session's feedback without writing state or aggregates", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const release = vi.fn();
    const pool = {
      connect: async () => ({ query, release }),
    } as unknown as Pool;
    const store = createPostgresConversationStore(pool);
    expect(
      await store.recordFeedback({
        replyId: "other-reply",
        helpful: false,
        tokenHash: "b".repeat(64),
      }),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        /^\s*(?:INSERT|UPDATE)\b/u.test(String(sql)),
      ),
    ).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back both streak and anonymous counter if feedback persistence fails", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO feedback_counter"))
        throw new Error("write failure");
      return {
        rows: [{ session_id: "session-test", lang: "en", topic_id: "goals" }],
      };
    });
    const release = vi.fn();
    const store = createPostgresConversationStore({
      connect: async () => ({ query, release }),
    } as unknown as Pool);
    await expect(
      store.recordFeedback({
        replyId: "reply-test",
        helpful: false,
        tokenHash: "b".repeat(64),
      }),
    ).rejects.toThrow("write failure");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
