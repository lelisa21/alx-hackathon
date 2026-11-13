import type pg from "pg";
import { randomUUID } from "node:crypto";
import type { HelpSocketMessage, HelpSocketStore } from "../help-sockets.js";

export function createPostgresHelpSocketStore(pool: pg.Pool): HelpSocketStore {
  return {
    async recordShareConsent(requestId) {
      const result = await pool.query(
        `INSERT INTO consent_log (id, channel, notice_version, purpose)
         SELECT $1, channel, 'screen-share-v1', 'screen-share'
         FROM help_request WHERE id = $2 AND status = 'claimed'`,
        [randomUUID(), requestId],
      );
      return result.rowCount === 1;
    },
    async getHelperName(requestId) {
      const result = await pool.query<{ public_display_name: string | null }>(
        `SELECT helper.public_display_name
         FROM help_request h JOIN helper ON helper.id = h.helper_id
         WHERE h.id = $1 AND h.status = 'claimed' AND helper.active`,
        [requestId],
      );
      return result.rows[0]?.public_display_name ?? undefined;
    },
    async authenticateLearner(requestId, sessionId, tokenHash) {
      const result = await pool.query(
        `SELECT 1
         FROM help_request h
         JOIN session s ON s.id = h.session_id
         WHERE h.id = $1 AND h.status <> 'closed'
           AND s.id = $2 AND s.token_hash = $3`,
        [requestId, sessionId, tokenHash],
      );
      return result.rowCount === 1;
    },
    async isHelperActive(helperId) {
      const result = await pool.query(
        "SELECT 1 FROM helper WHERE id = $1 AND active",
        [helperId],
      );
      return result.rowCount === 1;
    },
    async isHelperClaimed(requestId, helperId) {
      const result = await pool.query(
        `SELECT 1 FROM help_request
         WHERE id = $1 AND helper_id = $2 AND status = 'claimed'`,
        [requestId, helperId],
      );
      return result.rowCount === 1;
    },
    async listMessagesAfter(requestId, lastMessageId) {
      const result = await pool.query<HelpSocketMessage>(
        `SELECT id, sender, text
         FROM help_message
         WHERE help_request_id = $1
           AND created_at > COALESCE(
             (SELECT created_at FROM help_message
              WHERE id = $2 AND help_request_id = $1),
             'epoch'::timestamptz
           )
         ORDER BY created_at, id`,
        [requestId, lastMessageId ?? ""],
      );
      return result.rows;
    },
    async persistMessage(requestId, sender, id, text) {
      const client = await pool.connect();
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        const request = await client.query<{ status: string }>(
          "SELECT status FROM help_request WHERE id = $1 FOR UPDATE",
          [requestId],
        );
        if (request.rowCount !== 1 || request.rows[0]?.status === "closed") {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return "rejected";
        }

        const inserted = await client.query(
          `INSERT INTO help_message
             (id, help_request_id, sender, text, created_at)
           VALUES (
             $1, $2, $3, $4,
             GREATEST(
               clock_timestamp(),
               COALESCE(
                 (SELECT max(created_at) + interval '1 microsecond'
                  FROM help_message WHERE help_request_id = $2),
                 '-infinity'::timestamptz
               )
             )
           )
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [id, requestId, sender, text],
        );
        if (inserted.rowCount === 1) {
          await client.query("COMMIT");
          transactionOpen = false;
          return "stored";
        }

        const existing = await client.query<{
          help_request_id: string;
          sender: "learner" | "helper";
          text: string;
        }>(
          `SELECT help_request_id, sender, text
           FROM help_message WHERE id = $1`,
          [id],
        );
        const message = existing.rows[0];
        const isSameMessage =
          message?.help_request_id === requestId &&
          message.sender === sender &&
          message.text === text;
        await client.query("COMMIT");
        transactionOpen = false;
        return isSameMessage ? "duplicate" : "rejected";
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "Help message transaction and rollback failed",
              { cause: rollbackError },
            );
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
