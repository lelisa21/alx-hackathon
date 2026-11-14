import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPostgresRepository } from "../src/db/repository.js";

describe("host key authorization", () => {
  it("only resolves a secret host key for server-to-server access", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: "secret-host", name: "Server integration" }],
    });
    const pool = { query } as unknown as Pool;
    const repository = createPostgresRepository(pool);
    const key = "a-secret-host-key-that-is-long-enough";

    await expect(repository.verifyHostKey(key)).resolves.toEqual({
      id: "secret-host",
      name: "Server integration",
    });

    expect(query.mock.calls[0]?.[0]).toContain("key_type = 'secret'");
    expect(query.mock.calls[0]?.[1]).toEqual([
      createHash("sha256").update(key).digest("hex"),
    ]);
    expect(query.mock.calls[0]?.[1]).not.toContain(key);
  });
});
