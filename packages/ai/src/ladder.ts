import type { AnswerRequest } from "@dimts/engine";
import {
  describeProviderFailure,
  InvalidProviderResponseError,
  permittedPassages,
} from "./provider.js";
import type { AiProvider, AnswerResult } from "./provider.js";

const COOLDOWN_MS = 60_000;
// A rejected key or unknown model will not fix itself within a minute.
const PERMANENT_COOLDOWN_MS = 15 * 60_000;

/** Content-free description of a failed provider attempt, for operators. */
export interface ProviderFailureEvent {
  provider: string;
  reason: string;
  status?: number;
  vendorCode?: string;
  vendorMessage?: string;
  cooldownMs: number;
}
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
  private readonly onFailure:
    ((event: ProviderFailureEvent) => void) | undefined;

  constructor(
    providers: AiProvider[],
    timeouts: Record<string, number>,
    now: () => number = () => Date.now(),
    onFailure?: (event: ProviderFailureEvent) => void,
  ) {
    this.providers = providers;
    this.timeouts = timeouts;
    this.now = now;
    this.onFailure = onFailure;
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
          if (!health.ok) {
            const status = /^status_(\d{3})$/u.exec(health.reasonCode ?? "");
            throw Object.assign(new Error("Provider health check failed."), {
              healthReason: health.reasonCode ?? "unhealthy",
              ...(status ? { healthStatus: Number(status[1]) } : {}),
            });
          }
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
      } catch (error) {
        const failure = describeProviderFailure(error);
        const healthStatus = (error as { healthStatus?: unknown }).healthStatus;
        if (typeof healthStatus === "number") {
          failure.status = healthStatus;
          failure.reason =
            healthStatus === 401 || healthStatus === 403
              ? "unauthorized"
              : healthStatus === 404
                ? "model_not_found"
                : healthStatus === 400
                  ? "rejected"
                  : "health_check_failed";
        }
        // Google answers an invalid API key with 400 INVALID_ARGUMENT, both on
        // the health probe and on generation.
        const permanent =
          failure.reason === "unauthorized" ||
          failure.reason === "model_not_found" ||
          (failure.status === 400 && typeof healthStatus === "number") ||
          (failure.status === 400 &&
            /api key|api_key|permission|not found|not supported/iu.test(
              `${failure.vendorCode ?? ""} ${failure.vendorMessage ?? ""}`,
            ));
        // Blueprint 3.2: cool down a provider that is down or rate limited.
        // A malformed answer (after its one retry) says nothing about
        // availability: this question falls through, the next one tries the
        // provider again instead of sending every learner to the fallback.
        const malformed = error instanceof InvalidProviderResponseError;
        const cooldownMs = malformed
          ? 0
          : permanent
            ? PERMANENT_COOLDOWN_MS
            : COOLDOWN_MS;
        if (!malformed) {
          this.healthyUntil.delete(provider.name);
          this.coolUntil.set(provider.name, this.now() + cooldownMs);
        }
        try {
          this.onFailure?.({ provider: provider.name, ...failure, cooldownMs });
        } catch {
          // Logging must never break answering.
        }
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
