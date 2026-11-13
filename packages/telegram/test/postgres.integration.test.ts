import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../api/src/db/migrate.js";
import { ContactCipher } from "@dimts/jobs";
import { PostgresTelegramStore } from "../src/store.js";
const url = process.env.DIMTS_TEST_DATABASE_URL;
const schema = "telegram_" + randomUUID().replaceAll("-", "");
describe.skipIf(!url)("P08 durable encrypted Telegram state", () => {
  let pool: pg.Pool;
  let store: PostgresTelegramStore;
  const hash = new ContactCipher(Buffer.alloc(32, 1), Buffer.alloc(32, 2)).hash(
    "telegram",
    "12345",
  );
  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url });
    await admin.query("CREATE SCHEMA " + schema);
    await admin.end();
    pool = new pg.Pool({
      connectionString: url,
      options: "-c search_path=" + schema,
      max: 6,
    });
    const client = await pool.connect();
    try {
      await applyMigrations(client, resolve("packages/api/migrations"));
    } finally {
      client.release();
    }
    await pool.query(
      "INSERT INTO session(id,channel,lang) VALUES('tg-session','telegram','en')",
    );
    store = new PostgresTelegramStore(
      pool,
      Buffer.alloc(32, 1),
      Buffer.alloc(32, 2),
    );
  });
  afterAll(async () => {
    if (pool) {
      await pool.query("DROP SCHEMA " + schema + " CASCADE");
      await pool.end();
    }
  });
  it("encrypts pending transcript and expires it at read", async () => {
    await store.withContact(hash, async (locked) => {
      await locked.save({
        contactHash: hash,
        sessionId: "tg-session",
        lang: "en",
        stopped: false,
        lastUpdate: 1,
        windowAt: 0,
        windowCount: 0,
        expiresAt: Date.now() + 86400000,
        state: {
          step: "ready",
          voice: {
            text: "private transcript",
            id: 1,
            expiresAt: Date.now() + 86400000,
          },
        },
      });
    });
    const row = (
      await pool.query(
        "SELECT * FROM telegram_conversation WHERE contact_hash=$1",
        [hash],
      )
    ).rows[0];
    expect(Buffer.isBuffer(row.private_enc)).toBe(true);
    expect(row.private_enc.toString()).not.toContain("private transcript");
    expect(JSON.stringify(row)).not.toContain("12345");
    await pool.query(
      "UPDATE telegram_conversation SET expires_at=now()-interval '1 second' WHERE contact_hash=$1",
      [hash],
    );
    await store.withContact(hash, async (locked) =>
      expect((await locked.load())?.state).toEqual({ step: "ready" }),
    );
  });
  it("persists out-of-order update receipts across store instances", async () => {
    expect(await store.claimDelivery(hash, "update:1002")).toBe(true);
    expect(await store.claimDelivery(hash, "update:1001")).toBe(true);
    const restarted = new PostgresTelegramStore(
      pool,
      Buffer.alloc(32, 1),
      Buffer.alloc(32, 2),
    );
    expect(await restarted.claimDelivery(hash, "update:1001")).toBe(false);
  });
  it("commits delivery claims durably and STOP bypasses active advisory lock", async () => {
    expect(await store.claimDelivery(hash, "message:1")).toBe(true);
    expect(await store.claimDelivery(hash, "message:1")).toBe(false);
    await store.withContact(hash, async (locked) => {
      const row = (await locked.load())!;
      await store.revoke(hash, new Date());
      row.stopped = false;
      await locked.save(row);
      expect(await locked.isStopped()).toBe(true);
    });
  });
  it("prevents another channel reactivating a permanently stopped Telegram contact", async () => {
    await expect(
      pool.query(
        "INSERT INTO subscription(id,session_id,channel,lang,contact_hash,contact_enc,consent_expires_at,notice_version,client_request_id) VALUES('reactivate','tg-session','telegram','en',$1,$2,now()+interval '1 day','job-alerts-v1','reactivate')",
        [hash, Buffer.from("encrypted")],
      ),
    ).rejects.toThrow("Telegram alerts stopped");
  });
  it("session erasure clears pending state and delivery metadata preserving minimal STOP", async () => {
    await store.withContact(hash, async (locked) => {
      const row = (await locked.load())!;
      row.state = { step: "jobs_type", jobType: "private job" };
      await locked.save(row);
    });
    await pool.query("DELETE FROM session WHERE id='tg-session'");
    const row = (
      await pool.query(
        "SELECT * FROM telegram_conversation WHERE contact_hash=$1",
        [hash],
      )
    ).rows[0];
    expect(row.private_enc).toBeNull();
    expect(row.session_id).toBeNull();
    expect(Number(row.replay_cutoff)).toBeGreaterThanOrEqual(
      Number(row.last_update),
    );
    expect(row.stopped_at).not.toBeNull();
    expect(
      (
        await pool.query(
          "SELECT * FROM telegram_delivery WHERE contact_hash=$1",
          [hash],
        )
      ).rows,
    ).toHaveLength(0);
  });
});
