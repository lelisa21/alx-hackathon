import type { Pool, PoolClient } from "pg";
import { ContactCipher } from "@dimts/jobs";
import type { SmsOutbox, SmsPrivateState, SmsRecord } from "./types.js";

export class SmsRevokedError extends Error {
  readonly lang: string;
  constructor(lang: string) {
    super("stopped");
    this.lang = lang;
  }
}
export class SmsBusyError extends Error {
  constructor() {
    super("busy");
  }
}

export function emptySmsState(): SmsPrivateState {
  return { step: "language", receipts: {}, outbox: [] };
}
export interface SmsLockedStore {
  load(): Promise<SmsRecord | null>;
  save(record: SmsRecord): Promise<void>;
  recordCallbackConsent(id: string): Promise<void>;
  isStopped(): Promise<boolean>;
}
export interface SmsStore {
  revoke(
    phoneHash: string,
    confirmation: (lang: string) => SmsOutbox,
    now: Date,
  ): Promise<{ sessionId: string | null; lang: string }>;
  withPhone<T>(
    phoneHash: string,
    work: (store: SmsLockedStore) => Promise<T>,
  ): Promise<T>;
}

/** In-memory adapter for isolated contract tests; production uses PostgreSQL. */
export class MemorySmsStore implements SmsStore {
  private readonly records = new Map<string, SmsRecord>();
  private readonly locks = new Map<string, Promise<void>>();
  readonly callbackConsents = new Set<string>();
  async revoke(
    hash: string,
    confirmation: (lang: string) => SmsOutbox,
    now: Date,
  ): Promise<{ sessionId: string | null; lang: string }> {
    let record = this.records.get(hash);
    if (!record)
      record = {
        phoneHash: hash,
        sessionId: null,
        lang: "en",
        stopped: false,
        stopDelivery: null,
        day: now.toISOString().slice(0, 10),
        count: 0,
        windowAt: now.getTime(),
        windowCount: 0,
        state: emptySmsState(),
      };
    if (record.stopped)
      return { sessionId: record.sessionId, lang: record.lang };
    record.stopped = true;
    record.state = emptySmsState();
    record.stopDelivery = confirmation(record.lang);
    record.count += 1;
    this.records.set(hash, structuredClone(record));
    return { sessionId: record.sessionId, lang: record.lang };
  }
  inspect(): SmsRecord[] {
    return structuredClone([...this.records.values()]);
  }
  async withPhone<T>(
    hash: string,
    work: (store: SmsLockedStore) => Promise<T>,
  ): Promise<T> {
    const prior = this.locks.get(hash) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(hash, next);
    await prior;
    try {
      return await work({
        load: async () => structuredClone(this.records.get(hash) ?? null),
        save: async (record) => {
          if (this.records.get(hash)?.stopped && !record.stopped)
            throw new SmsRevokedError(record.lang);
          this.records.set(hash, structuredClone(record));
        },
        isStopped: async () => this.records.get(hash)?.stopped ?? false,
        recordCallbackConsent: async (id) => {
          this.callbackConsents.add(id);
        },
      });
    } finally {
      release();
      if (this.locks.get(hash) === next) this.locks.delete(hash);
    }
  }
}

/** A session advisory lock serializes one HMAC identity across API processes.
 * Each save commits before any transport/callback effect, allowing safe replay. */
export class PostgresSmsStore implements SmsStore {
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
    confirmation: (lang: string) => SmsOutbox,
    now: Date,
  ): Promise<{ sessionId: string | null; lang: string }> {
    const lang =
      (
        await this.revocationPool.query<{ lang: string }>(
          "SELECT lang FROM sms_conversation WHERE phone_hash=$1",
          [hash],
        )
      ).rows[0]?.lang ?? "en";
    const message = confirmation(lang);
    const revoked = await this.revocationPool.query<{
      session_id: string | null;
      lang: string;
    }>(
      `INSERT INTO sms_conversation(phone_hash,lang,stopped_at,day,outbound_count,window_at,window_count,private_enc,expires_at,stop_delivery)
      VALUES($1,$2,$3,$4,1,$5,0,NULL,$3,$6)
      ON CONFLICT(phone_hash) DO UPDATE SET stopped_at=COALESCE(sms_conversation.stopped_at,EXCLUDED.stopped_at),private_enc=NULL,
      stop_delivery=COALESCE(sms_conversation.stop_delivery,EXCLUDED.stop_delivery),outbound_count=sms_conversation.outbound_count+CASE WHEN sms_conversation.stopped_at IS NULL THEN 1 ELSE 0 END RETURNING session_id,lang`,
      [
        hash,
        lang,
        now,
        now.toISOString().slice(0, 10),
        now.getTime(),
        JSON.stringify(message),
      ],
    );
    await this.revocationPool.query(
      "DELETE FROM sms_delivery WHERE phone_hash=$1 AND id NOT LIKE 'sms-stop:%'",
      [hash],
    );
    return {
      sessionId: revoked.rows[0]!.session_id,
      lang: revoked.rows[0]!.lang,
    };
  }
  async withPhone<T>(
    hash: string,
    work: (store: SmsLockedStore) => Promise<T>,
  ): Promise<T> {
    const client = await this.acquire(hash);
    let locked = false;
    let discarded = false;
    try {
      locked = true;
      return await work({
        load: async () => this.load(client, hash),
        save: async (record) => this.save(client, record),
        isStopped: async () =>
          (
            await client.query(
              "SELECT 1 FROM sms_conversation WHERE phone_hash=$1 AND stopped_at IS NOT NULL",
              [hash],
            )
          ).rows.length > 0,
        recordCallbackConsent: async (id) => {
          await client.query(
            "INSERT INTO consent_log(id,channel,notice_version,purpose) VALUES($1,'sms','sms-callback-v1','callback') ON CONFLICT(id) DO NOTHING",
            [id],
          );
        },
      });
    } finally {
      if (locked) {
        try {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1, 707))",
            [hash],
          );
        } catch {
          client.release(true);
          discarded = true;
        }
      }
      if (!discarded) client.release();
    }
  }
  private async acquire(hash: string): Promise<PoolClient> {
    const deadline = Date.now() + 200;
    for (;;) {
      const client = await this.pool.connect();
      try {
        if (
          (
            await client.query<{ acquired: boolean }>(
              "SELECT pg_try_advisory_lock(hashtextextended($1,707)) AS acquired",
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
      if (Date.now() >= deadline) throw new SmsBusyError();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }
  private async load(
    client: PoolClient,
    hash: string,
  ): Promise<SmsRecord | null> {
    // Enforce idle retention at the read boundary as well as in the scheduler:
    // otherwise the next save could renew an already-expired consent flow.
    await client.query(
      "UPDATE sms_conversation SET private_enc=NULL WHERE phone_hash=$1 AND expires_at<=now() AND private_enc IS NOT NULL",
      [hash],
    );
    const row = (
      await client.query<{
        session_id: string | null;
        lang: string;
        stopped_at: Date | null;
        stop_delivery: SmsRecord["stopDelivery"];
        day: string;
        outbound_count: number;
        window_at: string;
        window_count: number;
        private_enc: Buffer | null;
      }>(
        "SELECT session_id,lang,stopped_at,stop_delivery,day::text,outbound_count,window_at::text,window_count,private_enc FROM sms_conversation WHERE phone_hash=$1",
        [hash],
      )
    ).rows[0];
    if (!row) return null;
    return {
      phoneHash: hash,
      sessionId: row.session_id,
      lang: row.lang,
      stopped: row.stopped_at !== null,
      stopDelivery: row.stop_delivery,
      day: row.day,
      count: row.outbound_count,
      windowAt: Number(row.window_at),
      windowCount: row.window_count,
      state: row.private_enc
        ? (JSON.parse(
            this.cipher.decrypt(row.private_enc, `sms:${hash}`),
          ) as SmsPrivateState)
        : emptySmsState(),
    };
  }
  private async save(client: PoolClient, record: SmsRecord): Promise<void> {
    await client.query("BEGIN");
    try {
      const encrypted = record.stopped
        ? null
        : this.cipher.encrypt(
            JSON.stringify(record.state),
            `sms:${record.phoneHash}`,
          );
      const saved = await client.query(
        `INSERT INTO sms_conversation(phone_hash,session_id,lang,stopped_at,day,outbound_count,window_at,window_count,private_enc,expires_at,stop_delivery)
        VALUES($1,$2,$3,CASE WHEN $4 THEN now() ELSE NULL END,$5,$6,$7,$8,$9,now()+interval '24 hours',$10)
        ON CONFLICT(phone_hash) DO UPDATE SET session_id=EXCLUDED.session_id,lang=EXCLUDED.lang,stopped_at=COALESCE(sms_conversation.stopped_at,EXCLUDED.stopped_at),day=EXCLUDED.day,outbound_count=EXCLUDED.outbound_count,window_at=EXCLUDED.window_at,window_count=EXCLUDED.window_count,private_enc=EXCLUDED.private_enc,expires_at=EXCLUDED.expires_at,stop_delivery=EXCLUDED.stop_delivery
        WHERE sms_conversation.stopped_at IS NULL OR $4 RETURNING phone_hash`,
        [
          record.phoneHash,
          record.sessionId,
          record.lang,
          record.stopped,
          record.day,
          record.count,
          record.windowAt,
          record.windowCount,
          encrypted,
          record.stopDelivery ? JSON.stringify(record.stopDelivery) : null,
        ],
      );
      if (!saved.rows.length) throw new SmsRevokedError(record.lang);
      if (record.stopped)
        await client.query(
          "DELETE FROM sms_delivery WHERE phone_hash=$1 AND id NOT LIKE 'sms-stop:%'",
          [record.phoneHash],
        );
      for (const message of [
        ...record.state.outbox,
        ...(record.stopDelivery ? [record.stopDelivery] : []),
      ]) {
        await client.query(
          `INSERT INTO sms_delivery(id,phone_hash,status,attempts,created_at) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,attempts=EXCLUDED.attempts`,
          [
            message.id,
            record.phoneHash,
            message.status,
            message.attempts,
            new Date(message.createdAt),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}
