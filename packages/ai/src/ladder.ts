import { z } from "zod";
import type {
  AiProvider,
  AnswerRequest,
  AnswerResult,
  ProviderName,
} from "./provider.js";
import { modeFor } from "./mode.js";

const answerResultSchema = z.object({
  text: z.string().trim().min(1),
  usedPassageIds: z.array(z.string()).min(1),
  provider: z.enum(["cloud", "local", "offline"]),
  latencyMs: z.number().finite().nonnegative(),
});

export interface LadderProviderStatus {
  name: ProviderName;
  available: boolean;
  active: boolean;
}

export interface LadderStatus {
  activeProvider: ProviderName | null;
  providers: LadderProviderStatus[];
}

export class Ladder {
  private readonly unavailableUntil = new Map<ProviderName, number>();
  private activeProvider: ProviderName | null = null;
  private readonly timeouts: Record<ProviderName, number>;
  private readonly now: () => number;
  private readonly providers: AiProvider[];
  private readonly isProven: (provider: ProviderName, lang: string) => boolean;

  constructor(
    providers: AiProvider[],
    timeouts: Partial<Record<ProviderName, number>> = {},
    now: () => number = Date.now,
    isProven: (
      provider: ProviderName,
      lang: string,
    ) => boolean = () => false,
  ) {
    this.providers = providers;
    this.isProven = isProven;
    this.now = now;
    this.timeouts = {
      cloud: 8_000,
      local: 20_000,
      offline: 8_000,
      ...timeouts,
    };
  }

  async answer(request: AnswerRequest): Promise<AnswerResult> {
    for (const provider of this.providers) {
      if ((this.unavailableUntil.get(provider.name) ?? 0) > this.now()) {
        continue;
      }

      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const answer = await Promise.race([
          this.requestFrom(provider, request, controller.signal),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new Error("AI provider timed out"));
            }, this.timeouts[provider.name]);
          }),
        ]);
        const parsed = answerResultSchema.safeParse(answer);
        const allowedIds = new Set(request.passages.map(({ id }) => id));
        if (
          !parsed.success ||
          parsed.data.provider !== provider.name ||
          parsed.data.usedPassageIds.some((id) => !allowedIds.has(id))
        ) {
          throw new Error("AI provider returned an invalid answer");
        }
        this.activeProvider = provider.name;
        return parsed.data;
      } catch {
        this.unavailableUntil.set(provider.name, this.now() + 60_000);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    throw new Error("No AI provider answered the request");
  }

  status(): LadderStatus {
    const availableProviders = this.providers.filter(
      (provider) =>
        (this.unavailableUntil.get(provider.name) ?? 0) <= this.now(),
    );
    const activeProvider =
      this.activeProvider ??
      availableProviders[0]?.name ??
      this.providers[0]?.name ??
      null;
    return {
      activeProvider,
      providers: this.providers.map((provider) => ({
        name: provider.name,
        available:
          (this.unavailableUntil.get(provider.name) ?? 0) <= this.now(),
        active: provider.name === activeProvider,
      })),
    };
  }

  private async requestFrom(
    provider: AiProvider,
    request: AnswerRequest,
    signal: AbortSignal,
  ): Promise<AnswerResult> {
    const health = await provider.health();
    if (!health.ok) {
      throw new Error("AI provider is unhealthy");
    }
    const mode = modeFor(provider.name, request.lang, this.isProven);
    return provider.answer(
      { ...request, mode: mode === "extractive" ? "extractive" : request.mode },
      signal,
    );
  }
}
