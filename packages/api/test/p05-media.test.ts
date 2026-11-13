import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { validateHelpImage } from "../src/help-image.js";
import { createHelpIceProvider } from "../src/help-ice.js";
import { parseConfig } from "../src/config.js";

const environment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://localhost/dimts",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "secret-that-is-longer-than-thirty-two",
  DIMTS_CRON_SECRET: "cron-secret-that-is-longer-than-twenty-four",
  DIMTS_TURN_APP: "example",
  DIMTS_TURN_API_KEY: "private-metered-secret",
};
const config = parseConfig(environment);
describe("P05 media validation and server credentials", () => {
  it("accepts Compose's empty TURN settings as STUN-only defaults", () => {
    const disabled = parseConfig({
      ...environment,
      DIMTS_TURN_APP: "",
      DIMTS_TURN_API_KEY: "",
    });
    expect(disabled.DIMTS_TURN_APP).toBeUndefined();
  });
  it.each(["jpeg", "png", "webp"] as const)(
    "fully decodes %s and strips metadata",
    async (format) => {
      const source = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "red" },
      })
        .withMetadata({ exif: { IFD0: { Artist: "private name" } } })
        .toFormat(format)
        .toBuffer();
      const normalized = await validateHelpImage(source, `image/${format}`);
      expect(normalized).not.toBeNull();
      expect((await sharp(normalized!).metadata()).exif).toBeUndefined();
      expect(
        await validateHelpImage(
          source.subarray(0, source.length / 2),
          `image/${format}`,
        ),
      ).toBeNull();
    },
  );
  it("never accepts SVG or decompression bombs", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="6000"/>',
    );
    expect(await validateHelpImage(svg, "image/png")).toBeNull();
    const big = await sharp({
      create: { width: 4100, height: 4100, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    expect(await validateHelpImage(big, "image/png")).toBeNull();
  });
  it("requests expiring Metered credentials on the server, coalesces calls and never exposes secret", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            username: "temporary-user",
            password: "temporary-password",
            apiKey: "temporary-key",
          }),
        ),
    );
    let instant = new Date("2026-11-13T10:00:00.000Z");
    const ice = createHelpIceProvider(
      config,
      fetcher as typeof fetch,
      () => instant,
    );
    const [first, second] = await Promise.all([ice(), ice()]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(url.hostname).toBe("example.metered.live");
    expect(url.pathname).toBe("/api/v1/turn/credential");
    expect(JSON.parse(String(init.body))).toEqual({ expiryInSeconds: 3600 });
    expect(first.expiresAt).toBe("2026-11-13T11:00:00.000Z");
    expect(JSON.stringify(first)).not.toContain(config.DIMTS_TURN_API_KEY);
    expect(JSON.stringify(first)).not.toContain("temporary-key");
    instant = new Date("2026-11-13T11:01:00.000Z");
    await ice();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("degrades safely to STUN for malformed, rejected or failed provider responses", async () => {
    for (const fetcher of [
      async () => new Response("{}"),
      async () => new Response("secret", { status: 503 }),
      async () => {
        throw new Error("private-metered-secret");
      },
    ]) {
      expect(
        await createHelpIceProvider(config, fetcher as typeof fetch)(),
      ).toEqual({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    }
  });
});
