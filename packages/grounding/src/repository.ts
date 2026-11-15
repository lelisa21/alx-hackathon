import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { queryTokens, textGrams } from "./grams.js";
import type { PassageRecord } from "./ingest.js";
import type { GlossaryEntry, SearchCandidate } from "./search.js";
import { expandTokens, rankPassages, retrievalLanguages } from "./search.js";
import { normalise } from "./normalise.js";

const CANDIDATE_SQL = `
  WITH active_content AS (
    SELECT generation_id FROM active_source_generation
  )
  SELECT p.id, p.text, p.text_norm, p.lesson_title, p.section_title, p.url,
         p.lang, p.source_type, p.ts_start,
         (SELECT count(*) FROM unnest($1::text[]) AS g(gram)
          WHERE g.gram = ANY (p.grams)) AS hits
  FROM passage p
  WHERE p.grams && $1::text[]
    AND p.source_type = ANY ($2::text[])
    AND p.lang = ANY ($3::text[])
    AND p.content_version_id IN (SELECT generation_id FROM active_content)
  ORDER BY (p.lang = $4) DESC, hits DESC, p.id
  LIMIT 8
`;

const INSERT_PASSAGE_SQL = `
  INSERT INTO passage (
    id, content_version_id, lesson_id, lesson_title, section_title, anchor,
    url, lang, source_type, ts_start, text, text_norm, grams,
    source_id, source_resource_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
`;

interface PassageRow {
  id: string;
  text: string;
  text_norm: string;
  lesson_title: string;
  section_title: string | null;
  url: string;
  lang: string;
  source_type: "course" | "job";
  ts_start: number | null;
}

interface FaqCitation {
  passageId: string;
  label: string;
  url: string;
  sourceLang: string;
  sourceType: "course" | "job";
  timestamp?: number;
}

export interface ContentClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

export interface ContentPool {
  connect(): Promise<ContentClient>;
}

export async function replaceContent(
  pool: ContentPool,
  passages: PassageRecord[],
  versionId: string,
): Promise<void> {
  if (passages.length === 0) {
    throw new Error("Cannot ingest content without passages.");
  }
  if (!/^[a-f0-9]{64}$/u.test(versionId)) {
    throw new Error("Content version must be a SHA-256 hex digest.");
  }

  const client = await pool.connect();
  const generationId = randomUUID();
  const sourceId = "legacy";
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        sourceId,
      ]);
      await client.query(
        `INSERT INTO content_version (id, created_at, source_hash)
         VALUES ($1, clock_timestamp(), $2)`,
        [generationId, versionId],
      );
      await client.query(
        `INSERT INTO source_generation (
           id, source_id, mode, status, discovered, indexed, removed, completed_at
         ) VALUES ($1, $2, 'full', 'active', $3, $3, 0, clock_timestamp())`,
        [
          generationId,
          sourceId,
          new Set(passages.map(({ lessonId }) => lessonId)).size,
        ],
      );

      for (const passage of passages) {
        const passageId = createHash("sha256")
          .update(JSON.stringify([sourceId, passage.lessonId, passage.id]))
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
          sourceId,
          passage.lessonId,
        ]);
      }

      await client.query(
        `UPDATE source_generation
         SET status = 'retired'
         WHERE source_id = $1 AND status = 'active'`,
        [sourceId],
      );
      await client.query(
        `INSERT INTO active_source_generation (source_id, generation_id)
         VALUES ($1, $2)
         ON CONFLICT (source_id) DO UPDATE
         SET generation_id = EXCLUDED.generation_id`,
        [sourceId, generationId],
      );
      await client.query("DELETE FROM answer_cache");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

export class PostgresGrounding {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** Batch publication lookup: exact namespace identity, never fuzzy retrieval. */
  async resolveFaqCitations(
    sources: string[],
  ): Promise<Map<string, FaqCitation>> {
    const requested = [
      ...new Set(sources.filter((source) => source.trim())),
    ].slice(0, 100);
    const resolved = new Map<string, FaqCitation>();
    if (requested.length === 0) return resolved;
    const namespaces = await this.pool.query<{
      source_id: string;
      source_resource_id: string;
    }>(
      `SELECT DISTINCT p.source_id, p.source_resource_id
       FROM passage p
       JOIN active_source_generation active
         ON active.generation_id = p.content_version_id AND active.source_id = p.source_id
       WHERE p.source_type = 'course'`,
    );
    const candidates = new Map(
      requested.map((source) => [
        source,
        new Set([
          source,
          ...namespaces.rows.map((row) =>
            createHash("sha256")
              .update(
                JSON.stringify([row.source_id, row.source_resource_id, source]),
              )
              .digest("hex"),
          ),
        ]),
      ]),
    );
    const result = await this.pool.query<PassageRow>(
      `SELECT p.id, p.lesson_title, p.section_title, p.url, p.lang, p.source_type, p.ts_start
       FROM passage p
       JOIN active_source_generation active
         ON active.generation_id = p.content_version_id AND active.source_id = p.source_id
       WHERE p.id = ANY ($1::text[]) AND p.source_type = 'course'`,
      [[...new Set([...candidates.values()].flatMap((ids) => [...ids]))]],
    );
    for (const [source, ids] of candidates) {
      const matches = result.rows.filter((row) => ids.has(row.id));
      if (matches.length !== 1) continue;
      const row = matches[0]!;
      resolved.set(source, {
        passageId: row.id,
        label: [row.lesson_title, row.section_title]
          .filter(Boolean)
          .join(" / "),
        url: row.url,
        sourceLang: row.lang,
        sourceType: row.source_type,
        ...(row.ts_start === null ? {} : { timestamp: row.ts_start }),
      });
    }
    return resolved;
  }

  /** Resolve pack authoring IDs without weakening stored citation identity. */
  async resolveFaqSource(
    source: string,
    passageIds: string[],
  ): Promise<string | null> {
    const scope = [...new Set(passageIds)].slice(0, 5);
    if (!source.trim() || scope.length === 0) return null;
    const result = await this.pool.query<{
      id: string;
      source_id: string;
      source_resource_id: string;
    }>(
      `SELECT p.id, p.source_id, p.source_resource_id
       FROM passage p
       JOIN active_source_generation active
         ON active.generation_id = p.content_version_id AND active.source_id = p.source_id
       WHERE p.id = ANY ($1::text[])`,
      [scope],
    );
    const matches = result.rows.filter(
      (row) =>
        scope.includes(row.id) &&
        (row.id === source ||
          createHash("sha256")
            .update(
              JSON.stringify([row.source_id, row.source_resource_id, source]),
            )
            .digest("hex") === row.id),
    );
    // The same unqualified authoring ID may exist in multiple source namespaces.
    // Ambiguity is a miss, not permission to attach an unrelated citation.
    return matches.length === 1 ? matches[0]!.id : null;
  }

  /** Questions the active course content answers: its question headings. */
  async courseQuestions(
    lang: string,
    limit = 40,
  ): Promise<{ text: string; lesson: string }[]> {
    const result = await this.pool.query<{ text: string; lesson: string }>(
      `SELECT p.section_title AS text, min(p.lesson_title) AS lesson
       FROM passage p
       JOIN active_source_generation active
         ON active.generation_id = p.content_version_id
        AND active.source_id = p.source_id
       WHERE p.source_type = 'course'
         AND p.lang = $1
         AND p.section_title ~ '[?፧]$'
       GROUP BY p.section_title
       ORDER BY min(p.lesson_title), min(p.anchor)
       LIMIT $2`,
      [lang, Math.max(1, Math.min(100, limit))],
    );
    return result.rows;
  }

  async currentVersion(): Promise<string> {
    const result = await this.pool.query<{
      source_id: string;
      generation_id: string;
    }>(
      `SELECT source_id, generation_id
       FROM active_source_generation
       ORDER BY source_id`,
    );
    return createHash("sha256")
      .update(JSON.stringify(result.rows))
      .digest("hex");
  }

  async search(
    question: string,
    lang: string,
    glossary: GlossaryEntry[] = [],
    sourceTypes: ("course" | "job")[] = ["course", "job"],
  ) {
    if (sourceTypes.length === 0) return [];
    const tokens = queryTokens(normalise(question, lang));
    if (tokens.length === 0) return [];

    const expandedTokens = expandTokens(tokens, lang, glossary);
    const grams = textGrams(expandedTokens.join(" "));
    if (grams.length === 0) return [];

    const result = await this.pool.query<PassageRow>(CANDIDATE_SQL, [
      grams,
      sourceTypes,
      retrievalLanguages(question, lang, glossary),
      lang,
    ]);
    const candidates: SearchCandidate[] = result.rows.map((row) => {
      const candidate = {
        id: row.id,
        text: row.text,
        textNorm: row.text_norm,
        label: [row.lesson_title, row.section_title]
          .filter(Boolean)
          .join(" / "),
        url: row.url,
        lang: row.lang,
        sourceType: row.source_type,
      };
      return row.ts_start === null
        ? candidate
        : { ...candidate, timestamp: row.ts_start };
    });

    return rankPassages(question, lang, candidates, glossary, 5);
  }
}
