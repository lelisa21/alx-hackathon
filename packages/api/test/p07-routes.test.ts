import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import type { ApiRepository } from "../src/types.js";
import { SmsError } from "@dimts/sms";
import { loadPacks } from "@dimts/locales-tools";
import { resolve } from "node:path";
import { generateOpenApiYaml } from "../src/openapi.js";
import { SmsInboundRequestSchema } from "../src/sms-schemas.js";

const secret = "sms-inbound-secret-is-separate-and-long";
const environment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost/test",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "test-jwt-secret-is-at-least-32-characters",
  DIMTS_CRON_SECRET: "test-cron-secret-at-least-24-characters",
  DIMTS_SMS_GATEWAY_SECRET: secret,
};
const body = { id: "synthetic-inbound-1", from: "+251900000001", text: "HELP" };
function setup(config = parseConfig(environment)) {
  const inbound = vi.fn(async () => ({
    messages: [
      {
        id: "out-1",
        text: "Synthetic reply",
        encoding: "gsm7" as const,
        units: 15,
        segments: 1,
        status: "delivered" as const,
      },
    ],
    stopped: false,
    lang: "en",
  }));
  const app = buildApp({
    config,
    repository: {} as ApiRepository,
    smsService: { inbound, sendAlert: vi.fn(async () => undefined) },
  });
  return { app, inbound };
}
describe("P07 gateway boundary FR-SMS-01/02/09", () => {
  it("requires a separate gateway bearer before exposing the shared inbound path", async () => {
    const { app, inbound } = setup();
    await request(app).post("/v1/sms/inbound").send(body).expect(401);
    await request(app)
      .post("/v1/sms/inbound")
      .set("Authorization", `Bearer ${environment.DIMTS_CRON_SECRET}`)
      .send(body)
      .expect(401);
    expect(inbound).not.toHaveBeenCalled();
    const response = await request(app)
      .post("/v1/sms/inbound")
      .set("Authorization", `Bearer ${secret}`)
      .send(body)
      .expect(200);
    expect(inbound).toHaveBeenCalledExactlyOnceWith(body);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      stopped: false,
      lang: "en",
      messages: [{ encoding: "gsm7", segments: 1 }],
    });
  });
  it.each([
    { ...body, from: "0900000001" },
    { ...body, id: "a".repeat(129) },
    { ...body, id: "bad/id" },
    { ...body, text: " " },
    { ...body, text: "x".repeat(1001) },
    { ...body, unexpected: true },
  ])(
    "rejects invalid and unbounded gateway input without dispatch",
    async (input) => {
      const { app, inbound } = setup();
      const response = await request(app)
        .post("/v1/sms/inbound")
        .set("Authorization", `Bearer ${secret}`)
        .send(input)
        .expect(400);
      expect(response.body.messageKey).toBe("error.invalid");
      expect(inbound).not.toHaveBeenCalled();
    },
  );
  it("fails closed without the inbound secret", async () => {
    const { app, inbound } = setup(
      parseConfig({ ...environment, DIMTS_SMS_GATEWAY_SECRET: "" }),
    );
    await request(app)
      .post("/v1/sms/inbound")
      .set("Authorization", `Bearer ${secret}`)
      .send(body)
      .expect(503);
    expect(inbound).not.toHaveBeenCalled();
  });
  it("validates mode, separate secrets and paired HTTPS operator/callback settings", () => {
    expect(() =>
      parseConfig({ ...environment, DIMTS_SMS_MODE: "fake" }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...environment,
        DIMTS_SMS_GATEWAY_SECRET: environment.DIMTS_CRON_SECRET,
      }),
    ).toThrow();
    for (const prefix of ["DIMTS_SMS_GATEWAY", "DIMTS_SMS_CALLBACK"]) {
      const credential = prefix.endsWith("GATEWAY") ? "TOKEN" : "SECRET";
      expect(() =>
        parseConfig({
          ...environment,
          [`${prefix}_URL`]: "https://relay.example/sms",
        }),
      ).toThrow();
      expect(() =>
        parseConfig({
          ...environment,
          [`${prefix}_URL`]: "http://relay.example/sms",
          [`${prefix}_${credential}`]: secret,
        }),
      ).toThrow();
    }
  });
  it("validates authentication before the inbound contract and never echoes private input", async () => {
    const { app, inbound } = setup();
    const response = await request(app)
      .post("/v1/sms/inbound")
      .send({ from: body.from, text: "Private invalid input" })
      .expect(401);
    expect(JSON.stringify(response.body)).not.toContain(body.from);
    expect(JSON.stringify(response.body)).not.toContain(
      "Private invalid input",
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(inbound).not.toHaveBeenCalled();
  });
  it("localizes domain errors using the established conversation language", async () => {
    const { app, inbound } = setup();
    inbound.mockRejectedValueOnce(new SmsError("rate_limited", "am"));
    const response = await request(app)
      .post("/v1/sms/inbound")
      .set("Authorization", `Bearer ${secret}`)
      .send(body)
      .expect(429);
    const strings = loadPacks(resolve("locales")).get("am")!.sms as Record<
      string,
      string
    >;
    expect(response.body).toMatchObject({
      code: "rate_limited",
      lang: "am",
      message: strings.limit,
    });
    expect(response.headers["content-language"]).toBe("am");
    expect(JSON.stringify(response.body)).not.toContain(body.from);
  });
  it.each(["invalid", "conflict", "unavailable", "delivery_failed"] as const)(
    "maps the domain error %s without private details",
    async (code) => {
      const { app, inbound } = setup();
      inbound.mockRejectedValueOnce(new SmsError(code, "en"));
      const status = {
        invalid: 400,
        conflict: 409,
        unavailable: 503,
        delivery_failed: 503,
      }[code];
      const response = await request(app)
        .post("/v1/sms/inbound")
        .set("Authorization", `Bearer ${secret}`)
        .send(body)
        .expect(status);
      expect(response.body.lang).toBe("en");
      expect(typeof response.body.message).toBe("string");
      if (code === "unavailable" || code === "delivery_failed")
        expect(response.body.messageKey).toBe("sms.error");
      expect(JSON.stringify(response.body)).not.toContain(body.from);
    },
  );
  it("requires operator credentials in gateway mode and bounds the daily cap", () => {
    expect(() =>
      parseConfig({ ...environment, DIMTS_SMS_MODE: "gateway" }),
    ).toThrow();
    for (const limit of [0, 1001, 1.5])
      expect(() =>
        parseConfig({ ...environment, DIMTS_SMS_DAILY_LIMIT: limit }),
      ).toThrow();
    expect(parseConfig(environment).DIMTS_SMS_DAILY_LIMIT).toBe(20);
    expect(
      parseConfig({
        ...environment,
        DIMTS_SMS_MODE: "gateway",
        DIMTS_SMS_GATEWAY_URL: "https://relay.example/sms",
        DIMTS_SMS_GATEWAY_TOKEN: "separate-operator-token-at-least-24",
      }).DIMTS_SMS_MODE,
    ).toBe("gateway");
  });
  it("counts inbound Unicode code points and documents the canonical route", () => {
    expect(
      SmsInboundRequestSchema.safeParse({ ...body, text: "😀".repeat(1000) })
        .success,
    ).toBe(true);
    expect(
      SmsInboundRequestSchema.safeParse({ ...body, text: "😀".repeat(1001) })
        .success,
    ).toBe(false);
    const document = generateOpenApiYaml();
    expect(document).toContain("/v1/sms/inbound:");
    expect(document).toContain("smsGatewayBearer:");
    expect(document).toContain("SmsInboundRequest:");
  });
  it("authenticates before malformed JSON and bounds JSON bytes with private no-store errors", async () => {
    const { app, inbound } = setup();
    const unauthorized = await request(app)
      .post("/v1/sms/inbound")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(401);
    expect(unauthorized.headers["cache-control"]).toBe("no-store");
    const malformed = await request(app)
      .post("/v1/sms/inbound")
      .set("Authorization", `Bearer ${secret}`)
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
    expect(malformed.headers["cache-control"]).toBe("no-store");
    const oversized = await request(app)
      .post("/v1/sms/inbound")
      .set("Authorization", `Bearer ${secret}`)
      .send({ ...body, text: "x".repeat(20_000) })
      .expect(413);
    expect(oversized.body.code).toBe("payload_too_large");
    expect(oversized.headers["cache-control"]).toBe("no-store");
    expect(inbound).not.toHaveBeenCalled();
  });
});
