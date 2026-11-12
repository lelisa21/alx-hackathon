import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const secrets = [
  Buffer.alloc(32, 4).toString("base64"),
  Buffer.alloc(32, 5).toString("base64"),
  Buffer.alloc(32, 6).toString("base64"),
];

const baseEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: secrets[0],
  DIMTS_HASH_KEY: secrets[1],
  DIMTS_JWT_SECRET: secrets[2],
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
};

const remoteProvider = {
  id: "groq-fast",
  adapter: "openai-compatible",
  model: "model-name",
  endpoint: "https://provider.example/v1",
  credentialRef: "TEST_LLM_CREDENTIAL",
  privacyClass: "remote",
  enabled: true,
  priority: 10,
  timeoutMs: 8_000,
  allowedDataClasses: ["question", "course-passage"],
  capabilities: {
    languages: ["en"],
    modes: ["extractive", "generative"],
    modalities: ["text"],
    structuredOutput: true,
  },
};

describe("provider runtime configuration", () => {
  it("parses arbitrary provider bindings without retaining credential values", () => {
    const config = parseConfig({
      ...baseEnvironment,
      DIMTS_AI_PROVIDER: "groq-fast",
      DIMTS_AI_LADDER: "groq-fast,offline",
      DIMTS_AI_PROVIDERS: JSON.stringify([remoteProvider]),
      DIMTS_AI_MAX_TOKENS: "256",
      DIMTS_AI_TEMPERATURE: "0.15",
      TEST_LLM_CREDENTIAL: "credential-value-not-for-config",
    });

    expect(config.DIMTS_AI_PROVIDER).toBe("groq-fast");
    expect(config.DIMTS_AI_PROVIDERS).toEqual([
      { ...remoteProvider, evaluatedLanguages: [] },
    ]);
    expect(config.DIMTS_AI_MAX_TOKENS).toBe(256);
    expect(config.DIMTS_AI_TEMPERATURE).toBe(0.15);
    expect(JSON.stringify(config)).not.toContain(
      "credential-value-not-for-config",
    );
  });

  it("defaults to offline answers and bounded deterministic generation settings", () => {
    const config = parseConfig(baseEnvironment);

    expect(config.DIMTS_AI_PROVIDER).toBe("offline");
    expect(config.DIMTS_AI_PROVIDERS).toEqual([]);
    expect(config.DIMTS_AI_MAX_TOKENS).toBe(400);
    expect(config.DIMTS_AI_TEMPERATURE).toBe(0.1);
  });

  it("rejects malformed bindings, unresolved credentials, and unsafe limits", () => {
    expect(() =>
      parseConfig({
        ...baseEnvironment,
        DIMTS_AI_PROVIDERS: "{not-json",
      }),
    ).toThrow(/DIMTS_AI_PROVIDERS/u);

    expect(() =>
      parseConfig({
        ...baseEnvironment,
        DIMTS_AI_PROVIDERS: JSON.stringify([remoteProvider]),
      }),
    ).toThrow(/TEST_LLM_CREDENTIAL/u);

    expect(() =>
      parseConfig({
        ...baseEnvironment,
        DIMTS_AI_PROVIDERS: JSON.stringify([
          { ...remoteProvider, privacyClass: "unspecified" },
        ]),
        TEST_LLM_CREDENTIAL: "credential-value",
      }),
    ).toThrow(/privacyClass/u);

    expect(() =>
      parseConfig({
        ...baseEnvironment,
        DIMTS_AI_MAX_TOKENS: "0",
      }),
    ).toThrow(/DIMTS_AI_MAX_TOKENS/u);

    expect(() =>
      parseConfig({
        ...baseEnvironment,
        DIMTS_AI_TEMPERATURE: "2.5",
      }),
    ).toThrow(/DIMTS_AI_TEMPERATURE/u);
  });
});
