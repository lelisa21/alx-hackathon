import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { createApiProviderRuntime } from "../src/provider-runtime.js";
import { loadPacks } from "@dimts/locales-tools";
import { resolve } from "node:path";

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
  it.each(["openai", "gemini", "xai"])(
    "registers the native %s adapter without transmitting before consent",
    async (adapter) => {
      const binding = { ...remoteProvider, endpoint: undefined };
      const config = parseConfig({
        ...baseEnvironment,
        DIMTS_AI_PROVIDER: adapter,
        DIMTS_AI_LADDER: `${adapter},offline`,
        DIMTS_AI_PROVIDERS: JSON.stringify([
          { ...binding, id: adapter, adapter },
        ]),
        TEST_LLM_CREDENTIAL: "test-only-native-key",
      });
      const runtime = createApiProviderRuntime(
        config,
        loadPacks(resolve("locales")),
        { TEST_LLM_CREDENTIAL: "test-only-native-key" },
      );
      const response = {
        text: "Choose one learning goal.",
        usedPassageIds: ["goals"],
      };
      const network = vi.fn<typeof fetch>(
        async (_url, init) =>
          new Response(
            JSON.stringify(
              init?.method !== "POST"
                ? {}
                : adapter === "gemini"
                  ? {
                      candidates: [
                        {
                          finishReason: "STOP",
                          content: {
                            role: "model",
                            parts: [{ text: JSON.stringify(response) }],
                          },
                        },
                      ],
                    }
                  : {
                      status: "completed",
                      output: [
                        {
                          type: "message",
                          role: "assistant",
                          content: [
                            {
                              type: "output_text",
                              text: JSON.stringify(response),
                            },
                          ],
                        },
                      ],
                    },
            ),
            { status: 200 },
          ),
      );
      vi.stubGlobal("fetch", network);
      const answerRequest = {
        question: "How do I choose a learning goal?",
        lang: "en",
        simple: false,
        mode: "extractive" as const,
        systemPrompt: "Use the supplied passages.",
        glossary: [],
        passages: [
          {
            id: "goals",
            text: "Choose one learning goal.",
            label: "Goals",
            url: "https://course.example/goals",
            lang: "en",
            sourceType: "course" as const,
          },
        ],
      };
      try {
        expect(
          (await runtime.answer(answerRequest, { cloudOk: false })).provider,
        ).toBe("offline");
        expect(network).not.toHaveBeenCalled();
        expect(
          (await runtime.answer(answerRequest, { cloudOk: true })).provider,
        ).toBe(adapter);
        expect(network).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(runtime)).not.toContain("test-only-native-key");
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("uses configured priorities for remaining enabled fallback bindings", () => {
    const config = parseConfig({
      ...baseEnvironment,
      DIMTS_AI_PROVIDER: "selected",
      DIMTS_AI_LADDER: "selected",
      DIMTS_AI_PROVIDERS: JSON.stringify([
        { ...remoteProvider, id: "later", priority: 30 },
        { ...remoteProvider, id: "selected", priority: 10 },
        { ...remoteProvider, id: "earlier", priority: 20 },
      ]),
      TEST_LLM_CREDENTIAL: "test-only-key",
    });
    const runtime = createApiProviderRuntime(
      config,
      loadPacks(resolve("locales")),
      { TEST_LLM_CREDENTIAL: "test-only-key" },
    );
    expect(runtime.providerOrder).toEqual([
      "selected",
      "earlier",
      "later",
      "offline",
    ]);
  });

  it("preserves an explicitly configured offline step before any later remote provider", () => {
    const config = parseConfig({
      ...baseEnvironment,
      DIMTS_AI_PROVIDER: "selected",
      DIMTS_AI_LADDER: "selected,offline,remote",
      DIMTS_AI_PROVIDERS: JSON.stringify([
        { ...remoteProvider, id: "selected" },
        { ...remoteProvider, id: "remote" },
      ]),
      TEST_LLM_CREDENTIAL: "test-only-key",
    });
    expect(
      createApiProviderRuntime(config, loadPacks(resolve("locales")), {
        TEST_LLM_CREDENTIAL: "test-only-key",
      }).providerOrder,
    ).toEqual(["selected", "offline", "remote"]);
  });

  it.each(["openai", "gemini", "xai"])(
    "requires native %s bindings to declare remote privacy and credentials",
    (adapter) => {
      expect(() =>
        parseConfig({
          ...baseEnvironment,
          DIMTS_AI_PROVIDERS: JSON.stringify([
            { ...remoteProvider, adapter, privacyClass: "local" },
          ]),
          TEST_LLM_CREDENTIAL: "test-only-key",
        }),
      ).toThrow(/privacyClass/u);
      const binding = { ...remoteProvider, credentialRef: undefined };
      expect(() =>
        parseConfig({
          ...baseEnvironment,
          DIMTS_AI_PROVIDERS: JSON.stringify([{ ...binding, adapter }]),
        }),
      ).toThrow(/credentialRef/u);
    },
  );
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
