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
        return provider;
      });
  }
}
