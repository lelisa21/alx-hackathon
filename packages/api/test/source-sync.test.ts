import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublicSitemapSource,
  type SourceDocument,
  type SourcePage,
  type SourceResource,
  type SourceSyncStore,
} from "@dimts/grounding";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import type { ApiRepository } from "../src/types.js";

const secrets = [
  Buffer.alloc(32, 1).toString("base64"),
  Buffer.alloc(32, 2).toString("base64"),
  Buffer.alloc(32, 3).toString("base64"),
];

const validEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: secrets[0],
  DIMTS_HASH_KEY: secrets[1],
  DIMTS_JWT_SECRET: secrets[2],
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
};

const repository: ApiRepository = {
  ping: async () => true,
  runRetention: async () => undefined,
  getHostByHash: async () => null,
  createSession: async () => undefined,
  resumeSession: async () => null,
  getCloudConsent: async () => null,
  getSessionTokenHash: async () => null,
  touchSession: async () => undefined,
  findReply: async () => null,
  countRecentQuestions: async () => 0,
  claimQuestion: async () => true,
  saveReply: async () => undefined,
  releaseQuestion: async () => undefined,
};

function createStore(): SourceSyncStore {
  return {
    getCursor: async () => undefined,
    hasActiveGeneration: async () => false,
    beginGeneration: vi.fn(async () => "generation-1"),
    stageResource: vi.fn(async () => undefined),
    removeResource: vi.fn(async () => undefined),
    publishGeneration: vi.fn(async () => ({ removed: 0 })),
    abortGeneration: vi.fn(async () => undefined),
  };
}

function sourceResource(sourceId: string): SourceResource {
  return {
    sourceId,
    resourceId: "lesson-1",
    revision: "revision-1",
    canonicalUrl: "https://learn.example/lesson-1",
    language: "en",
    mediaType: "text/html",
  };
}

function sourceDocument(sourceId: string): SourceDocument {
  return {
    ...sourceResource(sourceId),
    body: '<h1 id="course">Course</h1><h2 id="lesson">Lesson</h2><p>Authorized content.</p>',
  };
}

function parseWithSources(sources: unknown) {
  return parseConfig({
    ...validEnv,
    DIMTS_PUBLIC_SOURCES: JSON.stringify(sources),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API content-source runtime", () => {
  it("validates the documented public sitemap source configuration", () => {
    const sources = [
      {
        id: "course-site",
        sitemapUrl: "https://learn.example/sitemap.xml",
        language: "en",
        pageSize: 25,
      },
    ];

    expect(parseWithSources(sources).DIMTS_PUBLIC_SOURCES).toEqual(sources);
    expect(parseConfig(validEnv).DIMTS_PUBLIC_SOURCES).toEqual([]);
    expect(parseConfig(validEnv).DIMTS_SOURCE_SYNC_INTERVAL_MS).toBe(300_000);
    expect(() => parseWithSources("{not-json")).toThrow(
      /DIMTS_PUBLIC_SOURCES/u,
    );
    expect(() =>
      parseWithSources([
        { ...sources[0], sitemapUrl: "http://learn.example/sitemap.xml" },
      ]),
    ).toThrow(/HTTPS/u);
    expect(() =>
      parseWithSources([{ ...sources[0], sitemapUrl: "not-a-url" }]),
    ).toThrow(/DIMTS_PUBLIC_SOURCES/u);
    expect(() => parseWithSources([{ ...sources[0], pageSize: 101 }])).toThrow(
      /pageSize/u,
    );
    expect(() =>
      parseConfig({ ...validEnv, DIMTS_SOURCE_SYNC_INTERVAL_MS: "500" }),
    ).toThrow(/DIMTS_SOURCE_SYNC_INTERVAL_MS/u);
    expect(() =>
      parseConfig({
        ...validEnv,
        DIMTS_SOURCE_SYNC_INTERVAL_MS: "86400001",
      }),
    ).toThrow(/DIMTS_SOURCE_SYNC_INTERVAL_MS/u);
    expect(() => parseWithSources([sources[0], sources[0]])).toThrow(/unique/u);
  });

  it("starts configured public sources and waits for their initial sync", async () => {
    const resource = sourceResource("course-site");
    const page: SourcePage = {
      resources: [resource],
      snapshotRevision: "snapshot-1",
    };
    const document = sourceDocument("course-site");
    let finishList: ((page: SourcePage) => void) | undefined;
    const list = vi
      .spyOn(PublicSitemapSource.prototype, "list")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finishList = resolve;
          }),
      );
    const fetch = vi
      .spyOn(PublicSitemapSource.prototype, "fetch")
      .mockResolvedValue(document);
    const store = createStore();
    const app = buildApp({
      config: parseWithSources([
        {
          id: "course-site",
          sitemapUrl: "https://learn.example/sitemap.xml",
          language: "en",
          pageSize: 25,
        },
      ]),
      repository,
      sourceSync: { store, intervalMs: 60_000 },
    });

    try {
      const ready: Promise<void> = app.locals.sourceSyncReady;
      await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
      let isReady = false;
      void ready.then(() => {
        isReady = true;
      });
      expect(isReady).toBe(false);
      finishList?.(page);
      await ready;

      expect(list).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledWith("lesson-1", expect.any(AbortSignal));
      expect(store.stageResource).toHaveBeenCalledOnce();
      expect(store.publishGeneration).toHaveBeenCalledOnce();
    } finally {
      finishList?.(page);
      await app.locals.close();
    }
  });

  it.each(["private-site", "telegram-approved-channel"])(
    "accepts the host-authorized %s adapter and refreshes fetched content",
    async (sourceId) => {
      const resource = sourceResource(sourceId);
      const auth = {
        authorize: vi.fn(async () => undefined),
      };
      const list = vi.fn(async () => ({
        resources: [resource],
        snapshotRevision: "snapshot-1",
      }));
      const fetch = vi.fn(async () => sourceDocument(resource.sourceId));
      const source = {
        id: resource.sourceId,
        auth,
        list,
        fetch,
      };
      const store = createStore();
      const app = buildApp({
        config: parseConfig(validEnv),
        repository,
        sourceSync: {
          sources: [source],
          store,
          intervalMs: 60_000,
        },
      });

      try {
        await app.locals.sourceSyncReady;

        expect(auth.authorize).toHaveBeenCalledWith(
          resource.sourceId,
          "discover",
          expect.any(AbortSignal),
        );
        expect(auth.authorize).toHaveBeenCalledWith(
          resource.sourceId,
          "read",
          expect.any(AbortSignal),
        );
        expect(fetch).toHaveBeenCalledOnce();

        await app.locals.sourceSyncManager.notify(resource.sourceId, [
          {
            resourceId: resource.resourceId,
            revision: "revision-2",
            operation: "upsert",
          },
        ]);

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(store.publishGeneration).toHaveBeenCalledTimes(2);
      } finally {
        await app.locals.close();
      }
    },
  );

  it("requires a source store when a custom repository is used", () => {
    expect(() =>
      buildApp({
        config: parseConfig(validEnv),
        repository,
        sourceSync: {
          sources: [
            {
              id: "private-site",
              auth: { authorize: async () => undefined },
              list: async () => ({ resources: [], snapshotRevision: "1" }),
              fetch: async () => null,
            },
          ],
        },
      }),
    ).toThrow(/SourceSyncStore/u);
  });
});
