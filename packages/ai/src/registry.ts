import type {
  AiProvider,
  ProviderDataClass,
  ProviderCapabilities,
  ProviderName,
  ProviderPrivacyClass,
} from "./provider.js";

export interface ProviderBinding {
  id: ProviderName;
  adapter: string;
  endpoint?: string | undefined;
  model: string;
  credentialRef?: string | undefined;
  privacyClass: ProviderPrivacyClass;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  allowedDataClasses: ProviderDataClass[];
  evaluatedLanguages?: string[] | undefined;
  capabilities: ProviderCapabilities;
}

export interface ResolvedProviderBinding extends ProviderBinding {
  apiKey?: string;
}

export type ProviderAdapterFactory = (
  binding: ResolvedProviderBinding,
) => AiProvider;

function intersection<T extends string>(declared: T[], actual: T[]): T[] {
  if (declared.includes("*" as T)) return [...actual];
  if (actual.includes("*" as T)) return [...declared];
  return declared.filter((value) => actual.includes(value));
}

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderAdapterFactory>();

  register(adapter: string, factory: ProviderAdapterFactory): ProviderRegistry {
    if (!adapter.trim()) throw new Error("Provider adapter ID is required.");
    if (this.factories.has(adapter)) {
      throw new Error(`Provider adapter "${adapter}" is already registered.`);
    }
    this.factories.set(adapter, factory);
    return this;
  }

  create(bindings: ResolvedProviderBinding[]): AiProvider[] {
    const ids = new Set<string>();
    for (const binding of bindings) {
      if (!binding.id.trim() || ids.has(binding.id)) {
        throw new Error(`Duplicate or empty provider ID "${binding.id}".`);
      }
      ids.add(binding.id);
    }

    for (const binding of bindings) {
      if (!this.factories.has(binding.adapter)) {
        throw new Error(
          `Provider adapter "${binding.adapter}" is not registered.`,
        );
      }
    }

    return bindings
      .filter(({ enabled }) => enabled)
      .sort((left, right) => left.priority - right.priority)
      .map((binding) => {
        const factory = this.factories.get(binding.adapter);
        if (!factory) {
          throw new Error(
            `Provider adapter "${binding.adapter}" is not registered.`,
          );
        }
        const provider = factory(binding);
        if (provider.name !== binding.id) {
          throw new Error(
            `Provider adapter "${binding.adapter}" returned a mismatched ID.`,
          );
        }
        if (provider.privacyClass !== binding.privacyClass) {
          throw new Error(
            "Provider adapter returned a mismatched privacy classification.",
          );
        }
        const actual = provider.capabilities();
        const capabilities: ProviderCapabilities = {
          languages: intersection(
            binding.capabilities.languages,
            actual.languages,
          ),
          modes: intersection(binding.capabilities.modes, actual.modes),
          modalities: intersection(
            binding.capabilities.modalities,
            actual.modalities,
          ),
          structuredOutput:
            binding.capabilities.structuredOutput && actual.structuredOutput,
        };
        return {
          name: provider.name,
          privacyClass: binding.privacyClass,
          allowedDataClasses: intersection(
            binding.allowedDataClasses,
            provider.allowedDataClasses,
          ),
          evaluatedLanguages: intersection(
            binding.evaluatedLanguages ?? [],
            provider.evaluatedLanguages,
          ),
          capabilities: () => ({
            ...capabilities,
            languages: [...capabilities.languages],
            modes: [...capabilities.modes],
            modalities: [...capabilities.modalities],
          }),
          health: (signal?: AbortSignal) => provider.health(signal),
          answer: provider.answer.bind(provider),
        };
      });
  }
}
