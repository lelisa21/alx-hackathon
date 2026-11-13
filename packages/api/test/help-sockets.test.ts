import { createServer } from "node:http";
import { SignJWT } from "jose";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { sha256 } from "../src/middleware/auth.js";
import { attachHelpWebSockets } from "../src/help-sockets.js";
import type {
  HelpSocketMessage,
  HelpSocketStore,
} from "../src/help-sockets.js";

const secrets = [
  Buffer.alloc(32, 1).toString("base64"),
  Buffer.alloc(32, 2).toString("base64"),
  Buffer.alloc(32, 3).toString("base64"),
];

const config = parseConfig({
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: secrets[0],
  DIMTS_HASH_KEY: secrets[1],
  DIMTS_JWT_SECRET: secrets[2],
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
});

const learnerToken = "learner-session-token-000000000000";
const requestId = "help-request-123";
const sessionId = "learner-session-123";
const seedMessage: HelpSocketMessage = {
  id: "seed-message",
  sender: "helper",
  text: "Welcome",
};

function createStore() {
  const messages = [seedMessage];
  const store: HelpSocketStore = {
    authenticateLearner: async (id, session, tokenHash) =>
      id === requestId &&
      session === sessionId &&
      tokenHash === sha256(learnerToken),
    isHelperActive: async (id) => id === "helper-one",
    isHelperClaimed: async (id, helperId) =>
      id === requestId && helperId === "helper-one",
    listMessagesAfter: async (id, lastMessageId) => {
      if (id !== requestId) return [];
      const lastIndex = lastMessageId
        ? messages.findIndex(({ id: messageId }) => messageId === lastMessageId)
        : -1;
      return messages.slice(lastIndex + 1);
    },
    persistMessage: async (id, sender, messageId, text) => {
      if (id !== requestId) return "rejected";
      const existing = messages.find(
        ({ id: savedId }) => savedId === messageId,
      );
      if (existing) {
        return existing.sender === sender && existing.text === text
          ? "duplicate"
          : "rejected";
      }
      messages.push({ id: messageId, sender, text });
      return "stored";
    },
  };
  return { store, messages };
}

async function createHelperJwt(): Promise<string> {
  return new SignJWT({ role: "helper" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("helper-one")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(config.DIMTS_JWT_SECRET));
}

interface SocketHarness {
  connect(): Promise<WebSocket>;
  closeRequest(requestId: string): Promise<void>;
  close(): Promise<void>;
  errors: ReturnType<typeof vi.fn>;
}

async function createHarness(): Promise<SocketHarness> {
  const { store } = createStore();
  const errors = vi.fn();
  const server = createServer();
  const socketServer = attachHelpWebSockets(server, {
    config,
    store,
    onError: errors,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The test WebSocket server has no TCP address.");
  }
  const url = `ws://127.0.0.1:${address.port}/v1/help/ws`;
  const clients: WebSocket[] = [];
  return {
    errors,
    connect: async () => {
      const socket = new WebSocket(url);
      clients.push(socket);
      return new Promise<WebSocket>((resolve, reject) => {
        socket.once("open", () => resolve(socket));
        socket.once("error", reject);
      });
    },
    closeRequest: (id) => socketServer.closeRequest(id),
    close: async () => {
      for (const client of clients) client.terminate();
      socketServer.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

interface MessageReader {
  queue: unknown[];
  waiters: Array<{
    resolve(message: unknown): void;
    reject(error: Error): void;
  }>;
}

const messageReaders = new WeakMap<WebSocket, MessageReader>();

function nextMessage(socket: WebSocket): Promise<unknown> {
  let reader = messageReaders.get(socket);
  if (!reader) {
    reader = { queue: [], waiters: [] };
    messageReaders.set(socket, reader);
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw));
        const waiter = reader?.waiters.shift();
        if (waiter) waiter.resolve(message);
        else reader?.queue.push(message);
      } catch (error) {
        const waiter = reader?.waiters.shift();
        if (waiter) {
          waiter.reject(
            error instanceof Error ? error : new Error("Invalid JSON frame"),
          );
        }
      }
    });
    socket.on("error", (error) => {
      for (const waiter of reader?.waiters.splice(0) ?? []) {
        waiter.reject(error);
      }
    });
  }
  if (reader.queue.length > 0) {
    return Promise.resolve(reader.queue.shift());
  }
  return new Promise((resolve, reject) => {
    reader?.waiters.push({ resolve, reject });
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code) => resolve(code));
    socket.once("error", reject);
  });
}

function sendAuth(
  socket: WebSocket,
  role: "learner" | "helper",
  jwt?: string,
  lastMessageId?: string,
): void {
  socket.send(
    JSON.stringify({
      type: "auth",
      requestId,
      role,
      ...(role === "learner" ? { sessionId, token: learnerToken } : { jwt }),
      ...(lastMessageId ? { lastMessageId } : {}),
    }),
  );
}

async function expectNoMessage(
  socket: WebSocket,
  durationMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      resolve();
    }, durationMs);
    const onMessage = () => {
      clearTimeout(timer);
      reject(new Error("Unexpected WebSocket message"));
    };
    socket.once("message", onMessage);
  });
}

const harnesses: SocketHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

describe("WP07 help WebSocket", () => {
  it("exposes the help WebSocket attachment in API composition", async () => {
    const { store } = createStore();
    const app = buildApp({ config, helpSocketStore: store });

    expect(typeof app.locals.attachHelpWebSockets).toBe("function");
    await app.locals.close();
  });

  it("requires the first client message to authenticate", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const socket = await harness.connect();
    const closedPromise = closed(socket);
    socket.send(JSON.stringify({ type: "chat.message", id: "x", text: "hi" }));

    expect(await closedPromise).toBe(4401);
  });

  it("closes unauthenticated sockets after five seconds", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const socket = await harness.connect();

    expect(await closed(socket)).toBe(4401);
  }, 7_000);

  it("authenticates, relays ordered chat, and replays after lastMessageId", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const learner = await harness.connect();
    const learnerWelcome = nextMessage(learner);
    const firstReplay = nextMessage(learner);
    sendAuth(learner, "learner");
    expect(await learnerWelcome).toEqual({ type: "help.joined" });
    expect(await firstReplay).toEqual({
      type: "chat.message",
      id: seedMessage.id,
      text: seedMessage.text,
      from: seedMessage.sender,
    });

    const helper = await harness.connect();
    const helperWelcome = nextMessage(helper);
    sendAuth(helper, "helper", await createHelperJwt(), seedMessage.id);
    expect(await helperWelcome).toEqual({ type: "help.joined" });

    const firstHelperMessage = nextMessage(helper);
    learner.send(
      JSON.stringify({
        type: "chat.message",
        id: "learner-message-1",
        text: "First question",
      }),
    );
    expect(await firstHelperMessage).toEqual({
      type: "chat.message",
      id: "learner-message-1",
      text: "First question",
      from: "learner",
    });
    learner.send(
      JSON.stringify({
        type: "chat.message",
        id: "learner-message-1",
        text: "First question",
      }),
    );
    await expectNoMessage(helper, 100);

    const secondHelperMessage = nextMessage(helper);
    learner.send(
      JSON.stringify({
        type: "chat.message",
        id: "learner-message-2",
        text: "Second question",
      }),
    );
    expect(await secondHelperMessage).toEqual({
      type: "chat.message",
      id: "learner-message-2",
      text: "Second question",
      from: "learner",
    });

    const learnerReply = nextMessage(learner);
    helper.send(
      JSON.stringify({
        type: "chat.message",
        id: "helper-message-1",
        text: "I can help.",
      }),
    );
    expect(await learnerReply).toEqual({
      type: "chat.message",
      id: "helper-message-1",
      text: "I can help.",
      from: "helper",
    });

    const learnerClosed = closed(learner);
    learner.close();
    await learnerClosed;

    const reconnectedLearner = await harness.connect();
    const reconnectWelcome = nextMessage(reconnectedLearner);
    const firstReplayedMessage = nextMessage(reconnectedLearner);
    const secondReplayedMessage = nextMessage(reconnectedLearner);
    sendAuth(reconnectedLearner, "learner", undefined, "learner-message-1");
    expect(await reconnectWelcome).toEqual({ type: "help.joined" });
    expect(await firstReplayedMessage).toEqual({
      type: "chat.message",
      id: "learner-message-2",
      text: "Second question",
      from: "learner",
    });
    expect(await secondReplayedMessage).toEqual({
      type: "chat.message",
      id: "helper-message-1",
      text: "I can help.",
      from: "helper",
    });
    expect(harness.errors).not.toHaveBeenCalled();
  });

  it("notifies both peers and closes sockets when help ends", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const learner = await harness.connect();
    const learnerWelcome = nextMessage(learner);
    const learnerReplay = nextMessage(learner);
    sendAuth(learner, "learner");
    expect(await learnerWelcome).toEqual({ type: "help.joined" });
    expect(await learnerReplay).toEqual({
      type: "chat.message",
      id: seedMessage.id,
      text: seedMessage.text,
      from: seedMessage.sender,
    });

    const helper = await harness.connect();
    const helperWelcome = nextMessage(helper);
    sendAuth(helper, "helper", await createHelperJwt(), seedMessage.id);
    expect(await helperWelcome).toEqual({ type: "help.joined" });

    const learnerClosedFrame = nextMessage(learner);
    const helperClosedFrame = nextMessage(helper);
    const learnerClose = closed(learner);
    const helperClose = closed(helper);
    await harness.closeRequest(requestId);

    expect(await learnerClosedFrame).toEqual({ type: "help.closed" });
    expect(await helperClosedFrame).toEqual({ type: "help.closed" });
    expect(await learnerClose).toBe(1000);
    expect(await helperClose).toBe(1000);
  });

  it("rejects invalid learner credentials with close code 4401", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const socket = await harness.connect();
    const closedPromise = closed(socket);
    socket.send(
      JSON.stringify({
        type: "auth",
        requestId,
        role: "learner",
        sessionId,
        token: "invalid-session-token-000000000000",
      }),
    );

    expect(await closedPromise).toBe(4401);
  });

  it("rejects auth frames carrying uncontracted learner data", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const socket = await harness.connect();
    const closedPromise = closed(socket);
    socket.send(
      JSON.stringify({
        type: "auth",
        requestId,
        role: "learner",
        sessionId,
        token: learnerToken,
        deviceId: "must-not-be-sent",
      }),
    );

    expect(await closedPromise).toBe(4401);
  });

  it("throttles chat.typing without relaying the repeated frame", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const helper = await harness.connect();
    const helperWelcome = nextMessage(helper);
    sendAuth(helper, "helper", await createHelperJwt(), seedMessage.id);
    await helperWelcome;

    const learner = await harness.connect();
    const learnerWelcome = nextMessage(learner);
    sendAuth(learner, "learner", undefined, seedMessage.id);
    await learnerWelcome;

    const typing = nextMessage(helper);
    learner.send(JSON.stringify({ type: "chat.typing" }));
    learner.send(JSON.stringify({ type: "chat.typing" }));
    expect(await typing).toEqual({ type: "chat.typing" });
    await expectNoMessage(helper, 100);
  });
});
