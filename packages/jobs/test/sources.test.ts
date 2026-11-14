// Job platform connectors: Ethiojobs JSON-LD crawl and partner feeds.
import { describe, expect, it, vi } from "vitest";
import {
  JobSourceSync,
  ethiojobsSource,
  extractJobPostings,
  partnerFeedSource,
  sitemapEntries,
} from "../src/sources.js";

const posting = (title: string, validThrough = "2099-01-01T00:00:00Z") => ({
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title,
  description: "<p>Answer customer questions.</p>",
  datePosted: "2026-11-10T00:00:00Z",
  validThrough,
  hiringOrganization: { "@type": "Organization", name: "Example Bank" },
  jobLocation: {
    "@type": "Place",
    address: { addressLocality: "Addis Ababa", addressCountry: "Ethiopia" },
  },
});

const page = (value: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(value)}</script></head></html>`;

function fakeFetch(routes: Record<string, string | number>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const body = routes[String(input)];
    if (body === undefined || typeof body === "number")
      return new Response("", {
        status: typeof body === "number" ? body : 404,
      });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("job source parsing", () => {
  it("extracts JobPosting objects from JSON-LD, including @graph", () => {
    const html =
      page({ "@graph": [{ "@type": "Organization" }, posting("Cashier")] }) +
      `<script type="application/ld+json">not json</script>` +
      page(posting("Clerk"));
    expect(extractJobPostings(html).map((item) => item.title)).toEqual([
      "Cashier",
      "Clerk",
    ]);
  });

  it("orders sitemap entries newest first", () => {
    const xml = `<urlset><url><loc>https://ethiojobs.net/job/a</loc><lastmod>2026-11-01</lastmod></url><url><loc>https://ethiojobs.net/job/b?x=1&amp;y=2</loc><lastmod>2026-11-14</lastmod></url></urlset>`;
    expect(sitemapEntries(xml).map(({ loc }) => loc)).toEqual([
      "https://ethiojobs.net/job/b?x=1&y=2",
      "https://ethiojobs.net/job/a",
    ]);
  });
});

describe("Ethiojobs connector", () => {
  it("fetches the newest job pages, skips closed and foreign URLs", async () => {
    const fetcher = fakeFetch({
      "https://ethiojobs.net/sitemap-jobs.xml": `<urlset>
        <url><loc>https://ethiojobs.net/job/open</loc><lastmod>2026-11-14</lastmod></url>
        <url><loc>https://evil.example/job/x</loc><lastmod>2026-11-13</lastmod></url>
        <url><loc>https://ethiojobs.net/job/closed</loc><lastmod>2026-11-12</lastmod></url>
        <url><loc>https://ethiojobs.net/job/broken</loc><lastmod>2026-11-11</lastmod></url>
      </urlset>`,
      "https://ethiojobs.net/job/open": page(posting("Open role")),
      "https://ethiojobs.net/job/closed": page(
        posting("Closed role", "2020-01-01T00:00:00Z"),
      ),
      "https://ethiojobs.net/job/broken": 500,
    });
    const postings = await ethiojobsSource({
      fetch: fetcher,
      delayMs: 0,
      now: () => new Date("2026-11-14T00:00:00Z"),
    }).fetchPostings(new AbortController().signal);
    expect(postings.map((item) => item.title)).toEqual(["Open role"]);
    expect(postings[0]?.url).toBe("https://ethiojobs.net/job/open");
    const requested = (
      fetcher as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map(([url]) => String(url));
    expect(requested).not.toContain("https://evil.example/job/x");
  });
});

describe("partner feeds (HahuJobs, Afriwork)", () => {
  it("reports needs_setup without a feed URL and never fetches", async () => {
    const fetcher = fakeFetch({});
    const source = partnerFeedSource({
      id: "hahujobs",
      name: "HahuJobs",
      homepage: "https://hahu.jobs",
      fetch: fetcher,
    });
    const sync = new JobSourceSync({
      sources: [source],
      importJobs: vi.fn(),
      intervalMs: 0,
    });
    await sync.start();
    expect(sync.status()[0]).toMatchObject({
      id: "hahujobs",
      state: "needs_setup",
      reason: "partner_feed_required",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts JSON arrays and {jobs: [...]} feeds with a bearer token", async () => {
    let auth = "";
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        auth = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(JSON.stringify({ jobs: [posting("Designer")] }));
      },
    ) as unknown as typeof fetch;
    const postings = await partnerFeedSource({
      id: "afriwork",
      name: "Afriwork",
      homepage: "https://afriworket.com",
      url: "https://partner.example/jobs.json",
      token: "secret-token",
      fetch: fetcher,
    }).fetchPostings(new AbortController().signal);
    expect(postings.map((item) => item.title)).toEqual(["Designer"]);
    expect(auth).toBe("Bearer secret-token");
  });
});

describe("JobSourceSync", () => {
  it("imports each configured source and reports status without content", async () => {
    const importJobs = vi.fn(async () => ({ imported: 2, errors: [] }));
    const sync = new JobSourceSync({
      sources: [
        {
          id: "ok",
          name: "OK",
          homepage: "https://ok.example",
          lang: "en",
          configured: true,
          fetchPostings: async () => [posting("A"), posting("B")],
        },
        {
          id: "down",
          name: "Down",
          homepage: "https://down.example",
          lang: "en",
          configured: true,
          fetchPostings: async () => {
            throw new Error("status_503");
          },
        },
      ],
      importJobs,
      intervalMs: 0,
      now: () => new Date("2026-11-14T10:00:00Z"),
    });
    await sync.start();
    expect(importJobs).toHaveBeenCalledWith({
      lang: "en",
      postings: [posting("A"), posting("B")],
    });
    expect(sync.status()).toEqual([
      {
        id: "ok",
        name: "OK",
        homepage: "https://ok.example",
        state: "ok",
        imported: 2,
        lastSyncedAt: "2026-11-14T10:00:00.000Z",
      },
      {
        id: "down",
        name: "Down",
        homepage: "https://down.example",
        state: "error",
        imported: 0,
        lastSyncedAt: null,
        reason: "upstream_status_503",
      },
    ]);
    await sync.stop();
  });
});
