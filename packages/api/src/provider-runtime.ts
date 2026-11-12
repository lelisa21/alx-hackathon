import {
  Ladder,
  OfflineProvider,
  OpenAiCompatible,
  ProviderRegistry,
} from "@dimts/ai";
import type { AnswerRequest, AnswerResult } from "@dimts/engine";
import type { LangPack } from "@dimts/locales-tools";
import type {
  OfflineFaq,
  ProviderBinding,
  ResolvedProviderBinding,
} from "@dimts/ai";
import type { ApiConfig } from "./config.js";

export interface ApiProviderRuntime {
  readonly providerOrder: string[];
  readonly activeProvider: string;
  answer(
    request: AnswerRequest,
    policy: { cloudOk: boolean },
  ): Promise<AnswerResult>;
}

function offlineFaqs(
  packs: Map<string, LangPack>,
): Record<string, OfflineFaq[]> {
  return Object.fromEntries(
    [...packs.entries()].map(([lang, pack]) => {
      const entries = Array.isArray(pack.faq) ? pack.faq : [];
      const faqs = entries.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry))
          return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.q !== "string" || typeof record.a !== "string")
          return [];
        return [
          {
            q: record.q,
            a: record.a,
            ...(typeof record.source === "string"
              ? { source: record.source }
              : {}),
          },
        ];
      });
      return [lang, faqs];
    }),
  );
}

function resolveBindings(
  bindings: ProviderBinding[],
  environment: Record<string, string | undefined>,
): ResolvedProviderBinding[] {
  return bindings.map((binding) => {
    if (!binding.credentialRef) return binding;
    const apiKey = environment[binding.credentialRef]?.trim();
    if (!binding.enabled || !apiKey) {
      if (!binding.enabled) return binding;
      throw new Error(
        `Provider credential reference ${binding.credentialRef} is unavailable.`,
      );
    }
    return { ...binding, apiKey };
  });
}

export function createApiProviderRuntime(
  config: ApiConfig,
  packs: Map<string, LangPack>,
  environment: Record<string, string | undefined> = process.env,
): ApiProviderRuntime {
  const registry = new ProviderRegistry()
    .register("openai-compatible", (binding) => {
      if (!binding.endpoint) {
        throw new Error(
          `Provider ${binding.id} requires an endpoint for openai-compatible.`,
        );
      }
      return new OpenAiCompatible({
        name: binding.id,
        baseUrl: binding.endpoint,
        model: binding.model,
        capabilities: binding.capabilities,
        privacyClass: binding.privacyClass,
        allowedDataClasses: binding.allowedDataClasses,
        maxTokens: config.DIMTS_AI_MAX_TOKENS,
        temperature: config.DIMTS_AI_TEMPERATURE,
        ...(binding.evaluatedLanguages
          ? { evaluatedLanguages: binding.evaluatedLanguages }
          : {}),
        ...(binding.apiKey ? { apiKey: binding.apiKey } : {}),
      });
    })
    .register(
      "offline",
      (binding) =>
        new OfflineProvider({
          name: binding.id,
          languages: binding.capabilities.languages,
          faqs: offlineFaqs(packs),
        }),
    );

  const offlineBinding: ProviderBinding = {
    id: "offline",
    adapter: "offline",
    model: "extractive",
    privacyClass: "local",
    enabled: true,
    priority: Number.MAX_SAFE_INTEGER,
    timeoutMs: 20_000,
    allowedDataClasses: ["question", "course-passage", "glossary"],
    evaluatedLanguages: [],
    capabilities: {
      languages: ["*"],
      modes: ["extractive"],
      modalities: ["text"],
      structuredOutput: true,
    },
  };
  const configuredBindings = resolveBindings(
    config.DIMTS_AI_PROVIDERS,
    environment,
  );
  const providerMap = new Map(
    registry
      .create([...configuredBindings, offlineBinding])
      .map((provider) => [provider.name, provider]),
  );
  const orderedIds = [
    config.DIMTS_AI_PROVIDER,
    ...config.DIMTS_AI_LADDER.split(",").map((id) => id.trim()),
  ].filter(
    (id, index, values) => id.length > 0 && values.indexOf(id) === index,
  );
  const providers = orderedIds.flatMap((id) => {
    const provider = providerMap.get(id);
    return provider ? [provider] : [];
  });
  if (!providers.some(({ name }) => name === "offline")) {
    const offline = providerMap.get("offline");
    if (!offline) throw new Error("Offline provider registration is missing.");
    providers.push(offline);
  }
  const providerOrder = providers.map(({ name }) => name);
  const timeouts = Object.fromEntries(
    configuredBindings.map(({ id, timeoutMs }) => [id, timeoutMs]),
  );
  const ladder = new Ladder(providers, timeouts);

  return {
    providerOrder,
    get activeProvider() {
      return ladder.activeProvider;
    },
    async answer(request, policy) {
      const result = await ladder.answer(request, policy);
      return {
        text: result.text,
        usedPassageIds: result.usedPassageIds,
        provider: result.providerId,
        latencyMs: result.latencyMs,
      };
    },
  };
}
