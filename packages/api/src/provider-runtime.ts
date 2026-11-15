import {
  Ladder,
  OfflineProvider,
  OpenAiCompatible,
  OpenAiProvider,
  OpenRouterProvider,
  GeminiProvider,
  XaiProvider,
  ProviderRegistry,
} from "@dimts/ai";
import type { AnswerRequest, AnswerResult } from "@dimts/engine";
import type { LangPack } from "@dimts/locales-tools";
import type {
  OfflineFaq,
  ProviderBinding,
  ProviderFailureEvent,
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
  /** True when a configured, enabled AI provider can serve this request. */
  canJudge?(lang: string, policy: { cloudOk: boolean }): boolean;
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

/**
 * True for values copied from an example file instead of a real key, such as
 * "REPLACE_WITH_YOUR_KEY", "your-api-key" or "sk-...". A real key never
 * contains these markers, so the check cannot reject a working credential.
 */
export function isPlaceholderCredential(value: string): boolean {
  // Local model servers may use short tokens such as "ollama", so length is
  // not a signal; only explicit template markers are.
  return /replace[-_ ]?(?:with|me)|your[-_ ]?(?:api[-_ ]?)?key|change[-_ ]?me|placeholder|xxxx|\.\.\.|<[^>]*>/iu.test(
    value.trim(),
  );
}

function resolveBindings(
  bindings: ProviderBinding[],
  environment: Record<string, string | undefined>,
  onWarning?: (event: { provider: string; reason: string }) => void,
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
    // A placeholder key fails every request (Gemini answers 400). Disable the
    // provider and say so once, so the rest of the ladder serves learners.
    if (isPlaceholderCredential(apiKey)) {
      onWarning?.({
        provider: binding.id,
        reason: `placeholder_credential:${binding.credentialRef}`,
      });
      return { ...binding, enabled: false };
    }
    return { ...binding, apiKey };
  });
}

export function createApiProviderRuntime(
  config: ApiConfig,
  packs: Map<string, LangPack>,
  environment: Record<string, string | undefined> = process.env,
  resolveSource?: (
    source: string,
    passageIds: string[],
  ) => Promise<string | null>,
  hooks: {
    /** Content-free failure of one provider attempt. */
    onProviderFailure?: (event: ProviderFailureEvent) => void;
    /** Configuration problem that disabled a provider at start. */
    onWarning?: (event: { provider: string; reason: string }) => void;
  } = {},
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
      "openrouter",
      (binding) =>
        new OpenRouterProvider({
          name: binding.id,
          model: binding.model,
          capabilities: binding.capabilities,
          allowedDataClasses: binding.allowedDataClasses,
          maxTokens: config.DIMTS_AI_MAX_TOKENS,
          temperature: config.DIMTS_AI_TEMPERATURE,
          ...(binding.endpoint ? { baseUrl: binding.endpoint } : {}),
          ...(binding.apiKey ? { apiKey: binding.apiKey } : {}),
          ...(binding.fallbackModels
            ? { fallbackModels: binding.fallbackModels }
            : {}),
          ...(config.DIMTS_PUBLIC_API_URL
            ? { referer: config.DIMTS_PUBLIC_API_URL }
            : {}),
          ...(binding.evaluatedLanguages
            ? { evaluatedLanguages: binding.evaluatedLanguages }
            : {}),
        }),
    )
    .register(
      "offline",
      (binding) =>
        new OfflineProvider({
          name: binding.id,
          languages: binding.capabilities.languages,
          faqs: offlineFaqs(packs),
          ...(resolveSource ? { resolveSource } : {}),
        }),
    );

  for (const [adapter, Provider] of [
    ["openai", OpenAiProvider],
    ["gemini", GeminiProvider],
    ["xai", XaiProvider],
  ] as const) {
    registry.register(
      adapter,
      (binding) =>
        new Provider({
          name: binding.id,
          model: binding.model,
          capabilities: binding.capabilities,
          privacyClass: binding.privacyClass,
          allowedDataClasses: binding.allowedDataClasses,
          maxTokens: config.DIMTS_AI_MAX_TOKENS,
          temperature: config.DIMTS_AI_TEMPERATURE,
          ...(binding.endpoint ? { baseUrl: binding.endpoint } : {}),
          ...(binding.apiKey ? { apiKey: binding.apiKey } : {}),
          ...(binding.evaluatedLanguages
            ? { evaluatedLanguages: binding.evaluatedLanguages }
            : {}),
        }),
    );
  }

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
    hooks.onWarning,
  );
  const providerMap = new Map(
    registry
      .create([...configuredBindings, offlineBinding])
      .map((provider) => [provider.name, provider]),
  );
  const orderedIds = [
    config.DIMTS_AI_PROVIDER,
    ...config.DIMTS_AI_LADDER.split(",").map((id) => id.trim()),
    ...providerMap.keys(),
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
  const ladder = new Ladder(
    providers,
    timeouts,
    undefined,
    hooks.onProviderFailure,
  );

  const judges = configuredBindings.filter(
    ({ enabled, capabilities }) =>
      enabled &&
      capabilities.structuredOutput &&
      capabilities.modalities.includes("text"),
  );
  return {
    providerOrder,
    canJudge(lang, policy) {
      return judges.some(
        ({ privacyClass, capabilities }) =>
          (privacyClass === "local" || policy.cloudOk) &&
          (capabilities.languages.includes("*") ||
            capabilities.languages.includes(lang)),
      );
    },
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
