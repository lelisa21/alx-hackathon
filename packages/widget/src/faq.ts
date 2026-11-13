export interface FaqCitation {
  passageId: string;
  label: string;
  url: string;
  sourceLang: string;
  sourceType: "course" | "job";
  timestamp?: number;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  lang: string;
  dir: "ltr" | "rtl";
  citations: FaqCitation[];
}

interface FaqDocument {
  lang: string;
  dir: "ltr" | "rtl";
  contentVersion: string;
  reviewedOn: string | null;
  items: Omit<FaqItem, "lang" | "dir">[];
}

const cacheName = "dimts-faq-v1";
const memory = new Map<string, Response>();
let epoch = 0;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function string(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const date = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date) &&
    date <= Date.now() &&
    new Date(date).toISOString().slice(0, 10) === value
  );
}

function parseFaq(value: unknown, lang: string): FaqDocument {
  if (
    !record(value) ||
    value.lang !== lang ||
    !["ltr", "rtl"].includes(String(value.dir)) ||
    !string(value.contentVersion, 256) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !(value.reviewedOn === null || validDate(value.reviewedOn)) ||
    (value.items.length > 0 && value.reviewedOn === null)
  )
    throw new Error("Invalid FAQ response");
  for (const item of value.items) {
    if (
      !record(item) ||
      !string(item.id, 128) ||
      !string(item.question, 1000) ||
      !string(item.answer, 4000) ||
      !Array.isArray(item.citations) ||
      item.citations.length !== 1
    )
      throw new Error("Invalid FAQ entry");
    for (const citation of item.citations) {
      if (
        !record(citation) ||
        !string(citation.passageId, 256) ||
        !string(citation.label, 1000) ||
        !string(citation.url, 4000) ||
        !string(citation.sourceLang, 35) ||
        citation.sourceType !== "course" ||
        (citation.timestamp !== undefined &&
          (typeof citation.timestamp !== "number" ||
            !Number.isFinite(citation.timestamp)))
      )
        throw new Error("Invalid FAQ citation");
      const url = new URL(citation.url);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Invalid FAQ source protocol");
    }
  }
  return value as unknown as FaqDocument;
}

function result(
  document: FaqDocument,
  cached: boolean,
): { items: FaqItem[]; cached: boolean } {
  return {
    items: document.items.map((item) => ({
      ...item,
      lang: document.lang,
      dir: document.dir,
    })),
    cached,
  };
}

async function storage(): Promise<Cache | undefined> {
  try {
    return await globalThis.caches?.open(cacheName);
  } catch {
    return undefined;
  }
}

/** Public reviewed content only: no learner text, token, or session enters this cache. */
export async function loadFaq(
  apiRoot: string,
  lang: string,
  preview = false,
  options: { signal?: AbortSignal } = {},
): Promise<{ items: FaqItem[]; cached: boolean }> {
  options.signal?.throwIfAborted();
  const started = epoch;
  const url = `${apiRoot.replace(/\/$/u, "")}/locales/${encodeURIComponent(lang)}/faq${preview ? "?lang_preview=1" : ""}`;
  const key = new URL(url, globalThis.location?.href ?? "https://localhost/")
    .href;
  const cache = await storage();
  let saved = memory.get(key)?.clone();
  if (!saved) {
    try {
      saved = await cache?.match(key);
    } catch {
      /* Storage restrictions leave the network path usable. */
    }
  }
  let previous: FaqDocument | undefined;
  if (saved) {
    try {
      previous = parseFaq(await saved.clone().json(), lang);
    } catch {
      saved = undefined;
    }
  }
  const etag = saved?.headers.get("ETag");
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  // Saved reviewed content remains useful while an API wakes. A caller abort
  // (language change/uninstall) still cancels rather than returning stale UI.
  const deadline = previous ? setTimeout(cancel, 2_000) : undefined;
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        credentials: "omit",
        headers: etag ? { "If-None-Match": etag } : {},
        signal: controller.signal,
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (previous) return result(previous, true);
      throw error;
    }
    options.signal?.throwIfAborted();
    controller.signal.throwIfAborted();
    if (response.status === 304 && previous) return result(previous, false);
    if (!response.ok) {
      if (response.status >= 500 && previous) return result(previous, true);
      if (response.status === 404 || response.status === 403) {
        memory.delete(key);
        try {
          await cache?.delete(key);
        } catch {
          /* Optional cache cleanup. */
        }
      }
      throw new Error("FAQ request failed");
    }
    const document = parseFaq(await response.clone().json(), lang);
    controller.signal.throwIfAborted();
    if (started === epoch) {
      memory.set(key, response.clone());
      if (memory.size > 20) memory.delete(memory.keys().next().value!);
      try {
        await cache?.put(key, response.clone());
      } catch {
        /* In-memory/offline use remains available. */
      }
    }
    return result(document, response.headers.get("X-Dimts-Offline") === "1");
  } catch (error) {
    options.signal?.throwIfAborted();
    if (controller.signal.aborted && previous) return result(previous, true);
    throw error;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", cancel);
  }
}

/** Uninstall removes only the cache owned by this module. */
export async function clearFaqCache(apiRoot?: string): Promise<void> {
  epoch += 1;
  const prefix = apiRoot
    ? new URL(
        `${apiRoot.replace(/\/$/u, "")}/locales/`,
        globalThis.location?.href ?? "https://localhost/",
      ).href
    : undefined;
  if (prefix) {
    for (const key of memory.keys())
      if (key.startsWith(prefix)) memory.delete(key);
  } else memory.clear();
  try {
    if (prefix) {
      const cache = await storage();
      const requests = (await cache?.keys()) ?? [];
      await Promise.all(
        requests
          .filter((request) => request.url.startsWith(prefix))
          .map((request) => cache!.delete(request)),
      );
    } else await globalThis.caches?.delete(cacheName);
  } catch {
    /* Storage may be disabled. */
  }
}
