import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export async function applyMigrations(
  client: pg.Client,
  directory: string,
): Promise<string[]> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const completed = await client.query<{ name: string }>(
    "SELECT name FROM _migrations",
  );
  const applied = new Set(completed.rows.map((row) => row.name));
  const pending = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const newlyApplied: string[] = [];

  for (const file of pending) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(directory, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      newlyApplied.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  return newlyApplied;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    throw new Error("DATABASE_URL_DIRECT is required to run migrations");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const directory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../migrations",
    );
    const applied = await applyMigrations(client, directory);
    for (const migration of applied)
      process.stdout.write(`applied ${migration}\n`);
    if (applied.length === 0) process.stdout.write("No pending migrations.\n");
  } finally {
    await client.end();
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  await main();
}
