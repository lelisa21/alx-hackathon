import type { Pool } from "pg";
import { queryTokens, textGrams } from "./grams.js";
import type { PassageRecord } from "./ingest.js";
import type { GlossaryEntry, SearchCandidate } from "./search.js";
import { expandTokens, rankPassages } from "./search.js";
import { normalise } from "./normalise.js";

const CANDIDATE_SQL = `
  WITH active_content AS (
    SELECT id FROM content_version
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  )
  SELECT p.id, p.text, p.text_norm, p.lesson_title, p.section_title, p.url,
         p.lang, p.source_type, p.ts_start,
         (SELECT count(*) FROM unnest($1::text[]) AS g(gram)
          WHERE g.gram = ANY (p.grams)) AS hits
  FROM passage p
  WHERE p.grams && $1::text[]
    AND p.source_type = ANY ($2::text[])
    AND p.content_version_id = (SELECT id FROM active_content)
  ORDER BY hits DESC, p.id
  LIMIT 8
`;

const INSERT_PASSAGE_SQL = `
  INSERT INTO passage (
    id, content_version_id, lesson_id, lesson_title, section_title, anchor,
    url, lang, source_type, ts_start, text, text_norm, grams
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (id) DO UPDATE SET
    content_version_id = EXCLUDED.content_version_id,
    lesson_id = EXCLUDED.lesson_id,
    lesson_title = EXCLUDED.lesson_title,
    section_title = EXCLUDED.section_title,
    anchor = EXCLUDED.anchor,
    url = EXCLUDED.url,
    lang = EXCLUDED.lang,
    source_type = EXCLUDED.source_type,
    ts_start = EXCLUDED.ts_start,
    text = EXCLUDED.text,
    text_norm = EXCLUDED.text_norm,
    grams = EXCLUDED.grams
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
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "dimts-content-ingest",
      ]);
      await client.query(
        `INSERT INTO content_version (id, created_at, source_hash)
         VALUES ($1, clock_timestamp(), $1)
         ON CONFLICT (id) DO UPDATE SET
           source_hash = EXCLUDED.source_hash,
           created_at = clock_timestamp()`,
        [versionId],
      );
      await client.query("DELETE FROM passage");

      for (const passage of passages) {
        await client.query(INSERT_PASSAGE_SQL, [
          passage.id,
          versionId,
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
        ]);
      }

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

  async currentVersion(): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM content_version
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    );
    return result.rows[0]?.id ?? "";
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
