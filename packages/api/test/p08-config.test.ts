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
 ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
 HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
 JWT_SECRET: "synthetic-jwt-secret-at-least-32-characters",
 CRON_SECRET: "synthetic-cron-secret-at-least-24-characters",
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
    expect(parseConfig(base).TELEGRAM_MODE).toBe("webhook");
    const config = parseConfig({
      ...base,
     TELEGRAM_TOKEN: "",
     TELEGRAM_SECRET: "",
    });
    expect(config.TELEGRAM_TOKEN).toBeUndefined();
    expect(config.TELEGRAM_SECRET).toBeUndefined();
  });
  it("requires a valid token and separate webhook secret when enabled", () => {
    expect(() =>
      parseConfig({ ...base,TELEGRAM_TOKEN: token }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
       TELEGRAM_TOKEN: "invalid",
       TELEGRAM_SECRET: secret,
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
       TELEGRAM_TOKEN: token,
       TELEGRAM_SECRET: base.CRON_SECRET,
      }),
    ).toThrow();
    expect(
      parseConfig({
        ...base,
       TELEGRAM_TOKEN: token,
       TELEGRAM_SECRET: secret,
      }).TELEGRAM_TOKEN,
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
       TELEGRAM_TOKEN: token,
       TELEGRAM_SECRET: value,
      }),
    ).toThrow();
  });
  it("allows explicit local polling but forbids it on hosted production", () => {
    expect(
      parseConfig({
        ...base,
       TELEGRAM_TOKEN: token,
       TELEGRAM_MODE: "polling",
      }).TELEGRAM_MODE,
    ).toBe("polling");
    expect(() =>
      parseConfig({
        ...base,
        NODE_ENV: "production",
       TELEGRAM_TOKEN: token,
       TELEGRAM_MODE: "polling",
       TELEGRAM_SECRET: secret,
      }),
    ).toThrow();
  });
});

describe("Telegram mode defaults", () => {
  const base = {
    DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
   ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
   HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
   JWT_SECRET: Buffer.alloc(32, 3).toString("base64"),
   CRON_SECRET: "a-cron-secret-that-is-long-enough",
  };
  it("polls in development and uses webhooks elsewhere when unset or empty", () => {
    expect(
      parseConfig({ ...base, NODE_ENV: "development" }).TELEGRAM_MODE,
    ).toBe("polling");
    expect(
      parseConfig({ ...base, NODE_ENV: "development",TELEGRAM_MODE: "" })
        .TELEGRAM_MODE,
    ).toBe("polling");
    expect(
      parseConfig({ ...base, NODE_ENV: "production" }).TELEGRAM_MODE,
    ).toBe("webhook");
    expect(parseConfig({ ...base, NODE_ENV: "test" }).TELEGRAM_MODE).toBe(
      "webhook",
    );
  });

  it("does not require a webhook secret for a development polling bot", () => {
    expect(
      parseConfig({
        ...base,
        NODE_ENV: "development",
       TELEGRAM_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      }).TELEGRAM_MODE,
    ).toBe("polling");
  });
});
