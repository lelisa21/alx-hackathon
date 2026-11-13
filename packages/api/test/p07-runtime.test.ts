import { describe, expect, it, vi } from "vitest";
import {
  createSmsCallback,
  SMS_CALLBACK_VERSION,
  withSmsJobsDelivery,
} from "../src/sms-runtime.js";
import { parseConfig } from "../src/config.js";
import type { SmsApiService } from "../src/sms-runtime.js";
const environment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost/test",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "synthetic-jwt-secret-with-32-characters",
  DIMTS_CRON_SECRET: "synthetic-cron-secret-long-enough",
};
describe("P07 host callback and P06 delivery wiring", () => {
  it("fails closed instead of bypassing SMS budgets through a legacy host relay", async () => {
    const host = {
      channels: ["sms" as const, "telegram" as const],
      relayAvailable: true,
      sendDigest: vi.fn(async () => undefined),
      sendAccommodation: vi.fn(async () => undefined),
    };
    const port = withSmsJobsDelivery(host, () => undefined, false);
    expect(port.channels).toEqual(["telegram"]);
    await expect(
      port.sendDigest({
        channel: "sms",
        contact: "+251900000010",
        text: "Synthetic digest",
        lang: "en",
        jobs: [],
        idempotencyKey: "disabled-digest",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(host.sendDigest).not.toHaveBeenCalled();
  });
  it("keeps callbacks unavailable until both host credentials exist", () => {
    expect(createSmsCallback(parseConfig(environment))).toBeUndefined();
  });
  it("requires the versioned, matching receipt and suppresses host error details", async () => {
    const config = parseConfig({
      ...environment,
      DIMTS_SMS_CALLBACK_URL: "https://host.example/callback",
      DIMTS_SMS_CALLBACK_SECRET: "synthetic-callback-secret-long-enough",
    });
    const input = {
      from: "+251900000010",
      sessionId: "synthetic-session",
      lang: "om",
      idempotencyKey: "callback-one",
    };
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        version: SMS_CALLBACK_VERSION,
        accepted: true,
        idempotencyKey: input.idempotencyKey,
      }),
    );
    const callback = createSmsCallback(config, transport)!;
    await callback(input);
    const init = transport.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({
      version: SMS_CALLBACK_VERSION,
      ...input,
    });
    transport.mockResolvedValueOnce(
      Response.json({
        version: SMS_CALLBACK_VERSION,
        accepted: true,
        idempotencyKey: "wrong",
      }),
    );
    await expect(callback(input)).rejects.toMatchObject({
      code: "unavailable",
      lang: "om",
    });
    transport.mockRejectedValueOnce(
      new Error(`${input.from} private operator error`),
    );
    await expect(callback(input)).rejects.toThrow("unavailable");
  });
  it("uses native SMS for digests while preserving Telegram and host accommodation behavior", async () => {
    const host = {
      channels: ["telegram" as const],
      relayAvailable: true,
      sendDigest: vi.fn(async () => undefined),
      sendAccommodation: vi.fn(async () => undefined),
    };
    const sms = {
      sendAlert: vi.fn(async () => undefined),
    } as unknown as SmsApiService;
    const port = withSmsJobsDelivery(host, () => sms, true);
    const digest = {
      channel: "sms" as const,
      contact: "+251900000010",
      lang: "en",
      text: "Synthetic digest",
      jobs: [],
      idempotencyKey: "digest-one",
    };
    await port.sendDigest(digest);
    expect(sms.sendAlert).toHaveBeenCalledWith({
      contact: digest.contact,
      text: digest.text,
      lang: digest.lang,
      idempotencyKey: digest.idempotencyKey,
    });
    expect(host.sendDigest).not.toHaveBeenCalled();
    await port.sendDigest({ ...digest, channel: "telegram" });
    expect(host.sendDigest).toHaveBeenCalledOnce();
    const accommodation = {
      to: "host@example.org",
      message: "Approved request",
      lang: "en",
      idempotencyKey: "request-one",
    };
    await port.sendAccommodation(accommodation);
    expect(host.sendAccommodation).toHaveBeenCalledWith(accommodation);
    expect(port.channels).toEqual(["telegram", "sms"]);
    expect(port.relayAvailable).toBe(true);
    expect(
      withSmsJobsDelivery({ ...host, relayAvailable: false }, () => sms, true)
        .relayAvailable,
    ).toBe(false);
  });
});
