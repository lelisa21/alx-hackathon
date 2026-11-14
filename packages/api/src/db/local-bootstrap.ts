import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { provisionHelper } from "./admin.js";
import { applyMigrations } from "./migrate.js";

interface LocalHostKeyClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

interface LocalHostKey {
  id: string;
  name: string;
  key: string;
  origins: string[];
}

export async function provisionLocalHostKey(
  client: LocalHostKeyClient,
  host: LocalHostKey,
): Promise<void> {
  if (!host.id.trim() || !host.name.trim() || !host.key.trim()) {
    throw new Error("Local host id, name, and key are required.");
  }
  if (
    host.origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          !["http:", "https:"].includes(url.protocol) ||
          url.origin !== origin ||
          url.username !== "" ||
          url.password !== ""
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("Each local host value must be an origin.");
  }

  const keyHash = createHash("sha256").update(host.key).digest("hex");
  await client.query(
    `INSERT INTO host_key (id, name, key_hash, origins)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       key_hash = EXCLUDED.key_hash,
       origins = EXCLUDED.origins`,
    [host.id, host.name, keyHash, host.origins],
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for local bootstrap.`);
  return value;
}

async function main(): Promise<void> {
  const connectionString = requiredEnvironment("DATABASE_URL_DIRECT");
  const key = requiredEnvironment("DIMTS_LOCAL_WIDGET_KEY");
  const origins = requiredEnvironment("DIMTS_HOST_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error("DIMTS_HOST_ORIGINS must contain an origin.");
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const directory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../migrations",
    );
    const migrations = await applyMigrations(client, directory);
    await provisionLocalHostKey(client, {
      id: "local-widget",
      name: "Local development widget",
      key,
      origins,
    });
    // Local demo helper so "Help me now" reaches a person: sign in at /helper
    // with DIMTS_SEED_HELPER_TOKEN. Skipped when the token is not set.
    const helperToken = process.env.DIMTS_SEED_HELPER_TOKEN?.trim();
    if (helperToken) {
      await provisionHelper(client, {
        id: "local-demo-helper",
        displayName: "Demo helper",
        token: helperToken,
        langs: ["en", "am", "om"],
      });
      process.stdout.write("Local demo helper is ready.\n");
    }
    for (const migration of migrations) {
      process.stdout.write(`applied ${migration}\n`);
    }
    process.stdout.write("Local widget host is ready.\n");
  } finally {
    await client.end();
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  await main();
}
