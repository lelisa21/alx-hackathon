import { expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { resolve } from "node:path";
import { loadPacks } from "../../locales-tools/src/index.js";

const packs = loadPacks(resolve("locales"));
const apiRoot = "http://127.0.0.1:4173/v1";

test("FR-INSIGHT-03 instructor page filters anonymous rows and downloads CSV", async ({
  page,
}) => {
  let responseMode: "rows" | "empty" | "error" = "rows";
  let releaseInitialInsights: (() => void) | undefined;
  let holdInitialInsights = true;
  const initialInsightsHeld = new Promise<void>((resolve) => {
    releaseInitialInsights = resolve;
  });
  const requests: { url: string; authorization: string | undefined }[] = [];
  await page.route("http://127.0.0.1:4173/p09-insights", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Insights</title></head><body><dimts-insights data-api="${apiRoot}" data-language="en" data-session-token="instructor-session-token"></dimts-insights><script type="module" src="/dimts-widget.js"></script></body></html>`,
    }),
  );
  await page.route(`${apiRoot}/**`, async (route) => {
    const url = new URL(route.request().url());
    requests.push({
      url: route.request().url(),
      authorization: route.request().headers().authorization,
    });
    if (url.pathname.endsWith("/locales/en/ui"))
      return route.fulfill({ json: packs.get("en")!.ui });
    if (url.pathname.endsWith("/languages"))
      return route.fulfill({
        json: { languages: [{ code: "en" }, { code: "am" }] },
      });
    if (
      url.pathname.endsWith("/insights") &&
      url.searchParams.get("format") === "csv"
    )
      return route.fulfill({
        contentType: "text/csv",
        headers: {
          "content-disposition":
            'attachment; filename="dimts-insights-2026-11-14.csv"',
        },
        body: "topic_id,lang,question_count\nlesson-1,en,8\n",
      });
    if (url.pathname.endsWith("/insights")) {
      if (holdInitialInsights) {
        holdInitialInsights = false;
        await initialInsightsHeld;
      }
      if (responseMode === "error")
        return route.fulfill({ status: 503, json: {} });
      else if (responseMode === "empty")
        return route.fulfill({
          json: {
            insights: [],
            period: { start: "2026-11-14", end: "2026-11-14" },
            exportedAt: "2026-11-14T12:00:00.000Z",
          },
        });
      else
        return route.fulfill({
          json: {
            insights: [
              {
                topicId: "lesson-1",
                topicLabel: "Study planning",
                lang: "en",
                period: "2026-11-14",
                questionCount: 8,
                notfoundCount: 2,
                helpfulCount: 6,
                unhelpfulCount: 1,
              },
            ],
            period: { start: "2026-11-14", end: "2026-11-14" },
            exportedAt: "2026-11-14T12:00:00.000Z",
          },
        });
    }
    return route.fulfill({ status: 404, json: {} });
  });

  await page.goto("http://127.0.0.1:4173/p09-insights");
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(page.getByRole("status")).toContainText("Loading insights");
  releaseInitialInsights?.();
  await expect(
    page.getByRole("heading", { name: "Learning insights" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("Study planning")).toBeVisible();
  await expect(page.getByText(/8 questions asked/u)).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByLabel("Language").selectOption("am");
  await page.getByLabel("Start date").fill("2026-11-01");
  await page.getByLabel("End date").fill("2026-11-14");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect
    .poll(
      () =>
        requests.filter(({ url }) =>
          new URL(url).pathname.endsWith("/insights"),
        ).length,
    )
    .toBe(2);
  const filtered = new URL(
    requests.filter(({ url }) =>
      new URL(url).pathname.endsWith("/insights"),
    )[1]!.url,
  );
  expect(filtered.searchParams.get("lang")).toBe("am");
  expect(filtered.searchParams.get("startDate")).toBe("2026-11-01");
  expect(filtered.searchParams.get("endDate")).toBe("2026-11-14");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toBe(
    "dimts-insights-2026-11-14.csv",
  );
  const protectedRequests = requests.filter(({ url }) =>
    new URL(url).pathname.endsWith("/insights"),
  );
  expect(
    protectedRequests.every(
      ({ authorization }) =>
        authorization === "Bearer instructor-session-token",
    ),
  ).toBe(true);

  responseMode = "empty";
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No data available.")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  responseMode = "error";
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not load insights.",
  );
  responseMode = "rows";
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("table")).toBeVisible();
});
