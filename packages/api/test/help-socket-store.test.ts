import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPostgresHelpSocketStore } from "../src/db/help-socket-store.js";

describe("NFR-PRIV-04 screen-share consent audit", () => {
  it("stores only anonymous notice metadata and derives channel from the claimed request", async () => {
    const query = vi.fn(async () => ({ rowCount: 1 }));
    const store = createPostgresHelpSocketStore({
      query,
    } as unknown as pg.Pool);
    expect(await store.recordShareConsent("authorized-request")).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as unknown as [string, string[]];
    expect(sql).toMatch(
      /INSERT INTO consent_log\s*\(id, channel, notice_version, purpose\)/u,
    );
    expect(sql).toContain(
      "SELECT $1, channel, 'screen-share-v1', 'screen-share'",
    );
    expect(sql).toContain(
      "FROM help_request WHERE id = $2 AND status = 'claimed'",
    );
    expect(values).toHaveLength(2);
    expect(values[0]).toMatch(/^[\da-f-]{36}$/u);
    expect(values[1]).toBe("authorized-request");
  });

  it("does not acknowledge consent for a request that is no longer claimed", async () => {
    const query = vi.fn(async () => ({ rowCount: 0 }));
    const store = createPostgresHelpSocketStore({
      query,
    } as unknown as pg.Pool);
    expect(await store.recordShareConsent("closed-request")).toBe(false);
  });
});
