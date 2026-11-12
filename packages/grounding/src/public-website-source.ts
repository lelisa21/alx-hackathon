import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { parseHTML } from "linkedom";
import type {
  ContentSource,
  HostAuth,
  SourceDocument,
  SourceResource,
} from "./sync.js";

const MAX_SITEMAP_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_SITEMAP_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_TOTAL_PAGE_BYTES = 32 * 1024 * 1024;
const MAX_RESOURCES = 250;
const DEFAULT_PAGE_SIZE = 25;

export interface PublicResourceResponse {
  status: number;
  contentType: string;
  body: string;
}

export type PublicResourceFetcher = (
  url: string,
  signal: AbortSignal,
) => Promise<PublicResourceResponse>;

export interface PublicSitemapSourceOptions {
  id: string;
  sitemapUrl: string;
  language: string;
  pageSize?: number;
  fetchResource?: PublicResourceFetcher;
}

interface IndexedPage {
  resource: SourceResource;
  document: SourceDocument;
}

interface Snapshot {
  revision: string;
  pages: IndexedPage[];
}

const publicReadOnlyAuth: HostAuth = {
  authorize: async () => undefined,
};

export class PublicSitemapSource implements ContentSource {
  readonly id: string;
  readonly auth = publicReadOnlyAuth;
  private readonly origin: string;
  private readonly sitemapUrl: string;
  private readonly language: string;
  private readonly pageSize: number;
  private readonly fetchResource: PublicResourceFetcher;
  private snapshot: Snapshot | undefined;

  constructor(options: PublicSitemapSourceOptions) {
    if (!/^[A-Za-z0-9._-]+$/u.test(options.id)) {
      throw new Error("Public source ID contains invalid characters.");
    }
    if (!options.language.trim()) {
      throw new Error("Public source language must not be empty.");
    }
    this.id = options.id;
    this.sitemapUrl = validatePublicUrl(options.sitemapUrl);
    this.origin = new URL(this.sitemapUrl).origin;
    this.language = options.language;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    if (
      !Number.isInteger(this.pageSize) ||
      this.pageSize < 1 ||
      this.pageSize > 100
    ) {
      throw new Error("Public source page size must be from 1 through 100.");
    }
    this.fetchResource = options.fetchResource ?? fetchPublicResource;
  }

  async list(
    input: { cursor?: string; snapshotRevision?: string },
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    let snapshot: Snapshot;
    let offset = 0;
    if (input.cursor !== undefined) {
      if (!input.snapshotRevision || !/^\d+$/u.test(input.cursor)) {
        throw new Error("Public source pagination cursor is invalid.");
      }
      snapshot = this.snapshot!;
      if (!snapshot || snapshot.revision !== input.snapshotRevision) {
        throw new Error("Public source snapshot is no longer available.");
      }
      offset = Number(input.cursor);
    } else {
      snapshot = await this.createSnapshot(signal);
      this.snapshot = snapshot;
      if (
        input.snapshotRevision !== undefined &&
        input.snapshotRevision !== snapshot.revision
      ) {
        throw new Error("Public site changed during source pagination.");
      }
    }

    const resources = snapshot.pages
      .slice(offset, offset + this.pageSize)
      .map(({ resource }) => resource);
    const nextOffset = offset + resources.length;
    return {
      resources,
      ...(nextOffset < snapshot.pages.length
        ? { nextCursor: String(nextOffset) }
        : {}),
      snapshotRevision: snapshot.revision,
    };
  }

  async fetch(
    resourceId: string,
    signal: AbortSignal,
  ): Promise<SourceDocument | null> {
    signal.throwIfAborted();
    const entry = this.snapshot?.pages.find(
      ({ resource }) => resource.resourceId === resourceId,
    );
    return entry?.document ?? null;
  }

  private async createSnapshot(signal: AbortSignal): Promise<Snapshot> {
    const urls = await this.discoverUrls(signal);
    const pages: IndexedPage[] = [];
    let totalPageBytes = 0;
    for (const url of urls) {
      signal.throwIfAborted();
      const response = await this.fetchResource(url, signal);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Public page fetch failed with status ${response.status}.`,
        );
      }
      if (!isHtml(response.contentType)) {
        throw new Error(
          `Unsupported public page media type: ${response.contentType}`,
        );
      }
      const bodyBytes = Buffer.byteLength(response.body, "utf8");
      if (bodyBytes > MAX_PAGE_BYTES) {
        throw new Error("Public page exceeds the configured size limit.");
      }
      totalPageBytes += bodyBytes;
      if (totalPageBytes > MAX_TOTAL_PAGE_BYTES) {
        throw new Error("Public site exceeds the total indexing size limit.");
      }
      const revision = createHash("sha256").update(response.body).digest("hex");
      const resourceId = createHash("sha256").update(url).digest("hex");
      const resource: SourceResource = {
        sourceId: this.id,
        resourceId,
        revision,
        canonicalUrl: url,
        language: this.language,
        mediaType: response.contentType,
      };
      pages.push({
        resource,
        document: { ...resource, body: response.body },
      });
    }

    const snapshotRevision = createHash("sha256")
      .update(
        pages
          .map(
            ({ resource }) => `${resource.canonicalUrl}\0${resource.revision}`,
          )
          .join("\n"),
      )
      .digest("hex");
    return { revision: snapshotRevision, pages };
  }

  private async discoverUrls(signal: AbortSignal): Promise<string[]> {
    const visited = new Set<string>();
    const pages = new Set<string>();
    const pending = [this.sitemapUrl];
    let totalSitemapBytes = 0;
    while (pending.length > 0) {
      signal.throwIfAborted();
      const sitemapUrl = pending.shift()!;
      if (visited.has(sitemapUrl)) continue;
      visited.add(sitemapUrl);
      if (visited.size > 20) {
        throw new Error("Public site contains too many sitemap files.");
      }
      const response = await this.fetchResource(sitemapUrl, signal);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Public sitemap fetch failed with status ${response.status}.`,
        );
      }
      if (!isXml(response.contentType)) {
        throw new Error("Public sitemap must use an XML media type.");
      }
      const sitemapBytes = Buffer.byteLength(response.body, "utf8");
      if (sitemapBytes > MAX_SITEMAP_BYTES) {
        throw new Error("Public sitemap exceeds the configured size limit.");
      }
      totalSitemapBytes += sitemapBytes;
      if (totalSitemapBytes > MAX_TOTAL_SITEMAP_BYTES) {
        throw new Error("Public site exceeds the total sitemap size limit.");
      }
      if (/<!DOCTYPE|<!ENTITY/iu.test(response.body)) {
        throw new Error("Public sitemap must not declare XML entities.");
      }

      const { document } = parseHTML(response.body);
      const root = document.documentElement?.localName.toLowerCase();
      if (root === "sitemapindex") {
        for (const location of locations(document, "sitemap")) {
          pending.push(this.approveUrl(location));
        }
      } else if (root === "urlset") {
        for (const location of locations(document, "url")) {
          pages.add(this.approveUrl(location));
          if (pages.size > MAX_RESOURCES) {
            throw new Error(
              `Public site exceeds the ${MAX_RESOURCES}-page discovery limit.`,
            );
          }
        }
      } else {
        throw new Error("Public sitemap has an unsupported XML root element.");
      }
    }
    return [...pages].sort();
  }

  private approveUrl(value: string): string {
    const normalized = validatePublicUrl(new URL(value, this.sitemapUrl).href);
    if (new URL(normalized).origin !== this.origin) {
      throw new Error(
        "Public sitemap resource is outside the approved origin.",
      );
    }
    return normalized;
  }
}

function locations(document: Document, entryName: "url" | "sitemap"): string[] {
  return [...document.querySelectorAll(`${entryName} > loc`)]
    .map((location) => location.textContent?.trim() ?? "")
    .filter(Boolean);
}

function validatePublicUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Public source URL must be an absolute HTTPS URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname.startsWith("[") ||
    isIP(url.hostname) ||
    url.hostname === "localhost" ||
    !url.hostname.includes(".")
  ) {
    throw new Error("Public source URL must be a public HTTPS URL.");
  }
  return url.href;
}

function isXml(contentType: string): boolean {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/xml" || mediaType === "text/xml";
}

function isHtml(contentType: string): boolean {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "text/html" || mediaType === "application/xhtml+xml";
}

async function fetchPublicResource(
  value: string,
  signal: AbortSignal,
): Promise<PublicResourceResponse> {
  const url = new URL(validatePublicUrl(value));
  const addresses = await dnsLookup(url.hostname, { family: 4, all: true });
  const address = addresses.find(({ address: ip }) => isPublicIPv4(ip));
  if (!address || addresses.some(({ address: ip }) => !isPublicIPv4(ip))) {
    throw new Error(
      "Public source host did not resolve only to public addresses.",
    );
  }

  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          accept: "text/html, application/xhtml+xml, application/xml, text/xml",
        },
        lookup: pinnedLookup,
        signal,
        timeout: 10_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const contentLength = Number(response.headers["content-length"] ?? 0);
        const maxBytes =
          url.pathname.toLowerCase().endsWith(".xml") ||
          url.pathname.toLowerCase().includes("sitemap")
            ? MAX_SITEMAP_BYTES
            : MAX_PAGE_BYTES;
        if (contentLength > maxBytes) {
          response.destroy(
            new Error("Public source response exceeds its size limit."),
          );
          return;
        }
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.byteLength;
          if (size > maxBytes) {
            response.destroy(
              new Error("Public source response exceeds its size limit."),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on("error", reject);
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            contentType: response.headers["content-type"] ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("Public source request timed out.")),
    );
    request.on("error", reject);
    request.end();
  });
}

function isPublicIPv4(value: string): boolean {
  const octets = value.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second, third] = octets;
  if (first === undefined || second === undefined || third === undefined) {
    return false;
  }
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0 && third === 113)
  );
}
