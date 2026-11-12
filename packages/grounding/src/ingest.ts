import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { textGrams } from "./grams.js";
import { normalise } from "./normalise.js";

export type ContentFormat = "markdown" | "html";

export interface ContentDocument {
  lessonId: string;
  content: string;
  format: ContentFormat;
  baseUrl: string;
  canonicalUrl?: string;
  lang: string;
}

export interface ContentChunk {
  section: string;
  anchor: string;
  text: string;
}

export interface PassageRecord {
  id: string;
  lessonId: string;
  lessonTitle: string;
  sectionTitle: string;
  anchor: string;
  url: string;
  lang: string;
  sourceType: "course" | "job";
  text: string;
  textNorm: string;
  grams: string[];
}

function slug(value: string): string {
  return (
    value
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "section"
  );
}

function uniqueAnchor(value: string, counts: Map<string, number>): string {
  const base = slug(value);
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function uniqueExplicitAnchor(
  value: string,
  counts: Map<string, number>,
): string {
  const base = value.trim() || "section";
  if (counts.has(base)) {
    throw new Error(`Duplicate HTML heading id: ${base}`);
  }
  counts.set(base, 1);
  return base;
}

function chunkWords(
  section: string,
  anchor: string,
  words: string[],
): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  for (let index = 0; index < words.length; index += 300) {
    const text = words.slice(index, index + 300).join(" ");
    if (text) chunks.push({ section, anchor, text });
  }
  return chunks;
}

function markdownParts(markdown: string): {
  lessonTitle: string;
  chunks: ContentChunk[];
} {
  const chunks: ContentChunk[] = [];
  const anchors = new Map<string, number>();
  const fence = /^\s*(```+|~~~+)/u;
  const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u;
  let lessonTitle = "";
  let section = "Introduction";
  let anchor = uniqueAnchor(section, anchors);
  let words: string[] = [];
  let fenced = false;
  let hasSourceAnchor = false;

  const flush = () => {
    if (words.length > 0 && !hasSourceAnchor) {
      throw new Error(
        `Markdown lesson section "${section}" needs a heading for citations.`,
      );
    }
    chunks.push(...chunkWords(section, anchor, words));
    words = [];
  };

  for (const rawLine of markdown.split(/\r?\n/u)) {
    if (fence.test(rawLine)) {
      fenced = !fenced;
      continue;
    }

    const match = fenced ? null : heading.exec(rawLine.trim());
    if (match) {
      flush();
      const title = match[2]?.trim();
      if (!title) continue;
      if (match[1] === "#" && !lessonTitle) lessonTitle = title;
      section = title;
      anchor = uniqueAnchor(section, anchors);
      hasSourceAnchor = true;
      continue;
    }

    const line = rawLine
      .trim()
      .replace(/^>\s?/u, "")
      .replace(/^[-*+]\s+/u, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
      .replace(/[`*_~]/gu, "");
    if (line) words.push(...line.split(/\s+/u).filter(Boolean));
  }
  flush();

  return { lessonTitle, chunks };
}

function htmlParts(html: string): {
  lessonTitle: string;
  chunks: ContentChunk[];
} {
  const hasDocumentElement = /<\s*(?:html|body)\b/iu.test(html);
  const markup = hasDocumentElement
    ? html
    : `<!doctype html><html><body>${html}</body></html>`;
  const { document } = parseHTML(markup);
  const chunks: ContentChunk[] = [];
  const anchors = new Map<string, number>();
  const contentTags = new Set(["p", "li", "blockquote", "pre", "td", "th"]);
  const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
  let lessonTitle = "";
  let section = "Introduction";
  let anchor = uniqueAnchor(section, anchors);
  let hasSourceAnchor = false;
  let words: string[] = [];

  const flush = () => {
    if (words.length > 0 && !hasSourceAnchor) {
      throw new Error(
        `HTML lesson section "${section}" needs a heading id for citations.`,
      );
    }
    chunks.push(...chunkWords(section, anchor, words));
    words = [];
  };

  const nodes = document.body.querySelectorAll(
    "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th",
  );
  for (const node of nodes) {
    const tag = node.tagName.toLowerCase();
    if (contentTags.has(tag)) {
      if (node.parentElement?.closest("p,li,blockquote,pre,td,th")) continue;
      const text = node.textContent?.trim() ?? "";
      if (text) words.push(...text.split(/\s+/u));
      continue;
    }

    if (!headingTags.has(tag)) continue;
    flush();
    const title = node.textContent?.trim();
    if (!title) continue;
    if (tag === "h1" && !lessonTitle) lessonTitle = title;
    section = title;
    const explicitAnchor = node.getAttribute("id");
    if (explicitAnchor) {
      anchor = uniqueExplicitAnchor(explicitAnchor, anchors);
      hasSourceAnchor = true;
    } else {
      anchor = uniqueAnchor(title, anchors);
      hasSourceAnchor = false;
    }
  }
  flush();

  return { lessonTitle, chunks };
}

function canonicalLessonUrl(baseUrl: string, lessonId: string): URL {
  const base = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.search ||
    base.hash
  ) {
    throw new Error("DIMTS_CONTENT_BASE_URL must be an HTTP(S) directory URL.");
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(encodeURIComponent(lessonId), base);
}

function canonicalDocumentUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "A canonical source URL must be HTTP(S), without credentials, query, or fragment.",
    );
  }
  return url;
}

export function toPassages(document: ContentDocument): PassageRecord[] {
  if (
    !/^[\p{L}\p{N}._ -]+$/u.test(document.lessonId) ||
    document.lessonId === "." ||
    document.lessonId === ".."
  ) {
    throw new Error(
      "Lesson id may contain only letters, numbers, space, dot, dash, and underscore.",
    );
  }
  const parsed =
    document.format === "markdown"
      ? markdownParts(document.content)
      : htmlParts(document.content);
  const lessonTitle = parsed.lessonTitle || document.lessonId;
  const lessonUrl = document.canonicalUrl
    ? canonicalDocumentUrl(document.canonicalUrl)
    : canonicalLessonUrl(document.baseUrl, document.lessonId);

  return parsed.chunks.map((chunk, index) => {
    const url = new URL(lessonUrl);
    url.hash = encodeURIComponent(chunk.anchor);
    const textNorm = normalise(
      `${lessonTitle} ${chunk.section} ${chunk.text}`,
      document.lang,
    );
    return {
      id: `${document.lessonId}#${chunk.anchor}-${index}`,
      lessonId: document.lessonId,
      lessonTitle,
      sectionTitle: chunk.section,
      anchor: chunk.anchor,
      url: url.toString(),
      lang: document.lang,
      sourceType: "course",
      text: chunk.text,
      textNorm,
      grams: textGrams(textNorm),
    };
  });
}

export function sourceHash(
  documents: { name: string; content: string }[],
  metadata: Record<string, string> = {},
): string {
  const canonicalSource = {
    documents: [...documents].sort((a, b) => a.name.localeCompare(b.name)),
    metadata: Object.fromEntries(
      Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalSource))
    .digest("hex");
}
