// FR-TG-08 / NFR-SEC: hosted webhook credentials and local-only polling.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import {
  HelpQueueResponseSchema,
  SessionRequestSchema,
} from "../src/schemas.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost/test",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "synthetic-jwt-secret-at-least-32-characters",
  DIMTS_CRON_SECRET: "synthetic-cron-secret-at-least-24-characters",
};
const token = "123456789:synthetic_telegram_token_for_tests_only";
const secret = "synthetic-telegram-webhook-secret-only";
describe("P08 Telegram configuration", () => {
  it("allows Telegram in the helper queue without allowing public web session creation for that channel", () => {
    expect(
      HelpQueueResponseSchema.safeParse({
        requests: [
          {
            id: "telegram-help-12345",
            lang: "en",
            channel: "telegram",
            createdAt: "2026-11-13T00:00:00Z",
            summary: null,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      SessionRequestSchema.safeParse({ lang: "en", channel: "telegram" })
        .success,
    ).toBe(false);
  });
  it("defaults to webhook, disabled without a token, and accepts empty optional environment values", () => {
    expect(parseConfig(base).DIMTS_TELEGRAM_MODE).toBe("webhook");
    const config = parseConfig({
      ...base,
      DIMTS_TELEGRAM_TOKEN: "",
      DIMTS_TELEGRAM_SECRET: "",
    });
    expect(config.DIMTS_TELEGRAM_TOKEN).toBeUndefined();
    expect(config.DIMTS_TELEGRAM_SECRET).toBeUndefined();
  });
  it("requires a valid token and separate webhook secret when enabled", () => {
    expect(() =>
      parseConfig({ ...base, DIMTS_TELEGRAM_TOKEN: token }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
        DIMTS_TELEGRAM_TOKEN: "invalid",
        DIMTS_TELEGRAM_SECRET: secret,
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
        DIMTS_TELEGRAM_TOKEN: token,
        DIMTS_TELEGRAM_SECRET: base.DIMTS_CRON_SECRET,
      }),
    ).toThrow();
    expect(
      parseConfig({
        ...base,
        DIMTS_TELEGRAM_TOKEN: token,
        DIMTS_TELEGRAM_SECRET: secret,
      }).DIMTS_TELEGRAM_TOKEN,
    ).toBe(token);
  });
  it.each([
    "short",
    "space invalid secret is not valid",
    "bad.secret.with.enough.characters",
  ])("rejects invalid standard secret syntax: %s", (value) => {
    expect(() =>
      parseConfig({
        ...base,
        DIMTS_TELEGRAM_TOKEN: token,
        DIMTS_TELEGRAM_SECRET: value,
      }),
    ).toThrow();
  });
  it("allows explicit local polling but forbids it on hosted production", () => {
    expect(
      parseConfig({
        ...base,
        DIMTS_TELEGRAM_TOKEN: token,
        DIMTS_TELEGRAM_MODE: "polling",
      }).DIMTS_TELEGRAM_MODE,
    ).toBe("polling");
    expect(() =>
      parseConfig({
        ...base,
        NODE_ENV: "production",
        DIMTS_TELEGRAM_TOKEN: token,
        DIMTS_TELEGRAM_MODE: "polling",
        DIMTS_TELEGRAM_SECRET: secret,
      }),
    ).toThrow();
  });
});
