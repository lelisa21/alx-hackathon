// FR-JOB-01/03/04/05/09/10 and FR-INT-07: one real browser/API/DB/HTTP delivery path.
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { JobsService } from "../../jobs/dist/index.js";
import { loadPacks } from "../../locales-tools/src/index.js";
import { buildApp } from "../../api/src/app.js";
import { parseConfig } from "../../api/src/config.js";
import {
  createPool,
  createPostgresRepository,
} from "../../api/src/db/repository.js";
import { applyMigrations } from "../../api/src/db/migrate.js";
import { sha256 } from "../../api/src/middleware/auth.js";
import {
  createHostJobsDelivery,
  JOBS_DELIVERY_VERSION,
} from "../../api/src/jobs-delivery.js";
import { createCareerRenderers } from "../../api/src/jobs-format.js";

const databaseUrl = process.env.DIMTS_TEST_DATABASE_URL;
const packs = loadPacks(resolve("locales"));
const ui = packs.get("en")!.ui;
const relaySecret = "synthetic-live-relay-secret-long-enough";
const cronSecret = "synthetic-live-cron-secret-long-enough";
const hostKey = "synthetic-live-widget-public-key";
const importerKey = "synthetic-live-importer-secret-key";
const environment = {
  NODE_ENV: "test",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "synthetic-live-jwt-secret-long-enough-characters",
  DIMTS_CRON_SECRET: cronSecret,
  DIMTS_JOBS_RELAY_URL: "https://synthetic-live-host.example/delivery",
  DIMTS_JOBS_RELAY_SECRET: relaySecret,
  DIMTS_JOBS_RELAY_CHANNELS: "sms",
};

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      done();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Synthetic server did not start");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server | undefined): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

test.describe("P06 live web career contract", () => {
  test.skip(!databaseUrl, "Requires an isolated DIMTS_TEST_DATABASE_URL");
  let admin: ReturnType<typeof createPool>;
  let pool: ReturnType<typeof createPool>;
  let host: Server;
  let apiServer: Server;
  let widgetServer: Server;
  let app: ReturnType<typeof buildApp>;
  let apiUrl: string;
  let fixtureOrigin: string;
  const schema = `p06web_${randomUUID().replaceAll("-", "")}`;
  const deliveries = new Map<string, Record<string, unknown>>();

  test.beforeAll(async () => {
    // Use real HTTP for the document and built assets. Request interception can
    // assign an artificial address space that Chromium blocks from local APIs.
    widgetServer = createServer(async (incoming, response) => {
      const pathname = new URL(incoming.url ?? "/", "http://fixture.invalid")
        .pathname;
      if (pathname === "/") {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(
          `<!doctype html><html lang="en"><head><title>Live career test</title></head><body><dimts-assistant data-api="${apiUrl}" data-host-key="${hostKey}"></dimts-assistant><script type="module" src="/dimts-widget.js"></script></body></html>`,
        );
        return;
      }
      if (!/^\/[A-Za-z0-9._-]+$/u.test(pathname)) {
        response.writeHead(404).end();
        return;
      }
      try {
        const data = await readFile(
          resolve("packages/widget/dist", pathname.slice(1)),
        );
        const type = pathname.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : pathname.endsWith(".json")
            ? "application/json"
            : pathname.endsWith(".woff2")
              ? "font/woff2"
              : "application/octet-stream";
        response.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "no-store",
        });
        response.end(data);
      } catch {
        response.writeHead(404).end();
      }
    });
    fixtureOrigin = await listen(widgetServer);
    admin = createPool(
      parseConfig({ ...environment, DATABASE_URL: databaseUrl }),
    );
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scopedUrl = new URL(databaseUrl!);
    scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
    const config = parseConfig({
      ...environment,
      DATABASE_URL: scopedUrl.toString(),
      DIMTS_HOST_ORIGINS: fixtureOrigin,
    });
    pool = createPool(config);
    const migrationClient = await pool.connect();
    try {
      await applyMigrations(
        migrationClient,
        resolve("packages/api/migrations"),
      );
    } finally {
      migrationClient.release();
    }
    await pool.query(
      "INSERT INTO host_key(id,name,key_hash,key_type,origins) VALUES('widget-host','Synthetic widget',$1,'public',$3),('import-host','Synthetic importer',$2,'secret','{}')",
      [sha256(hostKey), sha256(importerKey), [fixtureOrigin]],
    );
    host = createServer(async (incoming, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as Record<string, unknown>;
      if (
        incoming.headers.authorization !== `Bearer ${relaySecret}` ||
        incoming.headers["idempotency-key"] !== payload.idempotencyKey ||
        payload.version !== JOBS_DELIVERY_VERSION
      ) {
        response.writeHead(400).end();
        return;
      }
      const key = String(payload.idempotencyKey);
      if (!deliveries.has(key)) deliveries.set(key, payload);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          version: JOBS_DELIVERY_VERSION,
          accepted: true,
          idempotencyKey: key,
        }),
      );
    });
    const hostUrl = await listen(host);
    // Test-only transport rewrites the configured HTTPS endpoint to the synthetic loopback host.
    const delivery = createHostJobsDelivery(config, (_url, init) =>
      fetch(`${hostUrl}/delivery`, init),
    );
    const service = new JobsService({
      pool,
      encryptionKey: Buffer.from(config.DIMTS_ENC_KEY, "base64"),
      hashKey: Buffer.from(config.DIMTS_HASH_KEY, "base64"),
      delivery,
      ...createCareerRenderers(packs),
    });
    app = buildApp({
      config,
      repository: createPostgresRepository(pool),
      jobsService: service,
      jobsDelivery: delivery,
    });
    apiServer = createServer(app);
    apiUrl = `${await listen(apiServer)}/v1`;
  });
  test.afterAll(async () => {
    await close(widgetServer);
    await close(apiServer);
    await app?.locals.close();
    await close(host);
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  test("imports, consents, delivers and stops alerts, then sends an approved anonymous request", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60000);
    const title = "Synthetic live trainee";
    const posting = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title,
      description: "Synthetic trainee role. Written questions are available.",
      datePosted: "2026-11-01",
      validThrough: "2099-12-31",
      url: "https://jobs.example.org/live-trainee",
      hiringOrganization: {
        name: "Synthetic live organization",
        contactPoint: { email: "employer@example.org" },
      },
      jobLocation: {
        address: { addressLocality: "Addis", addressRegion: "Addis" },
      },
      employmentType: "PART_TIME",
      accommodationsOffered: ["written_questions"],
    };
    const imported = await request.post(`${apiUrl}/jobs/import`, {
      headers: { "X-Dimts-Key": importerKey },
      data: { lang: "en", postings: { "@graph": [posting] } },
    });
    expect(imported.status()).toBe(200);
    expect(await imported.json()).toEqual({ imported: 1, errors: [] });
    const languagesResponse = await request.get(`${apiUrl}/languages`, {
      headers: { Origin: fixtureOrigin },
    });
    expect(
      languagesResponse.status(),
      "Real API serves language metadata",
    ).toBe(200);
    expect(languagesResponse.headers()["access-control-allow-origin"]).toBe(
      fixtureOrigin,
    );
    expect((await languagesResponse.json()).languages).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "en" })]),
    );
    // Document, modules and API requests all use real HTTP, with no interception.
    const startupDiagnostics: Record<string, unknown>[] = [];
    const recordConsole = (
      message: import("@playwright/test").ConsoleMessage,
    ) => {
      if (message.type() === "error")
        startupDiagnostics.push({
          event: "consoleerror",
          message: message.text().replace(/https?:\/\/[^\s'"<>]+/gu, "[url]"),
        });
    };
    const recordPageError = (error: Error) =>
      startupDiagnostics.push({
        event: "pageerror",
        name: error.name,
        message: error.message.replace(/https?:\/\/[^\s'"<>]+/gu, "[url]"),
      });
    const recordFailure = (failed: import("@playwright/test").Request) =>
      startupDiagnostics.push({
        event: "requestfailed",
        path: new URL(failed.url()).pathname,
        reason: failed.failure()?.errorText,
      });
    const recordResponse = (response: import("@playwright/test").Response) =>
      startupDiagnostics.push({
        event: "response",
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    // Diagnostics are scoped to startup, before any private form input; no headers, query or bodies.
    page.on("pageerror", recordPageError);
    page.on("console", recordConsole);
    page.on("requestfailed", recordFailure);
    page.on("response", recordResponse);
    try {
      await page.goto(`${fixtureOrigin}/`);
      await expect
        .poll(
          () =>
            page.evaluate(() => Boolean(customElements.get("dimts-assistant"))),
          {
            timeout: 15000,
            message: "Built widget registers its custom element",
          },
        )
        .toBe(true);
      const language = page.getByRole("button", {
        name: packs.get("en")!.meta.name_native,
      });
      await expect(
        language,
        "Real API exposes an English language choice",
      ).toBeVisible({ timeout: 15000 });
      await language.click();
    } catch (error) {
      const structure = await page.evaluate(() => ({
        hostCount: document.querySelectorAll("dimts-assistant").length,
        shadowChildren:
          document.querySelector("dimts-assistant")?.shadowRoot
            ?.childElementCount ?? 0,
        scripts: Array.from(
          document.scripts,
          (script) => new URL(script.src, location.href).pathname,
        ),
        bodyChildren: document.body.childElementCount,
      }));
      const diagnosticPath = testInfo.outputPath("career-startup.json");
      await writeFile(
        diagnosticPath,
        JSON.stringify({ structure, events: startupDiagnostics }, null, 2),
        "utf8",
      );
      await testInfo.attach("career-startup-diagnostics", {
        contentType: "application/json",
        path: diagnosticPath,
      });
      throw error;
    } finally {
      page.off("pageerror", recordPageError);
      page.off("console", recordConsole);
      page.off("requestfailed", recordFailure);
      page.off("response", recordResponse);
    }
    await page
      .getByRole("button", { name: ui["jobs.title"], exact: true })
      .click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: ui["jobs.alerts"], exact: true })
      .click();
    const next = () =>
      page.getByRole("button", { name: ui["jobs.next"], exact: true }).click();
    await page.getByLabel(ui["jobs.type"]!, { exact: true }).fill("PART_TIME");
    await next();
    await page.getByLabel(ui["jobs.region"]!, { exact: true }).fill("Addis");
    await next();
    await next();
    await next();
    await expect(
      page.getByLabel(ui["jobs.contact"]!, { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: ui["jobs.next"], exact: true }),
    ).toBeDisabled();
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM subscription")).rows[0].count,
      ),
    ).toBe(0);
    await page.getByLabel(ui["jobs.consent"]!, { exact: true }).check();
    await next();
    await page
      .getByLabel(ui["jobs.contact"]!, { exact: true })
      .fill("+251911111111");
    await next();
    await page
      .getByRole("button", { name: ui["jobs.subscribe"], exact: true })
      .click();
    await expect(
      page
        .locator(".career")
        .getByRole("status")
        .filter({ hasText: ui["jobs.subscribed"]! }),
    ).toBeVisible();
    const subscription = (
      await pool.query("SELECT id,contact_enc,contact_hash FROM subscription")
    ).rows[0];
    expect(Buffer.isBuffer(subscription.contact_enc)).toBe(true);
    expect(subscription.contact_enc.toString()).not.toContain("251911111111");
    expect(subscription.contact_hash).not.toContain("251911111111");
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      ),
    ).not.toContain("251911111111");
    const firstRun = await request.post(`${apiUrl}/internal/alerts`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect(firstRun.status()).toBe(200);
    expect((await firstRun.json()).sent).toBe(1);
    expect(
      [...deliveries.values()].filter((item) => item.kind === "digest"),
    ).toHaveLength(1);
    await page
      .getByRole("button", { name: ui["jobs.stop"], exact: true })
      .click();
    await expect(
      page
        .locator(".career")
        .getByRole("status")
        .filter({ hasText: ui["jobs.stopped"]! }),
    ).toBeVisible();
    expect(
      (
        await pool.query(
          "SELECT contact_enc,contact_hash,stopped_at FROM subscription WHERE id=$1",
          [subscription.id],
        )
      ).rows[0],
    ).toMatchObject({
      contact_enc: null,
      contact_hash: null,
      stopped_at: expect.any(Date),
    });

    await page
      .getByRole("button", { name: ui["jobs.accommodation"], exact: true })
      .click();
    await next();
    await page
      .getByLabel(ui["jobs.supportLabels.written_questions"]!, { exact: true })
      .check();
    await next();
    await next();
    await expect(
      page.getByLabel(ui["jobs.name"]!, { exact: true }),
    ).toHaveValue("");
    await next();
    await page
      .getByLabel(ui["jobs.interviewAt"]!, { exact: true })
      .fill("2099-11-20T09:30");
    await next();
    await expect(
      page.getByRole("button", { name: ui["jobs.approve"], exact: true }),
    ).toBeVisible();
    const exactMessage = (await page
      .locator(".career-exact")
      .textContent())!.trim();
    expect(exactMessage).toContain(title);
    expect(
      [...deliveries.values()].filter((item) => item.kind === "accommodation"),
    ).toHaveLength(0);
    await expect(
      page.getByRole("button", { name: ui["jobs.send"], exact: true }),
    ).toHaveCount(0);
    const draft = (
      await pool.query(
        "SELECT private_enc,needs,approved_at,sent_at FROM accommodation_request",
      )
    ).rows[0];
    expect(draft.private_enc.toString()).not.toContain(exactMessage);
    expect(draft.needs).toEqual([]);
    expect(draft.approved_at).toBeNull();
    expect(draft.sent_at).toBeNull();
    await page
      .getByRole("button", { name: ui["jobs.approve"], exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: ui["jobs.send"], exact: true }),
    ).toBeVisible();
    expect(
      [...deliveries.values()].filter((item) => item.kind === "accommodation"),
    ).toHaveLength(0);
    await page
      .getByRole("button", { name: ui["jobs.send"], exact: true })
      .click();
    await expect(
      page
        .locator(".career")
        .getByRole("status")
        .filter({ hasText: ui["jobs.sent"]! }),
    ).toBeVisible();
    const accommodation = [...deliveries.values()].filter(
      (item) => item.kind === "accommodation",
    );
    expect(accommodation).toHaveLength(1);
    expect(accommodation[0]).toMatchObject({
      to: "employer@example.org",
      message: exactMessage,
      lang: "en",
    });
    expect(accommodation[0]).not.toHaveProperty("name");
    expect(
      (
        await pool.query(
          "SELECT status,delivery_attempted,sent_at FROM accommodation_request",
        )
      ).rows[0],
    ).toMatchObject({
      status: "sent",
      delivery_attempted: true,
      sent_at: expect.any(Date),
    });
  });
});
