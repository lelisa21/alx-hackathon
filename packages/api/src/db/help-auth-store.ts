import type pg from "pg";
import type { HelpAuthStore } from "../types.js";

export function createPostgresHelpAuthStore(pool: pg.Pool): HelpAuthStore {
  return {
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
        `UPDATE help_request
         SET status = 'claimed', claimed_at = now(), helper_id = $2
         WHERE id = $1 AND status = 'waiting'
         RETURNING id`,
        [requestId, helperId],
      );
      return result.rowCount === 1;
    },
  };
}
