import { describe, expect, it } from "vitest";
import { simulatorAssetPath } from "../sms-page-plugin.js";

describe("FR-SMS-02 exact standalone simulator route", () => {
  it("serves the emitted page at the canonical preview URL and preserves query parameters", () => {
    expect(simulatorAssetPath("/sim/sms", false)).toBe("/sim/sms/index.html");
    expect(simulatorAssetPath("/sim/sms/?lang_preview=1", false)).toBe(
      "/sim/sms/index.html?lang_preview=1",
    );
    expect(simulatorAssetPath("/sim/sms?lang_preview=1&test=2", false)).toBe(
      "/sim/sms/index.html?lang_preview=1&test=2",
    );
  });
  it("serves the same built document and its standalone assets in development", () => {
    expect(simulatorAssetPath("/sim/sms?lang_preview=1", true)).toBe(
      "/dist/sim/sms/index.html?lang_preview=1",
    );
    expect(simulatorAssetPath("/dimts-sms-simulator.js", true)).toBe(
      "/dist/dimts-sms-simulator.js",
    );
    expect(
      simulatorAssetPath("/NotoSansEthiopic-ethiopic-400-normal.woff2", true),
    ).toBe("/dist/NotoSansEthiopic-ethiopic-400-normal.woff2");
    expect(
      simulatorAssetPath("/NotoSansEthiopic-ethiopic-700-normal.woff2", true),
    ).toBe("/dist/NotoSansEthiopic-ethiopic-700-normal.woff2");
  });
  it.each([
    undefined,
    "/",
    "/v1/sms/inbound",
    "/sim/sms-other",
    "/sim/sms/private",
    "/dimts-widget.js",
  ])("leaves unrelated paths unchanged: %s", (path) => {
    expect(simulatorAssetPath(path, false)).toBe(path);
    expect(simulatorAssetPath(path, true)).toBe(path);
  });
});
