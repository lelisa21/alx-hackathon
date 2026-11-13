// FR-TG-05/08/11/12: standard webhook auth, validation, private projection, safe errors.
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createTelegramRouter } from "../src/routes/telegram.js";
import { parseConfig } from "../src/config.js";
import { generateOpenApiYaml } from "../src/openapi.js";

const secret = "synthetic-telegram-webhook-secret-only";
const environment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost/test",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: "synthetic-jwt-secret-at-least-32-characters",
  DIMTS_CRON_SECRET: "synthetic-cron-secret-at-least-24-characters",
  DIMTS_TELEGRAM_TOKEN: "123456789:synthetic_telegram_token_for_tests_only",
  DIMTS_TELEGRAM_SECRET: secret,
};
const body = {
  update_id: 1,
  message: {
    message_id: 2,
    date: 1700000000,
    chat: { id: 123456, type: "private" },
    from: { id: 123456, is_bot: false, first_name: "Synthetic private name" },
    text: "/start",
  },
};
function setup(overrides: Record<string, unknown> = {}, enabled = true) {
  const handleUpdate = vi
    .fn<(update: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const app = express();
  app.use(
    "/v1",
    createTelegramRouter({
      config: parseConfig({ ...environment, ...overrides }),
      ...(enabled ? { service: { handleUpdate } } : {}),
    }),
  );
  return { app, handleUpdate };
}
const post = (app: express.Express) =>
  request(app)
    .post("/v1/telegram/webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", secret);
describe("P08 Telegram webhook boundary", () => {
  it("requires the standard secret header before JSON parsing and ignores query-string credentials", async () => {
    const { app, handleUpdate } = setup();
    for (const candidate of [undefined, "wrong-secret"]) {
      let call = request(app)
        .post(`/v1/telegram/webhook?secret=${secret}`)
        .set("Content-Type", "application/json");
      if (candidate)
        call = call.set("X-Telegram-Bot-Api-Secret-Token", candidate);
      const response = await call.send("{").expect(401);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(JSON.stringify(response.body)).not.toContain(secret);
    }
    expect(handleUpdate).not.toHaveBeenCalled();
  });
  it.each([
    { DIMTS_TELEGRAM_TOKEN: "", DIMTS_TELEGRAM_SECRET: "" },
    { DIMTS_TELEGRAM_MODE: "polling" },
  ])("fails closed when webhook mode is unavailable", async (overrides) => {
    const { app, handleUpdate } = setup(overrides);
    await post(app).send(body).expect(503);
    expect(handleUpdate).not.toHaveBeenCalled();
  });
  it("requires a service and returns only an acknowledgment for valid input", async () => {
    await post(setup({}, false).app).send(body).expect(503);
    const { app, handleUpdate } = setup();
    const response = await post(app).send(body).expect(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(handleUpdate).toHaveBeenCalledOnce();
    expect(JSON.stringify(response.body)).not.toMatch(
      /123456|Synthetic private name|start/,
    );
  });
  it.each(["group", "supergroup", "channel"])(
    "silently acknowledges %s without dispatch",
    async (type) => {
      const { app, handleUpdate } = setup();
      await post(app)
        .send({
          ...body,
          message: { ...body.message, chat: { id: -100123, type } },
        })
        .expect(200, { ok: true });
      expect(handleUpdate).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...body, update_id: -1 },
    { ...body, unexpected: "value" },
    {
      ...body,
      message: { ...body.message, from: { ...body.message.from, id: 654321 } },
    },
  ])("rejects invalid or spoofed private input", async (input) => {
    const { app, handleUpdate } = setup();
    await post(app).send(input).expect(400);
    expect(handleUpdate).not.toHaveBeenCalled();
  });
  it("bounds JSON and sanitizes malformed/transport failures", async () => {
    const { app, handleUpdate } = setup();
    await post(app)
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
    await post(app)
      .send({ ...body, padding: "x".repeat(70_000) })
      .expect(413);
    handleUpdate.mockRejectedValueOnce(
      new Error("private token 123456 transcript"),
    );
    const response = await post(app).send(body).expect(503);
    expect(response.body.message).toContain("/help");
    expect(JSON.stringify(response.body)).not.toMatch(
      /123456|transcript|token/,
    );
  });
  it("documents the canonical route and standard header authentication", () => {
    const openapi = generateOpenApiYaml();
    expect(openapi).toContain("/v1/telegram/webhook:");
    expect(openapi).toContain("X-Telegram-Bot-Api-Secret-Token");
  });
});
