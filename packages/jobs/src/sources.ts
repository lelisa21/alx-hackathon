/**
 * Job platform connectors. Each source yields schema.org JobPosting objects
 * that JobsService.importJobs() validates, stores and indexes for the tutor.
 *
 * - Ethiojobs publishes JobPosting JSON-LD on every public job page and its
 *   robots.txt allows crawling them (it disallows only /api, /auth, /users).
 *   The connector reads the job sitemap, takes the newest postings and fetches
 *   them one at a time with a delay.
 * - HahuJobs and Afriwork publish no public API or feed; their sites load jobs
 *   from private APIs. Their connectors accept a partner feed URL (and token)
 *   once the platform grants access, and otherwise report `needs_setup`.
 */

export type JobSourceState = "ok" | "error" | "needs_setup" | "pending";

export interface JobSourceStatus {
  id: string;
  name: string;
  homepage: string;
  state: JobSourceState;
  /** Postings accepted in the last successful sync. */
  imported: number;
  lastSyncedAt: string | null;
  /** Stable reason code, never upstream content. */
  reason?: string;
}

export interface JobSource {
  id: string;
  name: string;
  homepage: string;
  lang: string;
  configured: boolean;
  /** Why the source cannot run yet (when not configured). */
  setupReason?: string;
  fetchPostings(signal: AbortSignal): Promise<Record<string, unknown>[]>;
}

type Fetch = typeof fetch;

const DEFAULT_USER_AGENT = "DimtsJobsBot/0.1";

function isJobPosting(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const type = (value as Record<string, unknown>)["@type"];
  return Array.isArray(type)
    ? type.includes("JobPosting")
    : type === "JobPosting";
}

function flatten(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (typeof value === "object" && value !== null) {
    const graph = (value as Record<string, unknown>)["@graph"];
    if (Array.isArray(graph)) return graph.flatMap(flatten);
  }
  return [value];
}

/** Every JobPosting in the page's JSON-LD blocks. Malformed blocks are skipped. */
export function extractJobPostings(html: string): Record<string, unknown>[] {
  const postings: Record<string, unknown>[] = [];
  const pattern =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;
  for (const match of html.matchAll(pattern)) {
    try {
      for (const item of flatten(JSON.parse(match[1] ?? "")))
        if (isJobPosting(item)) postings.push(item);
    } catch {
      // A broken block on the page must not hide the valid ones.
    }
  }
  return postings;
}

/** <loc>/<lastmod> pairs from a sitemap, newest first. */
export function sitemapEntries(
  xml: string,
): { loc: string; lastmod: string }[] {
  const entries: { loc: string; lastmod: string }[] = [];
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/giu)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/iu.exec(block[1] ?? "")?.[1];
    if (!loc) continue;
    const lastmod =
      /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/iu.exec(block[1] ?? "")?.[1] ?? "";
    entries.push({ loc: loc.replaceAll("&amp;", "&"), lastmod });
  }
  return entries.sort((a, b) => b.lastmod.localeCompare(a.lastmod));
}

function stillOpen(posting: Record<string, unknown>, now: Date): boolean {
  const deadline = posting.validThrough;
  if (typeof deadline !== "string" || !deadline) return true;
  const time = Date.parse(deadline);
  return !Number.isFinite(time) || time >= now.getTime();
}

async function get(
  fetcher: Fetch,
  url: string,
  signal: AbortSignal,
  headers: Record<string, string>,
): Promise<string> {
  const response = await fetcher(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error(`status_${response.status}`);
  return response.text();
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export function ethiojobsSource(
  options: {
    fetch?: Fetch;
    limit?: number;
    delayMs?: number;
    userAgent?: string;
    now?: () => Date;
  } = {},
): JobSource {
  const fetcher = options.fetch ?? fetch;
  const limit = Math.max(1, Math.min(200, options.limit ?? 40));
  const delayMs = Math.max(0, options.delayMs ?? 500);
  const headers = {
    "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
    accept: "text/html,application/xml;q=0.9",
  };
  const now = options.now ?? (() => new Date());
  return {
    id: "ethiojobs",
    name: "Ethiojobs",
    homepage: "https://ethiojobs.net",
    lang: "en",
    configured: true,
    async fetchPostings(signal) {
      const sitemap = await get(
        fetcher,
        "https://ethiojobs.net/sitemap-jobs.xml",
        signal,
        headers,
      );
      const urls = sitemapEntries(sitemap)
        .map(({ loc }) => loc)
        .filter((loc) => {
          try {
            const url = new URL(loc);
            return (
              url.protocol === "https:" &&
              url.hostname === "ethiojobs.net" &&
              url.pathname.startsWith("/job/")
            );
          } catch {
            return false;
          }
        })
        .slice(0, limit);
      const postings: Record<string, unknown>[] = [];
      for (const [index, url] of urls.entries()) {
        if (index > 0) await pause(delayMs, signal);
        try {
          const page = await get(fetcher, url, signal, headers);
          const posting = extractJobPostings(page)[0];
          if (posting && stillOpen(posting, now()))
            postings.push({ ...posting, url: posting.url ?? url });
        } catch (error) {
          if (signal.aborted) throw error;
          // One unavailable page does not fail the whole sync.
        }
      }
      return postings;
    },
  };
}

/**
 * A partner feed: JSON (an array of JobPosting objects, `{"@graph": [...]}` or
 * `{"jobs": [...]}`) or an HTML page with JobPosting JSON-LD.
 */
export function partnerFeedSource(options: {
  id: string;
  name: string;
  homepage: string;
  url?: string | undefined;
  token?: string | undefined;
  lang?: string;
  fetch?: Fetch;
  userAgent?: string;
}): JobSource {
  const fetcher = options.fetch ?? fetch;
  const url = options.url?.trim();
  return {
    id: options.id,
    name: options.name,
    homepage: options.homepage,
    lang: options.lang ?? "en",
    configured: Boolean(url),
    ...(url ? {} : { setupReason: "partner_feed_required" }),
    async fetchPostings(signal) {
      if (!url) return [];
      const body = await get(fetcher, url, signal, {
        "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
        accept: "application/ld+json,application/json,text/html;q=0.8",
        ...(options.token
          ? { authorization: `Bearer ${options.token.trim()}` }
          : {}),
      });
      const trimmed = body.trimStart();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed) as unknown;
        const jobs =
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed) &&
          Array.isArray((parsed as Record<string, unknown>).jobs)
            ? (parsed as Record<string, unknown>).jobs
            : parsed;
        return flatten(jobs).filter(isJobPosting);
      }
      return extractJobPostings(body);
    },
  };
}

export interface JobSourceSyncOptions {
  sources: JobSource[];
  importJobs(input: {
    lang: string;
    postings: unknown;
  }): Promise<{ imported: number; errors: unknown[] }>;
  intervalMs: number;
  onError?(event: { source: string; reason: string }): void;
  now?: () => Date;
}

/** Runs each configured source on start and then on an interval. */
export class JobSourceSync {
  private readonly options: JobSourceSyncOptions;
  private readonly statuses = new Map<string, JobSourceStatus>();
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;

  constructor(options: JobSourceSyncOptions) {
    this.options = options;
    for (const source of options.sources)
      this.statuses.set(source.id, {
        id: source.id,
        name: source.name,
        homepage: source.homepage,
        state: source.configured ? "pending" : "needs_setup",
        imported: 0,
        lastSyncedAt: null,
        ...(source.setupReason ? { reason: source.setupReason } : {}),
      });
  }

  status(): JobSourceStatus[] {
    return [...this.statuses.values()].map((status) => ({ ...status }));
  }

  start(): Promise<void> {
    if (this.options.intervalMs > 0 && !this.timer) {
      this.timer = setInterval(
        () => void this.syncAll(),
        this.options.intervalMs,
      );
      this.timer.unref?.();
    }
    return this.syncAll();
  }

  syncAll(): Promise<void> {
    this.running ??= (async () => {
      try {
        for (const source of this.options.sources) {
          if (this.controller.signal.aborted) return;
          if (source.configured) await this.syncOne(source);
        }
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  private async syncOne(source: JobSource): Promise<void> {
    const previous = this.statuses.get(source.id)!;
    try {
      const postings = await source.fetchPostings(this.controller.signal);
      const result = postings.length
        ? await this.options.importJobs({ lang: source.lang, postings })
        : { imported: 0, errors: [] };
      this.statuses.set(source.id, {
        id: previous.id,
        name: previous.name,
        homepage: previous.homepage,
        state: result.imported > 0 ? "ok" : "error",
        imported: result.imported,
        lastSyncedAt: (this.options.now?.() ?? new Date()).toISOString(),
        ...(result.imported > 0 ? {} : { reason: "no_open_postings" }),
      });
    } catch (error) {
      if (this.controller.signal.aborted) return;
      const reason =
        error instanceof Error && /^status_\d{3}$/u.test(error.message)
          ? `upstream_${error.message}`
          : "unreachable";
      this.statuses.set(source.id, { ...previous, state: "error", reason });
      this.options.onError?.({ source: source.id, reason });
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.controller.abort();
    await this.running?.catch(() => undefined);
  }
}
