import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../src/registry.js";
import type { ProviderBinding } from "../src/registry.js";
import { OpenAiCompatible } from "../src/openai-compatible.js";

describe("provider registry", () => {
  it("creates arbitrary provider IDs through a registered adapter", () => {
    const registry = new ProviderRegistry().register(
      "openai-compatible",
      (binding) =>
        new OpenAiCompatible({
          name: binding.id,
          baseUrl: binding.endpoint ?? "",
          model: binding.model,
          capabilities: binding.capabilities,
          privacyClass: binding.privacyClass,
          allowedDataClasses: binding.allowedDataClasses,
          evaluatedLanguages: binding.evaluatedLanguages,
          ...(binding.apiKey ? { apiKey: binding.apiKey } : {}),
        }),
    );

    const providers = registry.create([
      {
        id: "gemini-production",
        adapter: "openai-compatible",
        endpoint: "https://provider.example/v1",
        model: "model-name",
        privacyClass: "remote",
        enabled: true,
        priority: 10,
        timeoutMs: 8_000,
        allowedDataClasses: ["question", "course-passage"],
        evaluatedLanguages: [],
        capabilities: {
          languages: ["*"],
          modes: ["extractive", "generative"],
          modalities: ["text"],
          structuredOutput: true,
        },
      },
    ]);

    expect(providers.map(({ name }) => name)).toEqual(["gemini-production"]);
  });

  it("rejects duplicate IDs and unregistered adapter types", () => {
    const registry = new ProviderRegistry();
    const binding: ProviderBinding = {
      id: "custom",
      adapter: "future-adapter",
      endpoint: "https://provider.example",
      model: "model-name",
      privacyClass: "remote",
      enabled: true,
      priority: 10,
      timeoutMs: 8_000,
      allowedDataClasses: ["question", "course-passage"],
      capabilities: {
        languages: ["*"],
        modes: ["extractive"],
        modalities: ["text"],
        structuredOutput: false,
      },
    };

    expect(() => registry.create([binding, binding])).toThrow(/duplicate/iu);
    expect(() => registry.create([binding])).toThrow(/not registered/u);
  });
});
