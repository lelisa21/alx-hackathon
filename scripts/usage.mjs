import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const apiRequire = createRequire(
  fileURLToPath(new URL("../packages/api/package.json", import.meta.url)),
);
const { Client } = apiRequire("pg");

export async function collectUsage(client) {
  const database = await client.query(
    "SELECT current_database() AS name, pg_database_size(current_database())::text AS bytes",
  );
  const tables = await client.query(
    `SELECT schemaname AS schema, relname AS name,
            pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)::text AS bytes
     FROM pg_stat_user_tables
     ORDER BY pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) DESC
     LIMIT 10`,
  );
  const counts = await client.query(
    "SELECT (SELECT count(*)::text FROM session) AS sessions, (SELECT count(*)::text FROM message) AS messages",
  );
  return {
    name: database.rows[0].name,
    bytes: Number(database.rows[0].bytes),
    tables: tables.rows.map((row) => ({
      schema: row.schema,
      name: row.name,
      bytes: Number(row.bytes),
    })),
    sessions: Number(counts.rows[0].sessions),
    messages: Number(counts.rows[0].messages),
  };
}

export function formatUsage(usage, budgetMb = 600) {
  const sizeMb = usage.bytes / (1024 * 1024);
  const lines = [
    `Database: ${usage.name}`,
    `Size: ${sizeMb.toFixed(2)} MiB (${usage.bytes} bytes)`,
    `Sessions: ${usage.sessions}`,
    `Messages: ${usage.messages}`,
    "Largest tables:",
    ...usage.tables.map(
      (table) =>
        `  ${table.schema}.${table.name}: ${(table.bytes / (1024 * 1024)).toFixed(2)} MiB`,
    ),
  ];
  if (sizeMb >= budgetMb)
    lines.push(
      `WARNING: database size is at or above the ${budgetMb} MiB budget.`,
    );
  return lines.join("\n");
}

async function main() {
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString)
    throw new Error(
      "DATABASE_URL_DIRECT is required to report database usage.",
    );
  const budgetMb = Number(process.env.DIMTS_DB_BUDGET_MB ?? "600");
  if (!Number.isFinite(budgetMb) || budgetMb <= 0)
    throw new Error("DIMTS_DB_BUDGET_MB must be a positive number.");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    process.stdout.write(
      `${formatUsage(await collectUsage(client), budgetMb)}\n`,
    );
  } finally {
    await client.end();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) await main();
