/**
 * P09: Insights API tests
 * Tests for GET /v1/insights endpoint
 * Requirements: FR-INSIGHT-01–04, FR-UI-20, NFR-PRIV-03
 */

import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import type { ApiRepository } from "../src/types.js";
import type { InsightsRepository } from "@dimts/insights";

describe("GET /v1/insights", () => {
  let mockRepository: ApiRepository;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    // Mock repository
    mockRepository = {
      ping: async () => true,
      runRetention: async () => {},
      deleteSessionData: async () => {},
      getHostByHash: async () => null,
      verifyHostKey: async (key: string) => {
        if (key === "valid-key") {
          return { id: "host-1", name: "Test Host" };
        }
        return null;
      },
      getInsightsRepository: () => {
        const mockInsightsRepo: InsightsRepository = {
          async queryInsights() {
            return [
              {
                topic_id: "unit-1",
                lang: "en",
                period: "2026-11-13",
                question_count: 10,
                notfound_count: 1,
                helpful: 5,
                unhelpful: 2,
              },
            ];
          },
          async topicLabel() {
            return null;
          },
        };
        return mockInsightsRepo;
      },
      createSession: async () => {},
      resumeSession: async () => null,
      getCloudConsent: async () => null,
      getSessionTokenHash: async () => null,
      touchSession: async () => {},
      findReply: async () => null,
      countRecentQuestions: async () => 0,
      claimQuestion: async () => false,
      saveReply: async () => {},
      releaseQuestion: async () => {},
    };

    const config = parseConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://localhost/dimts",
      DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
      DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
      DIMTS_JWT_SECRET: "j".repeat(32),
      DIMTS_CRON_SECRET: "c".repeat(32),
    });

    app = buildApp({ config, repository: mockRepository });
  });

  it("requires X-Dimts-Key header", async () => {
    const res = await request(app).get("/v1/insights");
    expect(res.status).toBe(401);
  });

  it("rejects invalid X-Dimts-Key", async () => {
    const res = await request(app)
      .get("/v1/insights")
      .set("X-Dimts-Key", "invalid-key");
    expect(res.status).toBe(401);
  });

  it("returns JSON with valid key", async () => {
    const res = await request(app)
      .get("/v1/insights")
      .set("X-Dimts-Key", "valid-key");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toHaveProperty("insights");
    expect(res.body).toHaveProperty("period");
    expect(res.body).toHaveProperty("exportedAt");
  });

  it("returns CSV when format=csv", async () => {
    const res = await request(app)
      .get("/v1/insights?format=csv")
      .set("X-Dimts-Key", "valid-key");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
  });

  it("filters by language", async () => {
    const res = await request(app)
      .get("/v1/insights?lang=en")
      .set("X-Dimts-Key", "valid-key");
    expect(res.status).toBe(200);
    expect(res.body.insights).toBeDefined();
  });

  it("filters by date range", async () => {
    const res = await request(app)
      .get("/v1/insights?startDate=2026-11-01&endDate=2026-11-30")
      .set("X-Dimts-Key", "valid-key");
    expect(res.status).toBe(200);
    expect(res.body.insights).toBeDefined();
  });

  it("applies minCellSize suppression", async () => {
    const res = await request(app)
      .get("/v1/insights?minCellSize=1")
      .set("X-Dimts-Key", "valid-key");
    expect(res.status).toBe(200);
  });

  it("does not expose session IDs or question text", async () => {
    const res = await request(app)
      .get("/v1/insights")
      .set("X-Dimts-Key", "valid-key");
    expect(res.status).toBe(200);
    const csv = JSON.stringify(res.body);
    expect(csv).not.toMatch(/session/i);
    expect(csv).not.toMatch(/question_text/i);
  });
});
