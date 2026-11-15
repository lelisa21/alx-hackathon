import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PublicSitemapSource } from "../src/public-website-source.js";

const sitemapUrl = "https://learn.example/sitemap.xml";
const pageUrl = "https://learn.example/course/lesson-1";
const sitemap = (urls: string[]) =>
  `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
const html = (text: string) =>
  `<html lang="en"><title>Course</title><h1>Course</h1><h2>Lesson</h2><p>${text}</p></html>`;

function response(body: string, contentType: string) {
  return { status: 200, contentType, body };
}

describe("public sitemap content source", () => {
  it("validates source identity, language, and page-size configuration", () => {
    const fetchResource = async () => response("", "application/xml");
    const create = (options: {
      id?: string;
      language?: string;
      pageSize?: number;
    }) =>
      new PublicSitemapSource({
        id: options.id ?? "learn-public",
        sitemapUrl,
        language: options.language ?? "en",
        ...(options.pageSize === undefined
          ? {}
          : { pageSize: options.pageSize }),
        fetchResource,
      });

    expect(() => create({ id: "invalid id" })).toThrow(
      "Public source ID contains invalid characters",
    );
    expect(() => create({ language: " " })).toThrow(
      "Public source language must not be empty",
    );
    for (const pageSize of [0, 101, 1.5]) {
      expect(() => create({ pageSize })).toThrow(
        "Public source page size must be from 1 through 100",
      );
    }
    expect(() => create({ pageSize: 1 })).not.toThrow();
    expect(() => create({ pageSize: 100 })).not.toThrow();
  });

  it("discovers approved pages and returns content with a stable body revision", async () => {
    const fetchResource = vi.fn(async (url: string) => {
      if (url === sitemapUrl) {
        return response(sitemap([pageUrl]), "application/xml");
      }
      if (url === pageUrl) {
        return response(html("Public course material."), "text/html");
      }
      throw new Error("Unexpected URL.");
    });
    const source = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      fetchResource,
    });

    const page = await source.list({}, new AbortController().signal);
    const resource = page.resources[0];
    expect(resource).toMatchObject({
      sourceId: "learn-public",
      canonicalUrl: pageUrl,
      language: "en",
      mediaType: "text/html",
    });
    expect(page.snapshotRevision).toMatch(/^[a-f0-9]{64}$/u);

    const document = await source.fetch(
      resource!.resourceId,
      new AbortController().signal,
    );
    expect(document).toMatchObject({
      sourceId: "learn-public",
      revision: createHash("sha256")
        .update(html("Public course material."))
        .digest("hex"),
      body: html("Public course material."),
    });
    expect(fetchResource).toHaveBeenCalledTimes(2);
  });

  it("rejects resources that leave the explicitly approved site origin", async () => {
    const fetchResource = vi.fn(async () => ({
      status: 200,
      contentType: "application/xml",
      body: sitemap(["https://other.example/private"]),
    }));
    const source = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      fetchResource,
    });

    await expect(source.list({}, new AbortController().signal)).rejects.toThrow(
      "outside the approved origin",
    );
    expect(fetchResource).toHaveBeenCalledTimes(1);
  });

  it("rejects private-network and insecure website targets", () => {
    for (const unsafeUrl of [
      "http://learn.example/sitemap.xml",
      "https://127.0.0.1/sitemap.xml",
      "https://localhost/sitemap.xml",
      "https://learn.example/sitemap.xml?token=private",
    ]) {
      expect(
        () =>
          new PublicSitemapSource({
            id: "learn-public",
            sitemapUrl: unsafeUrl,
            language: "en",
            fetchResource: async () => response("", "application/xml"),
          }),
      ).toThrow();
    }
  });

  it("returns the exact page body captured in its sitemap snapshot", async () => {
    let currentHtml = html("Original public material.");
    const fetchResource = async (url: string) =>
      url === sitemapUrl
        ? response(sitemap([pageUrl]), "application/xml")
        : response(currentHtml, "text/html");
    const source = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      fetchResource,
    });
    const page = await source.list({}, new AbortController().signal);
    currentHtml = html("Changed after discovery.");

    const document = await source.fetch(
      page.resources[0]!.resourceId,
      new AbortController().signal,
    );
    expect(document?.body).toBe(html("Original public material."));
  });

  it("paginates large sitemaps with a stable snapshot token", async () => {
    const urls = Array.from(
      { length: 3 },
      (_item, index) => `https://learn.example/course/${index + 1}`,
    );
    const fetchResource = vi.fn(async (url: string) =>
      url === sitemapUrl
        ? response(sitemap(urls), "application/xml")
        : response(html(url), "text/html"),
    );
    const source = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      pageSize: 2,
      fetchResource,
    });

    const first = await source.list({}, new AbortController().signal);
    const second = await source.list(
      {
        cursor: first.nextCursor,
        snapshotRevision: first.snapshotRevision,
      },
      new AbortController().signal,
    );

    expect(first.resources).toHaveLength(2);
    expect(second.resources).toHaveLength(1);
    expect(second.snapshotRevision).toBe(first.snapshotRevision);
  });

  it("rejects malformed, missing, and stale pagination snapshots", async () => {
    const source = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      fetchResource: async (url) =>
        url === sitemapUrl
          ? response(sitemap([pageUrl]), "application/xml")
          : response(html("Course content."), "text/html"),
    });
    const signal = new AbortController().signal;

    await expect(
      source.list({ cursor: "0", snapshotRevision: "snapshot" }, signal),
    ).rejects.toThrow("snapshot is no longer available");

    const first = await source.list({}, signal);
    await expect(
      source.list(
        { cursor: "x", snapshotRevision: first.snapshotRevision },
        signal,
      ),
    ).rejects.toThrow("pagination cursor is invalid");
    await expect(source.list({ cursor: "0" }, signal)).rejects.toThrow(
      "pagination cursor is invalid",
    );
    await expect(
      source.list({ cursor: "0", snapshotRevision: "stale-snapshot" }, signal),
    ).rejects.toThrow("snapshot is no longer available");
    await expect(
      source.list({ snapshotRevision: "stale-snapshot" }, signal),
    ).rejects.toThrow("site changed during source pagination");
  });

  it("does not fetch an unknown page or continue with an aborted request", async () => {
    const fetchResource = vi.fn(async () =>
      response(sitemap([pageUrl]), "application/xml"),
    );
    const source = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      fetchResource,
    });

    await expect(
      source.fetch("unknown-resource", new AbortController().signal),
    ).resolves.toBeNull();
    const aborted = new AbortController();
    aborted.abort();
    await expect(source.list({}, aborted.signal)).rejects.toThrow();
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized sitemap responses", async () => {
    const cases = [
      {
        response: { status: 503, contentType: "application/xml", body: "" },
        error: "sitemap fetch failed with status 503",
      },
      {
        response: response("<urlset/>", "text/plain"),
        error: "must use an XML media type",
      },
      {
        response: response("x".repeat(2 * 1024 * 1024 + 1), "application/xml"),
        error: "sitemap exceeds the configured size limit",
      },
      {
        response: response("<!DOCTYPE urlset><urlset/>", "application/xml"),
        error: "must not declare XML entities",
      },
      {
        response: response("<unknown/>", "application/xml"),
        error: "unsupported XML root element",
      },
    ];

    for (const testCase of cases) {
      const source = new PublicSitemapSource({
        id: "learn-public",
        sitemapUrl,
        language: "en",
        fetchResource: async () => testCase.response,
      });
      await expect(
        source.list({}, new AbortController().signal),
      ).rejects.toThrow(testCase.error);
    }
  });

  it("rejects failed, unsupported, or oversized public lesson responses", async () => {
    const cases = [
      {
        response: { status: 404, contentType: "text/html", body: "" },
        error: "page fetch failed with status 404",
      },
      {
        response: response("<html/>", "application/json"),
        error: "Unsupported public page media type",
      },
      {
        response: response(html("x".repeat(1024 * 1024)), "text/html"),
        error: "Public page exceeds the configured size limit",
      },
    ];

    for (const testCase of cases) {
      const source = new PublicSitemapSource({
        id: "learn-public",
        sitemapUrl,
        language: "en",
        fetchResource: async (url) =>
          url === sitemapUrl
            ? response(sitemap([pageUrl]), "application/xml")
            : testCase.response,
      });
      await expect(
        source.list({}, new AbortController().signal),
      ).rejects.toThrow(testCase.error);
    }
  });

  it("deduplicates cyclic sitemap indexes and enforces the page discovery cap", async () => {
    const childSitemap = "https://learn.example/sitemaps/course.xml";
    const source = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      fetchResource: async (url) => {
        if (url === sitemapUrl) {
          return response(
            `<sitemapindex><sitemap><loc>${childSitemap}</loc></sitemap><sitemap><loc>${childSitemap}</loc></sitemap><sitemap><loc>${sitemapUrl}</loc></sitemap></sitemapindex>`,
            "application/xml",
          );
        }
        if (url === childSitemap) {
          return response(sitemap([pageUrl]), "application/xml");
        }
        return response(html("Course content."), "text/html");
      },
    });
    const page = await source.list({}, new AbortController().signal);
    expect(page.resources.map(({ canonicalUrl }) => canonicalUrl)).toEqual([
      pageUrl,
    ]);

    const tooManyPages = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      fetchResource: async () =>
        response(
          sitemap(
            Array.from(
              { length: 251 },
              (_value, index) => `https://learn.example/course/${index}`,
            ),
          ),
          "application/xml",
        ),
    });
    await expect(
      tooManyPages.list({}, new AbortController().signal),
    ).rejects.toThrow("exceeds the 250-page discovery limit");
  });

  it("discovers additions and removals on the next reconciliation snapshot", async () => {
    let listedUrls = [pageUrl];
    const fetchResource = async (url: string) => {
      if (url === sitemapUrl) {
        return response(sitemap(listedUrls), "application/xml");
      }
      return response(html(url), "text/html");
    };
    const source = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      fetchResource,
    });

    const first = await source.list({}, new AbortController().signal);
    listedUrls = ["https://learn.example/course/lesson-2"];
    const second = await source.list({}, new AbortController().signal);

    expect(second.resources.map(({ canonicalUrl }) => canonicalUrl)).toEqual([
      "https://learn.example/course/lesson-2",
    ]);
    expect(second.resources[0]?.resourceId).not.toBe(
      first.resources[0]?.resourceId,
    );
    expect(second.snapshotRevision).not.toBe(first.snapshotRevision);
  });

  it("follows sitemap indexes without crossing the approved site origin", async () => {
    const childSitemap = "https://learn.example/sitemaps/course.xml";
    const fetchResource = async (url: string) => {
      if (url === sitemapUrl) {
        return response(
          `<sitemapindex><sitemap><loc>${childSitemap}</loc></sitemap></sitemapindex>`,
          "application/xml",
        );
      }
      if (url === childSitemap) {
        return response(sitemap([pageUrl]), "application/xml");
      }
      return response(html("Public course material."), "text/html");
    };
    const source = new PublicSitemapSource({
      id: "learn-public",
      sitemapUrl,
      language: "en",
      fetchResource,
    });

    const page = await source.list({}, new AbortController().signal);

    expect(page.resources.map(({ canonicalUrl }) => canonicalUrl)).toEqual([
      pageUrl,
    ]);
  });
});
