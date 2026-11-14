import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";

/**
 * Operator CLI for hosted deployments. Provisions the host keys and helper
 * accounts that the API only ever stores as SHA-256 hashes (blueprint 3.3).
 * Secrets are read from DIMTS_PROVISION_SECRET so they never appear in argv,
 * shell history or process listings.
 */

interface QueryClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export interface HostKeyInput {
  id: string;
  name: string;
  key: string;
  keyType: "public" | "secret";
  origins: string[];
}

export interface HelperInput {
  id: string;
  displayName: string;
  token: string;
  langs: string[];
}

export type AdminCommand =
  | { command: "host-key"; host: HostKeyInput }
  | { command: "helper"; helper: HelperInput };

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function assertOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("Each host value must be an origin.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== origin ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Each host value must be an origin.");
  }
  if (url.protocol === "http:" && !loopbackHosts.has(url.hostname)) {
    throw new Error("Non-loopback origins must use HTTPS.");
  }
}

export async function provisionHostKey(
  client: QueryClient,
  host: HostKeyInput,
): Promise<void> {
  if (!host.id.trim() || !host.name.trim() || !host.key.trim()) {
    throw new Error("Host id, name, and key are required.");
  }
  if (host.keyType === "secret" && host.key.length < 32) {
    throw new Error("Secret host keys must be at least 32 characters.");
  }
  if (host.keyType === "public" && host.origins.length === 0) {
    throw new Error("Public browser keys require at least one origin.");
  }
  host.origins.forEach(assertOrigin);

  await client.query(
    `INSERT INTO host_key (id, name, key_hash, origins, key_type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       key_hash = EXCLUDED.key_hash,
       origins = EXCLUDED.origins,
       key_type = EXCLUDED.key_type`,
    [host.id, host.name, sha256(host.key), host.origins, host.keyType],
  );
}

export async function provisionHelper(
  client: QueryClient,
  helper: HelperInput,
): Promise<void> {
  if (!helper.id.trim() || !helper.displayName.trim()) {
    throw new Error("Helper id and name are required.");
  }
  const bytes = Buffer.from(helper.token, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== helper.token) {
    throw new Error("Helper token must be a random 32-byte base64url value.");
  }
  if (
    helper.langs.length === 0 ||
    helper.langs.some(
      (lang) => !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(lang),
    )
  ) {
    throw new Error("Helper requires at least one BCP 47 language code.");
  }

  await client.query(
    `INSERT INTO helper (id, display_name, token_hash, langs, active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       token_hash = EXCLUDED.token_hash,
       langs = EXCLUDED.langs,
       active = TRUE`,
    [helper.id, helper.displayName, sha256(helper.token), helper.langs],
  );
}

const usage =
  "Usage: admin host-key --id <id> --name <name> [--type public|secret] [--origins <a,b>]\n" +
  "       admin helper --id <id> --name <name> --langs <en,am>\n" +
  "Set DIMTS_PROVISION_SECRET to the host key or helper token, and DATABASE_URL_DIRECT.";

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function parseAdminArguments(
  argv: readonly string[],
  environment: Record<string, string | undefined>,
): AdminCommand {
  const [command, ...rest] = argv;
  if (command !== "host-key" && command !== "helper") throw new Error(usage);
  const { values } = parseArgs({
    args: [...rest],
    options: {
      id: { type: "string" },
      name: { type: "string" },
      type: { type: "string" },
      origins: { type: "string" },
      langs: { type: "string" },
    },
    strict: true,
  });
  const secret = environment.DIMTS_PROVISION_SECRET?.trim();
  if (!secret) throw new Error(`DIMTS_PROVISION_SECRET is required.\n${usage}`);
  if (!values.id || !values.name) throw new Error(usage);

  if (command === "helper") {
    return {
      command,
      helper: {
        id: values.id,
        displayName: values.name,
        token: secret,
        langs: list(values.langs),
      },
    };
  }
  const keyType = values.type ?? "public";
  if (keyType !== "public" && keyType !== "secret") throw new Error(usage);
  return {
    command,
    host: {
      id: values.id,
      name: values.name,
      key: secret,
      keyType,
      origins: list(values.origins),
    },
  };
}

async function main(): Promise<void> {
  const parsed = parseAdminArguments(process.argv.slice(2), process.env);
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error("DATABASE_URL_DIRECT is required.");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    if (parsed.command === "host-key") {
      await provisionHostKey(client, parsed.host);
      process.stdout.write(`Host key ${parsed.host.id} is ready.\n`);
    } else {
      await provisionHelper(client, parsed.helper);
      process.stdout.write(`Helper ${parsed.helper.id} is ready.\n`);
    }
  } finally {
    await client.end();
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Provisioning failed."}\n`,
    );
    process.exitCode = 1;
  }
}
