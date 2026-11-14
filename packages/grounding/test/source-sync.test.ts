import { afterEach, describe, expect, it, vi } from "vitest";
import { toPassages } from "../src/ingest.js";
import {
  processTextDocument,
  reconcileSourceChanges,
  SourceSyncManager,
  synchronizeSource,
  synchronizeSourceChanges,
} from "../src/sync.js";
import type {
  ContentSource,
  HostAuth,
  PassageRecord,
  SourceDocument,
  SourceResource,
  SourceSyncStore,
} from "../src/sync.js";

interface Generation {
  id: string;
  mode: "full" | "incremental";
  resources: Map<
    string,
    { document: SourceDocument; passages: PassageRecord[] }
  >;
  published: boolean;
  metadata?: {
    snapshotRevision?: string;
    cursor?: string;
    discovered: number;
    indexed: number;
    removed: number;
  };
}

class MemorySyncStore implements SourceSyncStore {
  readonly generations: Generation[] = [];
  readonly active = new Map<string, Generation>();
  private nextId = 0;

  async beginGeneration(
    sourceId: string,
    mode: Generation["mode"],
  ): Promise<string> {
    const generation: Generation = {
      id: `generation-${++this.nextId}`,
      mode,
      resources:
        mode === "incremental"
          ? new Map(this.active.get(sourceId)?.resources)
          : new Map(),
      published: false,
    };
    this.generations.push(generation);
    return generation.id;
  }

  async getCursor(sourceId: string): Promise<string | undefined> {
    return this.active.get(sourceId)?.metadata?.cursor;
  }

  async hasActiveGeneration(sourceId: string): Promise<boolean> {
    return this.active.has(sourceId);
  }

  async stageResource(
    generationId: string,
    document: SourceDocument,
    passages: PassageRecord[],
  ): Promise<void> {
    this.get(generationId).resources.set(document.resourceId, {
      document,
      passages,
    });
  }

  async removeResource(
    generationId: string,
    resourceId: string,
  ): Promise<void> {
    this.get(generationId).resources.delete(resourceId);
  }

  async publishGeneration(
    generationId: string,
    metadata: NonNullable<Generation["metadata"]>,
  ): Promise<{ removed: number }> {
    const generation = this.get(generationId);
    const previous = this.active.get("course");
    const removed = [...(previous?.resources.keys() ?? [])].filter(
      (resourceId) => !generation.resources.has(resourceId),
    ).length;
    generation.metadata = metadata;
    generation.published = true;
    this.active.set("course", generation);
    return { removed };
  }

  async abortGeneration(generationId: string): Promise<void> {
    this.get(generationId).published = false;
  }

  private get(id: string): Generation {
    const generation = this.generations.find((item) => item.id === id);
    if (!generation) throw new Error("Unknown generation.");
    return generation;
  }
}

const resource = (resourceId: string): SourceResource => ({
  sourceId: "course",
  resourceId,
  revision: "revision-1",
  canonicalUrl: `https://learn.example/${resourceId}`,
  mediaType: "text/markdown",
  language: "en",
});

function document(
  item: SourceResource,
  body = `# ${item.resourceId}\n\n## Lesson\n\nCurrent source text.`,
): SourceDocument {
  return { ...item, body };
}

function extract(item: SourceDocument): PassageRecord[] {
  if (typeof item.body !== "string") {
    throw new Error("This test source only supplies text documents.");
  }
  return toPassages({
    lessonId: item.resourceId,
    content: item.body,
    format: "markdown",
    baseUrl: "https://learn.example/lessons/",
    canonicalUrl: item.canonicalUrl,
    lang: item.language ?? "en",
  });
}

function source(options: {
  resources: SourceResource[];
  documents: Map<string, SourceDocument>;
  failFetch?: string;
}): ContentSource {
  return {
    id: "course",
    auth: allowRead,
    list: async ({ cursor }) => ({
      resources: cursor ? [] : options.resources,
      snapshotRevision: "snapshot-1",
    }),
    fetch: async (resourceId) => {
      if (resourceId === options.failFetch)
        throw new Error("source unavailable");
      return options.documents.get(resourceId) ?? null;
    },
  };
}

const allowRead: HostAuth = {
  authorize: async () => {},
};

afterEach(() => {
  vi.useRealTimers();
});

describe("dynamic source synchronization", () => {
  it("discovers, fetches, indexes, and atomically publishes a full source", async () => {
    const first = resource("study-plan");
    const second = resource("accessibility");
    const documents = new Map([
      [first.resourceId, document(first)],
      [second.resourceId, document(second)],
    ]);
    const store = new MemorySyncStore();

    const result = await synchronizeSource(
      source({ resources: [first, second], documents }),
      store,
      extract,
      new AbortController().signal,
    );

    expect(result).toEqual({ discovered: 2, indexed: 2, removed: 0 });
    expect(store.active.get("course")?.resources.size).toBe(2);
    expect(store.active.get("course")?.published).toBe(true);
  });

  it("removes resources absent from a successful full reconciliation", async () => {
    const existing = resource("old-lesson");
    const store = new MemorySyncStore();
    await synchronizeSource(
      source({
        resources: [existing],
        documents: new Map([[existing.resourceId, document(existing)]]),
      }),
      store,
      extract,
      new AbortController().signal,
    );

    const current = resource("current-lesson");
    await synchronizeSource(
      source({
        resources: [current],
        documents: new Map([[current.resourceId, document(current)]]),
      }),
      store,
      extract,
      new AbortController().signal,
    );

    expect([...store.active.get("course")!.resources.keys()]).toEqual([
      "current-lesson",
    ]);
  });

  it("leaves the prior published generation active when fetching fails", async () => {
    const existing = resource("existing-lesson");
    const store = new MemorySyncStore();
    await synchronizeSource(
      source({
        resources: [existing],
        documents: new Map([[existing.resourceId, document(existing)]]),
      }),
      store,
      extract,
      new AbortController().signal,
    );
    const activeBefore = store.active.get("course");
    const missing = resource("new-lesson");

    await expect(
      synchronizeSource(
        source({
          resources: [missing],
          documents: new Map(),
          failFetch: missing.resourceId,
        }),
        store,
        () => [],
        new AbortController().signal,
      ),
    ).rejects.toThrow("source unavailable");

    expect(store.active.get("course")).toBe(activeBefore);
    expect(store.generations.at(-1)?.published).toBe(false);
  });

  it("rejects a document revision that differs from the full-list snapshot", async () => {
    const listed = resource("changing-lesson");
    const stale = document({ ...listed, revision: "revision-2" });
    const store = new MemorySyncStore();

    await expect(
      synchronizeSource(
        source({
          resources: [listed],
          documents: new Map([[listed.resourceId, stale]]),
        }),
        store,
        extract,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Resource changed during snapshot");

    expect(store.active.has("course")).toBe(false);
    expect(store.generations.at(-1)?.published).toBe(false);
  });

  it("persists the latest change cursor after reconciling all pages", async () => {
    const updated = resource("study-plan");
    const store = new MemorySyncStore();
    const cursorCalls: (string | undefined)[] = [];
    const sourceAdapter: ContentSource = {
      id: "course",
      auth: allowRead,
      list: async () => ({ resources: [], snapshotRevision: "snapshot-1" }),
      listChanges: async ({ cursor }) => {
        cursorCalls.push(cursor);
        return cursor
          ? {
              changes: [
                {
                  resourceId: updated.resourceId,
                  revision: "revision-2",
                  operation: "upsert",
                },
              ],
            }
          : { changes: [], nextCursor: "change-cursor-1" };
      },
      fetch: async () => document({ ...updated, revision: "revision-2" }),
    };

    await synchronizeSource(
      sourceAdapter,
      store,
      extract,
      new AbortController().signal,
    );
    const result = await reconcileSourceChanges(
      sourceAdapter,
      store,
      extract,
      new AbortController().signal,
    );

    expect(result).toEqual({ changed: 1, indexed: 1, removed: 0 });
    expect(cursorCalls).toEqual([undefined, "change-cursor-1"]);
    expect(store.generations.at(-1)?.metadata?.cursor).toBe("change-cursor-1");

    await reconcileSourceChanges(
      sourceAdapter,
      store,
      extract,
      new AbortController().signal,
    );
    expect(cursorCalls[2]).toBe("change-cursor-1");
  });

  it("performs an initial full discovery before using a change stream", async () => {
    const item = resource("initial-lesson");
    const store = new MemorySyncStore();
    let changeCalls = 0;
    const sourceAdapter: ContentSource = {
      id: "course",
      auth: allowRead,
      list: async () => ({
        resources: [item],
        snapshotRevision: "snapshot-1",
      }),
      listChanges: async () => {
        changeCalls += 1;
        return { changes: [] };
      },
      fetch: async () => document(item),
    };

    await reconcileSourceChanges(
      sourceAdapter,
      store,
      extract,
      new AbortController().signal,
    );

    expect(store.active.get("course")?.resources.has(item.resourceId)).toBe(
      true,
    );
    expect(changeCalls).toBe(0);

    await reconcileSourceChanges(
      sourceAdapter,
      store,
      extract,
      new AbortController().signal,
    );

    expect(changeCalls).toBe(1);
  });

  it("runs initial synchronization and periodic reconciliation for host sources", async () => {
    vi.useFakeTimers();
    const item = resource("host-course");
    const store = new MemorySyncStore();
    let listCalls = 0;
    let changeCalls = 0;
    const sourceAdapter: ContentSource = {
      id: "course",
      auth: allowRead,
      list: async () => {
        listCalls += 1;
        return {
          resources: [item],
          snapshotRevision: "snapshot-1",
        };
      },
      listChanges: async () => {
        changeCalls += 1;
        return { changes: [] };
      },
      fetch: async () => document(item),
    };
    const errors: unknown[] = [];
    const manager = new SourceSyncManager({
      sources: [sourceAdapter],
      store,
      process: extract,
      intervalMs: 1000,
      onError: (_sourceId, error) => errors.push(error),
    });

    await manager.start();
    expect(listCalls).toBe(1);
    expect(store.active.get("course")?.resources.has(item.resourceId)).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(changeCalls).toBe(1);
    expect(errors).toEqual([]);
    await manager.stop();
  });

  it("reports failed initial synchronization to the host error handler", async () => {
    const store = new MemorySyncStore();
    const failure = new Error("host source unavailable");
    const errors: unknown[] = [];
    const manager = new SourceSyncManager({
      sources: [
        {
          id: "course",
          auth: allowRead,
          list: async () => {
            throw failure;
          },
          fetch: async () => null,
        },
      ],
      store,
      process: extract,
      intervalMs: 60_000,
      onError: (_sourceId, error) => errors.push(error),
    });

    await manager.start();

    expect(errors).toEqual([failure]);
    expect(store.active.has("course")).toBe(false);
    await manager.stop();
  });

  it("refreshes authoritative content through the host notification hook", async () => {
    const updated = resource("study-plan");
    const store = new MemorySyncStore();
    await synchronizeSource(
      source({
        resources: [updated],
        documents: new Map([[updated.resourceId, document(updated)]]),
      }),
      store,
      extract,
      new AbortController().signal,
    );
    const authorized: string[] = [];
    const manager = new SourceSyncManager({
      sources: [
        {
          id: "course",
          auth: {
            authorize: async (_sourceId, operation) => {
              authorized.push(operation);
            },
          },
          list: async () => ({ resources: [], snapshotRevision: "snapshot-1" }),
          fetch: async () =>
            document(
              { ...updated, revision: "revision-2" },
              "# Study plan\n\n## Updated\n\nAuthoritative host content.",
            ),
        },
      ],
      store,
      process: extract,
      intervalMs: 60_000,
      onError: (_sourceId, error) => {
        throw error;
      },
    });

    const result = await manager.notify("course", [
      {
        resourceId: updated.resourceId,
        revision: "hint-1",
        operation: "upsert",
      },
    ]);

    expect(result).toEqual({ changed: 1, indexed: 1, removed: 0 });
    expect(authorized).toContain("discover");
    expect(
      store.active.get("course")?.resources.get(updated.resourceId)?.document
        .body,
    ).toContain("Authoritative host content.");
    await manager.stop();
  });

  it("treats change events as hints and fetches canonical source content", async () => {
    const updated = resource("study-plan");
    const sourceAdapter: ContentSource = {
      id: "course",
      auth: allowRead,
      list: async () => ({ resources: [] }),
      fetch: async (resourceId) =>
        resourceId === updated.resourceId
          ? document(
              updated,
              "# Study plan\n\n## Updated\n\nAuthoritative text.",
            )
          : null,
    };
    const store = new MemorySyncStore();
    const deleted = resource("deleted-lesson");
    await synchronizeSource(
      source({
        resources: [updated, deleted],
        documents: new Map([
          [updated.resourceId, document(updated)],
          [deleted.resourceId, document(deleted)],
        ]),
      }),
      store,
      extract,
      new AbortController().signal,
    );

    const result = await synchronizeSourceChanges(
      sourceAdapter,
      store,
      [
        {
          resourceId: updated.resourceId,
          revision: "hint-1",
          operation: "upsert",
        },
        {
          resourceId: updated.resourceId,
          revision: "hint-1",
          operation: "upsert",
        },
        {
          resourceId: "deleted-lesson",
          revision: "hint-2",
          operation: "delete",
        },
      ],
      extract,
      new AbortController().signal,
    );

    expect(result).toEqual({ changed: 2, indexed: 1, removed: 1 });
    expect(
      store.active.get("course")?.resources.get(updated.resourceId)?.document
        .body,
    ).toContain("Authoritative text");
  });

  it("authorizes a source before beginning a sync or reading content", async () => {
    let listed = false;
    const sourceAdapter: ContentSource = {
      id: "course",
      auth: {
        authorize: async () => {
          throw new Error("source access denied");
        },
      },
      list: async () => {
        listed = true;
        return { resources: [], snapshotRevision: "snapshot-1" };
      },
      fetch: async () => null,
    };
    const store = new MemorySyncStore();

    await expect(
      synchronizeSource(
        sourceAdapter,
        store,
        extract,
        new AbortController().signal,
      ),
    ).rejects.toThrow("source access denied");

    expect(listed).toBe(false);
    expect(store.generations).toHaveLength(0);
  });

  it("validates source-manager configuration and lifecycle", async () => {
    const adapter = source({
      resources: [],
      documents: new Map(),
    });
    const createManager = (sources: ContentSource[], intervalMs = 1000) =>
      new SourceSyncManager({
        sources,
        store: new MemorySyncStore(),
        process: extract,
        intervalMs,
        onError: () => undefined,
      });

    expect(() => createManager([adapter], 0)).toThrow(
      "interval must be a positive number",
    );
    expect(() => createManager([{ ...adapter, id: " " }])).toThrow(
      "Source IDs must be non-empty and unique",
    );
    expect(() => createManager([adapter, adapter])).toThrow(
      "Source IDs must be non-empty and unique",
    );

    const manager = createManager([adapter]);
    await manager.start();
    expect(() => manager.start()).toThrow("cannot be started");
    expect(() => manager.reconcile("unknown")).toThrow(
      "Unknown content source",
    );
    await manager.stop();
    await manager.stop();
    expect(() => manager.start()).toThrow("cannot be started");
    await expect(manager.reconcile("course")).rejects.toThrow("stopped");
    await manager.reconcileAll();
  });

  it("processes only declared, supported text formats", () => {
    const markdown = {
      ...resource("document"),
      body: "# Document\n\n## Section\n\nA complete lesson.",
    };
    expect(processTextDocument(markdown)[0]?.text).toBe("A complete lesson.");
    expect(
      processTextDocument({
        ...markdown,
        mediaType: "text/x-markdown; charset=utf-8",
      })[0]?.url,
    ).toBe(`${markdown.canonicalUrl}#section`);

    expect(() =>
      processTextDocument({ ...markdown, body: new Uint8Array([1, 2]) }),
    ).toThrow("requires a binary extractor");
    expect(() => processTextDocument({ ...markdown, language: " " })).toThrow(
      "has no declared language",
    );
    expect(() =>
      processTextDocument({ ...markdown, mediaType: "application/pdf" }),
    ).toThrow("Unsupported source media type");
    expect(
      processTextDocument({
        ...markdown,
        mediaType: "application/xhtml+xml",
        body: '<h1>Document</h1><h2 id="section">Section</h2><p>Text.</p>',
      }),
    ).toHaveLength(1);
  });

  it("paginates a stable snapshot and fetches duplicate resources once", async () => {
    const first = resource("first");
    const second = resource("second");
    const pages: { cursor?: string; snapshotRevision?: string }[] = [];
    const fetches: string[] = [];
    const adapter: ContentSource = {
      id: "course",
      auth: allowRead,
      list: async (input) => {
        pages.push(input);
        return input.cursor
          ? {
              resources: [first, second],
              snapshotRevision: "snapshot-1",
            }
          : {
              resources: [first],
              nextCursor: "page-2",
              snapshotRevision: "snapshot-1",
            };
      },
      fetch: async (resourceId) => {
        fetches.push(resourceId);
        return document(resourceId === first.resourceId ? first : second);
      },
    };
    const store = new MemorySyncStore();

    await expect(
      synchronizeSource(adapter, store, extract, new AbortController().signal),
    ).resolves.toEqual({ discovered: 2, indexed: 2, removed: 0 });
    expect(pages).toEqual([
      {},
      { cursor: "page-2", snapshotRevision: "snapshot-1" },
    ]);
    expect(fetches).toEqual(["first", "second"]);
  });

  it("rejects empty or changing snapshots and repeated pagination cursors", async () => {
    const item = resource("lesson");
    const store = new MemorySyncStore();
    const signal = new AbortController().signal;
    const make = (list: ContentSource["list"]): ContentSource => ({
      id: "course",
      auth: allowRead,
      list,
      fetch: async () => document(item),
    });

    await expect(
      synchronizeSource(
        make(async () => ({ resources: [], snapshotRevision: " " })),
        store,
        extract,
        signal,
      ),
    ).rejects.toThrow("did not provide a snapshot revision");
    await expect(
      synchronizeSource(
        make(async ({ cursor }) => ({
          resources: [],
          snapshotRevision: cursor ? "snapshot-2" : "snapshot-1",
          ...(cursor ? {} : { nextCursor: "next" }),
        })),
        store,
        extract,
        signal,
      ),
    ).rejects.toThrow("snapshot changed during pagination");
    await expect(
      synchronizeSource(
        make(async () => ({
          resources: [],
          snapshotRevision: "snapshot-1",
          nextCursor: "repeat",
        })),
        store,
        extract,
        signal,
      ),
    ).rejects.toThrow("repeated a pagination cursor");
  });

  it("removes resources that disappear before fetch and rejects identity mismatches", async () => {
    const item = resource("lesson");
    const store = new MemorySyncStore();
    const noDocument: ContentSource = {
      id: "course",
      auth: allowRead,
      list: async () => ({
        resources: [item],
        snapshotRevision: "snapshot-1",
      }),
      fetch: async () => null,
    };
    await expect(
      synchronizeSource(
        noDocument,
        store,
        extract,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ discovered: 1, indexed: 0, removed: 0 });
    expect(store.active.get("course")?.resources).toHaveProperty("size", 0);

    const mismatchedResource: ContentSource = {
      ...noDocument,
      list: async () => ({
        resources: [{ ...item, sourceId: "another-source" }],
        snapshotRevision: "snapshot-1",
      }),
    };
    await expect(
      synchronizeSource(
        mismatchedResource,
        new MemorySyncStore(),
        extract,
        new AbortController().signal,
      ),
    ).rejects.toThrow("invalid identity");

    const mismatchedDocument: ContentSource = {
      ...noDocument,
      fetch: async () => document({ ...item, resourceId: "another-resource" }),
    };
    await expect(
      synchronizeSource(
        mismatchedDocument,
        new MemorySyncStore(),
        extract,
        new AbortController().signal,
      ),
    ).rejects.toThrow("mismatched resource");
  });

  it("preserves both sync and rollback errors if a generation cannot abort", async () => {
    class FailedAbortStore extends MemorySyncStore {
      override async abortGeneration(): Promise<void> {
        throw new Error("rollback failed");
      }
    }

    const store = new FailedAbortStore();
    const adapter: ContentSource = {
      id: "course",
      auth: allowRead,
      list: async () => {
        throw new Error("discovery failed");
      },
      fetch: async () => null,
    };
    let caught: unknown;
    try {
      await synchronizeSource(
        adapter,
        store,
        extract,
        new AbortController().signal,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    if (!(caught instanceof AggregateError)) {
      throw new Error("Expected source sync to retain both failures.");
    }
    expect(caught.errors).toEqual([
      new Error("discovery failed"),
      new Error("rollback failed"),
    ]);
  });
});
