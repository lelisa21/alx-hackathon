import { createHash } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPostgresRepository } from "../src/db/repository.js";

describe("P10 LTI session persistence", () => {
  it("reports nonce replay only when its atomic insert finds a conflict", async () => {
    const pool = new pg.Pool({
      connectionString: "postgres://localhost/dimts",
    });
    const query = vi.spyOn(pool, "query");
    const repository = createPostgresRepository(pool);
    query.mockResolvedValue({
      command: "INSERT",
      rowCount: 0,
      oid: 0,
      rows: [],
      fields: [],
    });
    query.mockResolvedValueOnce({
      command: "INSERT",
      rowCount: 1,
      oid: 0,
      rows: [{ nonce: "first-nonce" }],
      fields: [],
    });
    query.mockResolvedValueOnce({
      command: "INSERT",
      rowCount: 0,
      oid: 0,
      rows: [],
      fields: [],
    });

    expect(await repository.checkAndMarkNonceUsed?.("first-nonce", null)).toBe(
      false,
    );
    expect(await repository.checkAndMarkNonceUsed?.("first-nonce", null)).toBe(
      true,
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO lti_nonce_used");
    expect(query.mock.calls[0]?.[0]).toContain("RETURNING nonce");

    await pool.end();
  });

  it("reports token replay only when its atomic insert finds a conflict", async () => {
    const pool = new pg.Pool({
      connectionString: "postgres://localhost/dimts",
    });
    const query = vi.spyOn(pool, "query");
    const repository = createPostgresRepository(pool);
    query.mockResolvedValue({
      command: "INSERT",
      rowCount: 0,
      oid: 0,
      rows: [],
      fields: [],
    });
    query.mockResolvedValueOnce({
      command: "INSERT",
      rowCount: 1,
      oid: 0,
      rows: [{ token_hash: "first-token" }],
      fields: [],
    });
    query.mockResolvedValueOnce({
      command: "INSERT",
      rowCount: 0,
      oid: 0,
      rows: [],
      fields: [],
    });

    expect(
      await repository.checkAndMarkTokenReplayed?.(
        "first-token",
        "static-platform",
        null,
      ),
    ).toBe(false);
    expect(
      await repository.checkAndMarkTokenReplayed?.(
        "first-token",
        "static-platform",
        null,
      ),
    ).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO lti_token_replay");
    expect(query.mock.calls[0]?.[0]).toContain("RETURNING token_hash");

    await pool.end();
  });

  it("stores only the bearer-token hash with launch context and expiry", async () => {
    const pool = new pg.Pool({
      connectionString: "postgres://localhost/dimts",
    });
    const query = vi.spyOn(pool, "query").mockResolvedValue({
      command: "INSERT",
      rowCount: 1,
      oid: 0,
      rows: [],
      fields: [],
    });
    const repository = createPostgresRepository(pool);
    const token = "lti-session-bearer-token";
    const expiresAt = new Date("2026-11-15T12:00:00.000Z");
    const ltiContext = {
      issuer: "https://platform.example.com",
      platformId: "platform-1",
      deploymentId: "deployment-1",
      ltiUserId: "user-1",
      roles: ["Instructor"],
      insightsAccess: true,
      timestamp: 1000,
    };

    await repository.createSession({
      id: "lti-session-1",
      channel: "lti",
      lang: "en",
      token,
      expiresAt,
      ltiContext,
    });

    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("token_hash");
    expect(sql).toContain("expires_at");
    expect(sql).toContain("lti_context");
    expect(values).toContain(createHash("sha256").update(token).digest("hex"));
    expect(values).not.toContain(token);
    expect(values).toContain(expiresAt);
    expect(values).toContain(JSON.stringify(ltiContext));

    await pool.end();
  });

  it("looks up live LTI sessions using only the bearer-token hash", async () => {
    const pool = new pg.Pool({
      connectionString: "postgres://localhost/dimts",
    });
    const query = vi.spyOn(pool, "query").mockResolvedValue({
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      rows: [
        {
          id: "lti-session-1",
          channel: "lti",
          lti_context: { insightsAccess: true },
        },
      ],
      fields: [],
    });
    const repository = createPostgresRepository(pool);
    const token = "lti-session-bearer-token";
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await expect(
      repository.getLtiSessionByTokenHash?.(tokenHash),
    ).resolves.toMatchObject({
      id: "lti-session-1",
      channel: "lti",
      ltiContext: { insightsAccess: true },
    });

    expect(query.mock.calls[0]?.[0]).toContain("token_hash = $1");
    expect(query.mock.calls[0]?.[0]).toContain("expires_at > now()");
    expect(query.mock.calls[0]?.[1]).toEqual([tokenHash]);
    expect(query.mock.calls[0]?.[1]).not.toContain(token);

    await pool.end();
  });
});
