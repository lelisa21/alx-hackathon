import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { applyMigrations } from "../src/db/migrate.js";
import { provisionLocalHostKey } from "../src/db/local-bootstrap.js";
import {
  PostgresGrounding,
  replaceContent,
} from "../../grounding/src/repository.js";
import { PostgresSourceSyncStore } from "../../grounding/src/source-store.js";
import { sourceHash, toPassages } from "../../grounding/src/ingest.js";
import {
  processTextDocument,
  synchronizeSource,
  synchronizeSourceChanges,
} from "../../grounding/src/sync.js";
import type {
  ContentSource,
  SourceDocument,
  SourceResource,
} from "../../grounding/src/sync.js";

const databaseUrl = process.env.DIMTS_TEST_DATABASE_URL;
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const localesRoot = path.join(root, "locales");
const migrationsRoot = path.join(root, "packages", "api", "migrations");
const hostId = "api-postgres-integration";
const hostKey = "api-postgres-integration-public-id";
const origin = "http://localhost:5173";
const secrets = [
  Buffer.alloc(32, 1).toString("base64"),
  Buffer.alloc(32, 2).toString("base64"),
  Buffer.alloc(32, 3).toString("base64"),
];

describe.skipIf(!databaseUrl)("PostgreSQL API integration", () => {
  let client: pg.Client;
  let app: ReturnType<typeof buildApp>;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("DIMTS_TEST_DATABASE_URL is required.");
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await applyMigrations(client, migrationsRoot);
    await provisionLocalHostKey(client, {
      id: hostId,
      name: "PostgreSQL integration test",
      key: hostKey,
      origins: [origin],
    });
    app = buildApp({
      config: parseConfig({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        DIMTS_ENC_KEY: secrets[0],
        DIMTS_HASH_KEY: secrets[1],
        DIMTS_JWT_SECRET: secrets[2],
        DIMTS_CRON_SECRET: "integration-cron-secret-long-enough",
        DIMTS_HOST_ORIGINS: origin,
        DIMTS_AI_PROVIDER: "offline",
      }),
      localesRoot,
    });
  });

  afterAll(async () => {
    if (app) await app.locals.close();
    if (client) {
      for (const sessionId of sessionIds) {
        await client.query("DELETE FROM session WHERE id = $1", [sessionId]);
      }
      await client.query("DELETE FROM host_key WHERE id = $1", [hostId]);
      await client.end();
    }
  });

  it("is migration-idempotent and creates a database-backed session", async () => {
    const pending = await applyMigrations(client, migrationsRoot);
    expect(pending).toEqual([]);

    const health = await request(app).get("/v1/health");
    expect(health.status).toBe(200);
    expect(health.body.db).toBe(true);

    const session = await request(app)
      .post("/v1/sessions")
      .set("x-dimts-key", hostKey)
      .set("origin", origin)
      .send({ lang: "en", channel: "web" });
    expect(session.status).toBe(201);
    expect(session.body.sessionId).toEqual(expect.any(String));
    if (typeof session.body.sessionId !== "string") {
      throw new Error("Session response did not contain a session id.");
    }
    sessionIds.push(session.body.sessionId);

    const stored = await client.query<{ key_hash: string }>(
      "SELECT key_hash FROM host_key WHERE id = $1",
      [hostId],
    );
    expect(stored.rows[0]?.key_hash).toBe(
      createHash("sha256").update(hostKey).digest("hex"),
    );
    expect(stored.rows[0]?.key_hash).not.toBe(hostKey);
  });

  it("uses newly ingested course content for subsequent cited answers", async () => {
    const databasePool = new pg.Pool({ connectionString: databaseUrl });
    const firstContent =
      "# Dynamic lesson\n\n## Course policy\n\nThe course policy is bronze.";
    const nextContent =
      "# Dynamic lesson\n\n## Course policy\n\nThe course policy is silver.";
    try {
      const firstPassages = toPassages({
        lessonId: "dynamic-course-policy",
        content: firstContent,
        format: "markdown",
        baseUrl: "https://course.example/lessons/",
        lang: "en",
      });
      await replaceContent(
        databasePool,
        firstPassages,
        sourceHash([
          { name: "dynamic-course-policy.md", content: firstContent },
        ]),
      );

      const session = await request(app)
        .post("/v1/sessions")
        .set("x-dimts-key", hostKey)
        .set("origin", origin)
        .send({ lang: "en", channel: "web" });
      expect(session.status).toBe(201);
      if (
        typeof session.body.sessionId !== "string" ||
        typeof session.body.sessionToken !== "string"
      ) {
        throw new Error(
          "Session response did not contain session credentials.",
        );
      }
      sessionIds.push(session.body.sessionId);

      const ask = (clientMsgId: string) =>
        request(app)
          .post("/v1/ask")
          .set("authorization", `Bearer ${session.body.sessionToken}`)
          .send({
            sessionId: session.body.sessionId,
            clientMsgId,
            lang: "en",
            via: "text",
            text: "What is the course policy?",
          });
      const firstReply = await ask("dynamic-policy-question-1");
      expect(firstReply.status, JSON.stringify(firstReply.body)).toBe(200);
      expect(firstReply.body.kind).toBe("answer");
      expect(firstReply.body.text).toContain("bronze");
      expect(firstReply.body.citations[0]?.url).toBe(
        "https://course.example/lessons/dynamic-course-policy#course-policy",
      );

      const nextPassages = toPassages({
        lessonId: "dynamic-course-policy",
        content: nextContent,
        format: "markdown",
        baseUrl: "https://course.example/lessons/",
        lang: "en",
      });
      await replaceContent(
        databasePool,
        nextPassages,
        sourceHash([
          { name: "dynamic-course-policy.md", content: nextContent },
        ]),
      );

      const nextReply = await ask("dynamic-policy-question-2");
      expect(nextReply.status).toBe(200);
      expect(nextReply.body.kind).toBe("answer");
      expect(nextReply.body.text).toContain("silver");
      expect(nextReply.body.contentVersion).not.toBe(
        firstReply.body.contentVersion,
      );
    } finally {
      await databasePool.end();
    }
  });

  it("atomically publishes source generations and preserves the last good index", async () => {
    const databasePool = new pg.Pool({ connectionString: databaseUrl });
    const sourceId = `integration-${randomUUID()}`;
    const first = {
      sourceId,
      resourceId: "archive-policy",
      revision: "revision-1",
      canonicalUrl: "https://course.example/archive-policy",
      language: "en",
      mediaType: "text/markdown",
    } satisfies SourceResource;
    const second = {
      ...first,
      resourceId: "course-room",
    } satisfies SourceResource;
    const documents = new Map<string, SourceDocument>([
      [
        first.resourceId,
        {
          ...first,
          body: "# Archive policy\n\n## Key\n\nThe archive key is amber.",
        },
      ],
      [
        second.resourceId,
        {
          ...second,
          body: "# Course room\n\n## Access\n\nThe course room is accessible.",
        },
      ],
    ]);
    const failed = new Set<string>();
    const sourceAdapter: ContentSource = {
      id: sourceId,
      auth: { authorize: async () => undefined },
      list: async () => ({
        resources: [...documents.values()],
        snapshotRevision: "snapshot-1",
      }),
      fetch: async (resourceId) => {
        if (failed.has(resourceId)) throw new Error("source unavailable");
        return documents.get(resourceId) ?? null;
      },
    };
    const store = new PostgresSourceSyncStore(databasePool);
    const grounding = new PostgresGrounding(databasePool);

    try {
      await synchronizeSource(
        sourceAdapter,
        store,
        processTextDocument,
        new AbortController().signal,
      );
      const initial = await grounding.search(
        "What color is the archive key?",
        "en",
      );
      expect(initial[0]?.text).toContain("amber");
      const initialRevision = await databasePool.query<{ revision: string }>(
        `SELECT resource.revision
         FROM active_source_generation AS active
         JOIN source_resource_revision AS resource
           ON resource.generation_id = active.generation_id
         WHERE active.source_id = $1 AND resource.resource_id = $2`,
        [sourceId, first.resourceId],
      );
      expect(initialRevision.rows[0]?.revision).toBe("revision-1");

      const updated = {
        ...first,
        revision: "revision-2",
      };
      documents.set(updated.resourceId, {
        ...updated,
        body: "# Archive policy\n\n## Key\n\nThe archive key is violet.",
      });
      documents.delete(second.resourceId);
      await synchronizeSourceChanges(
        sourceAdapter,
        store,
        [
          {
            resourceId: updated.resourceId,
            revision: updated.revision,
            operation: "upsert",
          },
          {
            resourceId: second.resourceId,
            revision: "revision-2",
            operation: "delete",
          },
        ],
        processTextDocument,
        new AbortController().signal,
        "change-cursor-1",
      );
      expect(await store.getCursor(sourceId)).toBe("change-cursor-1");
      const updatedRevision = await databasePool.query<{
        revision: string;
      }>(
        `SELECT resource.revision
         FROM active_source_generation AS active
         JOIN source_resource_revision AS resource
           ON resource.generation_id = active.generation_id
         WHERE active.source_id = $1 AND resource.resource_id = $2`,
        [sourceId, first.resourceId],
      );
      expect(updatedRevision.rows[0]?.revision).toBe("revision-2");

      const current = await grounding.search(
        "What color is the archive key?",
        "en",
      );
      expect(current[0]?.text).toContain("violet");
      expect(current.some(({ text }) => text.includes("amber"))).toBe(false);

      failed.add(updated.resourceId);
      await expect(
        synchronizeSource(
          sourceAdapter,
          store,
          processTextDocument,
          new AbortController().signal,
        ),
      ).rejects.toThrow("source unavailable");
      const afterFailure = await grounding.search(
        "What color is the archive key?",
        "en",
      );
      expect(afterFailure[0]?.text).toContain("violet");
    } finally {
      await databasePool.query(
        "DELETE FROM active_source_generation WHERE source_id = $1",
        [sourceId],
      );
      await databasePool.query(
        "DELETE FROM source_generation WHERE source_id = $1",
        [sourceId],
      );
      await databasePool.end();
    }
  });
});
