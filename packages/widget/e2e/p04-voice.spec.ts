import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { loadPacks } from "../../locales-tools/src/index.js";

const ui = loadPacks(resolve("locales")).get("en")!.ui;

// Browser API doubles exercise the production adapters, not injected widget ports.
// The reviewed catalog below is a test fixture, never physical-device evidence.
async function openVoiceWidget(
  page: Page,
  configured = true,
  oromoVoice = false,
) {
  const asks: Record<string, unknown>[] = [];
  const requests: string[] = [];
  let expireNextResume = false;
  let sessionGeneration = 0;
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    const state = {
      starts: [] as { lang: string; local: boolean }[],
      stops: 0,
      aborts: 0,
      pauses: 0,
      resumes: 0,
      cancels: 0,
      spoken: [] as {
        text: string;
        lang: string;
        rate: number;
        local: boolean;
      }[],
      voices: true,
      localRecognition: true,
      tones: 0,
      vibrations: 0,
      active: undefined as Recognition | undefined,
      utterance: undefined as Utterance | undefined,
      finish: (text: string, confidence = 0.98) => {
        const active = state.active;
        active?.onresult?.({
          resultIndex: 0,
          results: [
            Object.assign([{ transcript: text, confidence }], {
              isFinal: true,
            }),
          ],
        });
        active?.onend?.();
      },
      fail: (error: string) => state.active?.onerror?.({ error }),
    };
    class Recognition {
      processLocally = false;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult:
        ((event: { resultIndex: number; results: unknown[] }) => void) | null =
        null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      static available = async () =>
        state.localRecognition ? "available" : "unavailable";
      start() {
        state.active = this;
        state.starts.push({ lang: this.lang, local: this.processLocally });
      }
      stop() {
        state.stops += 1;
      }
      abort() {
        state.aborts += 1;
      }
    }
    class Utterance {
      text: string;
      lang = "";
      rate = 1;
      voice?: { localService: boolean };
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    const synthesis = new EventTarget();
    Object.assign(synthesis, {
      getVoices: () =>
        state.voices
          ? ["en-US", "om-ET"].map((lang) => ({
              name: "Local fixture",
              lang,
              localService: true,
              default: true,
              voiceURI: `fixture-${lang}`,
            }))
          : [],
      speak: (utterance: Utterance) => {
        state.utterance = utterance;
        state.spoken.push({
          text: utterance.text,
          lang: utterance.lang,
          rate: utterance.rate,
          local: utterance.voice?.localService === true,
        });
      },
      cancel: () => {
        state.cancels += 1;
      },
      pause: () => {
        state.pauses += 1;
      },
      resume: () => {
        state.resumes += 1;
      },
    });
    Object.defineProperty(window, "SpeechRecognition", {
      value: Recognition,
      configurable: true,
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: Utterance,
      configurable: true,
    });
    Object.defineProperty(window, "speechSynthesis", {
      value: synthesis,
      configurable: true,
    });
    Object.defineProperty(navigator, "vibrate", {
      value: () => {
        state.vibrations += 1;
        return true;
      },
      configurable: true,
    });
    class Audio {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator() {
        return {
          frequency: { setValueAtTime() {} },
          connect() {},
          start() {
            state.tones += 1;
          },
          stop() {},
        };
      }
      createGain() {
        return { gain: { setValueAtTime() {} }, connect() {} };
      }
      close() {
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, "AudioContext", {
      value: Audio,
      configurable: true,
    });
    Object.defineProperty(window, "__browserVoice", { value: state });
  });
  await page.route("http://127.0.0.1:4173/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>Voice fixture</title></head><body><dimts-assistant data-api="http://api.test/v1" data-host-key="test-host"></dimts-assistant><script type="module" src="/dimts-widget.js"></script></body></html>',
    }),
  );
  await page.context().route("http://api.test/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/languages"))
      return route.fulfill({
        json: {
          languages: [
            {
              code: "en",
              nameNative: "English",
              nameEn: "English",
              script: "Latn",
              dir: "ltr",
              status: "live",
              stt: configured,
              tts: configured,
              voice: configured
                ? { engine: "browser", bcp_tag: "en-US" }
                : null,
            },
            {
              code: "om",
              nameNative: "Afaan Oromoo",
              nameEn: "Afaan Oromoo",
              script: "Latn",
              dir: "ltr",
              status: "beta",
              stt: oromoVoice,
              tts: oromoVoice,
              voice: oromoVoice
                ? { engine: "browser", bcp_tag: "om-ET" }
                : null,
            },
          ],
        },
      });
    if (path.endsWith("/ui")) return route.fulfill({ json: ui });
    if (path.endsWith("/sessions")) {
      const body = route.request().postDataJSON();
      if (expireNextResume && body.sessionId) {
        expireNextResume = false;
        sessionGeneration += 1;
        return route.fulfill({ status: 401, json: {} });
      }
      return route.fulfill({
        status: 201,
        json: {
          sessionId: `voice-session-1234-${sessionGeneration}`,
          sessionToken: `voice-token-${sessionGeneration}`,
          resumeToken: `voice-resume-token-1234567890-${sessionGeneration}`,
          lang: "en",
          cloudOk: body.cloudOk === true,
        },
      });
    }
    if (path.endsWith("/ask")) {
      asks.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          id: `reply-${asks.length}`,
          kind: "answer",
          text: "Choose one topic to study.",
          lang: "en",
          dir: "ltr",
          citations: [],
          actions: [],
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("http://127.0.0.1:4173/");
  await page.getByRole("button", { name: "English" }).click();
  return {
    asks,
    requests,
    expireSession: () => {
      expireNextResume = true;
    },
  };
}

async function voiceState(page: Page) {
  return page.evaluate(() => {
    const state = (
      window as unknown as { __browserVoice: Record<string, unknown> }
    ).__browserVoice;
    return Object.fromEntries(
      Object.entries(state).filter(
        ([key]) => !["active", "utterance", "finish", "fail"].includes(key),
      ),
    );
  });
}

async function finish(page: Page, text: string, confidence = 0.98) {
  await page.evaluate(
    ({ text, confidence }) => {
      (
        window as unknown as {
          __browserVoice: { finish(text: string, confidence: number): void };
        }
      ).__browserVoice.finish(text, confidence);
    },
    { text, confidence },
  );
}

test("P04 automatically configures local browser voice and reviews without sending or persisting audio", async ({
  page,
}) => {
  const { asks, requests } = await openVoiceWidget(page);
  await expect(
    page.getByRole("button", { name: "Start talking" }),
  ).toBeVisible();
  expect((await voiceState(page)).starts).toEqual([]);
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByText(ui["voice.listening"]!)).toBeVisible();
  await expect
    .poll(() => voiceState(page))
    .toMatchObject({ starts: [{ lang: "en-US", local: true }] });
  await page.getByRole("button", { name: "Stop talking" }).click();
  await expect(page.getByText(ui["voice.processing"]!)).toBeVisible();
  await finish(page, "Review before sending.");
  await expect(page.locator("#message")).toHaveValue("Review before sending.");
  expect(asks).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "Say it again" }),
  ).toBeVisible();
  await page.locator("#message").fill("My edited question.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() => asks)
    .toEqual([
      expect.objectContaining({ text: "My edited question.", via: "voice" }),
    ]);
  expect(
    requests.every((url) =>
      ["http://api.test", "http://127.0.0.1:4173"].includes(
        new URL(url).origin,
      ),
    ),
  ).toBe(true);
  expect(requests.some((url) => /\/(stt|tts)(?:\?|$)/u.test(url))).toBe(false);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("Review before sending.");
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  const cacheUrls = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).map(
            (request) => request.url,
          ),
        ),
      )
    ).flat(),
  );
  expect(cacheUrls.some((url) => /audio|\/stt|\/tts/u.test(url))).toBe(false);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
});

test("P04 hides unsupported voice, keeps typed questions, and preserves the Oromo beta label", async ({
  page,
}) => {
  const { asks, requests } = await openVoiceWidget(page, false);
  await expect(page.locator(".mic")).toHaveCount(0);
  await expect(page.getByText(ui["voice.inputUnavailable"]!)).toBeVisible();
  expect(requests.some((url) => /voice-runtime/u.test(url))).toBe(false);
  await page.locator("#message").fill("Typed question.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => asks.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Read reply aloud" }),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-role="assistant"]').getByText(ui["voice.unavailable"]!),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Change language", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Afaan Oromoo/u }),
  ).toContainText(ui["status.beta"]!);
});

test("P04 cancels recording on language changes and disconnect without stale review", async ({
  page,
}) => {
  await openVoiceWidget(page);
  await page.getByRole("button", { name: "Start talking" }).click();
  await page
    .getByRole("button", { name: "Change language", exact: true })
    .click();
  await page.getByRole("button", { name: /Afaan Oromoo/u }).click();
  await finish(page, "Stale transcript.");
  await expect.poll(() => voiceState(page)).toMatchObject({ aborts: 1 });
  await expect(page.locator("#message")).toHaveValue("");
  await page
    .getByRole("button", { name: "Change language", exact: true })
    .click();
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Start talking" }).click();
  await page.locator("dimts-assistant").evaluate((element) => element.remove());
  await finish(page, "Detached transcript.");
  await expect.poll(() => voiceState(page)).toMatchObject({ aborts: 2 });
});

test("P04 refreshes installed voices and controls local playback without overlaps", async ({
  page,
}) => {
  await openVoiceWidget(page);
  await page.evaluate(() => {
    (
      window as unknown as { __browserVoice: { spoken: unknown[] } }
    ).__browserVoice.spoken = [];
  });
  await page.locator("#message").fill("Typed question.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Speech speed").selectOption("1.25");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Read reply aloud" }).click();
  await page.getByRole("button", { name: "Pause reading" }).click();
  await page.getByRole("button", { name: "Resume reading" }).click();
  await page.getByRole("button", { name: "Read reply aloud" }).click();
  await expect
    .poll(() => voiceState(page))
    .toMatchObject({
      pauses: 1,
      resumes: 1,
      spoken: [
        {
          text: "Choose one topic to study.",
          lang: "en-US",
          rate: 1.25,
          local: true,
        },
        {
          text: "Choose one topic to study.",
          lang: "en-US",
          rate: 1.25,
          local: true,
        },
      ],
    });
  expect((await voiceState(page)).cancels).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Stop reading" }).click();
  await page.evaluate(() => {
    (
      window as unknown as { __browserVoice: { voices: boolean } }
    ).__browserVoice.voices = false;
    speechSynthesis.dispatchEvent(new Event("voiceschanged"));
  });
  await expect(
    page.getByRole("button", { name: "Read reply aloud" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (
      window as unknown as { __browserVoice: { voices: boolean } }
    ).__browserVoice.voices = true;
    speechSynthesis.dispatchEvent(new Event("voiceschanged"));
  });
  await expect(
    page.getByRole("button", { name: "Read reply aloud" }),
  ).toBeVisible();
});

test("P04 low confidence has a localized retry and sound-off plus reduced motion keeps visible cues", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openVoiceWidget(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: ui["voice.soundCues"]! }).uncheck();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByText(ui["voice.listening"]!)).toBeVisible();
  await finish(page, "Uncertain transcript.", 0.2);
  await expect(page.getByRole("alert")).toContainText(
    ui["voice.lowConfidence"]!,
  );
  await expect(page.locator("#message")).toHaveValue("");
  expect(await voiceState(page)).toMatchObject({ tones: 0, vibrations: 0 });
});

test("P04 ends recording after sixty seconds, times out cleanly, and cancels on session replacement", async ({
  page,
}) => {
  const { asks, expireSession } = await openVoiceWidget(page);
  await page.clock.install();
  await page.getByRole("button", { name: "Start talking" }).click();
  await page.clock.fastForward(60_000);
  await expect.poll(() => voiceState(page)).toMatchObject({ stops: 1 });
  await expect(page.getByText(ui["voice.processing"]!)).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect(page.getByRole("alert")).toContainText(ui["voice.timeout"]!);
  await expect(page.locator("#message")).toBeEnabled();
  await page.getByRole("button", { name: "Start talking" }).click();
  expireSession();
  // Use one activation: recovery intentionally leaves this checkbox unchecked.
  await page
    .getByRole("checkbox", { name: "Allow remote AI for this session" })
    .click();
  await expect(page.getByText(ui["privacy.sessionRestarted"]!)).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Allow remote AI for this session" }),
  ).not.toBeChecked();
  await finish(page, "A previous session transcript.");
  await expect(page.locator("#message")).toHaveValue("");
  expect(asks).toHaveLength(0);
  await expect.poll(() => voiceState(page)).toMatchObject({ aborts: 2 });
});

test("P04 labels reviewed beta voice with its accuracy note while live voice omits it", async ({
  page,
}) => {
  await openVoiceWidget(page, true, true);
  await expect(
    page.getByRole("button", { name: "Start talking" }),
  ).toBeVisible();
  await expect(
    page.getByText(ui["voice.betaNote"]!, { exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Change language", exact: true })
    .click();
  await page.getByRole("button", { name: /Afaan Oromoo/u }).click();
  await expect(
    page.getByRole("button", { name: "Start talking" }),
  ).toBeVisible();
  await expect(
    page.getByText(ui["voice.betaNote"]!, { exact: false }),
  ).toContainText(ui["status.beta"]!);
});

test("P04 closing the widget cancels recording and playback before reopening", async ({
  page,
}) => {
  await openVoiceWidget(page);
  await page.getByRole("button", { name: "Start talking" }).click();
  await page.evaluate(() => window.Dimts?.close());
  await expect.poll(() => voiceState(page)).toMatchObject({ aborts: 1 });
  await finish(page, "A hidden transcript.");
  await page.evaluate(() => window.Dimts?.open());
  await expect(page.locator("#message")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Start talking" }),
  ).toBeVisible();
  await page.locator("#message").fill("Typed question.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Read reply aloud" }).click();
  const cancels = (await voiceState(page)).cancels as number;
  await page.evaluate(() => window.Dimts?.close());
  await expect
    .poll(async () => (await voiceState(page)).cancels)
    .toBeGreaterThan(cancels);
  await page.evaluate(() => window.Dimts?.open());
  await expect(page.getByRole("button", { name: "Stop reading" })).toHaveCount(
    0,
  );
});
