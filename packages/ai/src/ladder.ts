import type { AnswerRequest } from "@dimts/engine";
import { InvalidProviderResponseError, permittedPassages } from "./provider.js";
import type { AiProvider, AnswerResult } from "./provider.js";

const COOLDOWN_MS = 60_000;
// A healthy probe is reused so each learner question costs one remote call.
const HEALTHY_FOR_MS = 60_000;

export interface AnswerPolicy {
  cloudOk: boolean;
}

export class Ladder {
  private readonly coolUntil = new Map<string, number>();
  private readonly healthyUntil = new Map<string, number>();
  private readonly providers: AiProvider[];
  private readonly timeouts: Record<string, number>;
  private readonly now: () => number;
  private activeProviderId = "offline";

  constructor(
    providers: AiProvider[],
    timeouts: Record<string, number>,
    now: () => number = () => Date.now(),
  ) {
    this.providers = providers;
    this.timeouts = timeouts;
    this.now = now;
  }

  get activeProvider(): string {
    return this.activeProviderId;
  }

  async answer(
    request: AnswerRequest,
    policy: AnswerPolicy = { cloudOk: false },
  ): Promise<AnswerResult> {
    this.activeProviderId = "offline";
    for (const provider of this.providers) {
      if ((this.coolUntil.get(provider.name) ?? 0) > this.now()) continue;
      if (provider.privacyClass === "remote" && !policy.cloudOk) continue;

      const effectiveRequest = this.applyEvaluationGate(provider, request);
      if (!this.supportsRequest(provider, effectiveRequest)) continue;
      const providerRequest = this.filterDataClasses(
        provider,
        effectiveRequest,
      );
      if (
        !providerRequest.question.trim() ||
        providerRequest.passages.length === 0
      )
        continue;

      const timeoutMs =
        this.timeouts[provider.name] ??
        (provider.privacyClass === "local" ? 20_000 : 8_000);
      const deadline = Date.now() + timeoutMs;
      const controller = new AbortController();
      const remaining = () => Math.max(0, deadline - Date.now());
      try {
        if ((this.healthyUntil.get(provider.name) ?? 0) <= this.now()) {
          const health = await this.withTimeout(
            provider.health(controller.signal),
            remaining(),
            () => controller.abort(),
          );
          if (!health.ok) throw new Error("Provider health check failed.");
          this.healthyUntil.set(provider.name, this.now() + HEALTHY_FOR_MS);
        }

        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            if (remaining() === 0)
              throw new Error("Provider request timed out.");
            const result = await this.withTimeout(
              provider.answer(providerRequest, controller.signal),
              remaining(),
              () => controller.abort(),
            );
            const passageIds = new Set(
              providerRequest.passages.map(({ id }) => id),
            );
            // A well-formed decline is a judgement, not a failure: no cooldown
            // and no fallback (another provider sees the same passages). The
            // engine turns it into a not-found reply.
            if (
              typeof result?.text === "string" &&
              Array.isArray(result.usedPassageIds) &&
              result.usedPassageIds.length === 0
            ) {
              this.activeProviderId = provider.name;
              return { ...result, providerId: provider.name };
            }
            if (
              typeof result?.text === "string" &&
              result.text.trim() &&
              Array.isArray(result.usedPassageIds) &&
              result.usedPassageIds.length > 0 &&
              result.usedPassageIds.length <= 5 &&
              result.usedPassageIds.every((id) => passageIds.has(id))
            ) {
              this.activeProviderId = provider.name;
              return { ...result, providerId: provider.name };
            }
            throw new InvalidProviderResponseError();
          } catch (error) {
            if (attempt === 0 && error instanceof InvalidProviderResponseError)
              continue;
            throw error;
          }
        }
      } catch {
        this.healthyUntil.delete(provider.name);
        this.coolUntil.set(provider.name, this.now() + COOLDOWN_MS);
      } finally {
        controller.abort();
      }
    }

    return {
      text: "",
      usedPassageIds: [],
      providerId: "offline",
      latencyMs: 0,
    };
  }

  private supportsRequest(
    provider: AiProvider,
    request: AnswerRequest,
  ): boolean {
    const capabilities = provider.capabilities();
    return (
      (capabilities.languages.includes("*") ||
        capabilities.languages.includes(request.lang)) &&
      capabilities.modes.includes(request.mode) &&
      capabilities.modalities.includes("text") &&
      capabilities.structuredOutput
    );
  }

  private applyEvaluationGate(
    provider: AiProvider,
    request: AnswerRequest,
  ): AnswerRequest {
    if (
      request.mode !== "generative" ||
      provider.evaluatedLanguages.includes(request.lang) ||
      provider.evaluatedLanguages.includes("*")
    ) {
      return request;
    }
    return { ...request, mode: "extractive" };
  }

  private filterDataClasses(
    provider: AiProvider,
    request: AnswerRequest,
  ): AnswerRequest {
    const allowed = new Set(provider.allowedDataClasses);
    return {
      lang: request.lang,
      simple: request.simple,
      mode: request.mode,
      systemPrompt: request.systemPrompt,
      question: allowed.has("question") ? request.question : "",
      passages: permittedPassages(
        request.passages,
        allowed,
        provider.privacyClass,
      ),
      glossary:
        provider.privacyClass === "local" && allowed.has("glossary")
          ? request.glossary
          : [],
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    onTimeout?: () => void,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            onTimeout?.();
            reject(new Error("Provider request timed out."));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
