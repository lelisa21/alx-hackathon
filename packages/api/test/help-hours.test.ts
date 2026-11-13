import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { isHelperAvailable } from "../src/help-hours.js";

const secrets = [
  Buffer.alloc(32, 1).toString("base64"),
  Buffer.alloc(32, 2).toString("base64"),
  Buffer.alloc(32, 3).toString("base64"),
];

const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: secrets[0],
  DIMTS_HASH_KEY: secrets[1],
  DIMTS_JWT_SECRET: secrets[2],
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
};

describe("WP07 helper availability hours", () => {
  it("uses UTC weekly intervals and treats omitted hours as unrestricted", () => {
    const config = parseConfig({
      ...validEnv,
      DIMTS_HELPER_HOURS: JSON.stringify([
        { day: 1, start: "09:00", end: "17:00" },
      ]),
    });

    expect(
      isHelperAvailable(
        config.DIMTS_HELPER_HOURS,
        new Date("2025-03-03T08:59:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isHelperAvailable(
        config.DIMTS_HELPER_HOURS,
        new Date("2025-03-03T09:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isHelperAvailable(
        config.DIMTS_HELPER_HOURS,
        new Date("2025-03-03T17:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isHelperAvailable(
        parseConfig(validEnv).DIMTS_HELPER_HOURS,
        new Date("2025-03-03T00:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("rejects malformed, overlapping, and overnight intervals", () => {
    for (const hours of [
      [{ day: 0, start: "09:00", end: "17:00" }],
      [{ day: 1, start: "9:00", end: "17:00" }],
      [{ day: 1, start: "17:00", end: "09:00" }],
      [
        { day: 1, start: "09:00", end: "12:00" },
        { day: 1, start: "11:00", end: "13:00" },
      ],
    ]) {
      expect(() =>
        parseConfig({
          ...validEnv,
          DIMTS_HELPER_HOURS: JSON.stringify(hours),
        }),
      ).toThrow(/DIMTS_HELPER_HOURS/u);
    }
  });

  it("treats an empty configured schedule as unavailable", () => {
    const config = parseConfig({
      ...validEnv,
      DIMTS_HELPER_HOURS: "[]",
    });

    expect(
      isHelperAvailable(
        config.DIMTS_HELPER_HOURS,
        new Date("2025-03-03T12:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
