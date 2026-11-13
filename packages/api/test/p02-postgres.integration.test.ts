import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPacks } from "@dimts/locales-tools";
import {
  PostgresGrounding,
  sourceHash,
  toPassages,
  replaceContent,
} from "@dimts/grounding";
import { createAnswerCacheKey } from "@dimts/engine";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { applyMigrations } from "../src/db/migrate.js";
import { provisionLocalHostKey } from "../src/db/local-bootstrap.js";
import { createPostgresAnswerCache } from "../src/db/answer-cache.js";
import { createEngineDependencies } from "../src/engine.js";
import { createApiProviderRuntime } from "../src/provider-runtime.js";

const databaseUrl = process.env.DIMTS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "P02 PostgreSQL session, cache and privacy integration",
  () => {
    let admin: pg.Client;
    let pool: pg.Pool;
    let app: ReturnType<typeof buildApp>;
    let config: ReturnType<typeof parseConfig>;
    const schema = `p02_${randomUUID().replaceAll("-", "")}`;
    const logs: string[] = [];
    const destination = {
      write: (line: string) => {
        logs.push(line);
      },
    };
    const makeApp = () => buildApp({ config, logDestination: destination });
    const publishGoals = async () => {
      const document = {
        lessonId: "p02-goals",
        baseUrl: "https://course.example/lessons/",
        lang: "en",
        format: "markdown" as const,
        content:
          "# Learning goals\n\nChoose one learning goal. Divide it into small weekly steps.",
      };
      await replaceContent(
        pool,
        toPassages(document),
        sourceHash([{ name: "p02-goals.md", content: document.content }]),
      );
    };
    const newSession = async () => {
      const result = await request(app)
        .post("/v1/sessions")
        .set("x-dimts-key", "p02-host-key")
        .send({ lang: "en" });
      expect(result.status).toBe(201);
      return result.body as { sessionId: string; sessionToken: string };
    };
    const ask = (
      session: { sessionId: string; sessionToken: string },
      text: string,
      clientMsgId = randomUUID(),
    ) =>
      request(app)
        .post("/v1/ask")
        .set("authorization", `Bearer ${session.sessionToken}`)
        .send({
          sessionId: session.sessionId,
          clientMsgId,
          lang: "en",
          text,
          via: "text",
        });

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(databaseUrl!);
      url.searchParams.set("options", `-c search_path=${schema}`);
      pool = new pg.Pool({ connectionString: url.toString() });
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        await applyMigrations(client, resolve("packages/api/migrations"));
        expect(
          await applyMigrations(client, resolve("packages/api/migrations")),
        ).toEqual([]);
        await provisionLocalHostKey(client, {
          id: "p02-host",
          name: "P02 integration",
          key: "p02-host-key",
          origins: [],
        });
      } finally {
        await client.end();
      }
      config = parseConfig({
        NODE_ENV: "development",
        DATABASE_URL: url.toString(),
        DIMTS_ENC_KEY: Buffer.alloc(32, 11).toString("base64"),
        DIMTS_HASH_KEY: Buffer.alloc(32, 12).toString("base64"),
        DIMTS_JWT_SECRET: "p02-test-signing-secret-long-enough",
        DIMTS_CRON_SECRET: "p02-test-cron-secret-long-enough",
      });
      app = makeApp();
    }, 30_000);

    afterAll(async () => {
      await app?.locals.close();
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });

    it("persists the two-notfound rule and a bounded feedback streak across API restarts", async () => {
      const session = await newSession();
      const first = await ask(
        session,
        "A question without any indexed course material",
      );
      const second = await ask(
        session,
        "Another question without indexed course material",
      );
      expect(first.body.kind).toBe("notfound");
      expect(second.body.kind).toBe("notfound");
      await app.locals.close();
      app = makeApp();
      expect(
        (await ask(session, "One more question about course material")).body
          .kind,
      ).toBe("escalation");
      const feedback = (helpful: boolean) =>
        request(app)
          .post("/v1/feedback")
          .set("authorization", `Bearer ${session.sessionToken}`)
          .send({ replyId: first.body.id, helpful });
      const outcomes = await Promise.all([
        feedback(false),
        feedback(false),
        feedback(false),
      ]);
      expect(outcomes.every(({ status }) => status === 200)).toBe(true);
      expect(
        (
          await pool.query(
            "SELECT negative_feedback_streak FROM session WHERE id = $1",
            [session.sessionId],
          )
        ).rows[0].negative_feedback_streak,
      ).toBe(2);
      await app.locals.close();
      app = makeApp();
      expect(
        (await ask(session, "A fresh course question after poor feedback")).body
          .kind,
      ).toBe("escalation");
      expect(
        (
          await pool.query(
            "SELECT negative_feedback_streak FROM session WHERE id = $1",
            [session.sessionId],
          )
        ).rows[0].negative_feedback_streak,
      ).toBe(0);
      await feedback(false);
      await feedback(true);
      expect(
        (
          await pool.query(
            "SELECT negative_feedback_streak FROM session WHERE id = $1",
            [session.sessionId],
          )
        ).rows[0].negative_feedback_streak,
      ).toBe(0);
      const counters = await pool.query(
        "SELECT * FROM feedback_counter WHERE topic_id = 'uncategorized'",
      );
      expect(counters.rows[0]).toMatchObject({
        lang: "en",
        helpful: 1,
        unhelpful: 4,
      });
      expect(Object.keys(counters.rows[0]).sort()).toEqual([
        "helpful",
        "lang",
        "period",
        "topic_id",
        "unhelpful",
      ]);
      const stranger = await newSession();
      expect(
        (
          await request(app)
            .post("/v1/feedback")
            .set("authorization", `Bearer ${stranger.sessionToken}`)
            .send({ replyId: first.body.id, helpful: false })
        ).status,
      ).toBe(401);
    });

    it("returns one durable reply for parallel duplicates and a serial retry after restart", async () => {
      const session = await newSession();
      let entered!: () => void;
      let finish!: () => void;
      const enteredSearch = new Promise<void>((resolveEntered) => {
        entered = resolveEntered;
      });
      const wait = new Promise<void>((resolveWait) => {
        finish = resolveWait;
      });
      const search = vi.fn(async () => {
        entered();
        await wait;
        return [];
      });
      const dependencies = createEngineDependencies({
        config,
        packs: loadPacks(resolve("locales")),
        grounding: { search, currentVersion: async () => "parallel-test" },
        providerRuntime: {
          activeProvider: "offline",
          providerOrder: ["offline"],
          answer: vi.fn(),
        },
      });
      await app.locals.close();
      app = buildApp({
        config,
        askDependencies: dependencies,
        logDestination: destination,
      });
      const messageId = randomUUID();
      const firstPromise = ask(
        session,
        "An idempotent course question",
        messageId,
      ).then((result) => result);
      await enteredSearch;
      const duplicate = await ask(
        session,
        "An idempotent course question",
        messageId,
      );
      expect(duplicate.status).toBe(409);
      finish();
      const first = await firstPromise;
      expect(first.status).toBe(200);
      await app.locals.close();
      app = makeApp();
      const replay = await ask(
        session,
        "An idempotent course question",
        messageId,
      );
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(first.body);
      expect(search).toHaveBeenCalledOnce();
      const rows = await pool.query(
        "SELECT role, count(*)::int AS count FROM message WHERE session_id = $1 GROUP BY role",
        [session.sessionId],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.every(({ count }) => count === 1)).toBe(true);
    }, 15_000);

    it("persists safe cache entries, expires old rows, and invalidates on content publication", async () => {
      const cache = createPostgresAnswerCache(pool);
      const key = createAnswerCacheKey(
        { text: "Choose a learning goal", lang: "en", simple: false },
        "v1",
      );
      const reply = {
        id: "source-reply",
        kind: "answer" as const,
        text: "Choose one learning goal.",
        lang: "en",
        dir: "ltr" as const,
        citations: [
          {
            passageId: "goal",
            label: "Goal",
            url: "https://course.example/goal",
            sourceLang: "en",
            sourceType: "course" as const,
          },
        ],
        actions: [],
        contentVersion: "v1",
      };
      await cache.set(key, reply);
      expect((await createPostgresAnswerCache(pool).get(key))?.id).toBe(
        "cached",
      );
      await expect(cache.getCurrent(key, "v1")).resolves.toBeNull();
      await pool.query(
        "UPDATE answer_cache SET created_at = now() - interval '25 hours' WHERE cache_key = $1",
        [key],
      );
      expect(await cache.get(key)).toBeNull();
      await cache.set(key, reply);
      await publishGoals();
      expect(await cache.get(key)).toBeNull();
    });

    it("validates cached citations against active passages and content version", async () => {
      const grounding = new PostgresGrounding(pool);
      await publishGoals();
      const contentVersion = await grounding.currentVersion();
      const passage = (
        await grounding.search("Choose one learning goal", "en")
      )[0]!;
      const key = createAnswerCacheKey(
        { text: "Choose one learning goal", lang: "en", simple: false },
        contentVersion,
      );
      const cache = createPostgresAnswerCache(pool);
      const reply = {
        id: "original",
        kind: "answer" as const,
        text: "Choose one learning goal.",
        lang: "en",
        dir: "ltr" as const,
        citations: [
          {
            passageId: "retired-passage",
            label: "Goal",
            url: "https://course.example/goal",
            sourceLang: "en",
            sourceType: "course" as const,
          },
        ],
        actions: [],
        contentVersion,
      };

      await cache.set(key, reply);
      await expect(cache.getCurrent(key, contentVersion)).resolves.toBeNull();

      await cache.set(key, {
        ...reply,
        citations: [
          {
            passageId: passage!.id,
            label: passage!.label,
            url: passage!.url,
            sourceLang: passage!.lang,
            sourceType: passage!.sourceType,
          },
        ],
      });
      await expect(
        cache.getCurrent(key, contentVersion),
      ).resolves.toMatchObject({
        kind: "answer",
        citations: [expect.objectContaining({ passageId: passage!.id })],
      });
      await expect(
        cache.getCurrent(key, "old-content-version"),
      ).resolves.toBeNull();
    });

    it("resolves a raw FAQ source to its current namespaced PostgreSQL citation", async () => {
      const content = await readFile(
        resolve("content/sample-course/study-plan.md"),
        "utf8",
      );
      const passages = toPassages({
        lessonId: "study-plan",
        baseUrl: "https://course.example/lessons/",
        content,
        format: "markdown",
        lang: "en",
      });
      await replaceContent(
        pool,
        passages,
        sourceHash([{ name: "study-plan.md", content }]),
      );
      const packs = loadPacks(resolve("locales"));
      const faq = packs.get("en")!.faq[0] as {
        q: string;
        a: string;
        source: string;
      };
      const grounding = new PostgresGrounding(pool);
      const retrieved = await grounding.search(faq.q, "en");
      expect(retrieved.length).toBeGreaterThan(0);
      expect(retrieved.every(({ id }) => id !== faq.source)).toBe(true);
      const resolveSource = vi.fn(grounding.resolveFaqSource.bind(grounding));
      const runtime = createApiProviderRuntime(
        config,
        packs,
        {},
        resolveSource,
      );
      const result = await runtime.answer(
        {
          question: faq.q,
          lang: "en",
          simple: false,
          mode: "extractive",
          systemPrompt: "Use only supplied passages.",
          glossary: [],
          passages: retrieved,
        },
        { cloudOk: false },
      );
      expect(resolveSource).toHaveBeenCalled();
      expect(result.text).toBe(faq.a);
      expect(result.usedPassageIds).toHaveLength(1);
      expect(retrieved.some(({ id }) => id === result.usedPassageIds[0])).toBe(
        true,
      );
      await publishGoals();
      expect(
        await grounding.resolveFaqSource(faq.source, result.usedPassageIds),
      ).toBeNull();
    });

    it("measures warm offline/repeat latency at HTTP boundary and logs only safe metadata", async () => {
      // pino-http measures request entry through response completion. Exclude
      // Supertest's ephemeral listener/client setup and loopback network time.
      const serverDuration = (offset: number): number => {
        const completed = logs
          .slice(offset)
          .flatMap((line) => line.trim().split("\n"))
          .map((line) => JSON.parse(line))
          .reverse()
          .find(
            (event) =>
              event.req?.url === "/v1/ask" &&
              typeof event.responseTime === "number",
          );
        expect(completed?.responseTime).toEqual(expect.any(Number));
        return completed.responseTime as number;
      };
      await publishGoals();
      const session = await newSession();
      // Warm connection pools and JIT before the measured repeated-question sample.
      const warm = await ask(session, "Choose one learning goal");
      expect(warm.body.kind).toBe("answer");
      const times: number[] = [];
      for (let index = 0; index < 10; index += 1) {
        const offset = logs.length;
        const result = await ask(session, "Choose one learning goal");
        times.push(serverDuration(offset));
        expect(result.body.kind).toBe("answer");
        expect(result.body.id).not.toBe(warm.body.id);
      }
      const p95 = times.sort((a, b) => a - b)[
        Math.ceil(times.length * 0.95) - 1
      ]!;
      expect(p95).toBeLessThan(50);
      const uncachedSession = await newSession();
      const offlineTimes: number[] = [];
      for (let index = 0; index < 10; index += 1) {
        await pool.query("DELETE FROM answer_cache");
        const offset = logs.length;
        const result = await ask(uncachedSession, "Choose one learning goal");
        offlineTimes.push(serverDuration(offset));
        expect(result.body.kind).toBe("answer");
      }
      const offlineP95 = offlineTimes.sort((a, b) => a - b)[
        Math.ceil(offlineTimes.length * 0.95) - 1
      ]!;
      expect(offlineP95).toBeLessThanOrEqual(1_000);
      const marker = "P02-private-question-marker 251900000000";
      await ask(session, marker);
      const serialized = logs.join("");
      for (const secret of [
        marker,
        session.sessionId,
        session.sessionToken,
        "Choose one learning goal.",
      ])
        expect(serialized).not.toContain(secret);
      const events = logs
        .flatMap((line) => line.trim().split("\n"))
        .map((line) => JSON.parse(line))
        .filter((event) => event.event === "answer_cache");
      expect(events.some((event) => event.result === "hit")).toBe(true);
      expect(events.some((event) => event.result === "miss")).toBe(true);
      for (const event of events)
        expect(Object.keys(event).sort()).toEqual([
          "event",
          "hostname",
          "level",
          "pid",
          "result",
          "time",
        ]);
      process.stdout.write(
        JSON.stringify({
          event: "p02_http_benchmark",
          samplesPerMode: times.length,
          warmCachedP95Ms: Number(p95.toFixed(2)),
          warmOfflineP95Ms: Number(offlineP95.toFixed(2)),
          database: "PostgreSQL",
          provider: "offline",
          boundary: "HTTP server request to response completion",
        }) + "\n",
      );
    });
  },
);
