// FR-TG-01/03/07/08/09/11: real PostgreSQL, HTTP, shared engine/jobs and helper WebSocket.
import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";
import request from "supertest";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTelegramTransport, createTelegramVoice } from "@dimts/telegram";
import type { AskDependencies } from "@dimts/engine";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { sha256 } from "../src/middleware/auth.js";
import { applyMigrations } from "../src/db/migrate.js";
import { loadPacks } from "@dimts/locales-tools";
import { careerDate } from "../src/jobs-format.js";

const databaseUrl = process.env.DIMTS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "P08 Telegram PostgreSQL/HTTP/helper WebSocket",
  () => {
    const schema = `p08_flow_${randomUUID().replaceAll("-", "")}`;
    const secret = "synthetic-telegram-webhook-secret";
    const cron = "synthetic-cron-secret-long-enough";
    const helperToken = "synthetic-helper-token-long-enough";
    const hashKey = Buffer.alloc(32, 2);
    const token = "123456:synthetic_bot_token_long_enough";
    let admin: pg.Client,
      pool: pg.Pool,
      app: ReturnType<typeof buildApp>,
      server: Server;
    let config: ReturnType<typeof parseConfig>;
    let sequence = 0,
      transportClock = 0;
    const sockets: WebSocket[] = [];
    const deliveries: { method: string; body: Record<string, unknown> }[] = [];
    const voiceQuestion =
      "Which learning goal should I choose from this voice question?";
    const transcribe = vi.fn(async () => voiceQuestion);
    const synthesize = vi.fn(async () => ({
      audio: new TextEncoder().encode("OggSsyntheticaudio"),
      mimeType: "audio/ogg",
    }));
    const answer = vi.fn(async () => ({
      text: "Choose one learning goal.",
      usedPassageIds: ["goals"],
      provider: "offline",
      latencyMs: 0,
    }));
    const dependencies: AskDependencies = {
      search: async () => [
        {
          id: "goals",
          text: "Choose one learning goal.",
          label: "Goals",
          url: "https://course.example/goals",
          lang: "en",
          sourceType: "course",
          score: 1,
        },
      ],
      answer,
      glossaryFor: () => [],
      systemPrompt: () => "Synthetic grounded fixture",
      modeFor: () => "extractive",
      confidenceFloor: () => 0.35,
      translate: (_lang, key) => key,
      direction: () => "ltr",
      contentVersion: () => "test-v1",
      createId: () => randomUUID(),
    };
    const hash = (id: number) =>
      createHmac("sha256", hashKey)
        .update(JSON.stringify(["telegram", String(id)]))
        .digest("hex");
    function makeTransport() {
      return createTelegramTransport({
        token,
        hashKey: hashKey.toString("base64"),
        now: () => transportClock,
        sleep: async (ms) => {
          transportClock += ms;
        },
        fetch: async (input, init) => {
          const method = String(input).split("/").at(-1)!;
          if (method === "fixture.ogg")
            return new Response(
              new TextEncoder().encode("OggSsyntheticaudio"),
              { headers: { "content-type": "audio/ogg" } },
            );
          const body = (
            method === "sendVoice" ? {} : JSON.parse(String(init?.body))
          ) as Record<string, unknown>;
          deliveries.push({ method, body });
          return Response.json({
            ok: true,
            result:
              method === "getFile"
                ? {
                    file_id: "synthetic-voice",
                    file_path: "voice/fixture.ogg",
                    file_size: 18,
                  }
                : method === "sendMessage" || method === "sendVoice"
                  ? { message_id: deliveries.length }
                  : true,
          });
        },
      });
    }
    async function startApp(withVoice = false) {
      const transport = makeTransport();
      app = buildApp({
        config,
        askDependencies: dependencies,
        telegramTransport: transport,
        ...(withVoice
          ? {
              telegramVoice: createTelegramVoice({
                transport,
                adapters: {
                  speechToText: {
                    supported: (lang) => lang === "en",
                    transcribe,
                  },
                  textToSpeech: {
                    supported: (lang) => lang === "en",
                    synthesize,
                  },
                },
              }),
            }
          : {}),
      });
      await app.locals.telegramReady;
      server = createServer(app);
      app.locals.attachHelpWebSockets(server);
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    }
    function inbound(chatId: number, text: string, updateId = ++sequence) {
      return request(app)
        .post("/v1/telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", secret)
        .send({
          update_id: updateId,
          message: {
            message_id: updateId,
            from: { id: chatId, is_bot: false },
            chat: { id: chatId, type: "private" },
            text,
          },
        });
    }
    function callback(chatId: number, data: string) {
      const updateId = ++sequence;
      return request(app)
        .post("/v1/telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", secret)
        .send({
          update_id: updateId,
          callback_query: {
            id: `callback-${updateId}`,
            from: { id: chatId, is_bot: false },
            data,
            message: {
              message_id: updateId,
              chat: { id: chatId, type: "private" },
            },
          },
        });
    }
    const sentTo = (id: number) =>
      deliveries.filter(
        ({ method, body }) =>
          method === "sendMessage" && String(body.chat_id) === String(id),
      );
    function callbackAction(chatId: number, action: string) {
      const markup = sentTo(chatId).at(-1)?.body.reply_markup as
        | {
            inline_keyboard: { callback_data: string }[][];
          }
        | undefined;
      const data = markup?.inline_keyboard
        .flat()
        .find((button) =>
          button.callback_data.startsWith(`${action}:`),
        )?.callback_data;
      if (!data) throw new Error("Missing current callback fixture");
      return callback(chatId, data);
    }
    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(databaseUrl!);
      url.searchParams.set("options", `-c search_path=${schema}`);
      const connectionString = url.toString();
      pool = new pg.Pool({ connectionString });
      const client = new pg.Client({ connectionString });
      await client.connect();
      try {
        await applyMigrations(client, resolve("packages/api/migrations"));
      } finally {
        await client.end();
      }
      config = parseConfig({
        NODE_ENV: "test",
        DATABASE_URL: connectionString,
        DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
        DIMTS_HASH_KEY: hashKey.toString("base64"),
        DIMTS_JWT_SECRET: "synthetic-jwt-secret-long-enough-for-test",
        DIMTS_CRON_SECRET: cron,
        DIMTS_TELEGRAM_TOKEN: token,
        DIMTS_TELEGRAM_SECRET: secret,
      });
      await pool.query(
        "INSERT INTO helper(id,display_name,token_hash,langs) VALUES('helper-p08','Private staff name',$1,ARRAY['en'])",
        [sha256(helperToken)],
      );
      await pool.query(
        "INSERT INTO host_key(id,name,key_hash,key_type) VALUES('host-p08','Synthetic host',$1,'secret')",
        [sha256("synthetic-host-secret")],
      );
      await startApp();
    }, 30000);
    afterAll(async () => {
      sockets.forEach((socket) => socket.terminate());
      await app?.locals.close();
      if (server) await new Promise<void>((done) => server.close(() => done()));
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });
    async function connect(requestId: string, jwt: string) {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing server port");
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/help/ws`);
      sockets.push(socket);
      const frames: Record<string, unknown>[] = [];
      socket.on("message", (raw) => frames.push(JSON.parse(String(raw))));
      await new Promise<void>((done, reject) => {
        socket.once("open", done);
        socket.once("error", reject);
      });
      socket.send(
        JSON.stringify({ type: "auth", role: "helper", requestId, jwt }),
      );
      await expect
        .poll(() => frames.some((frame) => frame.type === "help.joined"))
        .toBe(true);
      return { socket, frames };
    }
    it("uses the shared grounded tutor, replays safely, ignores groups and persists only contact HMAC", async () => {
      const id = 900001;
      await inbound(id, "/start").expect(200);
      expect(
        sentTo(id)
          .map(({ body }) => body.text)
          .join("\n"),
      ).toContain("/privacy");
      await callback(id, "language:en").expect(200);
      const updateId = ++sequence;
      await inbound(id, "What learning goal can I choose?", updateId).expect(
        200,
      );
      const count = sentTo(id).length;
      await inbound(id, "What learning goal can I choose?", updateId).expect(
        200,
      );
      expect(answer).toHaveBeenCalledOnce();
      expect(sentTo(id)).toHaveLength(count);
      expect(sentTo(id).at(-1)?.body.text).toContain(
        "https://course.example/goals",
      );
      expect(answer.mock.calls[0]?.[1]).toEqual({ cloudOk: false });
      await request(app)
        .post("/v1/telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", secret)
        .send({
          update_id: ++sequence,
          message: {
            message_id: sequence,
            chat: { id: -123, type: "group" },
            text: "Ignore",
          },
        })
        .expect(200);
      expect(sentTo(id)).toHaveLength(count);
      const sessions = (
        await pool.query("SELECT * FROM session WHERE contact_hmac=$1", [
          hash(id),
        ])
      ).rows;
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        channel: "telegram",
        cloud_ok: false,
        lang: "en",
      });
      expect(
        JSON.stringify(
          (await pool.query("SELECT * FROM telegram_conversation")).rows,
        ),
      ).not.toContain(String(id));
      expect(
        (await pool.query("SELECT count(*) FROM subscription")).rows[0].count,
      ).toBe("0");
    });
    it("relays both directions through the helper console, rebinds after restart and ends the same help", async () => {
      const id = 900002;
      await inbound(id, "/help").expect(200);
      const row = (
        await pool.query(
          "SELECT h.* FROM help_request h JOIN session s ON h.session_id=s.id WHERE s.contact_hmac=$1",
          [hash(id)],
        )
      ).rows[0];
      expect(row).toMatchObject({
        channel: "telegram",
        summary: null,
        include_summary: false,
        status: "waiting",
      });
      const login = await request(app)
        .post("/v1/helpers/login")
        .send({ token: helperToken })
        .expect(200);
      const jwt = login.body.jwt as string;
      await request(app)
        .post(`/v1/help/${row.id}/claim`)
        .set("Authorization", `Bearer ${jwt}`)
        .send({})
        .expect(200);
      let helper = await connect(row.id, jwt);
      await inbound(id, "Synthetic learner message").expect(200);
      await expect
        .poll(() =>
          helper.frames.some(
            (frame) => frame.text === "Synthetic learner message",
          ),
        )
        .toBe(true);
      helper.socket.send(
        JSON.stringify({
          type: "chat.message",
          id: "p08-helper-one",
          text: "Synthetic helper response",
        }),
      );
      await expect
        .poll(() =>
          sentTo(id).some(
            ({ body }) => body.text === "Synthetic helper response",
          ),
        )
        .toBe(true);
      helper.socket.terminate();
      await app.locals.close();
      await new Promise<void>((done) => server.close(() => done()));
      await startApp();
      helper = await connect(row.id, jwt);
      helper.socket.send(
        JSON.stringify({
          type: "chat.message",
          id: "p08-helper-offline",
          text: "Message before reconnection",
        }),
      );
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*) FROM help_message WHERE id='p08-helper-offline'",
              )
            ).rows[0].count,
        )
        .toBe("1");
      expect(
        sentTo(id).filter(
          ({ body }) => body.text === "Message before reconnection",
        ),
      ).toHaveLength(0);
      await inbound(id, "Reconnect help").expect(200);
      expect(
        sentTo(id).filter(
          ({ body }) => body.text === "Message before reconnection",
        ),
      ).toHaveLength(1);
      expect(
        sentTo(id).filter(
          ({ body }) => body.text === "Synthetic helper response",
        ),
      ).toHaveLength(1);
      await inbound(id, "/endhelp").expect(200);
      expect(
        (
          await pool.query("SELECT status FROM help_request WHERE id=$1", [
            row.id,
          ])
        ).rows[0].status,
      ).toBe("closed");
      const before = answer.mock.calls.length;
      await inbound(
        id,
        "Which learning goal should I practice after human help?",
      ).expect(200);
      expect(answer.mock.calls.length).toBe(before + 1);
    }, 30000);
    it("creates a real P06 alert only after review/consent/confirm, delivers natively and STOP deletes contacts", async () => {
      const id = 900003;
      await request(app)
        .post("/v1/jobs/import")
        .set("X-Dimts-Key", "synthetic-host-secret")
        .send({
          lang: "en",
          postings: {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            identifier: "p08-job",
            title: "Synthetic analyst",
            description: "A synthetic test opportunity",
            hiringOrganization: {
              "@type": "Organization",
              name: "Synthetic organization",
            },
            jobLocation: {
              "@type": "Place",
              address: {
                "@type": "PostalAddress",
                addressLocality: "Addis",
                addressRegion: "Addis",
                addressCountry: "ET",
              },
            },
            employmentType: "PART_TIME",
            datePosted: "2026-11-01",
            validThrough: "2099-12-31",
            url: "https://jobs.example/p08",
          },
        })
        .expect(200);
      await inbound(id, "/jobs").expect(200);
      expect(sentTo(id).at(-1)?.body.text).toContain(
        "https://jobs.example/p08",
      );
      expect(sentTo(id).at(-1)?.body.text).toContain(
        careerDate(loadPacks(resolve("locales")), "en", "2099-12-31"),
      );
      await callback(id, "jobs:create").expect(200);
      await inbound(id, "PART_TIME").expect(200);
      await inbound(id, "Addis").expect(200);
      await callback(id, "jobs:language:en").expect(200);
      await callbackAction(id, "jobs:review").expect(200);
      expect(
        (await pool.query("SELECT count(*) FROM subscription")).rows[0].count,
      ).toBe("0");
      await callbackAction(id, "jobs:consent").expect(200);
      expect(
        (await pool.query("SELECT count(*) FROM subscription")).rows[0].count,
      ).toBe("0");
      await callbackAction(id, "jobs:confirm").expect(200);
      const subscription = (
        await pool.query("SELECT * FROM subscription WHERE channel='telegram'")
      ).rows[0];
      expect(subscription.contact_enc).toBeInstanceOf(Buffer);
      expect(subscription.contact_enc.toString("utf8")).not.toContain(
        String(id),
      );
      const before = sentTo(id).length;
      await request(app)
        .post("/v1/internal/alerts")
        .set("Authorization", `Bearer ${cron}`)
        .expect(200);
      expect(sentTo(id)).toHaveLength(before + 1);
      expect(sentTo(id).at(-1)?.body.reply_markup).toMatchObject({
        inline_keyboard: [[{ callback_data: "jobs:stop" }]],
      });
      await inbound(id, "/help").expect(200);
      await inbound(id, "/stop").expect(200);
      expect(
        (
          await pool.query(
            "SELECT contact_enc,contact_hash FROM subscription WHERE id=$1",
            [subscription.id],
          )
        ).rows[0],
      ).toMatchObject({ contact_enc: null, contact_hash: null });
      expect(
        (
          await pool.query(
            "SELECT count(*) FROM help_request WHERE session_id=$1 AND status<>'closed'",
            [subscription.session_id],
          )
        ).rows[0].count,
      ).toBe("0");
      const stoppedCount = sentTo(id).length;
      await request(app)
        .post("/v1/internal/alerts")
        .set("Authorization", `Bearer ${cron}`)
        .expect(200);
      expect(sentTo(id)).toHaveLength(stoppedCount);
      await request(app)
        .post("/v1/internal/retention")
        .set("Authorization", `Bearer ${cron}`)
        .expect(200);
      expect(
        (
          await pool.query("SELECT count(*) FROM subscription WHERE id=$1", [
            subscription.id,
          ])
        ).rows[0].count,
      ).toBe("0");
    }, 30000);
    it("keeps text available when the configured browser voice adapter cannot process server attachments", async () => {
      const id = 900005;
      const before = answer.mock.calls.length;
      const updateId = ++sequence;
      await request(app)
        .post("/v1/telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", secret)
        .send({
          update_id: updateId,
          message: {
            message_id: updateId,
            from: { id, is_bot: false },
            chat: { id, type: "private" },
            voice: {
              file_id: "synthetic-voice",
              duration: 5,
              file_size: 100,
              mime_type: "audio/ogg",
            },
          },
        })
        .expect(200);
      expect(answer.mock.calls.length).toBe(before);
      expect(sentTo(id).at(-1)?.body.text).toContain("/help");
      expect(
        deliveries.some(
          ({ method }) => method === "getFile" || method === "sendVoice",
        ),
      ).toBe(false);
      await inbound(
        id,
        "Which learning goal should I study using text input?",
      ).expect(200);
      expect(answer.mock.calls.length).toBe(before + 1);
    });
    it("requires voice review Send, supports retry, and sends synthesized audio only after equivalent cited text", async () => {
      await app.locals.close();
      await new Promise<void>((done) => server.close(() => done()));
      await startApp(true);
      const id = 900006;
      await inbound(id, "/start").expect(200);
      const voice = (updateId: number) =>
        request(app)
          .post("/v1/telegram/webhook")
          .set("X-Telegram-Bot-Api-Secret-Token", secret)
          .send({
            update_id: updateId,
            message: {
              message_id: updateId,
              from: { id, is_bot: false },
              chat: { id, type: "private" },
              voice: {
                file_id: "synthetic-voice",
                duration: 5,
                file_size: 18,
                mime_type: "audio/ogg",
              },
            },
          });
      const before = answer.mock.calls.length;
      const first = ++sequence;
      await voice(first).expect(200);
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(answer.mock.calls.length).toBe(before);
      expect(sentTo(id).at(-1)?.body.text).toContain(voiceQuestion);
      await callback(id, `voice:retry:${first}`).expect(200);
      await callback(id, `voice:send:${first}`).expect(200);
      expect(answer.mock.calls.length).toBe(before);
      const second = ++sequence;
      await voice(second).expect(200);
      expect(transcribe).toHaveBeenCalledTimes(2);
      expect(answer.mock.calls.length).toBe(before);
      await callback(id, "audio:toggle").expect(200);
      const sentBefore = deliveries.length;
      await callback(id, `voice:send:${second}`).expect(200);
      expect(answer.mock.calls.length).toBe(before + 1);
      expect(synthesize).toHaveBeenCalledTimes(1);
      const generated = deliveries
        .slice(sentBefore)
        .filter(
          ({ method }) => method === "sendMessage" || method === "sendVoice",
        );
      expect(generated.map(({ method }) => method)).toEqual([
        "sendMessage",
        "sendVoice",
      ]);
      expect(generated[0]?.body.text).toContain("https://course.example/goals");
      expect(synthesize.mock.calls[0]?.[0]).toMatchObject({
        text: generated[0]?.body.text,
        lang: "en",
      });
      await callback(id, `voice:send:${second}`).expect(200);
      expect(answer.mock.calls.length).toBe(before + 1);
      await app.locals.close();
      await new Promise<void>((done) => server.close(() => done()));
      await startApp();
    }, 30000);
    it("global session deletion clears encrypted channel state and helper routing authorization", async () => {
      const id = 900004;
      await inbound(id, "/help").expect(200);
      const session = (
        await pool.query("SELECT id FROM session WHERE contact_hmac=$1", [
          hash(id),
        ])
      ).rows[0];
      await pool.query("DELETE FROM session WHERE id=$1", [session.id]);
      expect(
        (
          await pool.query(
            "SELECT private_enc,session_id FROM telegram_conversation WHERE contact_hash=$1",
            [hash(id)],
          )
        ).rows[0],
      ).toMatchObject({ private_enc: null, session_id: null });
      expect(
        (
          await pool.query(
            "SELECT count(*) FROM telegram_delivery WHERE contact_hash=$1",
            [hash(id)],
          )
        ).rows[0].count,
      ).toBe("0");
    });
  },
);
