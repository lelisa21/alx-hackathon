import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { formatUsage, collectUsage } from "./usage.mjs";
import { purgeEventData } from "./purge-event-data.mjs";
import { validateSeedHelperToken } from "./seed.mjs";
import { nextUtcRun } from "./local-scheduler.mjs";

describe("P11 operations", () => {
  it("reports the PostgreSQL size and warns at the configured budget", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ name: "dimts", bytes: "629145600" }],
        })
        .mockResolvedValueOnce({
          rows: [{ schema: "public", name: "session", bytes: "1024" }],
        })
        .mockResolvedValueOnce({
          rows: [{ sessions: "3", messages: "7" }],
        }),
    };

    const usage = await collectUsage(client);
    expect(usage).toEqual({
      name: "dimts",
      bytes: 629145600,
      tables: [{ schema: "public", name: "session", bytes: 1024 }],
      sessions: 3,
      messages: 7,
    });
    expect(client.query.mock.calls[0][0]).toContain("pg_database_size");
    expect(formatUsage(usage)).toContain("WARNING:");
  });

  it("keeps the purge read-only unless apply is explicitly selected", async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [{ count: "0" }] })),
    };

    const counts = await purgeEventData(client);

    expect(counts).toHaveLength(10);
    expect(client.query).toHaveBeenCalledTimes(10);
    expect(client.query.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(
      false,
    );
  });

  it("requires a canonical 32-byte base64url seed token", () => {
    const token = randomBytes(32).toString("base64url");

    expect(validateSeedHelperToken(token)).toBe(token);
    expect(() =>
      validateSeedHelperToken("generate-a-random-local-token"),
    ).toThrow(/32-byte base64url/u);
  });

  it("schedules each local job at its next UTC occurrence", () => {
    expect(
      nextUtcRun(6, 0, new Date("2026-11-13T05:59:00.000Z")).toISOString(),
    ).toBe("2026-11-13T06:00:00.000Z");
    expect(
      nextUtcRun(7, 30, new Date("2026-11-13T07:30:00.000Z")).toISOString(),
    ).toBe("2026-11-14T07:30:00.000Z");
  });
});
