import { createHash } from "node:crypto";
import type { AskRequest, Reply } from "./types.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;

export interface AnswerCache {
  get(key: string): Promise<Reply | null>;
  set(key: string, reply: Reply): Promise<void>;
}

export function createAnswerCacheKey(
  request: Pick<AskRequest, "text" | "lang" | "simple">,
  contentVersion: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        request.text
          .normalize("NFC")
          .toLowerCase()
          .trim()
          .replace(/\s+/gu, " "),
        request.lang,
        request.simple ?? false,
        contentVersion,
      ]),
    )
    .digest("hex");
}

export class InMemoryAnswerCache implements AnswerCache {
  private readonly entries = new Map<
    string,
    { reply: Reply; expiresAt: number }
  >();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    now: () => number = () => Date.now(),
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("Answer-cache TTL must be a positive number.");
    }
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("Answer-cache capacity must be a positive integer.");
    }
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  async get(key: string): Promise<Reply | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.reply);
  }

  async set(key: string, reply: Reply): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, {
      reply: structuredClone(reply),
      expiresAt: this.now() + this.ttlMs,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

const defaultCaches = new WeakMap<object, InMemoryAnswerCache>();

export function defaultAnswerCache(owner: object): InMemoryAnswerCache {
  let cache = defaultCaches.get(owner);
  if (!cache) {
    cache = new InMemoryAnswerCache();
    defaultCaches.set(owner, cache);
  }
  return cache;
}
