import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { resolve } from "node:path";
import { loadPacks } from "../../locales-tools/src/index.js";

const packs = loadPacks(resolve("locales"));
const ui = packs.get("en")!.ui;
const api = "http://api.test/v1";
const url = "http://127.0.0.1:4173/sim/sms";
const secret = "simulator-test-gateway-secret";
const number = "+251911111111";

async function configure(page: Page) {
  await page.goto(url);
  await page.getByLabel(ui["smsSim.api"]!, { exact: true }).fill(api);
  await page.getByLabel(ui["smsSim.secret"]!, { exact: true }).fill(secret);
  await page.getByLabel(ui["smsSim.phone"]!, { exact: true }).fill(number);
}

function reply(text: string, stopped = false) {
  return {
    messages: text
      ? [
          {
            id: crypto.randomUUID(),
            text,
            encoding: "gsm7",
            units: text.length,
            segments: 1,
            status: "delivered",
          },
        ]
      : [],
    stopped,
  };
}

test("FR-SMS-02/05/07: real simulator route, keyboard exchange, STOP and memory-only reset", async ({
  page,
}) => {
  const calls: { id: string; from: string; text: string }[] = [];
  let stopped = false;
  await page.route(`${api}/sms/inbound`, async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${secret}`);
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as (typeof calls)[number];
    calls.push(body);
    if (stopped) return route.fulfill({ json: reply("", true) });
    if (body.text === "STOP") {
      stopped = true;
      return route.fulfill({ json: reply("Messages stopped.", true) });
    }
    return route.fulfill({
      json: reply(
        calls.length === 1
          ? "1 English; 2 Amharic; 3 Afaan Oromoo"
          : "Language selected.",
      ),
    });
  });
  await configure(page);
  await expect(
    page.getByText(ui["smsSim.empty"]!, { exact: true }),
  ).toBeVisible();
  const composer = page.getByLabel(ui["smsSim.message"]!, { exact: true });
  await composer.fill("Hello");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: ui["smsSim.send"], exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("1 English; 2 Amharic; 3 Afaan Oromoo", { exact: true }),
  ).toBeVisible();
  await expect(composer).toBeFocused();
  await composer.fill("1");
  await page
    .getByRole("button", { name: ui["smsSim.send"], exact: true })
    .click();
  await expect(
    page.getByText("Language selected.", { exact: true }),
  ).toBeVisible();
  await composer.fill("STOP");
  await page
    .getByRole("button", { name: ui["smsSim.send"], exact: true })
    .click();
  await expect(
    page.getByText(ui["smsSim.stopped"]!, { exact: true }),
  ).toBeVisible();
  await expect(composer).toBeDisabled();
  await expect(
    page.getByRole("button", { name: ui["smsSim.send"], exact: true }),
  ).toBeDisabled();
  expect(calls.map(({ text }) => text)).toEqual(["Hello", "1", "STOP"]);
  expect(new Set(calls.map(({ id }) => id)).size).toBe(3);
  await page
    .getByRole("button", { name: ui["smsSim.newThread"], exact: true })
    .click();
  await expect(
    page.getByLabel(ui["smsSim.phone"]!, { exact: true }),
  ).toBeFocused();
  await expect(
    page.getByLabel(ui["smsSim.phone"]!, { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel(ui["smsSim.secret"]!, { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByText("Language selected.", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await page.getByLabel(ui["smsSim.secret"]!, { exact: true }).fill(secret);
  await page.getByLabel(ui["smsSim.phone"]!, { exact: true }).fill(number);
  await composer.fill("Hello again");
  await page
    .getByRole("button", { name: ui["smsSim.send"], exact: true })
    .click();
  await expect(
    page.getByText(ui["smsSim.stopped"]!, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel(ui["smsSim.phone"]!, { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel(ui["smsSim.secret"]!, { exact: true }),
  ).toHaveValue("");
});

test("FR-SMS-02/03/12: raw counter uses normalized transmitted encoding and extension units", async ({
  page,
}) => {
  await configure(page);
  const composer = page.getByLabel(ui["smsSim.message"]!, { exact: true });
  const counters = page.locator("#sms-counters");
  for (const [text, encoding, units, segments] of [
    ["a".repeat(160), "gsm7", 160, 1],
    ["a".repeat(161), "gsm7", 161, 2],
    ["ሀ".repeat(70), "ucs2", 70, 1],
    ["ሀ".repeat(71), "ucs2", 71, 2],
    ["€".repeat(81), "gsm7", 162, 2],
    ["“Afaan Oromoo” ’", "gsm7", 16, 1],
  ] as const) {
    await composer.fill(text);
    await expect(counters).toHaveAttribute("data-encoding", encoding);
    await expect(counters).toHaveAttribute("data-units", String(units));
    await expect(counters).toHaveAttribute("data-segments", String(segments));
    await expect(counters).toHaveAttribute(
      "data-characters",
      String(Array.from(text).length),
    );
  }
  let sent = "";
  await page.route(`${api}/sms/inbound`, (route) => {
    sent = (route.request().postDataJSON() as { text: string }).text;
    return route.fulfill({ json: reply("Received.") });
  });
  await page
    .getByRole("button", { name: ui["smsSim.send"], exact: true })
    .click();
  await expect(page.getByText("Received.", { exact: true })).toBeVisible();
  expect(sent).toBe('"Afaan Oromoo" \'');
});

test("FR-SMS-02: failure retry keeps inbound identity and announces pending state", async ({
  page,
}) => {
  const calls: unknown[] = [];
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${api}/sms/inbound`, async (route) => {
    calls.push(route.request().postDataJSON());
    if (calls.length === 1) return route.fulfill({ status: 503, json: {} });
    await held;
    return route.fulfill({ json: reply("Delivered after retry.") });
  });
  await configure(page);
  const composer = page.getByLabel(ui["smsSim.message"]!, { exact: true });
  await composer.fill("A private question");
  await page
    .getByRole("button", { name: ui["smsSim.send"], exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(ui["smsSim.error"]!);
  await expect(
    page.getByRole("button", { name: ui["smsSim.retry"], exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: ui["smsSim.retry"], exact: true })
    .click();
  await expect(
    page.getByText(ui["smsSim.sending"]!, { exact: true }),
  ).toBeVisible();
  await expect(composer).toBeDisabled();
  release?.();
  await expect(
    page.getByText("Delivered after retry.", { exact: true }),
  ).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  await expect(
    page.getByText("A private question", { exact: true }),
  ).toHaveCount(1);
  await expect(composer).toBeFocused();
});

for (const language of ["en", "am", "om", "ar-test"])
  test(`FR-SMS-02 accessibility: ${language} keyboard, 320px, 200% text and RTL`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`${url}?lang_preview=1`);
    await page
      .getByLabel(ui["smsSim.uiLanguage"]!, { exact: true })
      .selectOption(language);
    const pack = packs.get(language)!;
    await expect(page.locator("html")).toHaveAttribute("dir", pack.meta.dir);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.evaluate(() =>
      document.documentElement.style.setProperty("font-size", "200%"),
    );
    await page.getByLabel(pack.ui["smsSim.message"]!, { exact: true }).focus();
    await page.keyboard.type("Keyboard message");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(
      violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });
