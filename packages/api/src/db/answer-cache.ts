import type { AnswerCache } from "@dimts/engine";
import type { Pool } from "pg";
import { ReplySchema } from "../schemas.js";

/** Only shared grounded answers belong here; question/session data never does. */
export function createPostgresAnswerCache(pool: Pool): AnswerCache {
  return {
    async get(key) {
      const result = await pool.query<{ reply: unknown }>(
        `SELECT reply FROM answer_cache
         WHERE cache_key = $1 AND created_at > now() - interval '24 hours'`,
        [key],
      );
      const parsed = ReplySchema.safeParse(result.rows[0]?.reply);
      if (!parsed.success || parsed.data.kind !== "answer") return null;
      return {
        ...parsed.data,
        citations: parsed.data.citations.map(({ timestamp, ...citation }) =>
          timestamp === undefined ? citation : { ...citation, timestamp },
        ),
      };
    },
    async set(key, reply) {
      const parsed = ReplySchema.safeParse(reply);
      if (!parsed.success || parsed.data.kind !== "answer") return;
      const { text, lang, dir, citations, actions, contentVersion } =
        parsed.data;
      const cached = {
        id: "cached",
        kind: "answer",
        text,
        lang,
        dir,
        citations,
        actions,
        contentVersion,
      };
      await pool.query(
        `INSERT INTO answer_cache (cache_key, reply)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (cache_key) DO UPDATE
         SET reply = EXCLUDED.reply, created_at = now()`,
        [key, JSON.stringify(cached)],
      );
    },
  };
}
