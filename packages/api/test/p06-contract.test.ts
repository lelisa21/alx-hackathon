import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import {
  AccommodationRequestSchema,
  AccommodationResponseSchema,
  JobsQuerySchema,
  SubscriptionRequestSchema,
} from "../src/jobs-schemas.js";
import { createHostJobsDelivery } from "../src/jobs-delivery.js";
import { generateOpenApiYaml } from "../src/openapi.js";

const env = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost/test",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "test-only-jwt-secret-with-enough-characters",
  DIMTS_CRON_SECRET: "test-only-cron-secret-with-enough-characters",
};

describe("P06 FR-JOB-01/04/05/09/10 and FR-INT-07 API contracts", () => {
  it("requires explicit consent and rejects diagnosis and server support filters", () => {
    const subscription = {
      sessionId: "session-a",
      clientRequestId: "request-a",
      lang: "en",
      channel: "sms",
      contact: "+251911111111",
      consent: { accepted: true, noticeVersion: "job-alerts-v1" },
    };
    expect(SubscriptionRequestSchema.safeParse(subscription).success).toBe(
      true,
    );
    expect(
      SubscriptionRequestSchema.safeParse({
        ...subscription,
        consent: undefined,
      }).success,
    ).toBe(false);
    expect(
      SubscriptionRequestSchema.safeParse({
        ...subscription,
        consent: { accepted: false, noticeVersion: "job-alerts-v1" },
      }).success,
    ).toBe(false);
    expect(
      JobsQuerySchema.safeParse({
        sessionId: "session-a",
        support: "extra_time",
      }).success,
    ).toBe(false);
    expect(
      AccommodationRequestSchema.safeParse({
        action: "approve",
        sessionId: "session-a",
        id: "request-a",
      }).success,
    ).toBe(false);
    expect(
      AccommodationRequestSchema.safeParse({
        action: "draft",
        sessionId: "session-a",
        clientRequestId: "request-a",
        jobId: "job-a",
        lang: "en",
        needs: ["extra_time"],
        diagnosis: "private",
      }).success,
    ).toBe(false);
  });

  it("documents every canonical career endpoint", () => {
    const document = generateOpenApiYaml();
    for (const endpoint of [
      "/v1/jobs/import",
      "/v1/jobs:",
      "/v1/subscriptions:",
      "/v1/subscriptions/{id}",
      "/v1/accommodation-requests",
      "/v1/internal/alerts",
    ])
      expect(document).toContain(endpoint);
  });

  it("accepts an erased cancelled response without requiring retained private needs", () => {
    expect(
      AccommodationResponseSchema.safeParse({
        id: "request-id",
        jobId: "job-id",
        lang: "en",
        revision: 1,
        status: "cancelled",
        sendAttempted: false,
        message: "",
        needs: [],
      }).success,
    ).toBe(true);
  });

  it("requires the durable delivery-attempt marker for safe restoration", () => {
    const response = {
      id: "request-id",
      jobId: "job-id",
      lang: "en",
      revision: 1,
      status: "approved",
      message: "Synthetic approved message",
      needs: ["extra_time"],
      sendAttempted: true,
    };
    expect(AccommodationResponseSchema.safeParse(response).success).toBe(true);
    expect(
      AccommodationResponseSchema.safeParse({
        ...response,
        sendAttempted: undefined,
      }).success,
    ).toBe(false);
  });

  it.each([
    null,
    {
      version: "dimts.jobs.delivery.v1",
      accepted: false,
      idempotencyKey: "test-key",
    },
    {
      version: "dimts.jobs.delivery.v1",
      accepted: true,
      idempotencyKey: "wrong-key",
    },
    { accepted: true, idempotencyKey: "test-key" },
  ])("rejects an unconfirmed delivery receipt %#", async (receipt) => {
    const delivery = createHostJobsDelivery(
      parseConfig({
        ...env,
        DIMTS_JOBS_RELAY_URL: "https://relay.example/deliver",
        DIMTS_JOBS_RELAY_SECRET: "relay-secret-with-enough-characters",
      }),
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(receipt)),
    );
    await expect(
      delivery.sendAccommodation({
        to: "employer@example.org",
        message: "Synthetic text",
        lang: "en",
        idempotencyKey: "test-key",
      }),
    ).rejects.toThrow("delivery_failed");
  });

  it("fails closed for incomplete, insecure or ambiguous relay configuration", () => {
    expect(() =>
      parseConfig({
        ...env,
        DIMTS_JOBS_RELAY_URL: "https://relay.example/deliver",
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...env,
        DIMTS_JOBS_RELAY_URL: "http://relay.example/deliver",
        DIMTS_JOBS_RELAY_SECRET: "relay-secret-with-enough-characters",
      }),
    ).toThrow();
    expect(() =>
      parseConfig({ ...env, DIMTS_JOBS_RELAY_CHANNELS: "sms" }),
    ).toThrow();
    expect(() =>
      parseConfig({ ...env, DIMTS_JOBS_RELAY_CHANNELS: "email" }),
    ).toThrow();
    expect(createHostJobsDelivery(parseConfig(env)).channels).toEqual([]);
    expect(createHostJobsDelivery(parseConfig(env)).relayAvailable).toBe(false);
  });

  it("uses real host HTTP, a versioned payload and stable idempotency for safe retries", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(
        Response.json({
          version: "dimts.jobs.delivery.v1",
          accepted: true,
          idempotencyKey: "request-stable-key",
        }),
      );
    const delivery = createHostJobsDelivery(
      parseConfig({
        ...env,
        DIMTS_JOBS_RELAY_URL: "https://relay.example/deliver",
        DIMTS_JOBS_RELAY_SECRET: "relay-secret-with-enough-characters",
        DIMTS_JOBS_RELAY_CHANNELS: "sms",
      }),
      transport,
    );
    expect(delivery.channels).toEqual(["sms"]);
    const input = {
      to: "employer@example.org",
      message: "Synthetic approved text",
      lang: "en",
      idempotencyKey: "request-stable-key",
    };
    await expect(delivery.sendAccommodation(input)).rejects.toThrow();
    await delivery.sendAccommodation(input);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const [, options] of transport.mock.calls) {
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toMatchObject({
        "Idempotency-Key": "request-stable-key",
      });
      expect(JSON.parse(String(options?.body))).toEqual({
        version: "dimts.jobs.delivery.v1",
        kind: "accommodation",
        ...input,
      });
    }
  });

  it("never reports success for unconfigured or failed channels", async () => {
    const unavailable = createHostJobsDelivery(parseConfig(env));
    await expect(
      unavailable.sendAccommodation({
        to: "employer@example.org",
        message: "Synthetic text",
        lang: "en",
        idempotencyKey: "test-key",
      }),
    ).rejects.toThrow();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const configured = createHostJobsDelivery(
      parseConfig({
        ...env,
        DIMTS_JOBS_RELAY_URL: "https://relay.example/deliver",
        DIMTS_JOBS_RELAY_SECRET: "relay-secret-with-enough-characters",
      }),
      transport,
    );
    await expect(
      configured.sendAccommodation({
        to: "employer@example.org",
        message: "Synthetic text",
        lang: "en",
        idempotencyKey: "test-key",
      }),
    ).rejects.toThrow();
  });
});
