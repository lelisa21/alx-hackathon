import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { sourceHash, toPassages } from "./ingest.js";
import type { PassageRecord } from "./ingest.js";
import { replaceContent } from "./repository.js";

export interface SourceFile {
  name: string;
  content: string;
  format: "markdown" | "html";
  lessonId: string;
  lang: string;
  /** Present for language folders: the lesson's own page for that language. */
  canonicalUrl?: string;
}

const LANGUAGE_FOLDER = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

async function lessonFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

async function readLesson(
  filePath: string,
): Promise<Omit<SourceFile, "lang" | "lessonId"> & { base: string }> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".vtt" || extension === ".srt") {
    throw new Error(
      "Transcript ingestion is deferred until the course transcript format is confirmed.",
    );
  }
  return {
    name: path.basename(filePath),
    base: path.basename(filePath, extension),
    content: await readFile(filePath, "utf8"),
    format: extension === ".md" ? "markdown" : "html",
  };
}

function isLesson(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return [".md", ".html", ".htm", ".vtt", ".srt"].includes(extension);
}

/**
 * A content path is either a folder of lessons in the default language, or a
 * folder whose subfolders are language codes (`en/`, `am/`, `om/`). In the
 * second form each lesson cites its own per-language page under the base URL:
 * `<base>/<lang>/<lesson>.html`, a plain file any static host can serve.
 */
export async function sourceFiles(
  inputPath: string,
  options: { defaultLang: string; baseUrl: string },
): Promise<SourceFile[]> {
  const resolvedPath = path.resolve(inputPath);
  const info = await stat(resolvedPath);
  const files: SourceFile[] = [];

  const languageFolders = info.isDirectory()
    ? (await readdir(resolvedPath, { withFileTypes: true }))
        .filter(
          (entry) => entry.isDirectory() && LANGUAGE_FOLDER.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort()
    : [];

  if (languageFolders.length > 0) {
    const base = new URL(options.baseUrl);
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    for (const lang of languageFolders) {
      for (const filePath of await lessonFiles(path.join(resolvedPath, lang))) {
        if (!isLesson(filePath)) continue;
        const lesson = await readLesson(filePath);
        files.push({
          name: `${lang}/${lesson.name}`,
          content: lesson.content,
          format: lesson.format,
          lang,
          // Lesson ids are unique across languages; ids may not contain "/".
          lessonId: `${lesson.base}.${lang}`,
          canonicalUrl: new URL(
            `${encodeURIComponent(lang)}/${encodeURIComponent(lesson.base)}.html`,
            base,
          ).toString(),
        });
      }
    }
  } else {
    const paths = info.isDirectory()
      ? await lessonFiles(resolvedPath)
      : [resolvedPath];
    for (const filePath of paths) {
      if (!isLesson(filePath)) continue;
      const lesson = await readLesson(filePath);
      files.push({
        name: lesson.name,
        content: lesson.content,
        format: lesson.format,
        lang: options.defaultLang,
        lessonId: lesson.base,
      });
    }
  }

  if (files.length === 0) {
    throw new Error("The content path contains no Markdown or HTML lessons.");
  }
  const lessonIds = new Set<string>();
  for (const file of files) {
    if (lessonIds.has(file.lessonId)) {
      throw new Error(`Duplicate lesson id: ${file.lessonId}`);
    }
    lessonIds.add(file.lessonId);
  }
  return files;
}

export function passagesFor(
  files: SourceFile[],
  baseUrl: string,
): PassageRecord[] {
  return files.flatMap((file) =>
    toPassages({
      lessonId: file.lessonId,
      content: file.content,
      format: file.format,
      baseUrl,
      lang: file.lang,
      ...(file.canonicalUrl ? { canonicalUrl: file.canonicalUrl } : {}),
    }),
  );
}

async function activeSourceHash(pool: pg.Pool): Promise<string | null> {
  const result = await pool.query<{ source_hash: string }>(
    `SELECT version.source_hash
     FROM active_source_generation active
     JOIN content_version version ON version.id = active.generation_id
     WHERE active.source_id = 'legacy'`,
  );
  return result.rows[0]?.source_hash ?? null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ifChanged = args.includes("--if-changed");
  const inputPath = args.find((arg) => !arg.startsWith("--"));
  if (!inputPath) {
    throw new Error("Usage: pnpm content:ingest <path> [--if-changed]");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const baseUrl = process.env.DIMTS_CONTENT_BASE_URL;
  if (!baseUrl) throw new Error("DIMTS_CONTENT_BASE_URL is required.");
  const lang = process.env.DIMTS_DEFAULT_LANG;
  if (!lang) throw new Error("DIMTS_DEFAULT_LANG is required.");

  const files = await sourceFiles(inputPath, { defaultLang: lang, baseUrl });
  const passages = passagesFor(files, baseUrl);
  if (passages.length === 0) {
    throw new Error("No lesson passages were found in the content path.");
  }

  const versionId = sourceHash(
    files.map(({ name, content }) => ({ name, content })),
    // Bump citationUrls when the canonical URL layout changes so --if-changed
    // re-ingests instead of keeping passages with stale links.
    { baseUrl, lang, citationUrls: "lang-folder-html-v1" },
  );
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    if (ifChanged && (await activeSourceHash(pool)) === versionId) {
      process.stdout.write(
        `Content version ${versionId} is already active; nothing to ingest.\n`,
      );
      return;
    }
    await replaceContent(pool, passages, versionId);
  } finally {
    await pool.end();
  }
  const languages = [...new Set(files.map((file) => file.lang))].join(", ");
  process.stdout.write(
    `Ingested ${passages.length} passages (${languages}) in content version ${versionId}.\n`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Content ingestion failed."}\n`,
    );
    process.exitCode = 1;
  });
}
