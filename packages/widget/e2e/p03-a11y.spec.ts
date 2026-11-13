import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadPacks } from "../../locales-tools/src/index.js";

const packs = loadPacks(resolve("locales"));
const sampleFor = (code: string) =>
  (
    packs.get(code === "ar-test" ? "en" : code)!.faq as {
      q: string;
      a: string;
    }[]
  )[0]!;
let deleteAttempts = 0;

// Draft packs are enabled in this UI fixture only. This is not review evidence.
async function installFixture(page: Page, code: string) {
  const pack = packs.get(code)!;
  await page.route("http://127.0.0.1:4173/p03-a11y", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>Accessibility fixture</title></head><body style="margin:0"><dimts-assistant data-api="http://api.test/v1" data-host-key="public-test-host"></dimts-assistant><script type="module" src="/dimts-widget.js"></script></body></html>',
    }),
  );
  const citation = {
    passageId: "study-plan#goal",
    label: "Study plan",
    url: "https://course.test/study-plan",
    sourceLang: code,
    sourceType: "course",
  };
  await page.context().route("http://api.test/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/languages"))
      return route.fulfill({
        json: {
          languages: ["en", "am", "om", "ar-test"]
            .map((language) => packs.get(language)!)
            .map(({ meta }) => ({
              code: meta.code,
              nameNative: meta.name_native,
              nameEn: meta.name_en,
              script: meta.script,
              dir: meta.dir,
              status: "beta",
              stt: false,
              tts: false,
            })),
        },
      });
    if (path.endsWith("/ui"))
      return route.fulfill({ json: packs.get(path.split("/").at(-2)!)!.ui });
    if (path.endsWith("/faq"))
      return route.fulfill({
        json: {
          lang: code,
          dir: pack.meta.dir,
          contentVersion: "fixture-v1",
          reviewedOn: "2026-11-13",
          items: [
            {
              id: "faq-fixture",
              question: sampleFor(code).q,
              answer: sampleFor(code).a,
              citations: [citation],
            },
          ],
        },
      });
    if (path.endsWith("/sessions"))
      return route.fulfill({
        status: 201,
        json: {
          sessionId: "session-a11y-12345678",
          sessionToken: "session-token-a11y",
          resumeToken: "resume-token-a11y-12345678901234",
          lang: code,
          cloudOk: false,
          consentVersion: null,
        },
      });
    if (path.endsWith("/ask"))
      return route.fulfill({
        json: {
          id: "reply-a11y",
          kind: "answer",
          text: sampleFor(code).a,
          lang: code,
          dir: pack.meta.dir,
          citations: [citation],
          actions: [],
          contentVersion: "fixture-v1",
        },
      });
    if (path.endsWith("/data/delete")) {
      const status = deleteAttempts++ === 0 ? 500 : 204;
      return status === 204
        ? route.fulfill({ status })
        : route.fulfill({ status, json: {} });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("http://127.0.0.1:4173/p03-a11y");
}

test("P11 privacy deletion requires confirmation, reports errors, and can retry", async ({
  page,
}) => {
  deleteAttempts = 0;
  await installFixture(page, "en");
  const ui = packs.get("en")!.ui;
  await page
    .getByRole("button", { name: packs.get("en")!.meta.name_native })
    .click();
  await page
    .getByRole("button", { name: ui["settings.button"]!, exact: true })
    .click();
  const deletion = page.locator('[aria-labelledby="delete-data-heading"]');
  await deletion
    .getByRole("button", { name: ui["privacy.deleteButton"]!, exact: true })
    .click();
  await expect(deletion.getByText(ui["privacy.deleteConfirm"]!)).toBeVisible();
  await deletion
    .getByRole("button", { name: ui["privacy.deleteCancel"]!, exact: true })
    .click();
  await expect(deletion.getByText(ui["privacy.deleteConfirm"]!)).toHaveCount(0);

  await deletion
    .getByRole("button", { name: ui["privacy.deleteButton"]!, exact: true })
    .click();
  await deletion
    .getByRole("button", {
      name: ui["privacy.deleteConfirmButton"]!,
      exact: true,
    })
    .click();
  await expect(deletion.getByRole("status")).toHaveText(
    ui["privacy.deleteFailed"]!,
  );
  await deletion
    .getByRole("button", {
      name: ui["privacy.deleteConfirmButton"]!,
      exact: true,
    })
    .click();
  await expect(
    page.getByText(ui["privacy.deleted"]!, { exact: true }),
  ).toBeVisible();
});

async function audit(page: Page, testInfo: TestInfo, screen: string) {
  if (screen === "help-preview" && testInfo.title.includes("om light 320")) {
    const screenshot = testInfo.outputPath("om-help-200-percent.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("om-help-200-percent", {
      path: screenshot,
      contentType: "image/png",
    });
  }
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    ({ impact }) => impact === "critical" || impact === "serious",
  );
  expect(violations, `${screen}: axe`).toEqual([]);
  const layout = await page.locator("dimts-assistant").evaluate((widget) => {
    const root = widget.shadowRoot!;
    const targets = [
      ...root.querySelectorAll<HTMLElement>("button,a,input,textarea,select"),
    ].filter((node) => node.getClientRects().length > 0);
    const small = targets
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width < 47.9 || box.height < 47.9;
      })
      .map((node) => ({
        tag: node.tagName,
        id: node.id,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      }));
    const missingLanguage = targets
      .filter((node) => !node.closest("[lang]") || !node.closest("[dir]"))
      .map((node) => node.tagName);
    return {
      small,
      missingLanguage,
      overflow: Math.max(
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        widget.scrollWidth - widget.clientWidth,
      ),
    };
  });
  expect(layout.small, `${screen}: 48px targets`).toEqual([]);
  expect(layout.missingLanguage, `${screen}: lang/dir`).toEqual([]);
  expect(layout.overflow, `${screen}: horizontal overflow`).toBeLessThanOrEqual(
    1,
  );
  const evidence = testInfo.outputPath(`${screen}-audit.json`);
  await writeFile(evidence, JSON.stringify({ screen, violations, layout }));
  await testInfo.attach(`${screen}-audit`, {
    path: evidence,
    contentType: "application/json",
  });
}

for (const code of ["en", "am", "om", "ar-test"]) {
  for (const theme of ["light", "contrast"]) {
    for (const width of [320, 1280]) {
      test(`P03 a11y ${code} ${theme} ${width}: welcome, chat, reply, settings, help and FAQ`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await installFixture(page, code);
        const ui = packs.get(code)!.ui;
        await expect(
          page.getByRole("button", {
            name: packs.get(code)!.meta.name_native,
          }),
        ).toBeVisible();
        if (theme === "contrast") {
          await page
            .getByRole("button", {
              name: packs.get("en")!.ui["settings.button"]!,
              exact: true,
            })
            .click();
          await page
            .getByRole("checkbox", {
              name: packs.get("en")!.ui["settings.highContrast"]!,
            })
            .check();
          await page
            .getByRole("button", {
              name: packs.get("en")!.ui["settings.button"]!,
              exact: true,
            })
            .click();
        }
        await audit(page, testInfo, "welcome");
        await page
          .getByRole("button", {
            name: packs.get(code)!.meta.name_native,
          })
          .click();
        await expect(page.locator("#message")).toBeEnabled();
        await audit(page, testInfo, "chat");
        await page.locator("#message").fill(sampleFor(code).q);
        await page.locator("#message").press("Enter");
        const reply = page.locator('[data-role="assistant"]');
        await expect(reply).toBeFocused();
        await expect(reply).toHaveAttribute("lang", code);
        await expect(reply).toHaveAttribute("dir", packs.get(code)!.meta.dir);
        await audit(page, testInfo, "reply");
        await page
          .getByRole("button", { name: ui["settings.button"]!, exact: true })
          .click();
        await audit(page, testInfo, "settings");
        await page
          .getByRole("button", { name: ui["settings.scale200"]!, exact: true })
          .click();
        await audit(page, testInfo, "settings-200-percent");
        await page
          .getByRole("button", { name: ui["settings.button"]!, exact: true })
          .click();
        await page
          .getByRole("button", { name: ui["help.button"]!, exact: true })
          .click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await audit(page, testInfo, "help-preview");
        await page
          .getByRole("button", { name: ui["help.cancel"]!, exact: true })
          .click();
        await page
          .getByRole("button", { name: ui["faq.action"]!, exact: true })
          .click();
        await expect(
          page
            .getByRole("region", { name: ui["faq.title"]! })
            .getByText(sampleFor(code).q, { exact: true }),
        ).toBeVisible();
        await audit(page, testInfo, "faq");
      });
    }
  }
}
