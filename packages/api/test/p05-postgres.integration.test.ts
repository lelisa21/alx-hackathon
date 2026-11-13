import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../src/db/migrate.js";
import { createPostgresHelpAuthStore } from "../src/db/help-auth-store.js";
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
});
