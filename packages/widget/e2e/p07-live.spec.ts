// FR-SMS-01/02/05/07/08/09/10: real browser, HTTP API, PostgreSQL and simulator transport.
import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ContactCipher } from "../../jobs/dist/index.js";
import { loadPacks } from "../../locales-tools/src/index.js";
import { buildApp } from "../../api/src/app.js";
import { parseConfig } from "../../api/src/config.js";
import { createPool } from "../../api/src/db/repository.js";
import { applyMigrations } from "../../api/src/db/migrate.js";
import { sha256 } from "../../api/src/middleware/auth.js";

const databaseUrl = process.env.DIMTS_TEST_DATABASE_URL;
const packs = loadPacks(resolve("locales"));
const ui = packs.get("en")!.ui;
const sms = packs.get("en")!.sms as Record<string, string>;
const origin = "http://127.0.0.1:4173";
const phone = "+251900000007";
const secret = "synthetic-live-sms-gateway-secret-long-enough";
const cron = "synthetic-live-sms-cron-secret-long-enough";
const importer = "synthetic-live-sms-importer-secret-long-enough";
const encryptionKey = Buffer.alloc(32, 7);
const hashKey = Buffer.alloc(32, 8);
const environment = {
  NODE_ENV: "test",
  DIMTS_ENC_KEY: encryptionKey.toString("base64"),
  DIMTS_HASH_KEY: hashKey.toString("base64"),
  DIMTS_JWT_SECRET: "synthetic-live-sms-jwt-secret-long-enough-characters",
  DIMTS_CRON_SECRET: cron,
  DIMTS_SMS_GATEWAY_SECRET: secret,
  DIMTS_SMS_MODE: "simulator",
  DIMTS_AI_PROVIDER: "offline",
  DIMTS_AI_LADDER: "offline",
  DIMTS_HOST_ORIGINS: origin,
};

test.describe("P07 real SMS simulator contract", () => {
  test.skip(!databaseUrl, "Requires an isolated DIMTS_TEST_DATABASE_URL");
  let admin: ReturnType<typeof createPool>;
  let pool: ReturnType<typeof createPool>;
  let server: Server;
  let app: ReturnType<typeof buildApp>;
  let api: string;
  const schema = `p07web_${randomUUID().replaceAll("-", "")}`;

  test.beforeAll(async () => {
    admin = createPool(
      parseConfig({ ...environment, DATABASE_URL: databaseUrl }),
    );
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(databaseUrl!);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    const config = parseConfig({
      ...environment,
      DATABASE_URL: scoped.toString(),
    });
    pool = createPool(config);
    const connection = await pool.connect();
    try {
      await applyMigrations(connection, resolve("packages/api/migrations"));
    } finally {
      connection.release();
    }
    await pool.query(
      "INSERT INTO host_key(id,name,key_hash,key_type) VALUES('sms-importer','Synthetic importer',$1,'secret')",
      [sha256(importer)],
    );
    // No injected channel, engine, repository or delivery doubles: this is the production wiring.
    app = buildApp({ config });
    await app.locals.sourceSyncReady;
    server = createServer(app);
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        done();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("SMS fixture server failed");
    api = `http://127.0.0.1:${address.port}/v1`;
  });

  test.afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
    await app?.locals.close();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  test("selects language, tutors, fails closed for callback, consents to actual P06 alert delivery and permanently stops", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const title = "Synthetic SMS trainee";
    const imported = await request.post(`${api}/jobs/import`, {
      headers: { "X-Dimts-Key": importer },
      data: {
        lang: "en",
        postings: {
          "@graph": [
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              title,
              description:
                "Synthetic trainee job. Written questions are available.",
              datePosted: "2026-11-01",
              validThrough: "2099-12-31",
              url: "https://jobs.example.org/sms-trainee",
              hiringOrganization: { name: "Synthetic organization" },
              jobLocation: {
                address: { addressLocality: "Addis", addressRegion: "Addis" },
              },
              employmentType: "PART_TIME",
            },
          ],
        },
      },
    });
    expect(imported.status()).toBe(200);

    // Vite serves the built /sim/sms document and modules over HTTP; no page.route interception.
    await page.goto(`${origin}/sim/sms`);
    await page.getByLabel(ui["smsSim.api"]!, { exact: true }).fill(api);
    await page.getByLabel(ui["smsSim.secret"]!, { exact: true }).fill(secret);
    await page.getByLabel(ui["smsSim.phone"]!, { exact: true }).fill(phone);
    const composer = page.getByLabel(ui["smsSim.message"]!, { exact: true });
    const send = async (text: string) => {
      await composer.fill(text);
      const response = page.waitForResponse(
        (response) =>
          response.url() === `${api}/sms/inbound` &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: ui["smsSim.send"], exact: true })
        .click();
      const completed = await response;
      expect(completed.status()).toBe(200);
      const body = (await completed.json()) as {
        messages: { text: string; status: string; segments: number }[];
        stopped: boolean;
        lang: string;
      };
      await expect(
        page.getByText(ui["smsSim.sending"]!, { exact: true }),
      ).toHaveCount(0);
      return body;
    };

    expect((await send("Hello")).messages[0]!.text).toBe(sms.menu);
    const selected = await send("1");
    expect(selected.lang).toBe("en");
    expect(selected.messages[0]!.text).toBe(sms.welcome);
    const answer = await send("Explain photosynthesis for a learner.");
    expect(answer.messages.length).toBeGreaterThan(0);
    expect(
      answer.messages.every(
        (message) => message.status === "delivered" && message.segments <= 3,
      ),
    ).toBe(true);
    await expect(
      page.getByText(answer.messages[0]!.text, { exact: true }),
    ).toBeVisible();
    expect((await send("HELP")).messages[0]!.text).toBe(sms.unavailable);
    await send("Y");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM consent_log WHERE purpose='callback'",
        )
      ).rows[0].count,
    ).toBe(0);

    expect((await send("JOBS")).messages[0]!.text).toBe(sms.jobs_manage);
    expect((await send("1")).messages[0]!.text).toBe(sms.jobs_type);
    expect((await send("ALL")).messages[0]!.text).toBe(sms.jobs_region);
    expect((await send("ALL")).messages[0]!.text).toBe(sms.jobs_language);
    expect((await send("1")).messages[0]!.text).toBe(sms.jobs_consent);
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM subscription"))
        .rows[0].count,
    ).toBe(0);
    expect((await send("Y")).messages[0]!.text).toBe(sms.jobs_active);
    const subscription = (
      await pool.query("SELECT id,contact_enc,contact_hash FROM subscription")
    ).rows[0];
    expect(Buffer.isBuffer(subscription.contact_enc)).toBe(true);
    expect(subscription.contact_enc.toString()).not.toContain(phone);
    expect(subscription.contact_hash).not.toContain(phone);

    const run = await request.post(`${api}/internal/alerts`, {
      headers: { Authorization: `Bearer ${cron}` },
    });
    expect(run.status()).toBe(200);
    expect((await run.json()).sent).toBe(1);
    const conversation = (
      await pool.query("SELECT phone_hash,private_enc FROM sms_conversation")
    ).rows[0];
    const state = JSON.parse(
      new ContactCipher(encryptionKey, hashKey).decrypt(
        conversation.private_enc,
        `sms:${conversation.phone_hash}`,
      ),
    ) as {
      outbox: { id: string; text: string; status: string; segments: number }[];
    };
    const digest = state.outbox.find((message) => message.text.includes(title));
    expect(digest).toMatchObject({ status: "delivered" });
    expect(digest!.segments).toBeLessThanOrEqual(3);
    expect(
      (
        await pool.query(
          "SELECT status,attempts FROM sms_delivery WHERE id=$1",
          [digest!.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "delivered", attempts: 1 });

    expect((await send("STOP")).stopped).toBe(true);
    await expect(composer).toBeDisabled();
    expect(
      (await pool.query("SELECT stopped_at,private_enc FROM sms_conversation"))
        .rows[0],
    ).toMatchObject({ stopped_at: expect.any(Date), private_enc: null });
    expect(
      (
        await pool.query("SELECT id FROM subscription WHERE id=$1", [
          subscription.id,
        ])
      ).rows,
    ).toEqual([]);
    const stoppedRun = await request.post(`${api}/internal/alerts`, {
      headers: { Authorization: `Bearer ${cron}` },
    });
    expect((await stoppedRun.json()).sent).toBe(0);
    await page.reload();
    await page.getByLabel(ui["smsSim.api"]!, { exact: true }).fill(api);
    await page.getByLabel(ui["smsSim.secret"]!, { exact: true }).fill(secret);
    await page.getByLabel(ui["smsSim.phone"]!, { exact: true }).fill(phone);
    expect(await send("Hello after reload")).toMatchObject({
      messages: [],
      stopped: true,
    });
    expect(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    ).toEqual([0, 0]);
  });
});
