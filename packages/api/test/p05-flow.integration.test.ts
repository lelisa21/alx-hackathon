import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";
import request from "supertest";
import WebSocket from "ws";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { sha256 } from "../src/middleware/auth.js";
import { applyMigrations } from "../src/db/migrate.js";

const databaseUrl = process.env.DIMTS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "P05 real PostgreSQL/HTTP/WebSocket handoff",
  () => {
    const schema = `p05_flow_${randomUUID().replaceAll("-", "")}`;
    const token = "learner-token-00000000000000000000",
      helperToken = "helper-token-00000000000000000000",
      sessionId = "learner-session-00001";
    let admin: pg.Client,
      pool: pg.Pool,
      app: ReturnType<typeof buildApp>,
      server: Server;
    const sockets: WebSocket[] = [];
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
      await pool.query(
        "INSERT INTO session(id,lang,channel,token_hash) VALUES($1,'en','web',$2)",
        [sessionId, sha256(token)],
      );
      await pool.query(
        "INSERT INTO helper(id,display_name,token_hash,langs) VALUES('helper-one','Private staff name',$1,ARRAY['en'])",
        [sha256(helperToken)],
      );
      app = buildApp({
        config: parseConfig({
          NODE_ENV: "test",
          DATABASE_URL: connectionString,
          DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
          DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
          DIMTS_JWT_SECRET: "jwt-secret-at-least-thirty-two-characters",
          DIMTS_CRON_SECRET: "cron-secret-at-least-twenty-four-characters",
        }),
      });
      server = createServer(app);
      app.locals.attachHelpWebSockets(server);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
    }, 30000);
    afterAll(async () => {
      sockets.forEach((socket) => socket.terminate());
      await app?.locals.close();
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });
    async function connect(auth: Record<string, unknown>) {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("server");
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/help/ws`);
      sockets.push(socket);
      const frames: Record<string, unknown>[] = [];
      socket.on("message", (raw) => frames.push(JSON.parse(String(raw))));
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      socket.send(JSON.stringify({ type: "auth", ...auth }));
      await expect
        .poll(() => frames.some((frame) => frame.type === "help.joined"))
        .toBe(true);
      return { socket, frames };
    }
    it("persists waiting messages, claims once, relays/replays, authorizes images and clears help on end", async () => {
      const created = await request(app)
        .post("/v1/help")
        .set("Authorization", `Bearer ${token}`)
        .send({ sessionId, includeSummary: false });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      const learner = await connect({
        requestId: id,
        role: "learner",
        sessionId,
        token,
      });
      learner.socket.send(
        JSON.stringify({
          type: "chat.message",
          id: "message-before-claim",
          text: "Synthetic waiting message.",
        }),
      );
      await expect
        .poll(async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM help_message WHERE help_request_id=$1",
                [id],
              )
            ).rows[0].count,
          ),
        )
        .toBe(1);
      const login = await request(app)
        .post("/v1/helpers/login")
        .send({ token: helperToken });
      const jwt = login.body.jwt as string;
      const queue = await request(app)
        .get("/v1/help/queue")
        .set("Authorization", `Bearer ${jwt}`);
      expect(queue.body.requests[0].summary).toBeNull();
      const claim = await request(app)
        .post(`/v1/help/${id}/claim`)
        .set("Authorization", `Bearer ${jwt}`)
        .send({});
      expect(claim.status).toBe(200);
      const helper = await connect({ requestId: id, role: "helper", jwt });
      await expect
        .poll(() =>
          helper.frames.some((frame) => frame.id === "message-before-claim"),
        )
        .toBe(true);
      await expect
        .poll(() =>
          learner.frames.some(
            (frame) =>
              frame.type === "help.joined" && frame.helperJoined === true,
          ),
        )
        .toBe(true);
      expect(JSON.stringify(learner.frames)).not.toContain(
        "Private staff name",
      );
      await request(app)
        .patch("/v1/helpers/profile")
        .set("Authorization", `Bearer ${jwt}`)
        .send({ displayName: "Alex" })
        .expect(200);
      await expect
        .poll(
          () =>
            learner.frames
              .filter((frame) => frame.type === "help.joined")
              .at(-1)?.helperName,
        )
        .toBe("Alex");
      await request(app)
        .patch("/v1/helpers/profile")
        .set("Authorization", `Bearer ${jwt}`)
        .send({ displayName: null })
        .expect(200);
      await expect
        .poll(
          () =>
            learner.frames
              .filter((frame) => frame.type === "help.joined")
              .at(-1)?.helperName,
        )
        .toBeUndefined();
      helper.socket.send(
        JSON.stringify({
          type: "chat.message",
          id: "helper-reply",
          text: "Synthetic helper reply.",
        }),
      );
      await expect
        .poll(() => learner.frames.some((frame) => frame.id === "helper-reply"))
        .toBe(true);
      helper.socket.send(JSON.stringify({ type: "share.request" }));
      await expect
        .poll(() =>
          learner.frames.some((frame) => frame.type === "share.request"),
        )
        .toBe(true);
      learner.socket.send(JSON.stringify({ type: "share.decline" }));
      await expect
        .poll(() =>
          helper.frames.some((frame) => frame.type === "share.decline"),
        )
        .toBe(true);
      expect(
        (
          await pool.query(
            "SELECT channel,notice_version,purpose FROM consent_log",
          )
        ).rows,
      ).toEqual([]);
      helper.socket.send(JSON.stringify({ type: "share.request" }));
      await expect
        .poll(
          () =>
            learner.frames.filter((frame) => frame.type === "share.request")
              .length,
        )
        .toBe(2);
      learner.socket.send(JSON.stringify({ type: "share.accept" }));
      await expect
        .poll(() =>
          helper.frames.some((frame) => frame.type === "share.accept"),
        )
        .toBe(true);
      expect(
        (
          await pool.query(
            "SELECT channel,notice_version,purpose FROM consent_log",
          )
        ).rows,
      ).toEqual([
        {
          channel: "web",
          notice_version: "screen-share-v1",
          purpose: "screen-share",
        },
      ]);
      learner.socket.send(JSON.stringify({ type: "share.stop" }));
      const png = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      const image = await request(app)
        .post(`/v1/help/${id}/image`)
        .query({ sessionId })
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "image/png")
        .send(png);
      expect(image.status).toBe(201);
      expect(
        (
          await request(app)
            .get(`/v1/help/${id}/image/${image.body.id}`)
            .set("Authorization", `Bearer ${jwt}`)
        ).status,
      ).toBe(200);
      learner.socket.terminate();
      const resumed = await connect({
        requestId: id,
        role: "learner",
        sessionId,
        token,
        lastMessageId: "message-before-claim",
      });
      await expect
        .poll(
          () =>
            resumed.frames.filter((frame) => frame.id === "helper-reply")
              .length,
        )
        .toBe(1);
      expect(
        resumed.frames.some((frame) => frame.id === "message-before-claim"),
      ).toBe(false);
      expect(
        (
          await request(app)
            .post(`/v1/help/${id}/close`)
            .set("Authorization", `Bearer ${jwt}`)
            .send({ resolved: true })
        ).status,
      ).toBe(204);
      await expect
        .poll(() =>
          resumed.frames.some((frame) => frame.type === "help.closed"),
        )
        .toBe(true);
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM help_image WHERE help_request_id=$1",
              [id],
            )
          ).rows[0].count,
        ),
      ).toBe(0);
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM help_message WHERE help_request_id=$1",
              [id],
            )
          ).rows[0].count,
        ),
      ).toBe(0);
    }, 20000);
  },
);
