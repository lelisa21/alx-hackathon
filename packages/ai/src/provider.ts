import type { AnswerRequest } from "@dimts/engine";

export type ProviderName = string;
export type ProviderPrivacyClass = "local" | "remote";
/**
 * "job-posting" authorizes sending public job postings (from job boards) to a
 * remote provider. It is never implied by "course-passage".
 */
export type ProviderDataClass =
  "question" | "course-passage" | "job-posting" | "glossary";

/** Passages a provider may receive under its privacy class and data classes. */
export function permittedPassages<T extends { sourceType: "course" | "job" }>(
  passages: T[],
  allowed: ReadonlySet<ProviderDataClass>,
  privacyClass: "local" | "remote",
): T[] {
  if (privacyClass === "local")
    return allowed.has("course-passage") ? passages : [];
  return passages.filter(({ sourceType }) =>
    allowed.has(sourceType === "course" ? "course-passage" : "job-posting"),
  );
}

export interface ProviderCapabilities {
  languages: string[];
  modes: ("extractive" | "generative")[];
  modalities: ("text" | "image" | "audio")[];
  structuredOutput: boolean;
}

export interface AnswerResult {
  text: string;
  usedPassageIds: string[];
  providerId: ProviderName;
  latencyMs: number;
}

export interface AiProvider {
  name: ProviderName;
  privacyClass: ProviderPrivacyClass;
  allowedDataClasses: ProviderDataClass[];
  evaluatedLanguages: string[];
  capabilities(): ProviderCapabilities;
  health(signal?: AbortSignal): Promise<{ ok: boolean; reasonCode?: string }>;
  answer(request: AnswerRequest, signal: AbortSignal): Promise<AnswerResult>;
}

export class InvalidProviderResponseError extends Error {
  /** Stable reason code for logs; never model output. */
  readonly reason: string;
  constructor(reason = "invalid_answer") {
    super("Provider returned an invalid answer.");
    this.name = "InvalidProviderResponseError";
    this.reason = reason;
  }
}

/**
 * A vendor refused or failed a request. Carries the HTTP status and the
 * vendor's own error code/message (which describe the request, e.g. "API key
 * not valid"), never the learner question or passages.
 */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly vendorCode: string | undefined;
  readonly vendorMessage: string | undefined;
  /** When the vendor says the quota resets (429), in milliseconds. */
  readonly retryAfterMs: number | undefined;
  constructor(
    status: number,
    vendorCode?: string,
    vendorMessage?: string,
    options?: { cause?: unknown; retryAfterMs?: number },
  ) {
    super("Provider request failed.", options);
    this.name = "ProviderHttpError";
    this.status = status;
    this.vendorCode = vendorCode?.slice(0, 64);
    this.vendorMessage = vendorMessage?.replace(/\s+/gu, " ").slice(0, 240);
    this.retryAfterMs =
      options?.retryAfterMs ?? parseRetryDelay(this.vendorMessage);
  }
}

/**
 * Reads a quota reset delay from vendor text: Gemini says "Please retry in
 * 7h49m58s" or "retry in 26.5s"; RetryInfo uses "28s".
 */
export function parseRetryDelay(text: string | undefined): number | undefined {
  const match =
    /retry (?:in|after)\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/iu.exec(
      text ?? "",
    ) ?? /^\s*(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)\s*$/iu.exec(text ?? "");
  if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
  const ms =
    (Number(match[1] ?? 0) * 3600 +
      Number(match[2] ?? 0) * 60 +
      Number(match[3] ?? 0)) *
    1000;
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : undefined;
}

/** Retry-After (seconds or HTTP date) or OpenRouter's X-RateLimit-Reset (epoch ms). */
function headerRetryDelay(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date) && date > Date.now()) return date - Date.now();
  }
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > Date.now()) return reset - Date.now();
  return undefined;
}

/** Reads a vendor error body (bounded) into a ProviderHttpError. */
export async function providerHttpError(
  response: Response,
): Promise<ProviderHttpError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const text = (await response.text()).slice(0, 8_192);
    const body = JSON.parse(text) as unknown;
    const error =
      body && typeof body === "object" && "error" in body
        ? (body as { error: unknown }).error
        : body;
    if (error && typeof error === "object") {
      const record = error as Record<string, unknown>;
      const rawCode = record.status ?? record.code ?? record.type;
      if (typeof rawCode === "string" || typeof rawCode === "number")
        code = String(rawCode);
      if (typeof record.message === "string") message = record.message;
      const metadata = record.metadata as Record<string, unknown> | undefined;
      if (metadata && typeof metadata.raw === "string")
        message = `${message ?? ""} ${metadata.raw}`.trim();
    } else if (typeof error === "string") message = error;
  } catch {
    // Non-JSON bodies keep only the status.
  }
  const retryAfterMs =
    response.status === 429 ? headerRetryDelay(response.headers) : undefined;
  return new ProviderHttpError(response.status, code, message, {
    ...(retryAfterMs ? { retryAfterMs } : {}),
  });
}

/** A short, content-free description of why a provider attempt failed. */
export function describeProviderFailure(error: unknown): {
  reason: string;
  status?: number;
  vendorCode?: string;
  vendorMessage?: string;
  retryAfterMs?: number;
} {
  if (error instanceof ProviderHttpError)
    return {
      reason:
        error.status === 429
          ? "rate_limited"
          : error.status === 401 || error.status === 403
            ? "unauthorized"
            : error.status === 404
              ? "model_not_found"
              : error.status >= 500
                ? "vendor_unavailable"
                : "rejected",
      status: error.status,
      ...(error.vendorCode ? { vendorCode: error.vendorCode } : {}),
      ...(error.vendorMessage ? { vendorMessage: error.vendorMessage } : {}),
      ...(error.status === 429 && error.retryAfterMs
        ? { retryAfterMs: error.retryAfterMs }
        : {}),
    };
  if (error instanceof InvalidProviderResponseError)
    return { reason: error.reason };
  if (
    error instanceof Error &&
    /timed out|TimeoutError|AbortError/u.test(`${error.name} ${error.message}`)
  )
    return { reason: "timeout" };
  if (
    error instanceof Error &&
    error.message === "Provider health check failed."
  )
    return { reason: "health_check_failed" };
  return { reason: "network_error" };
}
