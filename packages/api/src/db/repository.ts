import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ApiConfig } from "../config.js";
import type {
  ApiRepository,
  ApiReply,
  ClaimedQuestion,
  NewSession,
  SavedReply,
} from "../types.js";

export function createPool(config: ApiConfig): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });
  pool.on("error", (error: NodeJS.ErrnoException) => {
    process.emitWarning(
      `Idle database client error (${error.code ?? "unknown"})`,
    );
  });
  return pool;
}

export function createPostgresRepository(pool: pg.Pool): ApiRepository {
  return {
    async ping() {
      await pool.query("SELECT 1");
      return true;
    },
    async getHostByHash(keyHash) {
      const result = await pool.query<{ origins: string[] }>(
        "SELECT origins FROM host_key WHERE key_hash = $1",
        [keyHash],
      );
      return result.rows[0] ?? null;
    },
    async createSession(session: NewSession) {
      await pool.query(
        `INSERT INTO session (id, channel, lang, token_hash, resume_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          session.id,
          session.channel,
          session.lang,
          session.tokenHash,
          session.resumeHash,
        ],
      );
    },
    async resumeSession(session) {
      const result = await pool.query<{ id: string; lang: string }>(
        `UPDATE session
         SET token_hash = $1, resume_hash = $2, last_seen_at = now()
         WHERE id = $3 AND resume_hash = $4
         RETURNING id, lang`,
        [
          session.tokenHash,
          session.resumeHash,
          session.id,
          session.currentResumeHash,
        ],
      );
      return result.rows[0] ?? null;
    },
    async getSessionTokenHash(sessionId) {
      const result = await pool.query<{ token_hash: string | null }>(
        "SELECT token_hash FROM session WHERE id = $1",
        [sessionId],
      );
      return result.rows[0]?.token_hash ?? null;
    },
    async touchSession(sessionId) {
      await pool.query(
        "UPDATE session SET last_seen_at = now() WHERE id = $1",
        [sessionId],
      );
    },
    async findReply(sessionId, clientMsgId) {
      const result = await pool.query<{ reply: ApiReply | null }>(
        `SELECT reply FROM message
         WHERE session_id = $1 AND reply_to = $2 AND reply IS NOT NULL
         LIMIT 1`,
        [sessionId, clientMsgId],
      );
      return result.rows[0]?.reply ?? null;
    },
    async countRecentQuestions(sessionId) {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM message
         WHERE session_id = $1 AND role = 'learner'
           AND created_at > now() - interval '1 minute'`,
        [sessionId],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    async claimQuestion(question: ClaimedQuestion) {
      const result = await pool.query(
        `INSERT INTO message (id, session_id, client_msg_id, role, text, lang, kind)
         VALUES ($1, $2, $3, 'learner', $4, $5, 'question')
         ON CONFLICT (session_id, client_msg_id) DO NOTHING
         RETURNING id`,
        [
          randomUUID(),
          question.sessionId,
          question.clientMsgId,
          question.text,
          question.lang,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async saveReply(saved: SavedReply) {
      await pool.query(
        `INSERT INTO message
           (id, session_id, reply_to, role, text, lang, kind, citations, reply)
         VALUES ($1, $2, $3, 'dimts', $4, $5, $6, $7::jsonb, $8::jsonb)
         ON CONFLICT (session_id, reply_to)
         WHERE reply_to IS NOT NULL
         DO NOTHING`,
        [
          saved.reply.id,
          saved.sessionId,
          saved.clientMsgId,
          saved.reply.text,
          saved.reply.lang,
          saved.reply.kind,
          JSON.stringify(saved.reply.citations),
          JSON.stringify(saved.reply),
        ],
      );
    },
    async releaseQuestion(sessionId, clientMsgId) {
      await pool.query(
        "DELETE FROM message WHERE session_id = $1 AND client_msg_id = $2 AND role = 'learner'",
        [sessionId, clientMsgId],
      );
    },
  };
}
