import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("backend contract documentation", () => {
  it("keeps the blueprint reply replay schema aligned with migration 002", async () => {
    const blueprint = await readFile(
      path.join(root, "Dimts-System-Blueprint-v2.0.md"),
      "utf8",
    );
    const migration = await readFile(
      path.join(
        root,
        "packages",
        "api",
        "migrations",
        "002_auth_replay_cache.sql",
      ),
      "utf8",
    );

    for (const statement of [
      /ALTER TABLE message ADD COLUMN reply_to TEXT;/u,
      /ALTER TABLE message ADD COLUMN reply JSONB;/u,
      /CREATE UNIQUE INDEX message_reply_to_idx[\s\S]+?WHERE reply_to IS NOT NULL;/u,
    ]) {
      expect(blueprint).toMatch(statement);
      expect(migration).toMatch(statement);
    }
  });

  it("documents the helper websocket authentication contract", async () => {
    const blueprint = await readFile(
      path.join(root, "Dimts-System-Blueprint-v2.0.md"),
      "utf8",
    );

    expect(blueprint).toMatch(/first client message MUST be `auth`/u);
    expect(blueprint).toMatch(/`lastMessageId`/u);
    expect(blueprint).toMatch(/5 seconds/u);
    expect(blueprint).toMatch(/4401/u);
  });

  it("documents all distinct API signing and data-protection secrets", async () => {
    const blueprint = await readFile(
      path.join(root, "Dimts-System-Blueprint-v2.0.md"),
      "utf8",
    );

    for (const secret of [
      "DIMTS_ENC_KEY",
      "DIMTS_HASH_KEY",
      "DIMTS_JWT_SECRET",
      "DIMTS_CRON_SECRET",
    ]) {
      expect(blueprint).toContain(secret);
    }
    expect(blueprint).toMatch(/different from both/u);
  });

  it("assigns each blueprint decision ID only once", async () => {
    const blueprint = await readFile(
      path.join(root, "Dimts-System-Blueprint-v2.0.md"),
      "utf8",
    );
    const decisionIds = Array.from(
      blueprint.matchAll(/^\| D(\d+) \|/gmu),
      (match) => match[1],
    );

    expect(decisionIds.length).toBeGreaterThan(0);
    expect(new Set(decisionIds).size).toBe(decisionIds.length);
  });
});
