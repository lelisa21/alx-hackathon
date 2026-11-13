// FR-UI-16, NFR-PERF-06: reviewed, cited content only; draft preview is never approval.
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { loadPacks } from "@dimts/locales-tools";
import { createCoreRouter } from "../src/routes/core.js";
import { buildReviewedFaq } from "../src/faq.js";
import { LocaleFaqSchema } from "../src/schemas.js";
import { parseConfig } from "../src/config.js";
import type { ApiRepository } from "../src/types.js";
import { generateOpenApiYaml } from "../src/openapi.js";

const pack = loadPacks(resolve("locales")).get("en")!;
const citation = {
  passageId: "stored-passage",
  label: "Study plan / One goal",
  url: "https://course.example/one-goal",
  sourceLang: "en",
  sourceType: "course" as const,
};
const reviewed = () => ({
  ...pack,
  meta: {
    ...pack.meta,
    reviewed_by: "Language reviewer",
    reviewed_on: "2026-01-01",
  },
});

describe("P03 reviewed offline FAQ contract", () => {
  it("emits only resolved active citations and no reviewer name or authored raw reference", async () => {
    const current = reviewed();
    const entry = (
      current.faq as { q: string; a: string; source: string }[]
    )[0]!;
    const resolveSources = vi.fn(
      async () => new Map([[entry.source, citation]]),
    );
    const result = await buildReviewedFaq(
      current,
      "version-one",
      resolveSources,
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).toMatchObject({
      question: entry.q,
      answer: entry.a,
      citations: [citation],
    });
    expect(result).toMatchObject({
      lang: "en",
      dir: "ltr",
      reviewedOn: "2026-01-01",
      contentVersion: "version-one",
    });
    expect(LocaleFaqSchema.parse(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("Language reviewer");
    expect(
      result.items.every(
        (item) => item.citations[0]?.passageId === citation.passageId,
      ),
    ).toBe(true);
  });
  it.each([null, "pending", "unknown", " "])(
    "never publishes FAQ without genuine review metadata (%s)",
    async (reviewer) => {
      const resolveSources = vi.fn(async () => new Map());
      const current = reviewed();
      current.meta.reviewed_by = reviewer;
      expect(
        await buildReviewedFaq(current, "v1", resolveSources),
      ).toMatchObject({ items: [], reviewedOn: null });
      expect(resolveSources).not.toHaveBeenCalled();
    },
  );
  it.each([null, "2026-02-30", "2999-01-01", "today"])(
    "rejects invalid or future review date (%s)",
    async (date) => {
      const current = reviewed();
      current.meta.reviewed_on = date;
      expect(
        await buildReviewedFaq(current, "v1", async () => new Map()),
      ).toMatchObject({ items: [], reviewedOn: null });
    },
  );
  it("keeps drafts empty even if review fields are populated and omits unresolved and unsafe entries", async () => {
    const current = reviewed();
    current.meta.status = "draft";
    expect(
      (
        await buildReviewedFaq(
          current,
          "v1",
          async () => new Map([["ref", citation]]),
        )
      ).items,
    ).toEqual([]);
    current.meta.status = "beta";
    current.faq = [
      { q: "One?", a: "One.", source: "ref" },
      { q: "Unresolved?", a: "No.", source: "missing" },
    ];
    expect(
      (
        await buildReviewedFaq(
          current,
          "v1",
          async () =>
            new Map([["ref", { ...citation, url: "javascript:alert(1)" }]]),
        )
      ).items,
    ).toEqual([]);
    expect(
      (await buildReviewedFaq(current, "v1", async () => new Map())).reviewedOn,
    ).toBe("2026-01-01");
  });
  it("returns a deterministic identity and changes the validator representation when published answers change", async () => {
    const current = reviewed();
    current.faq = [{ q: "One?", a: "One.", source: "ref" }];
    const resolver = async () => new Map([["ref", citation]]);
    const first = await buildReviewedFaq(current, "v1", resolver);
    expect(await buildReviewedFaq(current, "v1", resolver)).toEqual(first);
    current.faq = [{ q: "One?", a: "Two.", source: "ref" }];
    expect(await buildReviewedFaq(current, "v1", resolver)).not.toEqual(first);
  });
  it("serves conditional GET, safe empty preview, and documented canonical schema", async () => {
    const current = reviewed();
    current.faq = [{ q: "One?", a: "One.", source: "ref" }];
    const config = parseConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://test:test@localhost/test",
      DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
      DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
      DIMTS_JWT_SECRET: "a-long-test-signing-secret-with-32-characters",
      DIMTS_CRON_SECRET: "a-long-test-cron-secret-with-24-characters",
    });
    const app = express();
    app.use(
      "/v1",
      createCoreRouter({
        config,
        repository: {} as ApiRepository,
        packs: new Map([["en", current]]),
        grounding: {
          currentVersion: async () => "v1",
          resolveFaqCitations: async () => new Map([["ref", citation]]),
        },
      }),
    );
    const first = await request(app).get("/v1/locales/en/faq");
    expect(first.status).toBe(200);
    expect(LocaleFaqSchema.parse(first.body).items).toHaveLength(1);
    expect(first.headers["cache-control"]).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(
      (
        await request(app)
          .get("/v1/locales/en/faq")
          .set("If-None-Match", first.headers.etag)
      ).status,
    ).toBe(304);
    current.meta.status = "draft";
    expect((await request(app).get("/v1/locales/en/faq")).status).toBe(404);
    expect(
      (await request(app).get("/v1/locales/en/faq?lang_preview=1")).body.items,
    ).toEqual([]);
    expect(
      (await request(app).get("/v1/locales/en/faq?lang_preview=yes")).status,
    ).toBe(400);
    const missing = await request(app).get("/v1/locales/xx/faq");
    expect(missing.status).toBe(404);
    expect(missing.headers["cache-control"]).toBe("no-store");
    expect(generateOpenApiYaml()).toContain("/v1/locales/{code}/faq:");
  });
});
