// FR-VOICE-09: on-device recognition only. A missing on-device pack may be
// installed only by an explicit learner action, never automatically.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserVoiceAdapters } from "../src/browser.js";

const english = {
  code: "en",
  stt: true,
  tts: false,
  voice: { engine: "browser" as const, bcp_tag: "en-US" },
};

function stubRecognition(state: { status: string; installResult?: boolean }) {
  const install = vi.fn(async () => {
    if (state.installResult) state.status = "available";
    return state.installResult ?? false;
  });
  class FakeRecognition {
    processLocally = false;
    static available = vi.fn(async () => state.status);
    static install = install;
  }
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  return { install, available: FakeRecognition.available };
}

afterEach(() => vi.unstubAllGlobals());

describe("on-device speech pack installation", () => {
  it("never downloads automatically and reports the pack as installable", async () => {
    const { install } = stubRecognition({ status: "downloadable" });
    const adapters = await createBrowserVoiceAdapters({ languages: [english] });
    expect(adapters.speechToText.supported("en")).toBe(false);
    expect(adapters.speechToText.installable?.("en")).toBe(true);
    expect(install).not.toHaveBeenCalled();
  });

  it("installs on request and then supports local recognition", async () => {
    const { install } = stubRecognition({
      status: "downloadable",
      installResult: true,
    });
    const onCapabilitiesChanged = vi.fn();
    const adapters = await createBrowserVoiceAdapters({
      languages: [english],
      onCapabilitiesChanged,
    });
    expect(await adapters.speechToText.install?.("en")).toBe(true);
    expect(install).toHaveBeenCalledWith({
      langs: ["en-US"],
      processLocally: true,
    });
    expect(adapters.speechToText.supported("en")).toBe(true);
    expect(adapters.speechToText.installable?.("en")).toBe(false);
    expect(onCapabilitiesChanged).toHaveBeenCalled();
  });

  it("stays unavailable when installation fails or the pack is unsupported", async () => {
    stubRecognition({ status: "downloadable", installResult: false });
    const failed = await createBrowserVoiceAdapters({ languages: [english] });
    expect(await failed.speechToText.install?.("en")).toBe(false);
    expect(failed.speechToText.supported("en")).toBe(false);

    stubRecognition({ status: "unavailable" });
    const unsupported = await createBrowserVoiceAdapters({
      languages: [english],
    });
    expect(unsupported.speechToText.installable?.("en")).toBe(false);
  });
});
