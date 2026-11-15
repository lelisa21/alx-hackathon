import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

async function installRecognitionMock(page: Page) {
  await page.addInitScript(() => {
    class MockRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onstart?: () => void;
      onend?: () => void;
      onresult?: (event: unknown) => void;
      onerror?: (event: unknown) => void;
      start() {
        Object.assign(window, {
          __dimtsRecognitionLang: this.lang,
          __dimtsRecognition: this,
        });
        this.onstart?.();
      }
      stop() {
        this.onend?.();
      }
    }
    Object.assign(window, { SpeechRecognition: MockRecognition });
  });
}

async function deliverTranscript(page: Page, transcript: string) {
  await page.evaluate((recognizedText) => {
    const recognition = (
      window as Window & {
        __dimtsRecognition?: {
          onresult?: (event: unknown) => void;
        };
      }
    ).__dimtsRecognition;
    recognition?.onresult?.({
      results: [[{ transcript: recognizedText }]],
    });
  }, transcript);
}

async function deliverAlternatives(page: Page, transcripts: string[]) {
  await page.evaluate((recognizedTexts) => {
    const recognition = (
      window as Window & {
        __dimtsRecognition?: { onresult?: (event: unknown) => void };
      }
    ).__dimtsRecognition;
    recognition?.onresult?.({
      results: [recognizedTexts.map((transcript) => ({ transcript }))],
    });
  }, transcripts);
}

test.describe("FR-HOME-ACCESS public homepage guide", () => {
  test("offers a visible, keyboard operable destination guide", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:4173/");
    const launcher = page.getByRole("button", { name: /access guide/i });
    await expect(launcher).toBeVisible();
    const closedA11y = await new AxeBuilder({ page }).analyze();
    expect(
      closedA11y.violations.filter((item) =>
        ["critical", "serious"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
    await launcher.focus();
    await page.keyboard.press("Enter");
    await expect(launcher).toHaveAttribute("aria-expanded", "true");

    const guide = page.getByRole("region", { name: /where do you want/i });
    await expect(guide.getByText(/welcome to dimts/i)).toBeVisible();
    const panelBox = await guide.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.y).toBeGreaterThanOrEqual(0);
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(720);
    await expect(
      guide.getByRole("link", { name: /assistant/i }),
    ).toHaveAttribute("href", "#assistant");
    await expect(guide.getByRole("link", { name: /lessons/i })).toHaveAttribute(
      "href",
      "/learn/",
    );
    await expect(guide.getByRole("link", { name: /savanna/i })).toHaveAttribute(
      "href",
      "/savanna/",
    );
    await expect(
      guide.getByRole("link", { name: /human help/i }),
    ).toHaveAttribute("href", "/helper");
    await expect(
      guide.getByRole("link", { name: /service status/i }),
    ).toHaveAttribute("href", "#status");

    await page.setViewportSize({ width: 320, height: 780 });
    const narrowPanelBox = await guide.boundingBox();
    expect(narrowPanelBox).not.toBeNull();
    expect(narrowPanelBox!.y).toBeGreaterThanOrEqual(0);
    expect(narrowPanelBox!.y + narrowPanelBox!.height).toBeLessThanOrEqual(780);
    for (const link of await guide.getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((item) =>
        ["critical", "serious"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
  });

  test("speaks the welcome directions on first open and can replay or stop", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      let activeUtterance: MockUtterance | undefined;
      class MockUtterance {
        text: string;
        lang = "";
        onstart?: () => void;
        onend?: () => void;
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
            const spoken =
              (
                window as Window & {
                  __dimtsSpoken?: Array<{ text: string; lang: string }>;
                }
              ).__dimtsSpoken ?? [];
            spoken.push({ text: utterance.text, lang: utterance.lang });
            Object.assign(window, { __dimtsSpoken: spoken });
            activeUtterance = utterance;
            utterance.onstart?.();
          },
          cancel() {
            activeUtterance?.onend?.();
            activeUtterance = undefined;
            Object.assign(window, { __dimtsSpeechCancelled: true });
          },
        },
      });
    });
    await page.goto("http://127.0.0.1:4173/");
    await page.getByRole("button", { name: /access guide/i }).click();

    const guide = page.getByRole("region", { name: /where do you want/i });
    await expect(guide.getByText(/welcome to dimts/i)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __dimtsSpoken?: Array<{ text: string; lang: string }>;
              }
            ).__dimtsSpoken?.length ?? 0,
        ),
      )
      .toBe(1);
    const firstSpeech = await page.evaluate(
      () =>
        (
          window as Window & {
            __dimtsSpoken?: Array<{ text: string; lang: string }>;
          }
        ).__dimtsSpoken?.[0],
    );
    expect(firstSpeech?.text).toMatch(/welcome.*where would you like to go/i);
    expect(firstSpeech?.lang).toBe("en-US");

    for (const [index, languageTag] of ["am-ET", "om-ET", "ti-ET"].entries()) {
      await page.locator("#access-voice-language").selectOption(languageTag);
      await page.locator("#access-read-directions").click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  __dimtsSpoken?: Array<{ text: string; lang: string }>;
                }
              ).__dimtsSpoken?.length ?? 0,
          ),
        )
        .toBe(index + 2);
    }
    const spokenLanguages = await page.evaluate(() =>
      (
        window as Window & {
          __dimtsSpoken?: Array<{ text: string; lang: string }>;
        }
      ).__dimtsSpoken?.map(({ lang }) => lang),
    );
    expect(spokenLanguages).toEqual(["en-US", "am-ET", "om-ET", "ti-ET"]);
    await page.locator("#access-stop-speaking").click();
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __dimtsSpeechCancelled?: boolean })
            .__dimtsSpeechCancelled,
      ),
    ).toBe(true);
  });

  test("keeps the visible directions when speech output is unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: undefined,
      });
      Object.defineProperty(window, "speechSynthesis", { value: undefined });
    });
    await page.goto("http://127.0.0.1:4173/");
    await page.getByRole("button", { name: /access guide/i }).click();

    await expect(page.getByRole("status")).toContainText(
      /spoken directions are unavailable/i,
    );
    await expect(page.locator("#access-read-directions")).toBeDisabled();
    await expect(
      page.locator("#access-guide-panel").getByRole("link", {
        name: /browse lessons/i,
      }),
    ).toBeVisible();
  });

  test("sets one of the four requested recognition locales and keeps a text fallback", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "SpeechRecognition", { value: undefined });
      Object.defineProperty(window, "webkitSpeechRecognition", {
        value: undefined,
      });
    });
    await page.goto("http://127.0.0.1:4173/");
    await page.getByRole("button", { name: /access guide/i }).click();
    const language = page.locator("#access-voice-language");
    const expected = ["en-US", "am-ET", "om-ET", "ti-ET"];
    await expect(language.locator("option")).toHaveCount(4);
    for (const tag of expected) {
      await language.selectOption(tag);
      await expect(language).toHaveValue(tag);
    }
    await language.selectOption("en-US");
    await expect(
      page.locator("#access-guide-panel").getByRole("link", {
        name: /browse lessons/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/speech recognition is unavailable/i),
    ).toBeVisible();
  });

  test("starts recognition only after activation and exposes its state", async ({
    page,
  }) => {
    await installRecognitionMock(page);
    await page.goto("http://127.0.0.1:4173/");
    await page.locator("#access-guide-toggle").click();
    await page.locator("#access-voice-language").selectOption("om-ET");
    await page.locator("#access-voice-start").click();
    await expect(page.getByRole("status")).toContainText("Dhaggeeffachaa");
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __dimtsRecognitionLang?: string })
            .__dimtsRecognitionLang,
      ),
    ).toBe("om-ET");
    expect(
      await page.evaluate(
        () =>
          (
            window as Window & {
              __dimtsRecognition?: { maxAlternatives?: number };
            }
          ).__dimtsRecognition?.maxAlternatives,
      ),
    ).toBe(5);
    await deliverTranscript(page, "not a destination");
    await expect(page.locator("#access-voice-transcript")).toContainText(
      "not a destination",
    );
    await expect(page.getByRole("status")).toContainText(
      /hubachuun hin danda'amne/i,
    );
    await expect(page).toHaveURL("http://127.0.0.1:4173/");
    await page.locator("#access-voice-stop").click();
    await expect(page.getByRole("status")).toContainText("dhaabbateera");
  });

  const naturalCommands = [
    ["Could you please take me to my courses?", "/learn/", "en-US"],
    ["I need to talk to a real person for support.", "/helper", "en-US"],
    ["Can I talk to someone about my account?", "/helper", "en-US"],
    ["I need supprot with my account.", "/helper", "en-US"],
    ["Would you check whether the service is healthy?", "#status", "en-US"],
    ["Open ALX Savanna for me!", "/savanna/", "en-US"],
    ["Please show me the chat assistant.", "#assistant", "en-US"],
    ["Koorsii naaf agarsiisi", "/learn/", "om-ET"],
  ] as const;

  for (const [transcript, destination, languageTag] of naturalCommands) {
    test(`understands the natural request: ${transcript}`, async ({ page }) => {
      await installRecognitionMock(page);
      await page.goto("http://127.0.0.1:4173/");
      await page.locator("#access-guide-toggle").click();
      await page.locator("#access-voice-language").selectOption(languageTag);
      await page.locator("#access-voice-start").click();
      await deliverTranscript(page, transcript);
      await expect
        .poll(() => {
          const current = new URL(page.url());
          return destination.startsWith("#") ? current.hash : current.pathname;
        })
        .toBe(destination === "/learn/" ? "/learn/en/" : destination);
    });
  }

  test("uses a valid speech alternative and loads the real lessons page", async ({
    page,
  }) => {
    await installRecognitionMock(page);
    await page.goto("http://127.0.0.1:4173/");
    await page.locator("#access-guide-toggle").click();
    await page.locator("#access-voice-start").click();
    await deliverAlternatives(page, ["random unrelated words", "lessons"]);
    await expect(page).toHaveURL(/\/learn\/en\/$/);
    await expect(page.locator("body")).toContainText(/courses|lessons/i);
  });

  test("handles empty recognition results without throwing", async ({
    page,
  }) => {
    await installRecognitionMock(page);
    await page.goto("http://127.0.0.1:4173/");
    await page.locator("#access-guide-toggle").click();
    await page.locator("#access-voice-start").click();
    await page.evaluate(() => {
      const recognition = (
        window as Window & {
          __dimtsRecognition?: { onresult?: (event: unknown) => void };
        }
      ).__dimtsRecognition;
      recognition?.onresult?.({ results: [] });
    });
    await expect(page.getByRole("status")).toContainText(
      /didn't catch a destination/i,
    );
  });

  test("asks the learner to clarify a genuinely ambiguous request", async ({
    page,
  }) => {
    await installRecognitionMock(page);
    await page.goto("http://127.0.0.1:4173/");
    await page.locator("#access-guide-toggle").click();
    await page.locator("#access-voice-start").click();
    await deliverTranscript(page, "Please take me to human help with a course");
    await expect(page.getByRole("status")).toContainText(
      /more than one possible destination/i,
    );
    await expect(page).toHaveURL("http://127.0.0.1:4173/");
  });

  test("explains microphone permission errors", async ({ page }) => {
    await installRecognitionMock(page);
    await page.goto("http://127.0.0.1:4173/");
    await page.locator("#access-guide-toggle").click();
    await page.locator("#access-voice-start").click();
    await page.evaluate(() => {
      const recognition = (
        window as Window & {
          __dimtsRecognition?: { onerror?: (event: unknown) => void };
        }
      ).__dimtsRecognition;
      recognition?.onerror?.({ error: "not-allowed" });
    });
    await expect(page.getByRole("status")).toContainText(
      /microphone access is blocked/i,
    );
  });
});
