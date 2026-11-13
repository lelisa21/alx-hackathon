import type { AnswerCache } from "@dimts/engine";
import type { Pool } from "pg";
import { ReplySchema } from "../schemas.js";

/** Only shared grounded answers belong here; question/session data never does. */
export function createPostgresAnswerCache(pool: Pool): AnswerCache {
  const parseReply = (reply: unknown) => {
    const parsed = ReplySchema.safeParse(reply);
    if (!parsed.success || parsed.data.kind !== "answer") return null;
    return {
      ...parsed.data,
      citations: parsed.data.citations.map(({ timestamp, ...citation }) =>
        timestamp === undefined ? citation : { ...citation, timestamp },
      ),
    };
  };

  return {
    async get(key) {
      const result = await pool.query<{ reply: unknown }>(
        `SELECT reply FROM answer_cache
         WHERE cache_key = $1 AND created_at > now() - interval '24 hours'`,
        [key],
      );
      return parseReply(result.rows[0]?.reply);
    },
    async getCurrent(key, contentVersion) {
      const result = await pool.query<{ reply: unknown }>(
        `SELECT cached.reply
         FROM answer_cache cached
         WHERE cached.cache_key = $1
           AND cached.created_at > now() - interval '24 hours'
           AND cached.reply->>'contentVersion' = $2
           AND jsonb_typeof(cached.reply->'citations') = 'array'
           AND jsonb_array_length(
             CASE
               WHEN jsonb_typeof(cached.reply->'citations') = 'array'
                 THEN cached.reply->'citations'
               ELSE '[]'::jsonb
             END
           ) > 0
           AND NOT EXISTS (
             SELECT 1
             FROM jsonb_array_elements(
               CASE
                 WHEN jsonb_typeof(cached.reply->'citations') = 'array'
                   THEN cached.reply->'citations'
                 ELSE '[]'::jsonb
               END
             ) AS citation(value)
             WHERE NOT EXISTS (
               SELECT 1
               FROM passage p
               JOIN active_source_generation active
                 ON active.generation_id = p.content_version_id
                AND active.source_id = p.source_id
               WHERE p.id = citation.value->>'passageId'
             )
           )`,
        [key, contentVersion],
      );
      return parseReply(result.rows[0]?.reply);
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
