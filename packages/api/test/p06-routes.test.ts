import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { JobsError } from "@dimts/jobs";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { sha256 } from "../src/middleware/auth.js";
import type { ApiRepository } from "../src/types.js";

const token = "session-token-with-enough-characters";
const config = parseConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost/test",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "test-only-jwt-secret-with-enough-characters",
  DIMTS_CRON_SECRET: "test-only-cron-secret-with-enough-characters",
});
function setup() {
  const service = {
    authorizeImporter: vi.fn(
      async (key: string) => key === sha256("secret-host-key"),
    ),
    importJobs: vi.fn(async () => ({
      imported: 1,
      errors: [{ index: 1, reason: "invalid_job_posting" }],
    })),
    listJobs: vi.fn(async () => []),
    subscribe: vi.fn(async () => ({
      id: "subscription-id",
      status: "active" as const,
    })),
    listSubscriptions: vi.fn(async () => []),
    stopSubscription: vi.fn(async () => true),
    accommodation: vi.fn(async () => ({
      id: "request-id",
      revision: 1,
      status: "draft" as const,
      sendAttempted: false,
      message: "Synthetic draft",
      jobId: "job-id",
      lang: "en",
      needs: ["extra_time" as const],
    })),
    listAccommodationRequests: vi.fn(async () => []),
    runAlerts: vi.fn(async () => ({
      matched: 1,
      sent: 0,
      skipped: 1,
      failed: 0,
    })),
    cleanupExpired: vi.fn(async () => undefined),
  };
  const repository = {
    getSessionTokenHash: async (id: string) =>
      id === "session-owner" ? sha256(token) : null,
    touchSession: async () => undefined,
    runRetention: vi.fn(async () => undefined),
  } as unknown as ApiRepository;
  const app = buildApp({ config, repository, jobsService: service });
  return { app, service, repository };
}
describe("P06 authenticated career REST routes", () => {
  it("cleans expired private career data every minute without enabling alert delivery", async () => {
    vi.useFakeTimers();
    const { app, service } = setup();
    try {
      await vi.advanceTimersByTimeAsync(60000);
      expect(service.cleanupExpired.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      );
      expect(service.runAlerts).not.toHaveBeenCalled();
    } finally {
      await app.locals.close();
      vi.useRealTimers();
    }
  });
  it("FR-INT-07 permits only a secret host import and returns partial failure indexes", async () => {
    const { app, service } = setup();
    await request(app)
      .post("/v1/jobs/import")
      .set("x-dimts-key", "public-widget-key")
      .send({ lang: "en", postings: [] })
      .expect(401);
    const result = await request(app)
      .post("/v1/jobs/import")
      .set("x-dimts-key", "secret-host-key")
      .send({ lang: "en", postings: { "@graph": [] } })
      .expect(200);
    expect(result.body).toEqual({
      imported: 1,
      errors: [{ index: 1, reason: "invalid_job_posting" }],
    });
    expect(service.importJobs).toHaveBeenCalledOnce();
  });
  it("enforces session authentication, validated filters and truthful availability", async () => {
    const { app, service } = setup();
    await request(app).get("/v1/jobs?sessionId=session-owner").expect(401);
    const result = await request(app)
      .get("/v1/jobs?sessionId=session-owner&region=Addis&type=part-time")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(result.body).toMatchObject({
      jobs: [],
      channels: [],
      relayAvailable: false,
    });
    expect(service.listJobs).toHaveBeenCalledWith({
      lang: "en",
      region: "Addis",
      type: "part-time",
    });
    await request(app)
      .get("/v1/jobs?sessionId=session-owner&support=extra_time")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
    await request(app)
      .get("/v1/jobs?sessionId=session-owner&lang=zz")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
  });
  it("FR-JOB-01/03/10 requires consent, scopes Stop to the owner, and restores safe metadata", async () => {
    const { app, service } = setup();
    const body = {
      sessionId: "session-owner",
      clientRequestId: "request-one",
      lang: "en",
      channel: "sms",
      contact: "+251911111111",
    };
    await request(app)
      .post("/v1/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send(body)
      .expect(400);
    await request(app)
      .post("/v1/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...body,
        consent: { accepted: true, noticeVersion: "job-alerts-v1" },
      })
      .expect(201);
    await request(app)
      .delete("/v1/subscriptions/subscription-id?sessionId=someone-else")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(service.stopSubscription).not.toHaveBeenCalled();
    await request(app)
      .delete("/v1/subscriptions/subscription-id?sessionId=session-owner")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(service.stopSubscription).toHaveBeenCalledWith({
      sessionId: "session-owner",
      id: "subscription-id",
    });
    await request(app)
      .get("/v1/subscriptions?sessionId=session-owner")
      .set("Authorization", `Bearer ${token}`)
      .expect(200, { subscriptions: [] });
  });
  it("FR-JOB-04/05 rejects unversioned send, hides private failure details and serves no-store drafts", async () => {
    const { app, service } = setup();
    await request(app)
      .post("/v1/accommodation-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "send", sessionId: "session-owner", id: "request-id" })
      .expect(400);
    expect(service.accommodation).not.toHaveBeenCalled();
    const result = await request(app)
      .post("/v1/accommodation-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "resume", sessionId: "session-owner", id: "request-id" })
      .expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    service.accommodation.mockRejectedValueOnce(
      new JobsError("delivery_failed"),
    );
    await request(app)
      .post("/v1/accommodation-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({
        action: "send",
        sessionId: "session-owner",
        id: "request-id",
        revision: 1,
      })
      .expect(503);
  });
  it("FR-JOB-09 protects the runner with cron auth and passes dry run without mutation", async () => {
    const { app, service } = setup();
    await request(app).post("/v1/internal/alerts?dry=1").expect(401);
    await request(app)
      .post("/v1/internal/alerts?dry=1")
      .set("Authorization", `Bearer ${config.DIMTS_CRON_SECRET}`)
      .expect(200);
    expect(service.runAlerts).toHaveBeenCalledWith({ dryRun: true });
    await request(app)
      .post("/v1/internal/alerts?dry=yes")
      .set("Authorization", `Bearer ${config.DIMTS_CRON_SECRET}`)
      .expect(400);
  });
  it("NFR-SEC-09 bounds subscription creation abuse", async () => {
    const { app, service } = setup();
    const input = {
      sessionId: "session-owner",
      clientRequestId: "subscription-request",
      lang: "en",
      channel: "sms",
      contact: "+251911111111",
      consent: { accepted: true, noticeVersion: "job-alerts-v1" },
    };
    for (let index = 0; index < 30; index++) {
      await request(app)
        .post("/v1/subscriptions")
        .set("Authorization", `Bearer ${token}`)
        .send(input)
        .expect(201);
    }
    await request(app)
      .post("/v1/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send(input)
      .expect(429);
    expect(service.subscribe).toHaveBeenCalledTimes(30);
    await app.locals.close();
  });
});
