import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { resolve } from "node:path";
import { loadPacks } from "../../locales-tools/src/index.js";

const pack = loadPacks(resolve("locales")).get("en")!;
const api = "http://api.test/v1";

async function fixture(page: Page) {
  const state = {
    requests: [
      {
        id: "newer",
        lang: "en",
        channel: "web",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        summary: null,
      },
      {
        id: "older",
        lang: "en",
        channel: "web",
        createdAt: new Date(Date.now() - 180_000).toISOString(),
        summary: null,
      },
    ],
    profiles: [] as unknown[],
    closed: [] as unknown[],
    frames: [] as Record<string, unknown>[],
    sockets: [] as WebSocketRoute[],
    pictureReads: 0,
    pictureListFails: false,
    pictures: [] as { id: string; expiresAt: string }[],
  };
  await page.route("http://127.0.0.1:4173/p05-helper", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Helper</title></head><body><dimts-helper-console data-api="${api}"></dimts-helper-console><script type="module" src="/dimts-helper-console.js"></script></body></html>`,
    }),
  );
  await page.route(`${api}/**`, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
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
              stt: false,
              tts: false,
            },
          ],
        },
      });
    if (path.endsWith("/ui")) return route.fulfill({ json: pack.ui });
    if (path.endsWith("/login"))
      return route.fulfill({ json: { jwt: "helper-test-jwt" } });
    if (path.endsWith("/profile")) {
      if (request.method() === "PATCH")
        state.profiles.push(request.postDataJSON());
      return route.fulfill({ json: { displayName: null } });
    }
    if (path.endsWith("/metrics"))
      return route.fulfill({
        json: {
          closedCount: 4,
          resolvedCount: 2,
          unresolvedCount: 1,
          totalWaitMs: 120_000,
          totalResolutionMs: 300_000,
        },
      });
    if (path.endsWith("/health"))
      return route.fulfill({
        json: { provider: "offline", ladder: ["offline"] },
      });
    if (path.endsWith("/queue"))
      return route.fulfill({ json: { requests: state.requests } });
    if (path.endsWith("/claim")) return route.fulfill({ json: { ok: true } });
    if (path.endsWith("/close")) {
      state.closed.push(request.postData() ? request.postDataJSON() : null);
      state.requests = [];
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/ice"))
      return route.fulfill({ json: { iceServers: [] } });
    if (path.endsWith("/image"))
      return state.pictureListFails
        ? route.fulfill({ status: 503 })
        : route.fulfill({ json: { images: state.pictures } });
    if (path.includes("/image/")) {
      expect(request.headers().authorization).toBe("Bearer helper-test-jwt");
      state.pictureReads++;
      if (path.endsWith("/unavailable")) return route.fulfill({ status: 404 });
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.routeWebSocket("ws://api.test/v1/help/ws", (socket) => {
    state.sockets.push(socket);
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      state.frames.push(frame);
      if (frame.type === "auth")
        socket.send(
          JSON.stringify({ type: "help.joined", helperJoined: true }),
        );
    });
  });
  await page.goto("http://127.0.0.1:4173/p05-helper");
  await page.getByLabel("Helper token").fill("valid-helper-token-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-request-id]")).toHaveCount(2);
  return state;
}

test("FR-HELP-06/14/16 queue wait order, visual announcement, opt-in sound/name and metrics", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let chimes = 0;
    Object.defineProperty(window, "__helperChimes", { get: () => chimes });
    Object.defineProperty(window, "AudioContext", {
      value: class {
        state = "running";
        currentTime = 0;
        destination = {};
        resume() {
          return Promise.resolve();
        }
        close() {
          this.state = "closed";
          return Promise.resolve();
        }
        createOscillator() {
          return {
            frequency: { value: 0 },
            connect: () => ({ connect: () => undefined }),
            disconnect: () => undefined,
            start: () => {
              chimes++;
            },
            stop: () => undefined,
          };
        }
        createGain() {
          return {
            gain: {
              setValueAtTime: () => undefined,
              exponentialRampToValueAtTime: () => undefined,
            },
            disconnect: () => undefined,
          };
        }
      },
    });
  });
  await page.setViewportSize({ width: 320, height: 720 });
  const state = await fixture(page);
  await expect(page.locator("[data-request-id]").first()).toHaveAttribute(
    "data-request-id",
    "older",
  );
  await expect(page.getByText("Waiting 3 min", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Sound for new requests")).not.toBeChecked();
  await expect(page.getByLabel("First name (optional)")).toHaveValue("");
  expect(state.profiles).toEqual([]);
  await page.getByLabel("First name (optional)").fill("Aster");
  await page.getByRole("button", { name: "Save first name" }).click();
  await expect.poll(() => state.profiles).toEqual([{ displayName: "Aster" }]);
  await page.getByLabel("First name (optional)").fill("");
  await page.getByRole("button", { name: "Save first name" }).click();
  await expect
    .poll(() => state.profiles)
    .toEqual([{ displayName: "Aster" }, { displayName: null }]);
  await expect(
    page.getByText("4 ended · 2 resolved · 1 unresolved"),
  ).toBeVisible();
  state.requests.push({ ...state.requests[0]!, id: "arrived" });
  await page.getByRole("button", { name: "Refresh queue" }).click();
  const announcement = page.getByText("A new help request is waiting.", {
    exact: true,
  });
  await expect(announcement).toBeVisible();
  expect(
    await announcement.evaluate(
      (element) => element.getBoundingClientRect().width,
    ),
  ).toBeGreaterThan(1);
  const chimes = () =>
    page.evaluate(
      () => (window as unknown as { __helperChimes: number }).__helperChimes,
    );
  expect(await chimes()).toBe(0);
  await page.getByLabel("Sound for new requests").check();
  state.requests.push({ ...state.requests[0]!, id: "audible-arrival" });
  await page.getByRole("button", { name: "Refresh queue" }).click();
  await expect.poll(chimes).toBe(1);
  await page.getByLabel("Sound for new requests").uncheck();
  state.requests.push({ ...state.requests[0]!, id: "silent-arrival" });
  await page.getByRole("button", { name: "Refresh queue" }).click();
  await expect(page.locator("[data-request-id]")).toHaveCount(5);
  expect(await chimes()).toBe(1);
  const { AxeBuilder } = await import("@axe-core/playwright");
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  const host = page.locator("dimts-helper-console");
  expect(
    await host.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});

test("FR-HELP-07/15 replay is ordered and deduplicated and resolution is explicit", async ({
  page,
}) => {
  const state = await fixture(page);
  await page
    .locator('[data-request-id="older"]')
    .getByRole("button", { name: "Claim" })
    .click();
  await expect.poll(() => state.sockets.length).toBe(1);
  state.sockets[0]!.send(
    JSON.stringify({
      type: "chat.message",
      id: "m1",
      text: "First question",
      from: "learner",
    }),
  );
  await expect(page.getByText("First question", { exact: true })).toBeVisible();
  await expect(page.locator('[data-message-id="m1"]')).toBeFocused();
  await page.getByLabel("Message", { exact: true }).fill("A reply");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  state.sockets[0]!.close({ code: 1012, reason: "test reconnect" });
  await expect.poll(() => state.sockets.length).toBe(2);
  expect(
    state.frames.filter((frame) => frame.type === "auth").at(-1)?.lastMessageId,
  ).toBe("m1");
  state.sockets[1]!.send(
    JSON.stringify({
      type: "chat.message",
      id: "m1",
      text: "First question",
      from: "learner",
    }),
  );
  await page.getByLabel("Message", { exact: true }).fill("Unsent draft");
  state.sockets[1]!.send(
    JSON.stringify({
      type: "chat.message",
      id: "m2",
      text: "Second question",
      from: "learner",
    }),
  );
  await expect(page.getByText("First question", { exact: true })).toHaveCount(
    1,
  );
  const ownMessage = state.frames.find(
    (frame) => frame.type === "chat.message",
  )!;
  state.sockets[1]!.send(JSON.stringify({ ...ownMessage, from: "helper" }));
  await expect(page.getByText("A reply", { exact: true })).toHaveCount(1);
  await expect(
    page.getByText("Second question", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Unsent draft",
  );
  await page.getByLabel("Was this resolved?").selectOption("yes");
  await page.getByRole("button", { name: "End help" }).click();
  await expect.poll(() => state.closed).toEqual([{ resolved: true }]);
  await expect(page.getByText("First question", { exact: true })).toHaveCount(
    0,
  );
});

test("FR-HELP-08/09/12 helper requests view, stops in one action and explicitly retrieves pictures", async ({
  page,
}) => {
  await page.clock.install();
  const state = await fixture(page);
  state.pictures = [
    {
      id: "picture-one",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    {
      id: "unavailable",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  ];
  await page
    .locator('[data-request-id="older"]')
    .getByRole("button", { name: "Claim" })
    .click();
  await page.getByRole("button", { name: "Request screen view" }).click();
  await expect
    .poll(() => state.frames.some((frame) => frame.type === "share.request"))
    .toBe(true);
  await expect(
    page.getByText("Waiting for the learner to choose."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop sharing", exact: true }).click();
  await expect
    .poll(() => state.frames.some((frame) => frame.type === "share.stop"))
    .toBe(true);
  expect(state.pictureReads).toBe(0);
  await page.getByRole("button", { name: "View picture 1" }).click();
  await expect(
    page.getByRole("img", { name: "Screen picture selected by the learner" }),
  ).toBeVisible();
  expect(state.pictureReads).toBe(1);
  await page.getByRole("button", { name: "View picture 2" }).click();
  await expect(
    page.getByText("This picture is no longer available."),
  ).toBeVisible();
  state.pictureListFails = true;
  await page.clock.fastForward(60_001);
  await expect(page.getByRole("img")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View picture 1" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Ask what they see" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Please describe what you see on your screen. What words or buttons are shown?",
  );
  await page.getByRole("button", { name: "End help" }).click();
  await expect(page.getByRole("img")).toHaveCount(0);
  expect(state.closed).toEqual([null]);
});

test("FR-HELP-09/10/14 helper viewer is muted with a persistent keyboard stop", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class Peer extends EventTarget {
      connectionState = "new";
      iceConnectionState = "new";
      localDescription: RTCSessionDescriptionInit | null = null;
      remoteDescription: RTCSessionDescriptionInit | null = null;
      ontrack: ((event: Event) => void) | null = null;
      constructor() {
        super();
        Object.assign(window, { __helperPeer: this });
      }
      createAnswer() {
        return Promise.resolve({ type: "answer", sdp: "v=0" });
      }
      setLocalDescription(value: RTCSessionDescriptionInit) {
        this.localDescription = value;
        return Promise.resolve();
      }
      setRemoteDescription(value: RTCSessionDescriptionInit) {
        this.remoteDescription = value;
        return Promise.resolve();
      }
      addIceCandidate() {
        return Promise.resolve();
      }
      getSenders() {
        return [];
      }
      getReceivers() {
        return [];
      }
      getStats() {
        return Promise.resolve(new Map());
      }
      close() {
        this.connectionState = "closed";
      }
    }
    Object.defineProperty(window, "RTCPeerConnection", { value: Peer });
  });
  const state = await fixture(page);
  await page
    .locator('[data-request-id="older"]')
    .getByRole("button", { name: "Claim" })
    .click();
  await page.getByRole("button", { name: "Request screen view" }).click();
  state.sockets[0]!.send(JSON.stringify({ type: "share.accept" }));
  state.sockets[0]!.send(JSON.stringify({ type: "rtc.offer", sdp: "v=0" }));
  await expect
    .poll(() => state.frames.some((frame) => frame.type === "rtc.answer"))
    .toBe(true);
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
    const stream = canvas.captureStream(1);
    const event = Object.assign(new Event("track"), {
      streams: [stream],
      track: stream.getVideoTracks()[0],
    });
    const peer = (
      window as unknown as {
        __helperPeer: EventTarget & { ontrack?: (event: Event) => void };
      }
    ).__helperPeer;
    Object.assign(window, { __helperRemoteTrack: stream.getVideoTracks()[0] });
    peer.ontrack?.(event);
    peer.dispatchEvent(event);
  });
  const video = page.locator("dimts-helper-console video");
  await expect(video).toBeVisible();
  expect(
    await video.evaluate(
      (element: HTMLVideoElement) =>
        element.muted &&
        !element.controls &&
        (element.srcObject as MediaStream).getAudioTracks().length === 0,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const stop = page.getByRole("button", { name: "Stop sharing", exact: true });
  const box = await stop.boundingBox();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(720);
  await expect(stop).toHaveAttribute("aria-keyshortcuts", "Alt+Shift+S");
  const { AxeBuilder } = await import("@axe-core/playwright");
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  await page.keyboard.press("Alt+Shift+s");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __helperRemoteTrack: MediaStreamTrack })
              .__helperRemoteTrack.readyState,
        ),
      { timeout: 1000 },
    )
    .toBe("ended");
  await expect(video).toHaveCount(0);
});
