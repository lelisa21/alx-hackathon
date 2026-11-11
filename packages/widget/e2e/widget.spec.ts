import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { getVisiblePacks, loadPacks } from "../../locales-tools/src/index.js";

const packs = loadPacks(resolve("locales"));
interface TestLanguage {
  code: string;
  nameNative: string;
  nameEn: string;
  script: string;
  dir: "ltr" | "rtl";
  status: "live" | "beta" | "draft";
  stt: boolean;
  tts: boolean;
}

const languages: TestLanguage[] = getVisiblePacks(packs).map((pack) => ({
  code: pack.meta.code,
  nameNative: pack.meta.name_native,
  nameEn: pack.meta.name_en,
  script: pack.meta.script,
  dir: pack.meta.dir,
  status: pack.meta.status,
  stt: pack.meta.stt,
  tts: pack.meta.tts,
}));
const languageChoices: TestLanguage[] = [
  ...languages,
  {
    code: "am",
    nameNative: "አማርኛ",
    nameEn: "Amharic",
    script: "Ethi",
    dir: "ltr",
    status: "beta",
    stt: false,
    tts: false,
  },
  {
    code: "om",
    nameNative: "Afaan Oromoo",
    nameEn: "Afaan Oromoo",
    script: "Latn",
    dir: "ltr",
    status: "beta",
    stt: false,
    tts: false,
  },
];

async function openWidget(
  page: import("@playwright/test").Page,
  options: { failFirstAsk?: boolean; languages?: TestLanguage[] } = {},
) {
  let failNextAsk = options.failFirstAsk ?? false;
  let networkOffline = false;
  await page.route("http://127.0.0.1:4173/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>Widget test</title></head><body><dimts-assistant data-api="http://api.test/v1" data-host-key="test-host"></dimts-assistant><script type="module" src="/dimts-widget.js"></script></body></html>',
    }),
  );
  await page.route("http://api.test/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      networkOffline &&
      ["languages", "ui"].some((part) => url.pathname.endsWith(part))
    ) {
      await route.abort("internetdisconnected");
      return;
    }
    if (url.pathname.endsWith("/languages")) {
      await route.fulfill({
        json: { languages: options.languages ?? languages },
      });
      return;
    }
    if (/\/locales\/[^/]+\/ui$/u.test(url.pathname)) {
      const code = url.pathname.split("/").at(-2) ?? "en";
      await route.fulfill({ json: packs.get(code)?.ui ?? {} });
      return;
    }
    if (url.pathname.endsWith("/sessions")) {
      await route.fulfill({
        status: 201,
        json: {
          sessionId: "session-12345678",
          sessionToken: "session-token",
          resumeToken: "resume-token-12345678901234567890",
          lang: "en",
        },
      });
      return;
    }
    if (url.pathname.endsWith("/ask")) {
      if (failNextAsk) {
        failNextAsk = false;
        await route.fulfill({ status: 503, json: {} });
        return;
      }
      await route.fulfill({
        json: {
          id: "reply-1",
          kind: "answer",
          text: "Choose one topic to learn this week.",
          lang: "en",
          dir: "ltr",
          citations: [
            {
              passageId: "study-plan#goals",
              label: "Study plan / Choose one goal",
              url: "https://course.test/study-plan#choose-one-goal",
              sourceLang: "en",
              sourceType: "course",
            },
          ],
          actions: [],
          contentVersion: "v1",
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: {} });
  });
  await page.goto("http://127.0.0.1:4173/");
  return {
    disconnectApi: () => {
      networkOffline = true;
    },
  };
}

test("welcomes in-language, keeps the conversation, and focuses cited replies", async ({
  page,
}) => {
  await openWidget(page);
  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();

  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await expect(composer).toBeFocused();
  await composer.fill("How do I make a study plan?");
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue("How do I make a study plan?\n");
  await composer.fill("How do I make a study plan?");
  await composer.press("Enter");

  await expect(page.getByRole("article", { name: "You" })).toContainText(
    "How do I make a study plan?",
  );
  const reply = page.getByRole("article", { name: "Dimts" });
  await expect(reply).toContainText("Choose one topic to learn this week.");
  await expect(reply).toBeFocused();
  await expect(
    reply.getByRole("link", { name: "Source: Study plan / Choose one goal" }),
  ).toHaveAttribute("href", "https://course.test/study-plan#choose-one-goal");
  await expect(page.getByRole("log")).toHaveAttribute("aria-live", "polite");
});

test("reflows at 320px and has no critical or serious accessibility violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Settings" }).click();

  const root = page.locator("dimts-assistant");
  const layout = await root.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

  const { AxeBuilder } = await import("@axe-core/playwright");
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("names controls in their language and meets interactive target sizes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Settings" }).click();

  const controls = await page
    .locator("dimts-assistant")
    .locator("button, a, input, select, textarea")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          width: bounds.width,
          height: bounds.height,
          lang: element.getAttribute("lang"),
          dir: element.getAttribute("dir"),
        };
      }),
    );

  expect(controls.length).toBeGreaterThan(0);
  expect(
    controls.filter(
      ({ width, height, lang, dir }) =>
        width < 48 || height < 48 || lang !== "en" || dir !== "ltr",
    ),
  ).toEqual([]);
});

test("remembers a language choice across page loads", async ({ page }) => {
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "200 percent" }).click();
  await page.reload();

  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("button", { name: "200 percent" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("works when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("storage unavailable");
      },
    });
  });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
});

test("announces failed asks with retry and help actions", async ({ page }) => {
  await openWidget(page, { failFirstAsk: true });
  await page.getByRole("button", { name: "English" }).click();
  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await composer.fill("How do I make a study plan?");
  await composer.press("Enter");

  await expect(page.getByRole("alert")).toContainText(
    "The service could not be reached",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Help me now" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("article", { name: "Dimts" })).toContainText(
    "Choose one topic to learn this week.",
  );
});

test("suggests a language for typed text without switching until chosen", async ({
  page,
}) => {
  const askLangs: string[] = [];
  await openWidget(page, { languages: languageChoices });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/ask")) {
      askLangs.push(String(request.postDataJSON().lang));
    }
  });
  await page.getByRole("button", { name: "English" }).click();

  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await composer.fill("Hello there");
  await expect(page.getByText("Choose English or Afaan Oromoo.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Afaan Oromoo" }),
  ).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("lang", "en");

  await page.getByRole("button", { name: "Afaan Oromoo" }).click();
  await expect(page.locator("main")).toHaveAttribute("lang", "om");
  await expect(composer).toHaveValue("Hello there");
  await composer.press("Enter");
  await expect(page.getByRole("article", { name: "Dimts" })).toBeVisible();
  expect(askLangs).toEqual(["om"]);
});

test("announces offline state and exposes recovery on the welcome screen", async ({
  page,
}) => {
  await openWidget(page);
  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator(".offline-banner")).toContainText(
    "You are offline",
  );
  await expect(page.getByRole("button", { name: "Help me now" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".offline-banner")).toHaveCount(0);
});

test("reopens from cached language data when the API is offline", async ({
  page,
}) => {
  const widget = await openWidget(page);
  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const keys = await caches.keys();
        const cached = await Promise.all(
          keys.map(async (name) => (await caches.open(name)).keys()),
        );
        return cached.flat().length;
      }),
    )
    .toBeGreaterThan(0);
  widget.disconnectApi();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  await expect(page.locator(".offline-banner")).toContainText(
    "You are offline",
  );
  const registered = await page.evaluate(async () =>
    Boolean(await navigator.serviceWorker?.getRegistration("/")),
  );
  expect(registered).toBe(true);
});

test("reads replies aloud only after the learner selects the read-aloud mode", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const spoken: { text: string; lang: string }[] = [];
    Object.defineProperty(window, "__spoken", { value: spoken });
    const synthesis = window.speechSynthesis;
    synthesis.speak = (utterance) => {
      spoken.push({ text: utterance.text, lang: utterance.lang });
    };
  });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Read replies aloud").selectOption("ask");
  await page.getByRole("button", { name: "Settings" }).click();

  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await composer.fill("How do I make a study plan?");
  await composer.press("Enter");
  await page.getByRole("button", { name: "Read reply aloud" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __spoken?: { text: string; lang: string }[] })
            .__spoken,
      ),
    )
    .toEqual([
      {
        text: "Choose one topic to learn this week.",
        lang: "en",
      },
    ]);
});
