import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRequire = createRequire(
  fileURLToPath(new URL("../packages/api/package.json", import.meta.url)),
);
const { Client } = apiRequire("pg");

export function validateSeedHelperToken(helperToken) {
  const helperTokenBytes = Buffer.from(helperToken ?? "", "base64url");
  if (
    helperTokenBytes.byteLength !== 32 ||
    helperTokenBytes.toString("base64url") !== helperToken
  )
    throw new Error(
      "DIMTS_SEED_HELPER_TOKEN must be a random 32-byte base64url token.",
    );
  return helperToken;
}

async function main() {
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString)
    throw new Error(
      "DATABASE_URL_DIRECT is required to seed local sample data.",
    );
  const helperToken = validateSeedHelperToken(
    process.env.DIMTS_SEED_HELPER_TOKEN,
  );

  const posting = JSON.parse(
    await readFile(
      path.join(root, "content", "sample-jobs", "sample-job.jsonld"),
      "utf8",
    ),
  );
  const helperHash = createHash("sha256").update(helperToken).digest("hex");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO job(id,posting,title,region,deadline,accommodations_offered,lang)
       VALUES($1,$2::jsonb,$3,$4,$5::date,$6,'en')
       ON CONFLICT(id) DO UPDATE SET posting=EXCLUDED.posting,title=EXCLUDED.title,
         region=EXCLUDED.region,deadline=EXCLUDED.deadline,
         accommodations_offered=EXCLUDED.accommodations_offered,lang=EXCLUDED.lang`,
      [
        posting["@id"] ?? posting.url,
        JSON.stringify(posting),
        posting.title,
        posting.jobLocation?.address?.addressLocality ?? null,
        posting.validThrough ?? null,
        posting.accommodationsOffered ?? [],
      ],
    );
    await client.query(
      `INSERT INTO helper(id,display_name,token_hash,langs,active)
       VALUES('local-sample-helper','Local sample helper',$1,ARRAY['en'],TRUE)
       ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,
         token_hash=EXCLUDED.token_hash,langs=EXCLUDED.langs,active=TRUE`,
      [helperHash],
    );
    await client.query("COMMIT");
    process.stdout.write("Sample job and helper records are ready.\n");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) await main();
