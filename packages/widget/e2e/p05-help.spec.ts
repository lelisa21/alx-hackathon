import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { resolve } from "node:path";
import { loadPacks } from "../../locales-tools/src/index.js";

const ui = loadPacks(resolve("locales")).get("en")!.ui;
async function openHelp(
  page: Page,
  available = true,
  joined = false,
  options: { waitTimeoutMs?: number; availabilityGate?: Promise<void> } = {},
) {
  const frames: Record<string, unknown>[] = [];
  const uploads: Buffer[] = [];
  let peer: WebSocketRoute;
  await page.routeWebSocket("ws://api.test/v1/help/ws", (socket) => {
    peer = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      frames.push(frame);
      if (frame.type === "auth")
        socket.send(
          JSON.stringify({ type: "help.joined", helperJoined: joined }),
        );
    });
  });
  await page.route("http://127.0.0.1:4173/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>Help test</title></head><body><dimts-assistant data-api="http://api.test/v1" data-host-key="test-host"></dimts-assistant><script type="module" src="/dimts-widget.js"></script></body></html>',
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
              status: "beta",
              stt: false,
              tts: false,
            },
          ],
        },
      });
    if (path.endsWith("/ui")) return route.fulfill({ json: ui });
    if (path.endsWith("/sessions"))
      return route.fulfill({
        json: {
          sessionId: "session-12345678",
          sessionToken: "session-token",
          resumeToken: "resume-token",
          lang: "en",
          cloudOk: false,
          consentVersion: null,
        },
      });
    if (path.endsWith("/availability")) {
      await options.availabilityGate;
      return route.fulfill({
        json: {
          available,
          nextOpenAt: available ? undefined : "2026-11-16T09:00:00.000Z",
          waitTimeoutMs: options.waitTimeoutMs ?? 300000,
        },
      });
    }
    if (path.endsWith("/help"))
      return route.fulfill({
        status: 201,
        json: { id: "request-1", status: "waiting" },
      });
    if (path.endsWith("/ice"))
      return route.fulfill({ json: { iceServers: [] } });
    if (path.endsWith("/image")) {
      uploads.push(route.request().postDataBuffer()!);
      return route.fulfill({
        status: 201,
        json: { id: "image-1", expiresAt: "2026-11-13T14:00:00Z" },
      });
    }
    if (path.endsWith("/close")) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("http://127.0.0.1:4173/");
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Help me now" }).click();
  await expect
    .poll(() => page.locator("[data-help-availability]").count())
    .toBe(1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Send request" })
    .click();
  await expect.poll(() => frames.length).toBeGreaterThan(0);
  return {
    frames,
    uploads,
    send: (frame: unknown) => peer.send(JSON.stringify(frame)),
  };
}

test("P05 outside-hours leave-message uses the same chat and keeps tutor available", async ({
  page,
}) => {
  const { frames } = await openHelp(page, false);
  await expect(
    page.getByText("Helpers are outside their available hours.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Leave a message", exact: true })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Please help with this lesson.");
  await page
    .locator("form.help-chat")
    .getByRole("button", { name: "Send", exact: true })
    .click();
  expect(frames.filter((x) => x.type === "chat.message")).toHaveLength(1);
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeEnabled();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((x) =>
      ["serious", "critical"].includes(x.impact ?? ""),
    ),
  ).toEqual([]);
});

test("P05 five-minute fallback has no countdown and helper arrival ends waiting", async ({
  page,
}) => {
  await page.clock.install();
  const { send } = await openHelp(page);
  await expect(page.locator("[data-help-timeout]")).toHaveCount(0);
  await page.clock.fastForward(300001);
  await expect(page.locator("[data-help-timeout]")).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
  send({ type: "help.joined", helperJoined: true, helperName: "Alex" });
  await expect(page.locator("[data-help-timeout]")).toHaveCount(0);
  await expect(
    page.getByText("Your helper: Alex", { exact: true }),
  ).toBeVisible();
});

test("P05 replays the learner's stored message without treating it as an error", async ({
  page,
}) => {
  const { send } = await openHelp(page, false);
  send({
    type: "chat.message",
    id: "saved-question",
    from: "learner",
    text: "A previously saved message.",
  });
  send({
    type: "chat.message",
    id: "saved-question",
    from: "learner",
    text: "A previously saved message.",
  });
  await expect(
    page.getByText("A previously saved message.", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Could not reach human help. Try again.", { exact: true }),
  ).toHaveCount(0);
});

test("P05 late availability applies the configured timeout to an already waiting request", async ({
  page,
}) => {
  await page.clock.install();
  let release!: () => void;
  const availabilityGate = new Promise<void>((resolve) => (release = resolve));
  await openHelp(page, true, false, { waitTimeoutMs: 1000, availabilityGate });
  release();
  await expect(
    page.getByText("Requests are within helper hours.", { exact: false }),
  ).toBeVisible();
  await page.clock.fastForward(1001);
  await expect(page.locator("[data-help-timeout]")).toBeVisible();
});

for (const stop of ["learner", "helper", "hidden"] as const)
  test(`P05 explicit capture and ${stop} stop ends native video tracks`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const probe = window as unknown as {
        captureCalls: number;
        screenTrack?: MediaStreamTrack;
      };
      probe.captureCalls = 0;
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: async (options: DisplayMediaStreamOptions) => {
          probe.captureCalls++;
          if (options.audio !== false) throw new Error("audio requested");
          const canvas = document.createElement("canvas");
          canvas.width = 100;
          canvas.height = 100;
          canvas.getContext("2d")!.fillRect(0, 0, 100, 100);
          const stream = canvas.captureStream(5);
          probe.screenTrack = stream.getVideoTracks()[0];
          return stream;
        },
      });
    });
    const { send, frames } = await openHelp(page, true, true);
    const probe = () =>
      page.evaluate(() => ({
        calls: (window as unknown as { captureCalls: number }).captureCalls,
        track: (window as unknown as { screenTrack?: MediaStreamTrack })
          .screenTrack?.readyState,
      }));
    expect((await probe()).calls).toBe(0);
    send({ type: "share.request" });
    await expect(page.getByRole("dialog")).toBeVisible();
    expect((await probe()).calls).toBe(0);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    expect((await probe()).calls).toBe(0);
    send({ type: "share.request" });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Share my screen", exact: true })
      .click();
    await expect(page.locator(".share-banner")).toBeVisible();
    await expect.poll(async () => (await probe()).calls).toBe(1);
    if (stop === "learner")
      await page
        .getByRole("button", { name: "Stop sharing", exact: true })
        .click();
    if (stop === "helper") send({ type: "share.stop", reason: "helper" });
    if (stop === "hidden")
      await page
        .locator("dimts-assistant")
        .evaluate((el) => el.setAttribute("hidden", ""));
    await expect
      .poll(async () => (await probe()).track, {
        timeout: 1000,
        intervals: [20, 50, 100],
      })
      .toBe("ended");
    if (stop !== "helper")
      expect(frames.some((frame) => frame.type === "share.stop")).toBe(true);
  });

test("P05 share decline captures nothing; unavailable capture offers picture and words", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {},
    }),
  );
  const { send, frames, uploads } = await openHelp(page, true, true);
  send({ type: "share.request" });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button").first()).toHaveText("Not now");
  await dialog.getByRole("button", { name: "Not now", exact: true }).click();
  expect(frames.some((x) => x.type === "share.decline")).toBe(true);
  send({ type: "share.request" });
  await dialog
    .getByRole("button", { name: "Share my screen", exact: true })
    .click();
  await expect(
    page.getByText(
      "Screen sharing is unavailable. You can send a picture or describe what you see.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Describe what you see", exact: true })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ZsAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("Send a picture of my screen", { exact: true })
    .setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByText(
      "Picture sent. It is removed when help ends or within two hours.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(uploads[0]).toEqual(png);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((x) =>
      ["serious", "critical"].includes(x.impact ?? ""),
    ),
  ).toEqual([]);
});
