import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const origin = "http://127.0.0.1:4173";
const captures = [
  ["/savanna/", "index.html"],
  ["/savanna/pages/homepage-v1-paced.html", "pages/homepage-v1-paced.html"],
  [
    "/savanna/pages/homepage-v1-self-paced.html",
    "pages/homepage-v1-self-paced.html",
  ],
  [
    "/savanna/pages/concept-with-navigation.html",
    "pages/concept-with-navigation.html",
  ],
] as const;

async function installCapture(
  page: Page,
  url: string,
  file: string,
  existingEmbed = false,
) {
  const captured = readFileSync(resolve(file), "utf8");
  const withExistingEmbed = existingEmbed
    ? captured.replace(
        /<\/head>/iu,
        "<script data-dimts-embed></script></head>",
      )
    : captured;
  const body = withExistingEmbed.replace(
    /<\/body>/iu,
    '<script async src="/dimts-host.js"></script></body>',
  );
  await page.route(`${origin}${url}`, (route) =>
    route.fulfill({ contentType: "text/html", body }),
  );
  const hostLoader = readFileSync(
    resolve("packages/widget/public/templates/dimts-host.js.template"),
    "utf8",
  )
    .replaceAll("${DIMTS_PUBLIC_API}", "/v1")
    .replaceAll("${DIMTS_LOCAL_WIDGET_KEY}", "public-fixture-key");
  await page.route(`${origin}/dimts-host.js`, (route) =>
    route.fulfill({ contentType: "text/javascript", body: hostLoader }),
  );
  await page.route(`${origin}/dimts-embed.js`, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.Dimts = { open: function () { window.__dimtsOpens = (window.__dimtsOpens || 0) + 1; } };",
    }),
  );
}

test.describe("Savanna FR-SAV-ACCESS guide integration", () => {
  test("understands a spoken request for the current page content", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      class MockUtterance {
        text: string;
        lang = "";
        onstart?: () => void;
        onend?: () => void;
        constructor(text: string) {
          this.text = text;
        }
      }
      let activeUtterance: MockUtterance | undefined;
      class MockRecognition {
        lang = "";
        continuous = false;
        interimResults = false;
        onstart?: () => void;
        onresult?: (event: unknown) => void;
        start() {
          Object.assign(window, { __savannaRecognition: this });
          this.onstart?.();
        }
        stop() {}
      }
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: MockUtterance,
      });
      Object.defineProperty(window, "speechSynthesis", {
        value: {
          speak(utterance: MockUtterance) {
            const spoken =
              (
                window as Window & {
                  __savannaSpoken?: Array<{ text: string; lang: string }>;
                }
              ).__savannaSpoken ?? [];
            spoken.push({ text: utterance.text, lang: utterance.lang });
            Object.assign(window, { __savannaSpoken: spoken });
            activeUtterance = utterance;
            utterance.onstart?.();
          },
          cancel() {
            activeUtterance = undefined;
          },
        },
      });
      Object.assign(window, {
        SpeechRecognition: MockRecognition,
        __savannaFinishSpeech: () => {
          const utterance = activeUtterance;
          activeUtterance = undefined;
          utterance?.onend?.();
        },
      });
    });
    await installCapture(page, ...captures[1]!);
    await page.goto(`${origin}${captures[1]![0]}`);
    await page.getByRole("button", { name: /access guide/i }).click();
    await page.locator("#access-voice-start").click();
    await page.evaluate(() => {
      const recognition = (
        window as Window & {
          __savannaRecognition?: { onresult?: (event: unknown) => void };
        }
      ).__savannaRecognition;
      recognition?.onresult?.({
        results: [[{ transcript: "Please take me to the main content." }]],
      });
    });
    await expect(page.getByRole("status")).toContainText(
      /opening.*page content/i,
    );
    const spoken = await page.evaluate(
      () =>
        (
          window as Window & {
            __savannaSpoken?: Array<{ text: string; lang: string }>;
          }
        ).__savannaSpoken,
    );
    expect(spoken).toHaveLength(2);
    expect(spoken?.[1]?.text).toBe(await page.getByRole("status").innerText());
    expect(spoken?.[1]?.lang).toBe("en-US");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.evaluate(() => {
      (
        window as Window & { __savannaFinishSpeech?: () => void }
      ).__savannaFinishSpeech?.();
    });
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("welcomes learners aloud with Savanna-specific directions", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      class MockUtterance {
        text: string;
        lang = "";
        onstart?: () => void;
        constructor(text: string) {
          this.text = text;
        }
      }
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: MockUtterance,
      });
      Object.defineProperty(window, "speechSynthesis", {
        value: {
          speak(utterance: MockUtterance) {
            Object.assign(window, {
              __dimtsSavannaSpeech: {
                text: utterance.text,
                lang: utterance.lang,
              },
            });
            utterance.onstart?.();
          },
          cancel() {},
        },
      });
    });
    await installCapture(page, ...captures[1]!);
    await page.goto(`${origin}${captures[1]![0]}`);
    await page.getByRole("button", { name: /access guide/i }).click();
    await expect(page.getByRole("status")).toContainText(
      /reading the directions/i,
    );

    const spoken = await page.evaluate(
      () =>
        (
          window as Window & {
            __dimtsSavannaSpeech?: { text: string; lang: string };
          }
        ).__dimtsSavannaSpeech,
    );
    expect(spoken?.text).toMatch(
      /welcome to the savanna guide.*page's content.*where would you like to go/i,
    );
    expect(spoken?.lang).toBe("en-US");
    await expect(
      page
        .getByRole("region", { name: /where do you want/i })
        .getByText(/welcome to the savanna guide/i),
    ).toBeVisible();
  });

  test("installs the guide when the host already has a Dimts embed", async ({
    page,
  }) => {
    await installCapture(page, ...captures[1]!, true);
    await page.goto(`${origin}${captures[1]![0]}`);

    const launcher = page.getByRole("button", { name: /access guide/i });
    await expect(launcher).toBeVisible();
    await expect(launcher).toBeEnabled();
    await launcher.click();
    await expect(launcher).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("region", { name: /where do you want/i }),
    ).toBeVisible();
    await expect(page.locator("script[data-dimts-embed]")).toHaveCount(1);
  });

  for (const [url, file] of captures) {
    test(`installs semantic guide on ${url} through the host loader`, async ({
      page,
    }) => {
      await installCapture(page, url, file);
      await page.goto(`${origin}${url}`);
      const launcher = page.getByRole("button", { name: /access guide/i });
      await expect(launcher).toBeVisible();
      const closedA11y = await new AxeBuilder({ page })
        .include("[data-dimts-access-guide]")
        .analyze();
      expect(
        closedA11y.violations.filter((item) =>
          ["critical", "serious"].includes(item.impact ?? ""),
        ),
      ).toEqual([]);
      await page.setViewportSize({ width: 320, height: 780 });
      await launcher.focus();
      await page.keyboard.press("Enter");
      await expect(launcher).toHaveAttribute("aria-expanded", "true");

      const guide = page.getByRole("region", { name: /where do you want/i });
      const panelBox = await guide.boundingBox();
      expect(panelBox).not.toBeNull();
      expect(panelBox!.y).toBeGreaterThanOrEqual(0);
      expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(780);
      await expect(
        guide.getByText(/welcome to the savanna guide/i),
      ).toBeVisible();
      await expect(
        guide.getByRole("link", { name: /page content/i }),
      ).toHaveAttribute("href", "#content");
      await expect(
        guide.getByRole("link", { name: /lessons/i }),
      ).toHaveAttribute("href", "/learn/");
      await expect(
        guide.getByRole("link", { name: /human help/i }),
      ).toHaveAttribute("href", "/helper");
      await expect(
        guide.getByRole("link", { name: /service status/i }),
      ).toHaveAttribute("href", "/v1/health");
      for (const link of await guide.getByRole("link").all()) {
        const box = await link.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      }
      await guide.getByRole("button", { name: /open the assistant/i }).click();
      expect(
        await page.evaluate(
          () => (window as Window & { __dimtsOpens?: number }).__dimtsOpens,
        ),
      ).toBe(1);

      const accessibility = await new AxeBuilder({ page })
        .include("[data-dimts-access-guide]")
        .analyze();
      expect(
        accessibility.violations.filter((item) =>
          ["critical", "serious"].includes(item.impact ?? ""),
        ),
      ).toEqual([]);
    });
  }

  test("retains text choices if browser speech recognition is unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "SpeechRecognition", { value: undefined });
      Object.defineProperty(window, "webkitSpeechRecognition", {
        value: undefined,
      });
    });
    await installCapture(page, ...captures[2]!);
    await page.goto(`${origin}${captures[2]![0]}`);
    await page.getByRole("button", { name: /access guide/i }).click();
    await expect(page.getByRole("status")).toContainText(
      /(?:speech recognition|spoken directions) .* unavailable/i,
    );
    await expect(
      page
        .getByRole("region", { name: /where do you want/i })
        .getByRole("link", {
          name: /page content/i,
        }),
    ).toBeVisible();
  });
});
