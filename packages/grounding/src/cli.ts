import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { sourceHash, toPassages } from "./ingest.js";
import { replaceContent } from "./repository.js";

interface SourceFile {
  name: string;
  content: string;
  format: "markdown" | "html";
  lessonId: string;
}

async function sourceFiles(inputPath: string): Promise<SourceFile[]> {
  const resolvedPath = path.resolve(inputPath);
  const info = await stat(resolvedPath);
  const paths = info.isDirectory()
    ? (await readdir(resolvedPath, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(resolvedPath, entry.name))
    : [resolvedPath];

  const files: SourceFile[] = [];
  for (const filePath of paths.sort()) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".vtt" || extension === ".srt") {
      throw new Error(
        "Transcript ingestion is deferred until the course transcript format is confirmed.",
      );
    }
    if (![".md", ".html", ".htm"].includes(extension)) continue;
    const name = path.basename(filePath);
    files.push({
      name,
      content: await readFile(filePath, "utf8"),
      format: extension === ".md" ? "markdown" : "html",
      lessonId: path.basename(filePath, extension),
    });
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

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: pnpm content:ingest <path>");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const baseUrl = process.env.DIMTS_CONTENT_BASE_URL;
  if (!baseUrl) throw new Error("DIMTS_CONTENT_BASE_URL is required.");
  const lang = process.env.DIMTS_DEFAULT_LANG;
  if (!lang) throw new Error("DIMTS_DEFAULT_LANG is required.");

  const files = await sourceFiles(inputPath);
  const passages = files.flatMap((file) =>
    toPassages({
      lessonId: file.lessonId,
      content: file.content,
      format: file.format,
      baseUrl,
      lang,
    }),
  );
  if (passages.length === 0) {
    throw new Error("No lesson passages were found in the content path.");
  }

  const versionId = sourceHash(
    files.map(({ name, content }) => ({ name, content })),
    { baseUrl, lang },
  );
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await replaceContent(pool, passages, versionId);
  } finally {
    await pool.end();
  }
  process.stdout.write(
    `Ingested ${passages.length} passages in content version ${versionId}.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Content ingestion failed."}\n`,
  );
  process.exitCode = 1;
});
