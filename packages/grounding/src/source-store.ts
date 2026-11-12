import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PassageRecord } from "./ingest.js";
import type { SourceDocument, SourceSyncStore } from "./sync.js";

interface GenerationRow {
  source_id: string;
  status: "staging" | "active" | "retired";
}

interface CursorRow {
  cursor: string | null;
}

interface ActiveGenerationRow {
  active: boolean;
}

interface RemovedRow {
  removed: number;
}

const INSERT_PASSAGE_SQL = `
  INSERT INTO passage (
    id, content_version_id, lesson_id, lesson_title, section_title, anchor,
    url, lang, source_type, ts_start, text, text_norm, grams,
    source_id, source_resource_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
`;

export class PostgresSourceSyncStore implements SourceSyncStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getCursor(sourceId: string): Promise<string | undefined> {
    const result = await this.pool.query<CursorRow>(
      `SELECT generation.cursor
       FROM active_source_generation AS active
       JOIN source_generation AS generation
         ON generation.id = active.generation_id
       WHERE active.source_id = $1`,
      [sourceId],
    );
    const cursor = result.rows[0]?.cursor;
    return cursor ?? undefined;
  }

  async hasActiveGeneration(sourceId: string): Promise<boolean> {
    const result = await this.pool.query<ActiveGenerationRow>(
      `SELECT EXISTS (
         SELECT 1
         FROM active_source_generation
         WHERE source_id = $1
       ) AS active`,
      [sourceId],
    );
    const row = result.rows[0];
    if (!row)
      throw new Error("Active source generation query returned no row.");
    return row.active;
  }

  async beginGeneration(
    sourceId: string,
    mode: "full" | "incremental",
  ): Promise<string> {
    if (!sourceId.trim()) throw new Error("Source id must not be empty.");

    const generationId = randomUUID();
    const sourceHash = createHash("sha256")
      .update(`${sourceId}\0${generationId}`)
      .digest("hex");

    await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        sourceId,
      ]);
      await client.query(
        `INSERT INTO content_version (id, created_at, source_hash)
         VALUES ($1, clock_timestamp(), $2)`,
        [generationId, sourceHash],
      );
      await client.query(
        `INSERT INTO source_generation (id, source_id, mode, status)
         VALUES ($1, $2, $3, 'staging')`,
        [generationId, sourceId, mode],
      );

      if (mode === "incremental") {
        const active = await client.query<{ generation_id: string }>(
          `SELECT generation_id
           FROM active_source_generation
           WHERE source_id = $1
           FOR UPDATE`,
          [sourceId],
        );
        const previousId = active.rows[0]?.generation_id;
        if (previousId) {
          await client.query(
            `INSERT INTO passage (
               id, content_version_id, lesson_id, lesson_title, section_title,
               anchor, url, lang, source_type, ts_start, text, text_norm, grams,
               source_id, source_resource_id
             )
             SELECT id, $1, lesson_id, lesson_title, section_title,
                    anchor, url, lang, source_type, ts_start, text, text_norm,
                    grams, source_id, source_resource_id
             FROM passage
             WHERE content_version_id = $2`,
            [generationId, previousId],
          );
          await client.query(
            `INSERT INTO source_resource_revision (
               generation_id, source_id, resource_id, revision, canonical_url,
               language, media_type, title, relations
             )
             SELECT $1, source_id, resource_id, revision, canonical_url,
                    language, media_type, title, relations
             FROM source_resource_revision
             WHERE generation_id = $2`,
            [generationId, previousId],
          );
          await client.query(
            `UPDATE source_generation AS next
             SET snapshot_revision = previous.snapshot_revision,
                 cursor = previous.cursor
             FROM source_generation AS previous
             WHERE next.id = $1 AND previous.id = $2`,
            [generationId, previousId],
          );
        }
      }
    });

    return generationId;
  }

  async stageResource(
    generationId: string,
    document: SourceDocument,
    passages: PassageRecord[],
  ): Promise<void> {
    await this.transaction(async (client) => {
      const generation = await this.getStagingGeneration(client, generationId);
      if (document.sourceId !== generation.source_id) {
        throw new Error("Document source does not match its generation.");
      }

      await client.query(
        `DELETE FROM passage
         WHERE content_version_id = $1
           AND source_id = $2
           AND source_resource_id = $3`,
        [generationId, generation.source_id, document.resourceId],
      );
      await client.query(
        `INSERT INTO source_resource_revision (
           generation_id, source_id, resource_id, revision, canonical_url,
           language, media_type, title, relations
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (generation_id, source_id, resource_id) DO UPDATE
         SET revision = EXCLUDED.revision,
             canonical_url = EXCLUDED.canonical_url,
             language = EXCLUDED.language,
             media_type = EXCLUDED.media_type,
             title = EXCLUDED.title,
             relations = EXCLUDED.relations`,
        [
          generationId,
          generation.source_id,
          document.resourceId,
          document.revision,
          document.canonicalUrl,
          document.language ?? null,
          document.mediaType,
          document.title ?? null,
          JSON.stringify(document.relations ?? []),
        ],
      );

      for (const passage of passages) {
        const passageId = createHash("sha256")
          .update(
            JSON.stringify([
              generation.source_id,
              document.resourceId,
              passage.id,
            ]),
          )
          .digest("hex");
        await client.query(INSERT_PASSAGE_SQL, [
          passageId,
          generationId,
          passage.lessonId,
          passage.lessonTitle,
          passage.sectionTitle,
          passage.anchor,
          passage.url,
          passage.lang,
          passage.sourceType,
          null,
          passage.text,
          passage.textNorm,
          passage.grams,
          generation.source_id,
          document.resourceId,
        ]);
      }
    });
  }

  async removeResource(
    generationId: string,
    resourceId: string,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const generation = await this.getStagingGeneration(client, generationId);
      await client.query(
        `DELETE FROM passage
         WHERE content_version_id = $1
           AND source_id = $2
           AND source_resource_id = $3`,
        [generationId, generation.source_id, resourceId],
      );
      await client.query(
        `DELETE FROM source_resource_revision
         WHERE generation_id = $1 AND source_id = $2 AND resource_id = $3`,
        [generationId, generation.source_id, resourceId],
      );
    });
  }

  async publishGeneration(
    generationId: string,
    metadata: {
      snapshotRevision?: string;
      cursor?: string;
      discovered: number;
      indexed: number;
      removed: number;
    },
  ): Promise<{ removed: number }> {
    return this.transaction(async (client) => {
      const generation = await this.getStagingGeneration(client, generationId);
      const previous = await client.query<{ generation_id: string }>(
        `SELECT generation_id
         FROM active_source_generation
         WHERE source_id = $1
         FOR UPDATE`,
        [generation.source_id],
      );
      const previousId = previous.rows[0]?.generation_id;
      let removed = 0;

      if (previousId) {
        const removedResult = await client.query<RemovedRow>(
          `SELECT count(DISTINCT old.source_resource_id)::int AS removed
           FROM passage AS old
           WHERE old.content_version_id = $1
             AND NOT EXISTS (
               SELECT 1
               FROM passage AS current
               WHERE current.content_version_id = $2
                 AND current.source_id = old.source_id
                 AND current.source_resource_id = old.source_resource_id
             )`,
          [previousId, generationId],
        );
        removed = removedResult.rows[0]?.removed ?? 0;
        await client.query(
          `UPDATE source_generation
           SET status = 'retired'
           WHERE id = $1`,
          [previousId],
        );
      }

      await client.query(
        `UPDATE source_generation
         SET status = 'active',
             snapshot_revision = COALESCE($2, snapshot_revision),
             cursor = COALESCE($3, cursor),
             discovered = $4,
             indexed = $5,
             removed = $6,
             completed_at = clock_timestamp()
         WHERE id = $1`,
        [
          generationId,
          metadata.snapshotRevision ?? null,
          metadata.cursor ?? null,
          metadata.discovered,
          metadata.indexed,
          removed,
        ],
      );
      await client.query(
        `INSERT INTO active_source_generation (source_id, generation_id)
         VALUES ($1, $2)
         ON CONFLICT (source_id) DO UPDATE
         SET generation_id = EXCLUDED.generation_id`,
        [generation.source_id, generationId],
      );
      await client.query("DELETE FROM answer_cache");

      return { removed };
    });
  }

  async abortGeneration(generationId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM source_generation
       WHERE id = $1 AND status = 'staging'`,
      [generationId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error("Staged source generation was not found.");
    }
  }

  private async getStagingGeneration(
    client: PoolClient,
    generationId: string,
  ): Promise<GenerationRow> {
    const result = await client.query<GenerationRow>(
      `SELECT source_id, status
       FROM source_generation
       WHERE id = $1
       FOR UPDATE`,
      [generationId],
    );
    const generation = result.rows[0];
    if (!generation || generation.status !== "staging") {
      throw new Error("Source generation is not staged.");
    }
    return generation;
  }

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Source generation transaction failed and rollback failed.",
            { cause: rollbackError },
          );
        }
        throw error;
      }
    } finally {
      client.release();
    }
  }
}
