import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const apiRequire = createRequire(
  fileURLToPath(new URL("../packages/api/package.json", import.meta.url)),
);
const { Client } = apiRequire("pg");
const personalTables = [
  ["sessions", "SELECT count(*)::text AS count FROM session"],
  ["messages", "SELECT count(*)::text AS count FROM message"],
  ["help requests", "SELECT count(*)::text AS count FROM help_request"],
  ["help images", "SELECT count(*)::text AS count FROM help_image"],
  ["subscriptions", "SELECT count(*)::text AS count FROM subscription"],
  [
    "accommodation requests",
    "SELECT count(*)::text AS count FROM accommodation_request",
  ],
  ["SMS mappings", "SELECT count(*)::text AS count FROM sms_conversation"],
  [
    "Telegram mappings",
    "SELECT count(*)::text AS count FROM telegram_conversation",
  ],
  ["helpers", "SELECT count(*)::text AS count FROM helper"],
  ["consent metadata", "SELECT count(*)::text AS count FROM consent_log"],
];
const deleteStatements = [
  "DELETE FROM session",
  "DELETE FROM subscription",
  "DELETE FROM accommodation_request",
  "DELETE FROM sms_conversation",
  "DELETE FROM telegram_conversation",
  "DELETE FROM consent_log",
  "DELETE FROM lti_nonce_state",
  "DELETE FROM lti_nonce_used",
  "DELETE FROM lti_token_replay",
  "DELETE FROM helper",
];

export async function getPurgeCounts(client) {
  const counts = [];
  for (const [label, query] of personalTables) {
    const result = await client.query(query);
    counts.push({ label, count: Number(result.rows[0].count) });
  }
  return counts;
}

export async function purgeEventData(client, apply = false) {
  if (!apply) return getPurgeCounts(client);
  await client.query("BEGIN");
  try {
    const counts = await getPurgeCounts(client);
    for (const statement of deleteStatements) await client.query(statement);
    await client.query("COMMIT");
    return counts;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (
    process.argv.some(
      (argument) => !["--apply", "--dry-run"].includes(argument),
    )
  )
    throw new Error(
      "Usage: node scripts/purge-event-data.mjs [--dry-run|--apply]",
    );
  if (apply && process.argv.includes("--dry-run"))
    throw new Error("Choose either --dry-run or --apply.");
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString)
    throw new Error(
      "DATABASE_URL_DIRECT is required for the event data purge.",
    );

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const counts = await purgeEventData(client, apply);
    process.stdout.write(`${apply ? "Purged" : "Dry run"} personal data:\n`);
    for (const { label, count } of counts)
      process.stdout.write(`  ${label}: ${count}\n`);
    if (!apply)
      process.stdout.write(
        "No rows were changed. Pass --apply to delete these records.\n",
      );
  } finally {
    await client.end();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) await main();
