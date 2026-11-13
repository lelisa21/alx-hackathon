import { test, expect } from "@playwright/test";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { loadPacks } from "../../locales-tools/src/index.js";

const packs = loadPacks(resolve("locales"));
let server: Server;
let origin: string;
const bytesPerSecond = 400_000 / 8;
const responseLatencyMs = 400;
const transfers: {
  path: string;
  receivedAtMs: number;
  firstByteAtMs: number | null;
  completedAtMs: number | null;
  compressedBytes: number;
  sentBytes: number;
}[] = [];
let linkQueue: Promise<void> = Promise.resolve();
let fixtureStartedAt = 0;

async function waitUntil(deadline: number): Promise<void> {
  while (performance.now() < deadline) {
    await new Promise((resolveTimer) =>
      setTimeout(resolveTimer, Math.ceil(deadline - performance.now())),
    );
  }
}

async function pacedResponse(
  response: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  transfer: (typeof transfers)[number],
): Promise<void> {
  const compressed = gzipSync(body);
  transfer.compressedBytes = compressed.length;
  // Server-side pacing covers page, service-worker, and precache requests alike.
  // The first byte waits one simulated RTT. All gzip bodies share one FIFO link.
  await waitUntil(fixtureStartedAt + transfer.receivedAtMs + responseLatencyMs);
  const sending = linkQueue.then(async () => {
    if (response.destroyed) return;
    response.writeHead(status, {
      "Content-Type": type,
      "Content-Encoding": "gzip",
      "Content-Length": compressed.length,
      "Cache-Control": "no-store",
    });
    response.flushHeaders();
    const bodyStartedAt = performance.now();
    transfer.firstByteAtMs = bodyStartedAt - fixtureStartedAt;
    for (let offset = 0; offset < compressed.length; offset += 1024) {
      const chunk = compressed.subarray(offset, offset + 1024);
      // Absolute cumulative deadlines avoid adding the OS timer quantum to
      // every chunk while never sending more than the elapsed byte budget.
      await waitUntil(
        bodyStartedAt + ((offset + chunk.length) / bytesPerSecond) * 1000,
      );
      if (response.destroyed) return;
      response.write(chunk);
      transfer.sentBytes += chunk.length;
    }
    response.end();
    transfer.completedAtMs = performance.now() - fixtureStartedAt;
  });
  linkQueue = sending.catch(() => undefined);
  await sending;
}

test.beforeAll(async () => {
  fixtureStartedAt = performance.now();
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const transfer: (typeof transfers)[number] = {
      path: pathname,
      receivedAtMs: performance.now() - fixtureStartedAt,
      firstByteAtMs: null,
      completedAtMs: null,
      compressedBytes: 0,
      sentBytes: 0,
    };
    transfers.push(transfer);
    void (async () => {
      let body: string | Buffer;
      let type: string;
      if (pathname === "/") {
        type = "text/html";
        body =
          '<!doctype html><html lang="en"><head><title>Dimts throttling fixture</title></head><body><script async src="/dimts-embed.js" data-api="/v1" data-host-key="public-performance-fixture" data-lang="en"></script></body></html>';
      } else if (pathname.startsWith("/v1/")) {
        type = "application/json";
        if (pathname.endsWith("/languages"))
          body = JSON.stringify({
            languages: [
              {
                code: "en",
                nameNative: "English",
                nameEn: "English",
                script: "Latin",
                dir: "ltr",
                status: "beta",
                stt: false,
                tts: false,
              },
            ],
          });
        else if (pathname.endsWith("/ui"))
          body = JSON.stringify(packs.get("en")!.ui);
        else if (pathname.endsWith("/faq"))
          body = JSON.stringify({
            lang: "en",
            dir: "ltr",
            contentVersion: "fixture-v1",
            reviewedOn: null,
            items: [],
          });
        else if (pathname.endsWith("/sessions"))
          body = JSON.stringify({
            sessionId: "session-12345678",
            sessionToken: "session-token",
            resumeToken: "resume-token-12345678901234567890",
            lang: "en",
          });
        else body = "{}";
      } else {
        type = pathname.endsWith(".js")
          ? "text/javascript"
          : pathname.endsWith(".woff2")
            ? "font/woff2"
            : "application/json";
        body = await readFile(
          resolve("packages/widget/dist", basename(pathname)),
        );
      }
      await pacedResponse(response, 200, type, body, transfer);
    })().catch(async () => {
      if (!response.headersSent)
        await pacedResponse(response, 404, "text/plain", "", transfer);
      else response.destroy();
    });
  });
  await new Promise<void>((resolveListening) =>
    server.listen(0, "127.0.0.1", resolveListening),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server address");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolveClosed, reject) =>
    server.close((error) => (error ? reject(error) : resolveClosed())),
  );
});

test("NFR-PERF-02 real compressed requests at 400 kbps/400 ms show launcher within 3 s and ready chat within 6 s", async ({
  page,
  context,
}, testInfo) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.addInitScript(() => {
    const marks: { launcherMs: number | null; chatReadyMs: number | null } = {
      launcherMs: null,
      chatReadyMs: null,
    };
    Reflect.set(window, "__dimtsStartupTimes", marks);
    const visible = (element: Element | null | undefined) => {
      if (!(element instanceof HTMLElement)) return false;
      const box = element.getBoundingClientRect();
      return (
        !element.hidden &&
        box.width > 0 &&
        box.height > 0 &&
        getComputedStyle(element).visibility !== "hidden"
      );
    };
    const measureFrame = () => {
      const root = document.querySelector("dimts-embed")?.shadowRoot;
      if (
        marks.launcherMs === null &&
        visible(root?.querySelector("#dimts-launcher"))
      )
        marks.launcherMs = performance.now();
      const input = root
        ?.querySelector("dimts-assistant")
        ?.shadowRoot?.querySelector<HTMLTextAreaElement>("#message");
      if (
        marks.chatReadyMs === null &&
        input &&
        !input.disabled &&
        visible(input)
      )
        marks.chatReadyMs = performance.now();
      if (marks.chatReadyMs === null) requestAnimationFrame(measureFrame);
    };
    requestAnimationFrame(measureFrame);
  });
  const prefetchedFaq = page.waitForResponse((response) =>
    response.url().endsWith("/locales/en/faq"),
  );
  await page.goto(origin, { waitUntil: "commit" });
  await page.locator("#dimts-launcher").waitFor({ state: "visible" });
  await page.locator("#dimts-launcher").click();
  await expect(page.locator("#message")).toBeEnabled();
  await page.waitForFunction(
    () =>
      (
        Reflect.get(window, "__dimtsStartupTimes") as {
          chatReadyMs: number | null;
        }
      ).chatReadyMs !== null,
  );
  const { launcherMs, chatReadyMs } = await page.evaluate(
    () =>
      Reflect.get(window, "__dimtsStartupTimes") as {
        launcherMs: number;
        chatReadyMs: number;
      },
  );
  await (await prefetchedFaq).finished();
  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => ({
      name: new URL(entry.name).pathname,
      duration: entry.duration,
      transferSize: (entry as PerformanceResourceTiming).transferSize,
    })),
  );
  const evidence = JSON.stringify(
    {
      bandwidthKbps: 400,
      roundTripMs: 400,
      transport:
        "Server-enforced 400ms minimum first-byte delay for every response, then one shared FIFO gzip-body link capped at 50,000 bytes/second using absolute cumulative byte deadlines and chunks of at most 1024 bytes. No page-only CDP bandwidth emulation. HTTP headers and tiny request uploads are not bandwidth-shaped.",
      cache:
        "Fresh browser context, browser cache disabled, all HTTP responses no-store; service worker enabled and its network requests paced identically.",
      launcherMs,
      chatReadyMs,
      timing:
        "Browser requestAnimationFrame observes the first visible launcher and the first visible enabled composer; timestamps exclude delays returning observations through the Node automation bridge. Chat is opened by a Playwright click after launcher visibility.",
      resources,
      serverTransfers: transfers.map((transfer) => ({
        ...transfer,
        bodyBytesPerSecond:
          transfer.completedAtMs !== null && transfer.firstByteAtMs !== null
            ? transfer.sentBytes /
              ((transfer.completedAtMs - transfer.firstByteAtMs) / 1000)
            : null,
      })),
    },
    null,
    2,
  );
  await mkdir(testInfo.outputDir, { recursive: true });
  const evidencePath = testInfo.outputPath("throttled-startup.json");
  await writeFile(evidencePath, evidence);
  await testInfo.attach("throttled-startup.json", {
    path: evidencePath,
    contentType: "application/json",
  });
  for (const transfer of transfers.filter(
    (item) => item.firstByteAtMs !== null,
  )) {
    expect(
      transfer.firstByteAtMs! - transfer.receivedAtMs,
    ).toBeGreaterThanOrEqual(responseLatencyMs);
    if (transfer.completedAtMs !== null) {
      expect(
        transfer.sentBytes /
          ((transfer.completedAtMs - transfer.firstByteAtMs!) / 1000),
      ).toBeLessThanOrEqual(bytesPerSecond);
    }
  }
  for (const path of ["/v1/locales/en/ui", "/v1/locales/en/faq"]) {
    expect(
      transfers.some(
        (transfer) =>
          transfer.path === path &&
          transfer.completedAtMs !== null &&
          transfer.sentBytes > 0,
      ),
    ).toBe(true);
  }
  expect(launcherMs).toBeLessThanOrEqual(3000);
  expect(chatReadyMs).toBeLessThanOrEqual(6000);
});
