// FR-SMS: SMS Ethiopia is configured with its API key only; the base URL is fixed.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { smsConfigured, smsGatewayOptions } from "../src/sms-runtime.js";

const base = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
 ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
 HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
 JWT_SECRET: Buffer.alloc(32, 3).toString("base64"),
 CRON_SECRET: "a-cron-secret-that-is-long-enough",
 SMS_GATEWAY_SECRET: "inbound-secret-that-is-long-enough-1",
};
const KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD";

describe("SMS Ethiopia configuration", () => {
  it("accepts smsethiopia mode with only the API key", () => {
    const config = parseConfig({
      ...base,
     SMS_MODE: "smsethiopia",
     SMS_GATEWAY_TOKEN: KEY,
    });
    expect(smsConfigured(config)).toBe(true);
    expect(smsGatewayOptions(config)).toEqual({
      type: "smsethiopia",
      token: KEY,
    });
  });

  it("requires the API key in smsethiopia mode", () => {
    expect(() =>
      parseConfig({ ...base,SMS_MODE: "smsethiopia" }),
    ).toThrow(/SMS_GATEWAY_TOKEN/u);
  });

  it("keeps the generic bridge and simulator behaviour", () => {
    expect(
      smsGatewayOptions(parseConfig({ ...base,SMS_MODE: "simulator" })),
    ).toEqual({ type: "simulator" });
    expect(() =>
      parseConfig({
        ...base,
       SMS_MODE: "gateway",
       SMS_GATEWAY_TOKEN: KEY,
      }),
    ).toThrow(/SMS_GATEWAY_URL/u);
  });
});
