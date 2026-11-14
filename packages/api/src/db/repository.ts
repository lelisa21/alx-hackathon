import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type { ApiConfig } from "../config.js";
import { createInsightsRepository } from "./insights-repository.js";
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

export function createPostgresRepository(
  pool: pg.Pool,
  now: () => Date = () => new Date(),
): ApiRepository {
  return {
    async ping() {
      await pool.query("SELECT 1");
      return true;
    },
    async runRetention(retentionHours) {
      const currentTime = now();
      const inactiveBefore = new Date(
        currentTime.getTime() - retentionHours * 60 * 60 * 1000,
      );
      const dayAgo = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000);
      const imageExpiry = new Date(currentTime.getTime() - 2 * 60 * 60 * 1000);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `DELETE FROM message
           WHERE session_id IN (
             SELECT id FROM session
             WHERE last_seen_at < $1
           )`,
          [inactiveBefore],
        );
        await client.query("DELETE FROM session WHERE last_seen_at < $1", [
          inactiveBefore,
        ]);
        await client.query("DELETE FROM help_image WHERE created_at < $1", [
          imageExpiry,
        ]);
        await client.query(
          `UPDATE subscription
           SET stopped_at = COALESCE(stopped_at, $1),
               contact_enc = NULL,
               contact_hash = NULL
           WHERE stopped_at IS NOT NULL OR consent_expires_at <= $1`,
          [currentTime],
        );
        await client.query(
          "DELETE FROM subscription WHERE stopped_at IS NOT NULL",
        );
        await client.query("DELETE FROM answer_cache WHERE created_at < $1", [
          dayAgo,
        ]);
        await client.query(
          "UPDATE sms_conversation SET private_enc=NULL WHERE expires_at<$1",
          [currentTime],
        );
        await client.query("DELETE FROM sms_delivery WHERE created_at < $1", [
          dayAgo,
        ]);
        await client.query(
          "UPDATE telegram_conversation SET private_enc=NULL WHERE expires_at<$1",
          [currentTime],
        );
        await client.query(
          "DELETE FROM telegram_delivery WHERE created_at < $1",
          [dayAgo],
        );
        await client.query(
          "DELETE FROM lti_nonce_state WHERE expires_at < $1",
          [currentTime],
        );
        await client.query("DELETE FROM lti_nonce_used WHERE used_at < $1", [
          dayAgo,
        ]);
        await client.query(
          "DELETE FROM lti_token_replay WHERE detected_at < $1",
          [dayAgo],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async deleteSessionData(sessionId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM session WHERE id = $1", [sessionId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async getHostByHash(keyHash) {
      const result = await pool.query<{ origins: string[] }>(
        "SELECT origins FROM host_key WHERE key_hash = $1",
        [keyHash],
      );
      return result.rows[0] ?? null;
    },
    async createSession(session: NewSession) {
      const tokenHash =
        session.tokenHash ??
        (session.token
          ? createHash("sha256").update(session.token).digest("hex")
          : null);
      await pool.query(
        `INSERT INTO session
           (id, channel, lang, token_hash, resume_hash, cloud_ok, consent_version, expires_at, lti_context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          session.id,
          session.channel,
          session.lang,
          tokenHash,
          session.resumeHash,
          session.cloudOk,
          session.consentVersion,
          session.expiresAt,
          session.ltiContext ? JSON.stringify(session.ltiContext) : null,
        ],
      );
    },
    async resumeSession(session) {
      const result = await pool.query<{
        id: string;
        lang: string;
        cloud_ok: boolean;
        consent_version: string | null;
      }>(
        `UPDATE session
         SET token_hash = $1,
             resume_hash = $2,
             last_seen_at = now(),
             cloud_ok = COALESCE($5, cloud_ok),
             consent_version = CASE
               WHEN $5 IS NULL THEN consent_version
               WHEN $5 THEN $6
               ELSE NULL
             END
         WHERE id = $3 AND resume_hash = $4
         RETURNING id, lang, cloud_ok, consent_version`,
        [
          session.tokenHash,
          session.resumeHash,
          session.id,
          session.currentResumeHash,
          session.cloudOk ?? null,
          session.consentVersion ?? null,
        ],
      );
      const resumed = result.rows[0];
      return resumed
        ? {
            id: resumed.id,
            lang: resumed.lang,
            cloudOk: resumed.cloud_ok,
            consentVersion: resumed.consent_version,
          }
        : null;
    },
    async getCloudConsent(sessionId) {
      const result = await pool.query<{
        cloud_ok: boolean;
        consent_version: string | null;
      }>(
        `SELECT cloud_ok, consent_version
         FROM session
         WHERE id = $1`,
        [sessionId],
      );
      const consent = result.rows[0];
      return consent
        ? {
            cloudOk: consent.cloud_ok,
            consentVersion: consent.consent_version,
          }
        : null;
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
    async verifyHostKey(key: string) {
      const keyHash = createHash("sha256").update(key).digest("hex");
      const result = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM host_key
         WHERE key_hash = $1 AND key_type = 'secret'
         LIMIT 1`,
        [keyHash],
      );
      return result.rows[0] ?? null;
    },
    getInsightsRepository() {
      return createInsightsRepository(pool);
    },
    async getSessionDetails(sessionId) {
      const result = await pool.query<{
        id: string;
        channel: string;
        lti_context: NewSession["ltiContext"] | null;
      }>("SELECT id, channel, lti_context FROM session WHERE id = $1", [
        sessionId,
      ]);
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            channel: row.channel,
            ltiContext: row.lti_context ?? undefined,
          }
        : null;
    },
    async getLtiSessionByTokenHash(tokenHash) {
      const result = await pool.query<{
        id: string;
        channel: string;
        lti_context: NewSession["ltiContext"] | null;
      }>(
        `SELECT id, channel, lti_context FROM session
         WHERE token_hash = $1 AND channel = 'lti'
           AND expires_at > now()
         LIMIT 1`,
        [tokenHash],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            channel: row.channel,
            ltiContext: row.lti_context ?? undefined,
          }
        : null;
    },
    async storeLtiState(
      state: string,
      platformId: string,
      nonce: string,
      expiresAt: Date,
    ) {
      await pool.query(
        `INSERT INTO lti_nonce_state (state, platform_id, nonce, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (state) DO NOTHING`,
        [state, platformId, nonce, expiresAt],
      );
    },
    async getLtiStateAndNonce(state: string) {
      const result = await pool.query<{
        platform_id: string;
        nonce: string;
        expires_at: Date;
      }>(
        `SELECT platform_id, nonce, expires_at FROM lti_nonce_state
         WHERE state = $1 AND expires_at > now()`,
        [state],
      );
      const row = result.rows[0];
      return row
        ? {
            platformId: row.platform_id,
            nonce: row.nonce,
            expiresAt: row.expires_at,
          }
        : null;
    },
    async deleteLtiState(state: string) {
      await pool.query("DELETE FROM lti_nonce_state WHERE state = $1", [state]);
    },
    async checkAndMarkNonceUsed(nonce: string, sessionId: string | null) {
      const result = await pool.query<{ nonce: string }>(
        `INSERT INTO lti_nonce_used (nonce, session_id) VALUES ($1, $2)
         ON CONFLICT (nonce) DO NOTHING
         RETURNING nonce`,
        [nonce, sessionId],
      );
      return result.rows.length === 0;
    },
    async checkAndMarkTokenReplayed(
      tokenHash: string,
      platformId: string,
      sessionId: string | null,
    ) {
      const result = await pool.query<{ token_hash: string }>(
        `INSERT INTO lti_token_replay (token_hash, platform_id, session_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (token_hash) DO NOTHING
         RETURNING token_hash`,
        [tokenHash, platformId, sessionId],
      );
      return result.rows.length === 0;
    },
  };
}
