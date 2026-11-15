// NFR-ADOPT-01/02: the integration guide at /v1/docs is self-serve and shows
// this deployment's real URLs for the widget, REST and LTI 1.3 paths.
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import type { ApiRepository } from "../src/types.js";

const repository = {
  ping: async () => true,
  runRetention: async () => undefined,
} as unknown as ApiRepository;

function app(extra: Record<string, string> = {}) {
  return buildApp({
    repository,
    config: parseConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
      DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
      DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
      DIMTS_JWT_SECRET: Buffer.alloc(32, 3).toString("base64"),
      DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
      ...extra,
    }),
  });
}

describe("integration guide page", () => {
  it("shows the three integration paths with this deployment's URLs", async () => {
    const instance = app({
      DIMTS_LTI_WIDGET_URL: "https://assets.example.org/dimts-widget.js",
      DIMTS_LTI_WIDGET_KEY: "public-id",
    });
    try {
      const page = await request(instance)
        .get("/v1/docs")
        .set("Host", "api.example.org")
        .set("X-Forwarded-Proto", "https");
      expect(page.status).toBe(200);
      expect(page.headers["content-type"]).toMatch(/text\/html/u);
      for (const text of [
        'id="embed"',
        'id="rest"',
        'id="lti"',
        "https://api.example.org/v1/sessions",
        "https://api.example.org/v1/ask",
        "https://api.example.org/v1/lti/login",
        "https://api.example.org/v1/lti/launch",
        "https://assets.example.org/dimts-widget.js",
        "/v1/openapi.yaml",
      ])
        expect(page.text).toContain(text);
      // No inline script: the API's default CSP stays strict.
      expect(page.text).not.toMatch(/<script(?![^>]*\bsrc=)/u);
    } finally {
      await instance.locals.close();
    }
  });

  it("escapes a hostile Host header", async () => {
    const instance = app();
    try {
      const page = await request(instance)
        .get("/v1/docs")
        .set("Host", 'evil"><img src=x onerror=alert(1)>');
      expect(page.text).not.toContain("<img src=x");
    } finally {
      await instance.locals.close();
    }
  });
});
