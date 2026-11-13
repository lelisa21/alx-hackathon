import type { ContentFormat, PassageRecord } from "./ingest.js";
import { toPassages } from "./ingest.js";

export interface SourceResource {
  sourceId: string;
  resourceId: string;
  revision: string;
  canonicalUrl: string;
  language?: string;
  mediaType: string;
  title?: string;
  relations?: { type: string; targetResourceId: string }[];
}

export interface SourcePage {
  resources: SourceResource[];
  nextCursor?: string;
  snapshotRevision: string;
}

export interface SourceChange {
  resourceId: string;
  revision: string;
  operation: "upsert" | "delete";
}

export interface SourceDocument extends SourceResource {
  body: string | Uint8Array;
}

export interface HostAuth {
  authorize(
    sourceId: string,
    operation: "discover" | "read",
    signal: AbortSignal,
  ): Promise<void>;
}

export interface ContentSource {
  id: string;
  auth: HostAuth;
  list(
    input: { cursor?: string; snapshotRevision?: string },
    signal: AbortSignal,
  ): Promise<SourcePage>;
  fetch(
    resourceId: string,
    signal: AbortSignal,
  ): Promise<SourceDocument | null>;
  listChanges?(
    input: { cursor?: string },
    signal: AbortSignal,
  ): Promise<{ changes: SourceChange[]; nextCursor?: string }>;
}

export interface SourceSyncStore {
  getCursor(sourceId: string): Promise<string | undefined>;
  hasActiveGeneration(sourceId: string): Promise<boolean>;
  beginGeneration(
    sourceId: string,
    mode: "full" | "incremental",
  ): Promise<string>;
  stageResource(
    generationId: string,
    document: SourceDocument,
    passages: PassageRecord[],
  ): Promise<void>;
  removeResource(generationId: string, resourceId: string): Promise<void>;
  publishGeneration(
    generationId: string,
    metadata: {
      snapshotRevision?: string;
      cursor?: string;
      discovered: number;
      indexed: number;
      removed: number;
    },
  ): Promise<{ removed: number }>;
  abortGeneration(generationId: string): Promise<void>;
}

export interface SyncResult {
  discovered?: number;
  changed?: number;
  indexed: number;
  removed: number;
}

export type SourceDocumentProcessor = (
  document: SourceDocument,
) => PassageRecord[];

export interface SourceSyncManagerOptions {
  sources: readonly ContentSource[];
  store: SourceSyncStore;
  process: SourceDocumentProcessor;
  intervalMs: number;
  onError: (sourceId: string, error: unknown) => void;
}

export class SourceSyncManager {
  private readonly sources: Map<string, ContentSource>;
  private readonly store: SourceSyncStore;
  private readonly process: SourceDocumentProcessor;
  private readonly intervalMs: number;
  private readonly onError: SourceSyncManagerOptions["onError"];
  private readonly pending = new Map<string, Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(options: SourceSyncManagerOptions) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new Error("Source sync interval must be a positive number.");
    }

    this.sources = new Map();
    for (const source of options.sources) {
      if (!source.id.trim() || this.sources.has(source.id)) {
        throw new Error("Source IDs must be non-empty and unique.");
      }
      this.sources.set(source.id, source);
    }
    this.store = options.store;
    this.process = options.process;
    this.intervalMs = options.intervalMs;
    this.onError = options.onError;
  }

  start(): Promise<void> {
    if (this.timer !== undefined || this.stopped) {
      throw new Error(
        "Source sync manager cannot be started in its current state.",
      );
    }
    this.timer = setInterval(() => {
      void this.reconcileAll();
    }, this.intervalMs);
    return this.reconcileAll();
  }

  async reconcileAll(): Promise<void> {
    if (this.stopped) return;
    await Promise.all(
      [...this.sources.keys()].map(async (sourceId) => {
        if (this.pending.has(sourceId)) return;
        try {
          await this.reconcile(sourceId);
        } catch (error) {
          this.onError(sourceId, error);
        }
      }),
    );
  }

  reconcile(sourceId: string): Promise<SyncResult> {
    return this.enqueue(sourceId, (source, signal) =>
      reconcileSourceChanges(source, this.store, this.process, signal),
    );
  }

  notify(
    sourceId: string,
    changes: readonly SourceChange[],
  ): Promise<SyncResult> {
    const snapshot = changes.map((change) => ({ ...change }));
    return this.enqueue(sourceId, (source, signal) =>
      synchronizeSourceChanges(
        source,
        this.store,
        snapshot,
        this.process,
        signal,
      ),
    );
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
    await Promise.all(this.pending.values());
  }

  private enqueue(
    sourceId: string,
    task: (source: ContentSource, signal: AbortSignal) => Promise<SyncResult>,
  ): Promise<SyncResult> {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`Unknown content source: ${sourceId}`);

    const previous = this.pending.get(sourceId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      if (this.stopped) throw new Error("Source sync manager is stopped.");
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        return await task(source, controller.signal);
      } finally {
        this.controllers.delete(controller);
      }
    });
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.pending.set(sourceId, settled);
    void settled.then(() => {
      if (this.pending.get(sourceId) === settled) {
        this.pending.delete(sourceId);
      }
    });
    return operation;
  }
}

export function processTextDocument(
  document: SourceDocument,
  baseUrl = document.canonicalUrl,
): PassageRecord[] {
  const format = formatForMediaType(document.mediaType);
  if (typeof document.body !== "string") {
    throw new Error(
      `Source document ${document.resourceId} requires a binary extractor.`,
    );
  }
  if (!document.language?.trim()) {
    throw new Error(
      `Source document ${document.resourceId} has no declared language.`,
    );
  }
  return toPassages({
    lessonId: document.resourceId,
    content: document.body,
    format,
    baseUrl,
    canonicalUrl: document.canonicalUrl,
    lang: document.language,
  });
}

export async function synchronizeSource(
  source: ContentSource,
  store: SourceSyncStore,
  process: SourceDocumentProcessor,
  signal: AbortSignal,
): Promise<SyncResult> {
  await source.auth.authorize(source.id, "discover", signal);
  const generationId = await store.beginGeneration(source.id, "full");
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let snapshotRevision: string | undefined;
  let indexed = 0;

  try {
    do {
      signal.throwIfAborted();
      await source.auth.authorize(source.id, "discover", signal);
      const page = await source.list(
        {
          ...(cursor === undefined ? {} : { cursor }),
          ...(snapshotRevision === undefined ? {} : { snapshotRevision }),
        },
        signal,
      );
      if (!page.snapshotRevision.trim()) {
        throw new Error("Source did not provide a snapshot revision.");
      }
      if (
        snapshotRevision !== undefined &&
        page.snapshotRevision !== snapshotRevision
      ) {
        throw new Error("Source snapshot changed during pagination.");
      }
      snapshotRevision ??= page.snapshotRevision;

      for (const resource of page.resources) {
        signal.throwIfAborted();
        assertResource(source.id, resource);
        if (seen.has(resource.resourceId)) continue;
        seen.add(resource.resourceId);
        await source.auth.authorize(source.id, "read", signal);
        const document = await source.fetch(resource.resourceId, signal);
        if (!document) {
          await store.removeResource(generationId, resource.resourceId);
          continue;
        }
        assertDocument(source.id, resource.resourceId, document);
        if (document.revision !== resource.revision) {
          throw new Error("Resource changed during snapshot.");
        }
        const passages = process(document);
        await store.stageResource(generationId, document, passages);
        indexed += 1;
      }

      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (cursors.has(cursor)) {
          throw new Error("Source repeated a pagination cursor.");
        }
        cursors.add(cursor);
      }
    } while (cursor !== undefined);

    const published = await store.publishGeneration(generationId, {
      snapshotRevision: snapshotRevision!,
      discovered: seen.size,
      indexed,
      removed: 0,
    });
    return { discovered: seen.size, indexed, removed: published.removed };
  } catch (error) {
    return await abortGeneration(store, generationId, error);
  }
}

export async function synchronizeSourceChanges(
  source: ContentSource,
  store: SourceSyncStore,
  changes: SourceChange[],
  process: SourceDocumentProcessor,
  signal: AbortSignal,
  cursor?: string,
): Promise<SyncResult> {
  await source.auth.authorize(source.id, "discover", signal);
  await source.auth.authorize(source.id, "read", signal);
  const generationId = await store.beginGeneration(source.id, "incremental");
  const resourceIds = new Set(changes.map(({ resourceId }) => resourceId));
  let indexed = 0;
  let removed = 0;

  try {
    for (const resourceId of resourceIds) {
      signal.throwIfAborted();
      await source.auth.authorize(source.id, "read", signal);
      const document = await source.fetch(resourceId, signal);
      if (!document) {
        await store.removeResource(generationId, resourceId);
        removed += 1;
        continue;
      }
      assertDocument(source.id, resourceId, document);
      const passages = process(document);
      await store.stageResource(generationId, document, passages);
      indexed += 1;
    }

    const published = await store.publishGeneration(generationId, {
      ...(cursor === undefined ? {} : { cursor }),
      discovered: resourceIds.size,
      indexed,
      removed,
    });
    return {
      changed: resourceIds.size,
      indexed,
      removed: published.removed,
    };
  } catch (error) {
    return await abortGeneration(store, generationId, error);
  }
}

export async function reconcileSourceChanges(
  source: ContentSource,
  store: SourceSyncStore,
  process: SourceDocumentProcessor,
  signal: AbortSignal,
): Promise<SyncResult> {
  if (!(await store.hasActiveGeneration(source.id))) {
    return synchronizeSource(source, store, process, signal);
  }
  if (!source.listChanges) {
    return synchronizeSource(source, store, process, signal);
  }

  let cursor = await store.getCursor(source.id);
  let latestCursor = cursor;
  const cursors = new Set<string>();
  const changes = new Map<string, SourceChange>();
  do {
    signal.throwIfAborted();
    await source.auth.authorize(source.id, "discover", signal);
    const page = await source.listChanges(
      cursor === undefined ? {} : { cursor },
      signal,
    );
    for (const change of page.changes) changes.set(change.resourceId, change);
    if (page.nextCursor !== undefined) {
      cursor = page.nextCursor;
      latestCursor = cursor;
      if (cursors.has(page.nextCursor)) {
        throw new Error("Source repeated a change cursor.");
      }
      cursors.add(page.nextCursor);
    } else {
      cursor = undefined;
    }
  } while (cursor !== undefined);

  const result = await synchronizeSourceChanges(
    source,
    store,
    [...changes.values()],
    process,
    signal,
    latestCursor,
  );
  return { ...result, changed: changes.size };
}

async function abortGeneration(
  store: SourceSyncStore,
  generationId: string,
  error: unknown,
): Promise<never> {
  try {
    await store.abortGeneration(generationId);
  } catch (abortError) {
    throw new AggregateError(
      [error, abortError],
      "Source sync failed and its staged generation could not be aborted.",
      { cause: abortError },
    );
  }
  throw error;
}

function assertResource(sourceId: string, resource: SourceResource): void {
  if (
    resource.sourceId !== sourceId ||
    !resource.resourceId.trim() ||
    !resource.revision.trim()
  ) {
    throw new Error("Source returned a resource with invalid identity.");
  }
}

function assertDocument(
  sourceId: string,
  resourceId: string,
  document: SourceDocument,
): void {
  if (
    document.sourceId !== sourceId ||
    document.resourceId !== resourceId ||
    !document.revision.trim()
  ) {
    throw new Error("Source fetch returned a mismatched resource.");
  }
}

function formatForMediaType(mediaType: string): ContentFormat {
  const normalized = mediaType.split(";")[0]?.trim().toLowerCase();
  if (normalized === "text/markdown" || normalized === "text/x-markdown") {
    return "markdown";
  }
  if (normalized === "text/html" || normalized === "application/xhtml+xml") {
    return "html";
  }
  throw new Error(`Unsupported source media type: ${mediaType}`);
}
