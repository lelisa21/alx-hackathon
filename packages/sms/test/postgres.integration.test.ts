import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../../api/src/db/migrate.js";
import { SmsService } from "../src/service.js";
import { PostgresSmsStore } from "../src/store.js";
import { SimulatedSmsGateway } from "../src/gateway.js";
import type { SmsServiceOptions } from "../src/types.js";

const url = process.env.DIMTS_TEST_DATABASE_URL;
const schema = `sms_${randomUUID().replaceAll("-", "")}`;
const strings = {
  menu: "1 English 2 አማርኛ 3 Afaan Oromoo",
  more: "Reply 1 for more.",
  welcome: "Ready.",
  callback: "Reply Y for a callback.",
  callback_sent: "Requested.",
  stopped: "You will get no more messages.",
  unavailable: "Unavailable.",
  error: "Try again.",
  no_more: "No more pages.",
};
describe.skipIf(!url)("P07 durable PostgreSQL SMS", () => {
  let pool: pg.Pool;
  let smsPool: pg.Pool;
  let options: SmsServiceOptions;
  let service: SmsService;
  const ask = vi.fn(async () => "A private tutor answer. ".repeat(90));
  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
      max: 6,
    });
    smsPool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
      max: 4,
    });
    const client = await pool.connect();
    try {
      await applyMigrations(client, resolve("packages/api/migrations"));
    } finally {
      client.release();
    }
    options = {
      pool: smsPool,
      revocationPool: pool,
      encryptionKey: Buffer.alloc(32, 1),
      hashKey: Buffer.alloc(32, 2),
      gateway: new SimulatedSmsGateway(),
      sessions: {
        create: async (lang) => {
          const id = randomUUID();
          await pool.query(
            "INSERT INTO session(id,channel,lang,cloud_ok) VALUES($1,'sms',$2,FALSE)",
            [id, lang],
          );
          return id;
        },
        setLanguage: async (id, lang) => {
          await pool.query("UPDATE session SET lang=$2 WHERE id=$1", [
            id,
            lang,
          ]);
        },
        delete: async (id) => {
          await pool.query("DELETE FROM session WHERE id=$1", [id]);
        },
      },
      locales: () => ({
        strings,
        keywords: {
          help: ["HELP"],
          stop: ["STOP"],
          language: ["LANG"],
          confirm: ["Y"],
        },
      }),
      ask,
      callback: async () => {},
    };
    service = new SmsService(options);
  });
  afterAll(async () => {
    await smsPool?.end();
    if (pool) {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  });
  const inbound = (from: string, text: string, id = randomUUID()) =>
    service.inbound({ id, from, text });
  it("serializes two service instances, deduplicates across restart, encrypts private data and stores no number", async () => {
    const from = "+251911123456";
    await inbound(from, "hello");
    await inbound(from, "3");
    const second = new SmsService(options);
    const input = { id: "same-request", from, text: "PRIVATE QUESTION" };
    const replies = await Promise.all([
      service.inbound(input),
      second.inbound(input),
    ]);
    expect(replies[0]).toEqual(replies[1]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(replies[0].messages[0]?.segments).toBeLessThanOrEqual(3);
    const records = await pool.query("SELECT * FROM sms_conversation");
    expect(records.rows[0].phone_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(Buffer.isBuffer(records.rows[0].private_enc)).toBe(true);
    const dump = JSON.stringify(records.rows);
    expect(dump).not.toContain(from);
    expect(dump).not.toContain("PRIVATE QUESTION");
    expect(dump).not.toContain("private tutor answer");
    const statuses = await pool.query(
      "SELECT status,attempts FROM sms_delivery",
    );
    expect(statuses.rows).toHaveLength(3);
    expect(
      statuses.rows.every(
        (row) => row.status === "delivered" && row.attempts === 1,
      ),
    ).toBe(true);
  });
  it("retains permanent STOP after deleting the session and clears all private ciphertext", async () => {
    const from = "+251911123456";
    const stop = await inbound(from, "STOP");
    expect(stop.messages).toHaveLength(1);
    const row = (await pool.query("SELECT * FROM sms_conversation")).rows[0];
    expect(row.stopped_at).not.toBeNull();
    expect(row.private_enc).toBeNull();
    expect(row.session_id).toBeNull();
    expect(
      (
        await new SmsService(options).inbound({
          id: "after-deletion",
          from,
          text: "hello",
        })
      ).messages,
    ).toEqual([]);
    await expect(
      service.sendAlert({
        contact: from,
        lang: "en",
        text: "No alert.",
        idempotencyKey: "stopped-alert",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it("preserves daily response/alert counters and retry exhaustion after restart", async () => {
    const from = "+251922123456";
    const gateway = new SimulatedSmsGateway({ failuresBeforeSuccess: 3 });
    const failing = new SmsService({ ...options, gateway, dailyLimit: 1 });
    const first = await failing.inbound({ from, text: "hello", id: "fail" });
    expect(first.messages[0]?.status).toBe("failed");
    expect(
      (
        await pool.query(
          "SELECT attempts,status FROM sms_delivery WHERE id=$1",
          [first.messages[0]!.id],
        )
      ).rows[0],
    ).toEqual({ attempts: 3, status: "failed" });
    expect(
      await new SmsService({ ...options, gateway, dailyLimit: 1 }).inbound({
        from,
        text: "hello",
        id: "fail",
      }),
    ).toEqual(first);
    await expect(
      failing.sendAlert({
        contact: from,
        text: "Alert.",
        lang: "en",
        idempotencyKey: "over-cap",
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });
  it("commits STOP outside the held conversation lock and cancels an in-flight tutor response", async () => {
    const from = "+251944123456";
    await inbound(from, "hello");
    await inbound(from, "1");
    let release!: (text: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const slow = new SmsService({
      ...options,
      ask: async () => {
        entered();
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
    });
    const pending = slow.inbound({
      from,
      id: "slow",
      text: "Blocked private question",
    });
    await started;
    const stopping = inbound(from, "STOP");
    await vi.waitFor(
      async () => {
        const hash = createHmac("sha256", Buffer.alloc(32, 2))
          .update(JSON.stringify(["sms", from]))
          .digest("hex");
        const revoked = await pool.query(
          "SELECT 1 FROM sms_conversation WHERE phone_hash=$1 AND stopped_at IS NOT NULL AND private_enc IS NULL",
          [hash],
        );
        expect(revoked.rows.length).toBe(1);
      },
      { timeout: 150, interval: 10 },
    );
    release("This answer must not be delivered.");
    expect((await pending).messages).toEqual([]);
    expect((await stopping).messages[0]?.text).toBe(strings.stopped);
  });
  it("expires idle private flows on read even before the retention scheduler runs", async () => {
    const from = "+251955123456";
    await inbound(from, "hello");
    await inbound(from, "1");
    await inbound(from, "HELP");
    const hash = createHmac("sha256", Buffer.alloc(32, 2))
      .update(JSON.stringify(["sms", from]))
      .digest("hex");
    await pool.query(
      "UPDATE sms_conversation SET expires_at=now()-interval '1 second' WHERE phone_hash=$1",
      [hash],
    );
    const store = new PostgresSmsStore(
      smsPool,
      Buffer.alloc(32, 1),
      Buffer.alloc(32, 2),
      pool,
    );
    const record = await store.withPhone(hash, (locked) => locked.load());
    expect(record?.state.step).toBe("language");
    expect(record?.state.outbox).toEqual([]);
    expect(record?.state.receipts).toEqual({});
    expect(
      (
        await pool.query(
          "SELECT private_enc FROM sms_conversation WHERE phone_hash=$1",
          [hash],
        )
      ).rows[0].private_enc,
    ).toBeNull();
  });
  it("session erasure clears encrypted continuation and consent receipts contain no contact", async () => {
    const from = "+251933123456";
    await inbound(from, "hello");
    await inbound(from, "1");
    await inbound(from, "HELP");
    await inbound(from, "Y");
    const consent = await pool.query(
      "SELECT * FROM consent_log WHERE purpose='callback'",
    );
    expect(consent.rows).toHaveLength(1);
    expect(JSON.stringify(consent.rows)).not.toContain(from);
    const session = (
      await pool.query(
        "SELECT session_id FROM sms_conversation WHERE stopped_at IS NULL AND outbound_count=4",
      )
    ).rows[0].session_id;
    await pool.query("DELETE FROM session WHERE id=$1", [session]);
    const row = (
      await pool.query(
        "SELECT private_enc,session_id FROM sms_conversation WHERE stopped_at IS NULL AND outbound_count=4",
      )
    ).rows[0];
    expect(row).toEqual({ private_enc: null, session_id: null });
  });
});
