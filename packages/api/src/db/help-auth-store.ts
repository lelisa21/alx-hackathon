import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { HelpCloseActor, HelpStore } from "../types.js";

function actorValues(actor: HelpCloseActor): [string, string] {
  return [
    actor.role,
    actor.role === "learner" ? actor.sessionId : actor.helperId,
  ];
}
// Values $2/$3 are always a trusted actor role and its authenticated identifier.
const participantSql = `request.status IN ('waiting','claimed') AND (
  ($2 = 'learner' AND request.session_id = $3) OR
  ($2 = 'helper' AND request.status = 'claimed' AND request.helper_id = $3
    AND EXISTS (SELECT 1 FROM helper WHERE id = $3 AND active)))`;

export function createPostgresHelpAuthStore(pool: pg.Pool): HelpStore {
  return {
    async authorizeRequest(requestId, actor, claimedOnly) {
      const result = await pool.query(
        `SELECT 1 FROM help_request request WHERE request.id=$1 AND ${participantSql} AND (NOT $4::boolean OR request.status='claimed')`,
        [requestId, ...actorValues(actor), claimedOnly],
      );
      return result.rowCount === 1;
    },
    async getHelperProfile(helperId) {
      const result = await pool.query<{ displayName: string | null }>(
        `SELECT public_display_name AS "displayName" FROM helper WHERE id=$1 AND active`,
        [helperId],
      );
      return result.rows[0] ?? { displayName: null };
    },
    async setHelperProfile(helperId, displayName) {
      const result = await pool.query<{ displayName: string | null }>(
        `UPDATE helper SET public_display_name=$2 WHERE id=$1 AND active RETURNING public_display_name AS "displayName"`,
        [helperId, displayName],
      );
      return result.rows[0] ?? { displayName: null };
    },
    async getMetrics() {
      const result = await pool.query<{
        closed_count: string;
        resolved_count: string;
        unresolved_count: string;
        total_wait_ms: number;
        total_resolution_ms: number;
      }>(
        "SELECT closed_count,resolved_count,unresolved_count,total_wait_ms,total_resolution_ms FROM help_service_metric WHERE singleton",
      );
      const row = result.rows[0];
      return {
        closedCount: Number(row?.closed_count ?? 0),
        resolvedCount: Number(row?.resolved_count ?? 0),
        unresolvedCount: Number(row?.unresolved_count ?? 0),
        totalWaitMs: Number(row?.total_wait_ms ?? 0),
        totalResolutionMs: Number(row?.total_resolution_ms ?? 0),
      };
    },
    async saveImage(requestId, sessionId, mime, data) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const request = await client.query(
          "SELECT 1 FROM help_request WHERE id=$1 AND session_id=$2 AND status IN ('waiting','claimed') FOR UPDATE",
          [requestId, sessionId],
        );
        if (request.rowCount !== 1) {
          await client.query("COMMIT");
          return null;
        }
        // Bound retained media per request even if a caller skips the UI.
        await client.query(
          "DELETE FROM help_image WHERE help_request_id=$1 AND created_at <= now()-interval '2 hours'",
          [requestId],
        );
        const count = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM help_image WHERE help_request_id=$1",
          [requestId],
        );
        if (Number(count.rows[0]?.count ?? 0) >= 5) {
          await client.query("COMMIT");
          return null;
        }
        const id = randomUUID();
        const result = await client.query<{ expires_at: Date }>(
          "INSERT INTO help_image(id,help_request_id,mime,data) VALUES($1,$2,$3,$4) RETURNING created_at+interval '2 hours' AS expires_at",
          [id, requestId, mime, data],
        );
        await client.query("COMMIT");
        return { id, expiresAt: result.rows[0]!.expires_at.toISOString() };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async listImages(requestId, actor) {
      const result = await pool.query<{ id: string; expires_at: Date }>(
        `SELECT image.id,image.created_at+interval '2 hours' AS expires_at FROM help_image image JOIN help_request request ON request.id=image.help_request_id WHERE request.id=$1 AND ${participantSql} AND image.created_at>now()-interval '2 hours' ORDER BY image.created_at,image.id`,
        [requestId, ...actorValues(actor)],
      );
      return result.rows.map((row) => ({
        id: row.id,
        expiresAt: row.expires_at.toISOString(),
      }));
    },
    async getImage(requestId, imageId, actor) {
      const result = await pool.query<{ mime: string; data: Buffer }>(
        `SELECT image.mime,image.data FROM help_image image JOIN help_request request ON request.id=image.help_request_id WHERE request.id=$1 AND ${participantSql} AND image.id=$4 AND image.created_at>now()-interval '2 hours'`,
        [requestId, ...actorValues(actor), imageId],
      );
      return result.rows[0] ?? null;
    },
    async deleteExpiredImages() {
      await pool.query(
        "DELETE FROM help_image WHERE created_at <= now()-interval '2 hours'",
      );
    },
    async findActiveHelperByTokenHash(tokenHash) {
      const result = await pool.query<{ id: string }>(
        "SELECT id FROM helper WHERE token_hash = $1 AND active",
        [tokenHash],
      );
      return result.rows[0] ?? null;
    },
    async isHelperActive(helperId) {
      const result = await pool.query(
        "SELECT 1 FROM helper WHERE id = $1 AND active",
        [helperId],
      );
      return result.rowCount === 1;
    },
    async claimWaitingRequest(requestId, helperId) {
      const result = await pool.query(
        `UPDATE help_request AS request
         SET status = 'claimed', claimed_at = now(), helper_id = helper.id
         FROM helper
         WHERE request.id = $1
           AND request.status = 'waiting'
           AND helper.id = $2
           AND helper.active
           AND request.lang = ANY(helper.langs)
           AND NOT EXISTS (
             SELECT 1 FROM help_request_block AS blocked
             WHERE blocked.help_request_id = request.id
               AND blocked.helper_id = helper.id
           )
         RETURNING request.id`,
        [requestId, helperId],
      );
      return result.rowCount === 1;
    },
    async createRequest(sessionId, includeSummary) {
      const client = await pool.connect();
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        const session = await client.query<{
          id: string;
          lang: string;
          channel: "web" | "api" | "telegram";
        }>(
          `SELECT session.id,
                  COALESCE(
                    (SELECT message.lang
                     FROM message
                     WHERE message.session_id = session.id
                     ORDER BY message.created_at DESC, message.id DESC
                     LIMIT 1),
                    session.lang
                  ) AS lang,
                  session.channel
           FROM session
           WHERE session.id = $1
           FOR UPDATE`,
          [sessionId],
        );
        const sessionData = session.rows[0];
        if (!sessionData) {
          throw new Error("Authenticated help session disappeared.");
        }

        const count = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM help_request
           WHERE session_id = $1
             AND created_at > now() - interval '1 hour'`,
          [sessionId],
        );
        if (Number(count.rows[0]?.count ?? 0) >= 5) {
          await client.query("COMMIT");
          transactionOpen = false;
          return null;
        }

        const questions = includeSummary
          ? await client.query<{ text: string }>(
              `SELECT text
               FROM message
               WHERE session_id = $1 AND role = 'learner' AND kind = 'question'
               ORDER BY created_at DESC, id DESC
               LIMIT 3`,
              [sessionId],
            )
          : null;
        const summary = questions
          ? JSON.stringify(questions.rows.reverse().map(({ text }) => text))
          : null;
        const id = randomUUID();
        await client.query(
          `INSERT INTO help_request
             (id, session_id, lang, channel, status, include_summary, summary)
           VALUES ($1, $2, $3, $4, 'waiting', $5, $6::jsonb)`,
          [
            id,
            sessionId,
            sessionData.lang,
            sessionData.channel,
            includeSummary,
            summary,
          ],
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return { id, status: "waiting" };
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "Help request transaction and rollback failed",
              { cause: rollbackError },
            );
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async listWaitingRequests(helperId, lang) {
      const result = await pool.query<{
        id: string;
        lang: string;
        channel: "web" | "api" | "telegram";
        created_at: Date;
        summary: string[] | null;
      }>(
        `SELECT request.id, request.lang, request.channel,
                request.created_at, request.summary
         FROM help_request AS request
         JOIN helper ON helper.id = $1 AND helper.active
         WHERE request.status = 'waiting'
           AND request.lang = ANY(helper.langs)
           AND ($2::text IS NULL OR request.lang = $2)
           AND NOT EXISTS (
             SELECT 1 FROM help_request_block AS blocked
             WHERE blocked.help_request_id = request.id
               AND blocked.helper_id = helper.id
           )
         ORDER BY request.created_at, request.id`,
        [helperId, lang ?? null],
      );
      return result.rows.map((row) => ({
        id: row.id,
        lang: row.lang,
        channel: row.channel,
        createdAt: row.created_at.toISOString(),
        summary: row.summary,
      }));
    },
    async blockWaitingRequest(requestId, helperId) {
      await pool.query(
        `INSERT INTO help_request_block (helper_id, help_request_id)
         SELECT $2, request.id
         FROM help_request AS request
         WHERE request.id = $1 AND request.status = 'waiting'
         ON CONFLICT (helper_id, help_request_id) DO NOTHING`,
        [requestId, helperId],
      );
      const result = await pool.query(
        `SELECT 1 FROM help_request
         WHERE id = $1 AND status = 'waiting'`,
        [requestId],
      );
      return result.rowCount === 1;
    },
    async closeRequest(requestId, actor: HelpCloseActor, resolved?: boolean) {
      const result =
        actor.role === "learner"
          ? await pool.query(
              `UPDATE help_request
               SET status = 'closed', closed_at = now()
               WHERE id = $1 AND session_id = $2
                 AND status IN ('waiting', 'claimed')
               RETURNING id`,
              [requestId, actor.sessionId],
            )
          : await pool.query(
              `UPDATE help_request
               SET status = 'closed', closed_at = now(), resolved = $3
               WHERE id = $1 AND helper_id = $2 AND status = 'claimed'
               RETURNING id`,
              [requestId, actor.helperId, resolved ?? null],
            );
      return result.rowCount === 1;
    },
  };
}
