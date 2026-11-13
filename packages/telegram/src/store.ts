import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ContactCipher } from "@dimts/jobs";
import type { TelegramRecord, TelegramPrivateState } from "./types.js";
export interface TelegramLockedStore {
  load(): Promise<TelegramRecord | null>;
  save(record: TelegramRecord): Promise<void>;
  isStopped(): Promise<boolean>;
  clear(): Promise<void>;
}
export interface TelegramStore {
  withContact<T>(
    hash: string,
    work: (store: TelegramLockedStore) => Promise<T>,
  ): Promise<T>;
  revoke(
    hash: string,
    now: Date,
    cutoff?: number,
  ): Promise<{ lang: string; sessionId: string | null }>;
  claimDelivery(hash: string, key: string): Promise<boolean>;
  isSessionCurrent(hash: string, sessionId: string): Promise<boolean>;
}
export function emptyTelegramState(): TelegramPrivateState {
  return { step: "ready" };
}
function blank(hash: string, now: number): TelegramRecord {
  return {
    contactHash: hash,
    sessionId: null,
    lang: "en",
    stopped: false,
    lastUpdate: -1,
    windowAt: now,
    windowCount: 0,
    expiresAt: now + 86400000,
    state: emptyTelegramState(),
  };
}
/** Test adapter. Production state is encrypted in PostgreSQL. */
export class MemoryTelegramStore implements TelegramStore {
  private readonly records = new Map<string, TelegramRecord>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly deliveries = new Map<string, number>();
  async isSessionCurrent(hash: string, sessionId: string): Promise<boolean> {
    return this.records.get(hash)?.sessionId === sessionId;
  }
  inspect(): TelegramRecord[] {
    return structuredClone([...this.records.values()]);
  }
  async revoke(
    hash: string,
    now: Date,
    cutoff?: number,
  ): Promise<{ lang: string; sessionId: string | null }> {
    const record = this.records.get(hash) ?? blank(hash, now.getTime());
    record.replayCutoff = Math.max(
      record.replayCutoff ?? -1,
      record.lastUpdate,
      cutoff ?? -1,
    );
    record.expiresAt = now.getTime() + 86400000;
    record.stopped = true;
    record.state = emptyTelegramState();
    this.records.set(hash, record);
    return { lang: record.lang, sessionId: record.sessionId };
  }
  async claimDelivery(hash: string, key: string): Promise<boolean> {
    const now = Date.now();
    for (const [k, at] of this.deliveries)
      if (at <= now - 86400000) this.deliveries.delete(k);
    const id = hash + ":" + createHash("sha256").update(key).digest("hex");
    if (this.deliveries.has(id)) return false;
    if (
      key.startsWith("update:") &&
      [...this.deliveries.keys()].filter((k) => k.startsWith(hash + ":"))
        .length >= 10000
    )
      return false;
    this.deliveries.set(id, now);
    return true;
  }
  async withContact<T>(
    hash: string,
    work: (store: TelegramLockedStore) => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(hash) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    this.locks.set(hash, next);
    await previous;
    try {
      return await work({
        load: async () => {
          const row = structuredClone(this.records.get(hash) ?? null);
          if (row && row.expiresAt <= Date.now()) {
            row.state = emptyTelegramState();
            row.replayCutoff = -1;
          }
          return row;
        },
        save: async (record) => {
          if (!record.stopped && this.records.get(hash)?.stopped) {
            record.state = emptyTelegramState();
            record.replayCutoff = this.records.get(hash)?.replayCutoff ?? -1;
          }
          record.stopped = record.stopped || !!this.records.get(hash)?.stopped;
          this.records.set(hash, structuredClone(record));
        },
        isStopped: async () => !!this.records.get(hash)?.stopped,
        clear: async () => {
          const row = this.records.get(hash);
          if (row) {
            row.state = emptyTelegramState();
            row.sessionId = null;
          }
          for (const key of this.deliveries.keys())
            if (key.startsWith(hash + ":")) this.deliveries.delete(key);
        },
      });
    } finally {
      release();
      if (this.locks.get(hash) === next) this.locks.delete(hash);
    }
  }
}
export class TelegramBusyError extends Error {
  constructor() {
    super("busy");
  }
}
export class PostgresTelegramStore implements TelegramStore {
  private readonly cipher: ContactCipher;
  private readonly pool: Pool;
  private readonly revocationPool: Pool;
  constructor(
    pool: Pool,
    encryptionKey: Buffer,
    hashKey: Buffer,
    revocationPool?: Pool,
  ) {
    this.pool = pool;
    this.revocationPool = revocationPool ?? pool;
    this.cipher = new ContactCipher(encryptionKey, hashKey);
  }
  async revoke(
    hash: string,
    now: Date,
    cutoff?: number,
  ): Promise<{ lang: string; sessionId: string | null }> {
    const client = await this.revocationPool.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,809))",
          [hash],
        );
        const row = (
          await client.query<{ lang: string; session_id: string | null }>(
            "INSERT INTO telegram_conversation(contact_hash,stopped_at,expires_at,replay_cutoff) VALUES($1,$2::timestamptz,$2::timestamptz+interval '24 hours',$3) ON CONFLICT(contact_hash) DO UPDATE SET stopped_at=COALESCE(telegram_conversation.stopped_at,EXCLUDED.stopped_at),private_enc=NULL,expires_at=EXCLUDED.expires_at,replay_cutoff=GREATEST(telegram_conversation.replay_cutoff,telegram_conversation.last_update,EXCLUDED.replay_cutoff) RETURNING lang,session_id",
            [hash, now, cutoff ?? -1],
          )
        ).rows[0]!;
        await client.query("COMMIT");
        return { lang: row.lang, sessionId: row.session_id };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }
  async claimDelivery(hash: string, key: string): Promise<boolean> {
    const keyHash = createHash("sha256").update(key).digest("hex");
    const result = await this.revocationPool.query(
      "INSERT INTO telegram_delivery(contact_hash,key_hash) SELECT $1,$2 WHERE $3::boolean OR (SELECT count(*) FROM telegram_delivery WHERE contact_hash=$1)<10000 ON CONFLICT DO NOTHING RETURNING key_hash",
      [hash, keyHash, !key.startsWith("update:")],
    );
    return result.rows.length === 1;
  }
  async withContact<T>(
    hash: string,
    work: (store: TelegramLockedStore) => Promise<T>,
  ): Promise<T> {
    const client = await this.acquire(hash);
    let discarded = false;
    try {
      return await work({
        load: () => this.load(client, hash),
        save: (record) => this.save(client, record),
        isStopped: async () =>
          (
            await client.query(
              "SELECT 1 FROM telegram_conversation WHERE contact_hash=$1 AND stopped_at IS NOT NULL",
              [hash],
            )
          ).rows.length > 0,
        clear: async () => {
          await client.query(
            "UPDATE telegram_conversation SET private_enc=NULL,session_id=NULL WHERE contact_hash=$1",
            [hash],
          );
          await client.query(
            "DELETE FROM telegram_delivery WHERE contact_hash=$1",
            [hash],
          );
        },
      });
    } finally {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,808))",
          [hash],
        );
      } catch {
        client.release(true);
        discarded = true;
      }
      if (!discarded) client.release();
    }
  }
  async isSessionCurrent(hash: string, sessionId: string): Promise<boolean> {
    return (
      (
        await this.revocationPool.query(
          "SELECT 1 FROM telegram_conversation t JOIN session s ON s.id=t.session_id WHERE t.contact_hash=$1 AND s.id=$2",
          [hash, sessionId],
        )
      ).rows.length === 1
    );
  }
  private async acquire(hash: string): Promise<PoolClient> {
    const deadline = Date.now() + 200;
    for (;;) {
      const client = await this.pool.connect();
      try {
        if (
          (
            await client.query<{ acquired: boolean }>(
              "SELECT pg_try_advisory_lock(hashtextextended($1,808)) AS acquired",
              [hash],
            )
          ).rows[0]?.acquired
        )
          return client;
      } catch (error) {
        client.release(true);
        throw error;
      }
      client.release();
      if (Date.now() >= deadline) throw new TelegramBusyError();
      await new Promise<void>((r) => setTimeout(r, 20));
    }
  }
  private async load(
    client: PoolClient,
    hash: string,
  ): Promise<TelegramRecord | null> {
    await client.query(
      "UPDATE telegram_conversation SET private_enc=NULL,replay_cutoff=-1 WHERE contact_hash=$1 AND expires_at<=now()",
      [hash],
    );
    await client.query(
      "DELETE FROM telegram_delivery WHERE contact_hash=$1 AND created_at<=now()-interval '24 hours'",
      [hash],
    );
    const row = (
      await client.query<{
        session_id: string | null;
        lang: string;
        stopped_at: Date | null;
        last_update: string;
        replay_cutoff: string;
        window_at: string;
        window_count: number;
        private_enc: Buffer | null;
        expires_at: Date;
      }>("SELECT * FROM telegram_conversation WHERE contact_hash=$1", [hash])
    ).rows[0];
    return row
      ? {
          contactHash: hash,
          sessionId: row.session_id,
          lang: row.lang,
          stopped: row.stopped_at !== null,
          lastUpdate: Number(row.last_update),
          replayCutoff: Number(row.replay_cutoff),
          windowAt: Number(row.window_at),
          windowCount: row.window_count,
          expiresAt: new Date(row.expires_at).getTime(),
          state: row.private_enc
            ? (JSON.parse(
                this.cipher.decrypt(row.private_enc, "telegram:" + hash),
              ) as TelegramPrivateState)
            : emptyTelegramState(),
        }
      : null;
  }
  private async save(
    client: PoolClient,
    record: TelegramRecord,
  ): Promise<void> {
    const encrypted = this.cipher.encrypt(
      JSON.stringify(record.state),
      "telegram:" + record.contactHash,
    );
    const result = await client.query<{ stopped_at: Date | null }>(
      "INSERT INTO telegram_conversation(contact_hash,session_id,lang,stopped_at,last_update,window_at,window_count,private_enc,expires_at,replay_cutoff) VALUES($1,$2,$3,CASE WHEN $4 THEN now() ELSE NULL END,$5,$6,$7,$8,$9,$10) ON CONFLICT(contact_hash) DO UPDATE SET session_id=EXCLUDED.session_id,lang=EXCLUDED.lang,stopped_at=COALESCE(telegram_conversation.stopped_at,EXCLUDED.stopped_at),last_update=GREATEST(telegram_conversation.last_update,EXCLUDED.last_update),replay_cutoff=GREATEST(telegram_conversation.replay_cutoff,EXCLUDED.replay_cutoff),window_at=EXCLUDED.window_at,window_count=EXCLUDED.window_count,private_enc=CASE WHEN telegram_conversation.stopped_at IS NOT NULL AND NOT $4 THEN NULL ELSE EXCLUDED.private_enc END,expires_at=EXCLUDED.expires_at RETURNING stopped_at",
      [
        record.contactHash,
        record.sessionId,
        record.lang,
        record.stopped,
        record.lastUpdate,
        record.windowAt,
        record.windowCount,
        encrypted,
        new Date(record.expiresAt),
        record.replayCutoff ?? -1,
      ],
    );
    if (!record.stopped && result.rows[0]?.stopped_at !== null)
      record.state = emptyTelegramState();
    record.stopped = result.rows[0]?.stopped_at !== null;
  }
}
