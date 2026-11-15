import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../src/db/migrate.js";
import { createPostgresHelpAuthStore } from "../src/db/help-auth-store.js";
import { createPostgresRepository } from "../src/db/repository.js";
import { createPostgresRepository } from "../src/db/repository.js";

const url = process.env.DIMTS_TEST_DATABASE_URL;
describe.skipIf(!url)("P05 durable help media/privacy", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  const schema = `p05_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(url!);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: scoped.toString() });
    const client = new pg.Client({ connectionString: scoped.toString() });
    await client.connect();
    try {
      await applyMigrations(client, resolve("packages/api/migrations"));
      expect(
        await applyMigrations(client, resolve("packages/api/migrations")),
      ).toEqual([]);
    } finally {
      await client.end();
    }
    await pool.query(
      "INSERT INTO session(id,lang,channel) VALUES('s1','en','web'),('s2','en','web')",
    );
    await pool.query(
      "INSERT INTO helper(id,display_name,token_hash,langs) VALUES('h1','Private staff name','hash1',ARRAY['en']),('h2','Other staff name','hash2',ARRAY['en'])",
    );
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  it("enforces summary optout, concurrent claim and five/hour with persisted state", async () => {
    const store = createPostgresHelpAuthStore(pool);
    await pool.query(
      "INSERT INTO message(id,session_id,role,text,lang,kind) VALUES('q1','s1','learner','private question','en','question')",
    );
    const first = (await store.createRequest("s1", false))!;
    expect((await store.listWaitingRequests("h1"))[0]?.summary).toBeNull();
    const claims = await Promise.all([
      store.claimWaitingRequest(first.id, "h1"),
      store.claimWaitingRequest(first.id, "h2"),
    ]);
    expect(claims.sort()).toEqual([false, true]);
    const rest = await Promise.all(
      Array.from({ length: 5 }, () => store.createRequest("s1", false)),
    );
    expect(rest.filter(Boolean)).toHaveLength(4);
  });
  it("authorizes images, hides expired media, purges on close/session end, retains only anonymous metrics", async () => {
    const store = createPostgresHelpAuthStore(pool);
    const actor = { role: "learner", sessionId: "s2" } as const;
    const help = (await store.createRequest("s2", false))!;
    expect(await store.getHelperProfile!("h1")).toEqual({ displayName: null });
    await store.setHelperProfile!("h1", "Ada");
    expect(await store.getHelperProfile!("h1")).toEqual({ displayName: "Ada" });
    const picture = (await store.saveImage!(
      help.id,
      "s2",
      "image/png",
      Buffer.from([1, 2, 3]),
    ))!;
    expect(
      await store.listImages!(help.id, { role: "helper", helperId: "h1" }),
    ).toEqual([]);
    await store.claimWaitingRequest(help.id, "h1");
    expect(
      await store.listImages!(help.id, { role: "helper", helperId: "h1" }),
    ).toEqual([picture]);
    expect(
      await store.getImage!(help.id, picture.id, {
        role: "helper",
        helperId: "h2",
      }),
    ).toBeNull();
    expect(
      await store.saveImage!(help.id, "s1", "image/png", Buffer.from([1])),
    ).toBeNull();
    await pool.query(
      "UPDATE help_image SET created_at=now()-interval '2 hours' WHERE id=$1",
      [picture.id],
    );
    expect(await store.getImage!(help.id, picture.id, actor)).toBeNull();
    await store.deleteExpiredImages!();
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM help_image")).rows[0].count,
      ),
    ).toBe(0);
    await store.saveImage!(help.id, "s2", "image/png", Buffer.from([4]));
    await pool.query(
      "UPDATE help_request SET created_at=now()-interval '2 minutes',claimed_at=now()-interval '1 minute' WHERE id=$1",
      [help.id],
    );
    expect(
      await store.closeRequest(
        help.id,
        { role: "helper", helperId: "h1" },
        true,
      ),
    ).toBe(true);
    expect(
      await store.closeRequest(
        help.id,
        { role: "helper", helperId: "h1" },
        false,
      ),
    ).toBe(false);
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM help_image")).rows[0].count,
      ),
    ).toBe(0);
    const metrics = await store.getMetrics!();
    expect(metrics.closedCount).toBe(1);
    expect(metrics.resolvedCount).toBe(1);
    expect(metrics.unresolvedCount).toBe(0);
    expect(metrics.totalWaitMs).toBeGreaterThanOrEqual(59000);
    expect(metrics.totalResolutionMs).toBeGreaterThanOrEqual(59000);
    const next = (await store.createRequest("s2", false))!;
    await store.saveImage!(next.id, "s2", "image/png", Buffer.from([5]));
    await pool.query("DELETE FROM session WHERE id='s2'");
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM help_image")).rows[0].count,
      ),
    ).toBe(0);
    expect(await store.getMetrics!()).toEqual(metrics);
    const columns = (
      await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='help_service_metric'",
        [schema],
      )
    ).rows.map((row) => row.column_name);
    expect(columns).toEqual([
      "singleton",
      "closed_count",
      "resolved_count",
      "unresolved_count",
      "total_wait_ms",
      "total_resolution_ms",
    ]);
    await createPostgresRepository(pool).runRetention(24);
  });

  it("deletes linked session data across help, jobs, SMS, and Telegram atomically", async () => {
    const sessionId = `p11-${randomUUID()}`;
    const requestId = `p11-help-${randomUUID()}`;
    const imageId = `p11-image-${randomUUID()}`;
    const subscriptionId = `p11-sub-${randomUUID()}`;
    const accommodationId = `p11-accommodation-${randomUUID()}`;
    const phoneHash = randomUUID().replaceAll("-", "").padEnd(64, "0");
    const contactHash = randomUUID().replaceAll("-", "").padEnd(64, "0");
    await pool.query(
      "INSERT INTO session(id,lang,channel,token_hash) VALUES($1,'en','web','p11-token-hash')",
      [sessionId],
    );
    await pool.query(
      "INSERT INTO message(id,session_id,role,text,lang,kind) VALUES($1,$2,'learner','private message','en','question')",
      [`p11-message-${randomUUID()}`, sessionId],
    );
    await pool.query(
      "INSERT INTO help_request(id,session_id,lang,channel,status) VALUES($1,$2,'en','web','waiting')",
      [requestId, sessionId],
    );
    await pool.query(
      "INSERT INTO help_message(id,help_request_id,sender,text) VALUES($1,$2,'learner','private help message')",
      [`p11-help-message-${randomUUID()}`, requestId],
    );
    await pool.query(
      "INSERT INTO help_image(id,help_request_id,mime,data) VALUES($1,$2,'image/png',$3)",
      [imageId, requestId, Buffer.from([1, 2, 3])],
    );
    await pool.query(
      "INSERT INTO subscription(id,session_id,channel,lang,contact_enc) VALUES($1,$2,'sms','en',$3)",
      [subscriptionId, sessionId, Buffer.from([4, 5, 6])],
    );
    await pool.query(
      "INSERT INTO accommodation_request(id,session_id,needs) VALUES($1,$2,'[]'::jsonb)",
      [accommodationId, sessionId],
    );
    await pool.query(
      `INSERT INTO sms_conversation(phone_hash,session_id,lang,day,private_enc,expires_at)
       VALUES($1,$2,'en',CURRENT_DATE,$3,now()+interval '1 day')`,
      [phoneHash, sessionId, Buffer.from([7, 8, 9])],
    );
    await pool.query(
      `INSERT INTO sms_delivery(id,phone_hash,status,attempts,created_at)
       VALUES($1,$2,'queued',0,now())`,
      [`p11-sms-delivery-${randomUUID()}`, phoneHash],
    );
    await pool.query(
      `INSERT INTO telegram_conversation(contact_hash,session_id,lang,last_update,replay_cutoff,window_at,window_count,private_enc,expires_at)
       VALUES($1,$2,'en',1,-1,0,0,$3,now()+interval '1 day')`,
      [contactHash, sessionId, Buffer.from([10, 11, 12])],
    );
    await pool.query(
      `INSERT INTO telegram_delivery(contact_hash,key_hash)
       VALUES($1,$2)`,
      [contactHash, randomUUID().replaceAll("-", "").padEnd(64, "0")],
    );

    await createPostgresRepository(pool).deleteSessionData(sessionId);

    for (const [table, column, value] of [
      ["session", "id", sessionId],
      ["message", "session_id", sessionId],
      ["help_request", "id", requestId],
      ["help_message", "help_request_id", requestId],
      ["help_image", "id", imageId],
      ["subscription", "id", subscriptionId],
      ["accommodation_request", "id", accommodationId],
    ]) {
      const remaining = await pool.query(
        `SELECT 1 FROM ${table} WHERE ${column}=$1`,
        [value],
      );
      expect(remaining.rows).toHaveLength(0);
    }

    const sms = await pool.query<{
      session_id: string | null;
      private_enc: Buffer | null;
    }>(
      "SELECT session_id,private_enc FROM sms_conversation WHERE phone_hash=$1",
      [phoneHash],
    );
    expect(sms.rows[0]).toEqual({ session_id: null, private_enc: null });
    expect(
      await pool.query("SELECT 1 FROM sms_delivery WHERE phone_hash=$1", [
        phoneHash,
      ]),
    ).toMatchObject({ rows: [] });

    const telegram = await pool.query<{
      session_id: string | null;
      private_enc: Buffer | null;
    }>(
      "SELECT session_id,private_enc FROM telegram_conversation WHERE contact_hash=$1",
      [contactHash],
    );
    expect(telegram.rows[0]).toEqual({ session_id: null, private_enc: null });
    expect(
      await pool.query(
        "SELECT 1 FROM telegram_delivery WHERE contact_hash=$1",
        [contactHash],
      ),
    ).toMatchObject({ rows: [] });
  });

  it("runs retention against an injected clock for sessions, images, subscriptions, and cache", async () => {
    const clock = new Date(Date.now() - 1000);
    const sessionId = `p11-retention-${randomUUID()}`;
    const liveSessionId = `p11-retention-live-${randomUUID()}`;
    const requestId = `p11-retention-help-${randomUUID()}`;
    const imageId = `p11-retention-image-${randomUUID()}`;
    const subscriptionId = `p11-retention-sub-${randomUUID()}`;
    const smsHash = randomUUID().replaceAll("-", "").padEnd(64, "0");
    const telegramHash = randomUUID().replaceAll("-", "").padEnd(64, "0");
    await pool.query(
      "INSERT INTO session(id,lang,channel,last_seen_at) VALUES($1,'en','web',$2)",
      [sessionId, new Date(clock.getTime() - 25 * 60 * 60 * 1000)],
    );
    // Rows below belong to a still-live session, so each must expire by its
    // own deadline rather than by the expired session's cascade.
    await pool.query(
      "INSERT INTO session(id,lang,channel,last_seen_at) VALUES($1,'en','web',$2)",
      [liveSessionId, clock],
    );
    await pool.query(
      "INSERT INTO help_request(id,session_id,lang,channel,status) VALUES($1,$2,'en','web','closed')",
      [requestId, liveSessionId],
    );
    await pool.query(
      "INSERT INTO help_image(id,help_request_id,mime,data,created_at) VALUES($1,$2,'image/png',$3,$4)",
      [
        imageId,
        requestId,
        Buffer.from([1]),
        new Date(clock.getTime() - 3 * 60 * 60 * 1000),
      ],
    );
    await pool.query(
      "INSERT INTO subscription(id,session_id,channel,lang,contact_enc,consent_expires_at) VALUES($1,$4,'sms','en',$2,$3)",
      [
        subscriptionId,
        Buffer.from([1]),
        new Date(clock.getTime() - 1),
        liveSessionId,
      ],
    );
    await pool.query(
      "INSERT INTO answer_cache(cache_key,reply,created_at) VALUES($1,'{}'::jsonb,$2)",
      [
        `p11-cache-${randomUUID()}`,
        new Date(clock.getTime() - 25 * 60 * 60 * 1000),
      ],
    );
    await pool.query(
      `INSERT INTO sms_conversation(phone_hash,session_id,lang,day,private_enc,expires_at)
       VALUES($1,$4,'en',CURRENT_DATE,$2,$3)`,
      [smsHash, Buffer.from([1]), new Date(clock.getTime() - 1), liveSessionId],
    );
    await pool.query(
      `INSERT INTO telegram_conversation(contact_hash,session_id,lang,last_update,replay_cutoff,window_at,window_count,private_enc,expires_at)
       VALUES($1,$4,'en',1,-1,0,0,$2,$3)`,
      [
        telegramHash,
        Buffer.from([1]),
        new Date(clock.getTime() - 1),
        liveSessionId,
      ],
    );

    await createPostgresRepository(pool, () => clock).runRetention(24);

    expect(
      await pool.query("SELECT 1 FROM session WHERE id=$1", [sessionId]),
    ).toMatchObject({ rows: [] });
    expect(
      await pool.query("SELECT 1 FROM help_image WHERE id=$1", [imageId]),
    ).toMatchObject({ rows: [] });
    expect(
      await pool.query("SELECT 1 FROM subscription WHERE id=$1", [
        subscriptionId,
      ]),
    ).toMatchObject({ rows: [] });
    expect(
      await pool.query(
        "SELECT 1 FROM answer_cache WHERE cache_key LIKE 'p11-cache-%'",
      ),
    ).toMatchObject({ rows: [] });
    const sms = await pool.query(
      "SELECT private_enc FROM sms_conversation WHERE phone_hash=$1",
      [smsHash],
    );
    expect(sms.rows[0]?.private_enc).toBeNull();
    const telegram = await pool.query(
      "SELECT private_enc FROM telegram_conversation WHERE contact_hash=$1",
      [telegramHash],
    );
    expect(telegram.rows[0]?.private_enc).toBeNull();
  });
});
