import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadPacks } from "../../locales-tools/src/index.js";

const en = loadPacks(resolve("locales")).get("en")!;
const base = "http://127.0.0.1:4173";
type FaqMode = "ready" | "empty" | "failed" | "gone";
const faq = {
  lang: "en",
  dir: "ltr",
  contentVersion: "reviewed-fixture-v1",
  reviewedOn: "2026-01-01",
  items: [
    {
      id: "reviewed-faq-one",
      question: "How many goals should I choose?",
      answer: "Choose one learning goal.",
      citations: [
        {
          passageId: "active-passage-one",
          label: "Study plan / Goals",
          url: "https://course.example/study#goals",
          sourceLang: "en",
          sourceType: "course",
        },
      ],
    },
  ],
};

async function fixture(
  context: BrowserContext,
  page: Page,
  options: { manualMount?: boolean; initialMode?: FaqMode } = {},
) {
  const state = {
    offline: false,
    mode: options.initialMode ?? ("ready" as FaqMode),
    wait: undefined as Promise<void> | undefined,
    asks: 0,
  };
  await context.route(`${base}/`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>FAQ offline test</title></head><body>${options.manualMount ? "" : '<dimts-assistant data-api="http://api.test/v1" data-host-key="public-fixture"></dimts-assistant><script type="module" src="/dimts-widget.js"></script>'}</body></html>`,
    }),
  );
  await context.route("http://api.test/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (state.offline) {
      await route.abort("internetdisconnected");
      return;
    }
    if (url.pathname.endsWith("/languages")) {
      await route.fulfill({
        json: {
          languages: [
            {
              code: "en",
              nameNative: "English",
              nameEn: "English",
              script: "Latn",
              dir: "ltr",
              status: "beta",
              stt: false,
              tts: false,
            },
          ],
        },
      });
      return;
    }
    if (url.pathname.endsWith("/ui")) {
      await route.fulfill({ json: en.ui });
      return;
    }
    if (url.pathname.endsWith("/faq")) {
      await state.wait;
      await route.fulfill({
        status:
          state.mode === "failed" ? 503 : state.mode === "gone" ? 404 : 200,
        json:
          state.mode === "failed"
            ? {}
            : state.mode === "empty"
              ? { ...faq, reviewedOn: null, items: [] }
              : faq,
        headers: { ETag: '"reviewed-fixture-v1"' },
      });
      return;
    }
    if (url.pathname.endsWith("/sessions")) {
      await route.fulfill({
        status: 201,
        json: {
          sessionId: "session-fixture-12345",
          sessionToken: "token-fixture-123456789012345",
          resumeToken: "resume-fixture-123456789012345",
          lang: "en",
          cloudOk: false,
          consentVersion: null,
        },
      });
      return;
    }
    if (url.pathname.endsWith("/ask")) state.asks += 1;
    await route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${base}/`);
  return state;
}

test("FR-UI-16 NFR-PERF-06 opens prefetched reviewed FAQ for the first time after an offline reload", async ({
  page,
  context,
}) => {
  const failures: { url: string; error: string | null | undefined }[] = [];
  const scriptErrors: string[] = [];
  page.on("requestfailed", (request) =>
    failures.push({ url: request.url(), error: request.failure()?.errorText }),
  );
  page.on("pageerror", (error) => scriptErrors.push(error.name));
  const state = await fixture(context, page);
  await page.getByRole("button", { name: /^English/u }).click();
  // Merely visiting the active language prepares the reviewed offline route.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const saved = await (
          await caches.open("dimts-faq-v1")
        ).match("http://api.test/v1/locales/en/faq");
        return Boolean(saved && (await saved.json()).items.length);
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.ready).active),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open("dimts-shell-v3");
        return (await cache.keys()).some(
          (request) => new URL(request.url).pathname === "/dimts-widget.js",
        );
      }),
    )
    .toBe(true);
  state.offline = true;
  await context.setOffline(true);
  // The host supplies its own HTML shell; Dimts restores only the assets/data it owns.
  await page.reload();
  const diagnostics = await page.evaluate(async () => ({
    htmlElements: document.body.children.length,
    hasWidget: Boolean(document.querySelector("dimts-assistant")),
    defined: Boolean(customElements.get("dimts-assistant")),
    controller: navigator.serviceWorker.controller?.scriptURL,
    cacheKeys: await Promise.all(
      (await caches.keys()).map(async (name) => ({
        name,
        urls: await Promise.all(
          (await (await caches.open(name)).keys()).map(async (request) => ({
            url: request.url,
            requestHeaders: [...request.headers],
            vary: (
              await (
                await caches.open(name)
              ).match(request, { ignoreVary: true })
            )?.headers.get("vary"),
          })),
        ),
      })),
    ),
  }));
  const diagnosticsPath = test.info().outputPath("offline-shell.json");
  await writeFile(
    diagnosticsPath,
    JSON.stringify({ failures, scriptErrors, ...diagnostics }, null, 2),
    "utf8",
  );
  await test.info().attach("offline-shell-diagnostics", {
    contentType: "application/json",
    path: diagnosticsPath,
  });
  await expect
    .poll(
      () => page.evaluate(() => Boolean(customElements.get("dimts-assistant"))),
      { message: "Cached widget module registers after offline reload" },
    )
    .toBe(true);
  await page
    .getByRole("button", { name: en.ui["faq.action"]!, exact: true })
    .click();
  await expect(
    page.getByText(faq.items[0]!.answer, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(en.ui["faq.cached"]!, { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".offline-banner")).toBeVisible();
  await expect(page.getByRole("link", { name: /Study plan/ })).toHaveAttribute(
    "href",
    faq.items[0]!.citations[0]!.url,
  );
  expect(state.asks).toBe(0);
  const cached = await page.evaluate(async () => {
    const results: string[] = [];
    for (const name of await caches.keys())
      if (name.startsWith("dimts-"))
        results.push(
          ...(await (await caches.open(name)).keys()).map(
            (request) => request.url,
          ),
        );
    return results;
  });
  expect(
    cached.some((url) => /\/(?:sessions|ask|feedback|help)(?:\?|$)/u.test(url)),
  ).toBe(false);
});

test("FR-UI-16 exposes FAQ loading, failure, retry, empty and refreshed success", async ({
  page,
  context,
}) => {
  const state = await fixture(context, page, { initialMode: "failed" });
  await page
    .getByRole("button", { name: en.ui["faq.action"]!, exact: true })
    .click();
  const panel = page.getByRole("region", { name: en.ui["faq.title"]! });
  await expect(
    panel.getByText(en.ui["faq.failed"]!, { exact: true }),
  ).toBeVisible();
  state.mode = "empty";
  await panel
    .getByRole("button", { name: en.ui["error.retry"]!, exact: true })
    .click();
  await expect(
    panel.getByText(en.ui["faq.empty"]!, { exact: true }),
  ).toBeVisible();
  let resolveWait: () => void = () => undefined;
  state.wait = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  state.mode = "ready";
  await page
    .getByRole("button", { name: en.ui["faq.action"]!, exact: true })
    .click();
  await expect(
    panel.getByText(en.ui["faq.loading"]!, { exact: true }),
  ).toBeVisible();
  resolveWait();
  await expect(
    panel.getByText(faq.items[0]!.answer, { exact: true }),
  ).toBeVisible();
  state.mode = "empty";
  await page
    .getByRole("button", { name: en.ui["faq.action"]!, exact: true })
    .click();
  await expect(
    panel.getByText(en.ui["faq.empty"]!, { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(faq.items[0]!.answer, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: en.ui["help.button"]!, exact: true }),
  ).toBeEnabled();
});

test("FR-INT-11 preserves a host service worker and unrelated storage during uninstall", async ({
  page,
  context,
}) => {
  await fixture(context, page, { manualMount: true });
  // An existing worker at the conventional path is not proof that Dimts owns it.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register(
      "/service-worker.js?owner=host",
      { scope: "/" },
    );
    await navigator.serviceWorker.ready;
    if (!registration.active)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
    localStorage.setItem("host-owned", "keep");
    await (
      await caches.open("host-owned-cache")
    ).put("/host-data", new Response("keep"));
    await import("/dimts-widget.js");
    const widget = document.createElement("dimts-assistant");
    widget.setAttribute("data-api", "http://api.test/v1");
    widget.setAttribute("data-host-key", "public-fixture");
    document.body.append(widget);
  });
  await expect(page.getByRole("button", { name: /^English/u })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration("/"))?.active
            ?.scriptURL,
      ),
    )
    .toBe(`${base}/service-worker.js?owner=host`);
  await page.locator("dimts-assistant").evaluate((element) => {
    (
      element as HTMLElement & { clearOwnedStorage(): void }
    ).clearOwnedStorage();
    element.remove();
  });
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration("/"))?.active
            ?.scriptURL,
      ),
    )
    .toBe(`${base}/service-worker.js?owner=host`);
  expect(await page.evaluate(() => localStorage.getItem("host-owned"))).toBe(
    "keep",
  );
  expect(
    await page.evaluate(async () =>
      Boolean(
        await (await caches.open("host-owned-cache")).match("/host-data"),
      ),
    ),
  ).toBe(true);
});

test("FR-INT-11 preserves a host replacement installed after the Dimts worker", async ({
  page,
  context,
}) => {
  await fixture(context, page);
  await expect(page.getByRole("button", { name: /^English/u })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.ready).active?.scriptURL,
      ),
    )
    .toContain("owner=dimts");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js?owner=host", {
      scope: "/",
    });
  });
  const currentWorker = () =>
    page.evaluate(
      async () =>
        (await navigator.serviceWorker.getRegistration("/"))?.active?.scriptURL,
    );
  await expect.poll(currentWorker).toBe(`${base}/service-worker.js?owner=host`);
  await page.locator("dimts-assistant").evaluate((element) => {
    element.remove();
    (
      element as HTMLElement & { clearOwnedStorage(): void }
    ).clearOwnedStorage();
  });
  await expect.poll(currentWorker).toBe(`${base}/service-worker.js?owner=host`);
});

test("FR-UI-16 removes a previously shown FAQ after the server withdraws its locale", async ({
  page,
  context,
}) => {
  const state = await fixture(context, page);
  await page
    .getByRole("button", { name: en.ui["faq.action"]!, exact: true })
    .click();
  const panel = page.getByRole("region", { name: en.ui["faq.title"]! });
  await expect(
    panel.getByText(faq.items[0]!.answer, { exact: true }),
  ).toBeVisible();
  state.mode = "gone";
  await page
    .getByRole("button", { name: en.ui["faq.action"]!, exact: true })
    .click();
  await expect(
    panel.getByText(en.ui["faq.failed"]!, { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(faq.items[0]!.answer, { exact: true }),
  ).toHaveCount(0);
});
