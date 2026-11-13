import type { ConversationSignals, ReplyKind } from "@dimts/engine";
import type { Pool } from "pg";

export interface ConversationStateStore extends ConversationSignals {
  recordFeedback(input: {
    replyId: string;
    helpful: boolean;
    tokenHash: string;
  }): Promise<boolean>;
}

export function createPostgresConversationStore(
  pool: Pool,
): ConversationStateStore {
  return {
    async recentReplyKinds(sessionId) {
      const result = await pool.query<{ kind: ReplyKind }>(
        `SELECT kind FROM message
         WHERE session_id = $1 AND role = 'dimts'
         ORDER BY created_at DESC, id DESC LIMIT 2`,
        [sessionId],
      );
      return result.rows.map(({ kind }) => kind).reverse();
    },
    async consecutiveNegativeFeedback(sessionId) {
      const result = await pool.query<{ negative_feedback_streak: number }>(
        "SELECT negative_feedback_streak FROM session WHERE id = $1",
        [sessionId],
      );
      return result.rows[0]?.negative_feedback_streak ?? 0;
    },
    async resetNegativeFeedback(sessionId) {
      await pool.query(
        "UPDATE session SET negative_feedback_streak = 0 WHERE id = $1",
        [sessionId],
      );
    },
    async recordFeedback({ replyId, helpful, tokenHash }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const owned = await client.query<{
          session_id: string;
          lang: string;
          topic_id: string;
        }>(
          `SELECT m.session_id, m.lang,
                  COALESCE(m.citations->0->>'passageId', 'uncategorized') AS topic_id
           FROM message m JOIN session s ON s.id = m.session_id
           WHERE m.id = $1 AND m.role = 'dimts' AND s.token_hash = $2
           FOR UPDATE OF s`,
          [replyId, tokenHash],
        );
        const reply = owned.rows[0];
        if (!reply) {
          await client.query("ROLLBACK");
          return false;
        }
        await client.query(
          `UPDATE session SET negative_feedback_streak =
             CASE WHEN $2 THEN 0 ELSE LEAST(2, negative_feedback_streak + 1) END,
             last_seen_at = now() WHERE id = $1`,
          [reply.session_id, helpful],
        );
        await client.query(
          `INSERT INTO feedback_counter (topic_id, lang, period, helpful, unhelpful)
           VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date, $3, $4)
           ON CONFLICT (topic_id, lang, period) DO UPDATE
           SET helpful = feedback_counter.helpful + EXCLUDED.helpful,
               unhelpful = feedback_counter.unhelpful + EXCLUDED.unhelpful`,
          [reply.topic_id, reply.lang, helpful ? 1 : 0, helpful ? 0 : 1],
        );
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
