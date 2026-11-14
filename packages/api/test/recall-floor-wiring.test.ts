// The recall floor applies only when a configured AI provider can actually
// serve this language under the learner's consent (privacy-first default).
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPacks } from "@dimts/locales-tools";
import { parseConfig } from "../src/config.js";
import { createEngineDependencies } from "../src/engine.js";
import { createApiProviderRuntime } from "../src/provider-runtime.js";

const packs = loadPacks(resolve("locales"));
const binding = (overrides: Record<string, unknown> = {}) => ({
  id: "cloud",
  adapter: "openai-compatible",
  model: "m",
  endpoint: "https://ai.example/v1",
  credentialRef: "CLOUD_KEY",
  privacyClass: "remote",
  enabled: true,
  priority: 1,
  timeoutMs: 1000,
  allowedDataClasses: ["question", "course-passage"],
  capabilities: {
    languages: ["en"],
    modes: ["extractive"],
    modalities: ["text"],
    structuredOutput: true,
  },
  ...overrides,
});

function deps(bindings: unknown[], extra: Record<string, string> = {}) {
  const env = {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
    DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
    DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
    DIMTS_JWT_SECRET: Buffer.alloc(32, 3).toString("base64"),
    DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
    DIMTS_AI_PROVIDERS: JSON.stringify(bindings),
    CLOUD_KEY: "secret-value",
    ...extra,
  };
  const config = parseConfig(env);
  const providerRuntime = createApiProviderRuntime(config, packs, env);
  return createEngineDependencies({
    config,
    packs,
    providerRuntime,
    grounding: {
      search: async () => [],
      currentVersion: async () => "v",
    },
  });
}

describe("recall floor wiring", () => {
  it("is unavailable with only the offline provider", () => {
    expect(deps([]).recallFloor?.("en", { cloudOk: true })).toBeUndefined();
  });

  it("requires learner consent for a remote provider", () => {
    const d = deps([binding()]);
    expect(d.recallFloor?.("en", { cloudOk: false })).toBeUndefined();
    expect(d.recallFloor?.("en", { cloudOk: true })).toBe(0.2);
  });

  it("requires the provider to declare the question language", () => {
    expect(
      deps([binding()]).recallFloor?.("am", { cloudOk: true }),
    ).toBeUndefined();
  });

  it("ignores disabled providers and honours DIMTS_AI_RECALL_FLOOR", () => {
    expect(
      deps([binding({ enabled: false })]).recallFloor?.("en", {
        cloudOk: true,
      }),
    ).toBeUndefined();
    expect(
      deps([binding()], { DIMTS_AI_RECALL_FLOOR: "0.4" }).recallFloor?.("en", {
        cloudOk: true,
      }),
    ).toBe(0.4);
  });

  it("allows a local provider without remote consent", () => {
    expect(
      deps([
        binding({
          privacyClass: "local",
          endpoint: "http://127.0.0.1:11434/v1",
          credentialRef: undefined,
        }),
      ]).recallFloor?.("en", { cloudOk: false }),
    ).toBe(0.2);
  });
});
