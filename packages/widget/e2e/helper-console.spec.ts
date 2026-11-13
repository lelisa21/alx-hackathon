import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { loadPacks } from "../../locales-tools/src/index.js";

const packs = loadPacks(resolve("locales"));
const apiRoot = "http://api.test/v1";

const languageRegistry = [...packs.values()]
  .filter(({ meta }) => meta.code !== "ar-test")
  .map(({ meta }) => ({
    code: meta.code,
    nameNative: meta.name_native,
    nameEn: meta.name_en,
    script: meta.script,
    dir: meta.dir,
    status: "live",
    stt: meta.stt,
    tts: meta.tts,
  }));
const englishLanguage = languageRegistry.find(({ code }) => code === "en")!;

test("FR-AI-09 helper provider status is authenticated, refreshable and failure-isolated", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  let healthRequests = 0;
  let healthMode: "held" | "ready" | "failed" = "held";
  let provider = "test-local-model";
  let releaseHealth: (() => void) | undefined;
  const healthReady = new Promise<void>((resolve) => {
    releaseHealth = resolve;
  });
  await page.route("http://127.0.0.1:4173/helper", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Helper</title></head><body><dimts-helper-console data-api="${apiRoot}"></dimts-helper-console><script type="module" src="/dimts-helper-console.js"></script></body></html>`,
    }),
  );
  await page.route(`${apiRoot}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/languages"))
      return route.fulfill({ json: { languages: [englishLanguage] } });
    if (pathname.endsWith("/ui"))
      return route.fulfill({ json: packs.get("en")!.ui });
    if (pathname.endsWith("/helpers/login"))
      return route.fulfill({ json: { jwt: "helper-jwt" } });
    if (pathname.endsWith("/help/queue"))
      return route.fulfill({ json: { requests: [] } });
    if (pathname.endsWith("/health")) {
      healthRequests += 1;
      if (healthMode === "held") await healthReady;
      if (healthMode === "failed")
        return route.fulfill({ status: 503, json: {} });
      return route.fulfill({
        json: {
          ok: true,
          db: true,
          version: "test",
          contentVersion: "v1",
          provider,
          ladder: [provider, "offline"],
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("http://127.0.0.1:4173/helper");
  await expect(
    page.getByRole("heading", { name: "Answer service" }),
  ).toHaveCount(0);
  expect(healthRequests).toBe(0);
  await page.getByLabel("Helper token").fill("valid-helper-token-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("Checking answer service…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No requests are waiting.")).toBeVisible();
  healthMode = "ready";
  releaseHealth?.();
  await expect(
    page.getByText("Active provider: test-local-model", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Provider order: test-local-model → offline", {
      exact: true,
    }),
  ).toBeVisible();
  const { AxeBuilder } = await import("@axe-core/playwright");
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(({ impact }) =>
      ["critical", "serious"].includes(impact ?? ""),
    ),
  ).toEqual([]);
  healthMode = "failed";
  await page.getByRole("button", { name: "Refresh queue" }).click();
  await expect(
    page.getByText("Answer service status is unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No requests are waiting.")).toBeVisible();
  await expect(
    page.getByText("Active provider: test-local-model", { exact: true }),
  ).toHaveCount(0);
  healthMode = "ready";
  provider = "configured-model-".repeat(12);
  await page.getByRole("button", { name: "Refresh queue" }).click();
  await expect(
    page.getByText(`Active provider: ${provider}`, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Answer service" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(`Active provider: ${provider}`, { exact: true }),
  ).toHaveCount(0);
});

// FR-LANG-01/10/14: registry metadata, status gating and direction must work
// for a language unknown to the component source.
test("helper language and queue pickers discover a new registry language", async ({
  page,
}) => {
  const requestedUi: string[] = [];
  const queueQueries: string[] = [];
  const extra = {
    ...englishLanguage,
    code: "fr",
    nameNative: "Français",
    nameEn: "French",
    status: "live",
    dir: "rtl",
  };
  const beta = {
    ...englishLanguage,
    code: "de",
    nameNative: "Deutsch",
    nameEn: "German",
    status: "beta",
  };
  const draft = {
    ...englishLanguage,
    code: "es",
    nameNative: "Español",
    nameEn: "Spanish",
    status: "draft",
  };
  await page.route("http://127.0.0.1:4173/helper", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Helper</title></head><body><dimts-helper-console data-api="${apiRoot}"></dimts-helper-console><script type="module" src="/dimts-helper-console.js"></script></body></html>`,
    }),
  );
  await page.route(`${apiRoot}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/languages")) {
      await route.fulfill({
        json: {
          languages: [
            languageRegistry.find(({ code }) => code === "en"),
            extra,
            beta,
            draft,
          ],
        },
      });
    } else if (/\/locales\/[^/]+\/ui$/u.test(url.pathname)) {
      requestedUi.push(url.pathname.split("/").at(-2)!);
      await route.fulfill({ json: packs.get("en")!.ui });
    } else if (url.pathname.endsWith("/helpers/login")) {
      await route.fulfill({ json: { jwt: "helper-jwt-token" } });
    } else if (url.pathname.endsWith("/help/queue")) {
      queueQueries.push(url.searchParams.get("lang") ?? "");
      await route.fulfill({
        json: {
          requests: [
            {
              id: "request-fr",
              lang: "fr",
              channel: "api",
              createdAt: "2026-11-13T10:00:00Z",
              summary: null,
            },
          ],
        },
      });
    } else await route.fulfill({ status: 404, json: {} });
  });
  await page.goto("http://127.0.0.1:4173/helper");
  const picker = page.getByLabel("Console language");
  await expect(picker.locator("option[value='fr']")).toHaveText("Français");
  await expect(picker.locator("option[value='de']")).toContainText("Beta");
  await expect(picker.locator("option[value='es']")).toHaveCount(0);
  await picker.selectOption("fr");
  await expect.poll(() => requestedUi).toContain("fr");
  await expect(page.locator("dimts-helper-console main")).toHaveAttribute(
    "dir",
    "rtl",
  );
  await expect(picker).toBeFocused();
  await page.getByLabel("Helper token").fill("valid-helper-token-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Filter by language").selectOption("fr");
  await expect.poll(() => queueQueries).toContain("fr");
  await expect(
    page.getByRole("article").getByText("Français", { exact: true }),
  ).toBeVisible();
  const { AxeBuilder } = await import("@axe-core/playwright");
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(({ impact }) =>
      ["critical", "serious"].includes(impact ?? ""),
    ),
  ).toEqual([]);
});

test("helper draft language is available only through explicit preview requests", async ({
  page,
}) => {
  const requests: URL[] = [];
  await page.route("http://127.0.0.1:4173/helper?lang_preview=1", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Helper</title></head><body><dimts-helper-console data-api="${apiRoot}"></dimts-helper-console><script type="module" src="/dimts-helper-console.js"></script></body></html>`,
    }),
  );
  await page.route(`${apiRoot}/**`, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname.endsWith("/languages"))
      await route.fulfill({
        json: {
          languages: [
            englishLanguage,
            {
              ...englishLanguage,
              code: "es",
              nameNative: "Español",
              nameEn: "Spanish",
              status: "draft",
            },
          ],
        },
      });
    else if (/\/locales\/[^/]+\/ui$/u.test(url.pathname))
      await route.fulfill({ json: packs.get("en")!.ui });
    else await route.fulfill({ status: 404, json: {} });
  });
  await page.goto("http://127.0.0.1:4173/helper?lang_preview=1");
  const picker = page.getByLabel("Console language");
  await expect(picker.locator("option[value='es']")).toHaveText("Español");
  await picker.selectOption("es");
  await expect
    .poll(() =>
      requests.some(({ pathname }) => pathname.endsWith("/locales/es/ui")),
    )
    .toBe(true);
  expect(
    requests.every(
      ({ searchParams }) => searchParams.get("lang_preview") === "1",
    ),
  ).toBe(true);
});

for (const configuredApi of [apiRoot, "/v1"]) {
  test(`helper logs in, filters, blocks, claims, chats, and closes a request (${configuredApi})`, async ({
    page,
  }) => {
    const resolvedApi = new URL(configuredApi, "http://127.0.0.1:4173").href;
    const queueQueries: string[] = [];
    const blockedRequests = new Set<string>();
    const sentMessages: { type: string; id: string; text: string }[] = [];
    const closedRequests = new Set<string>();
    let closedRequest = "";
    let newRequestVisible = false;

    await page.setViewportSize({ width: 320, height: 720 });
    await page.route("http://127.0.0.1:4173/helper", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><head><title>Helper</title></head><body><dimts-helper-console data-api="${configuredApi}" data-language="en"></dimts-helper-console><script type="module" src="/dimts-helper-console.js"></script></body></html>`,
      }),
    );
    await page.route(`${resolvedApi}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/languages")) {
        await route.fulfill({ json: { languages: languageRegistry } });
        return;
      }
      if (/\/locales\/[^/]+\/ui$/u.test(url.pathname)) {
        const code = url.pathname.split("/").at(-2) ?? "en";
        await route.fulfill({ json: packs.get(code)?.ui ?? {} });
        return;
      }
      if (url.pathname.endsWith("/helpers/login")) {
        await route.fulfill({ json: { jwt: "helper-jwt-token" } });
        return;
      }
      if (url.pathname.endsWith("/help/queue")) {
        queueQueries.push(url.searchParams.get("lang") ?? "");
        const requests = [
          ...(newRequestVisible
            ? [
                {
                  id: "request-new",
                  lang: "en",
                  channel: "web" as const,
                  createdAt: "2026-01-01T10:02:00.000Z",
                  summary: null,
                },
              ]
            : []),
          {
            id: "request-en",
            lang: "en",
            channel: "web",
            createdAt: "2026-01-01T10:00:00.000Z",
            summary: ["How do I start?"],
          },
          {
            id: "request-am",
            lang: "am",
            channel: "web",
            createdAt: "2026-01-01T10:01:00.000Z",
            summary: null,
          },
        ].filter(
          (request) =>
            !blockedRequests.has(request.id) &&
            !closedRequests.has(request.id) &&
            (!url.searchParams.has("lang") ||
              request.lang === url.searchParams.get("lang")),
        );
        await route.fulfill({ json: { requests } });
        return;
      }
      if (url.pathname.endsWith("/help/request-am/block")) {
        blockedRequests.add("request-am");
        await route.fulfill({ json: { ok: true } });
        return;
      }
      if (url.pathname.endsWith("/help/request-en/claim")) {
        await route.fulfill({ json: { ok: true } });
        return;
      }
      if (url.pathname.endsWith("/help/request-en/close")) {
        closedRequests.add("request-en");
        closedRequest = "request-en";
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ status: 404, json: {} });
    });
    await page.routeWebSocket(
      `${resolvedApi.replace(/^http/u, "ws")}/help/ws`,
      (socket) => {
        socket.onMessage((raw) => {
          const frame = JSON.parse(String(raw)) as Record<string, unknown>;
          if (frame.type === "auth") {
            socket.send(JSON.stringify({ type: "help.joined" }));
            socket.send(
              JSON.stringify({
                type: "chat.message",
                id: "learner-message-1",
                text: "Can you help me?",
                from: "learner",
              }),
            );
          } else if (frame.type === "chat.message") {
            sentMessages.push(
              frame as { type: string; id: string; text: string },
            );
          }
        });
      },
    );

    await page.goto("http://127.0.0.1:4173/helper");
    await page.getByLabel("Helper token").fill("valid-helper-token-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("How do I start?")).toBeVisible();
    await expect(page.getByText("request-am", { exact: true })).toBeVisible();
    const { AxeBuilder } = await import("@axe-core/playwright");
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
    const layout = await page
      .locator("dimts-helper-console")
      .evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    const targets = await page
      .locator("dimts-helper-console")
      .locator("button, input, select, textarea")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
      );
    expect(
      targets.every(({ width, height }) => width >= 48 && height >= 48),
    ).toBe(true);
    newRequestVisible = true;
    await page.getByRole("button", { name: "Refresh queue" }).click();
    await expect(
      page.getByText("A new help request is waiting."),
    ).toBeVisible();

    await page.getByLabel("Filter by language").selectOption("am");
    const amRequest = page
      .getByRole("article")
      .filter({ hasText: "request-am" });
    await expect(amRequest).toBeVisible();
    await amRequest.getByRole("button", { name: "Block" }).click();
    await expect(amRequest).toHaveCount(0);
    expect(queueQueries).toContain("am");

    await page.getByLabel("Filter by language").selectOption("en");
    const enRequest = page
      .getByRole("article")
      .filter({ hasText: "request-en" });
    await expect(enRequest).toBeVisible();
    await enRequest.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByText("Can you help me?")).toBeVisible();
    await expect(page.getByText("New message from the learner.")).toBeVisible();
    await page.getByLabel("Message").fill("I can help with that.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect
      .poll(() => sentMessages)
      .toEqual([
        {
          type: "chat.message",
          id: expect.any(String),
          text: "I can help with that.",
        },
      ]);

    await page.getByRole("button", { name: "End help" }).click();
    await expect(
      page.getByRole("article").filter({ hasText: "request-en" }),
    ).toHaveCount(0);
    expect(closedRequest).toBe("request-en");
  });
}
