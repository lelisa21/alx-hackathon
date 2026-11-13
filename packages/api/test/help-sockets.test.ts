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
    recordShareConsent: vi.fn(async () => true),
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
  store: HelpSocketStore;
  refreshHelper(helperId: string): Promise<void>;
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
    refreshHelper: (id) => socketServer.refreshHelper(id),
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
    store,
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
    refreshHelper: (id) => socketServer.refreshHelper(id),
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
  async function pair() {
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
    return { harness, learner, helper };
  }

  it("FR-HELP-08 permits only requested learner consent and ordered RTC roles", async () => {
    const { helper, learner } = await pair();
    const relay = async (from: WebSocket, to: WebSocket, frame: object) => {
      const received = nextMessage(to);
      from.send(JSON.stringify(frame));
      expect(await received).toEqual(frame);
    };
    await relay(helper, learner, { type: "share.request" });
    await relay(learner, helper, { type: "share.accept" });
    await relay(learner, helper, { type: "rtc.offer", sdp: "v=0\r\n" });
    await relay(helper, learner, { type: "rtc.answer", sdp: "v=0\r\n" });
    await relay(helper, learner, {
      type: "rtc.ice",
      candidate: { candidate: "candidate:1", sdpMid: "0" },
    });
    await relay(learner, helper, { type: "share.stop", reason: "learner" });
    const ended = closed(learner);
    learner.send(JSON.stringify({ type: "rtc.offer", sdp: "v=0\r\n" }));
    expect(await ended).toBe(1008);
  });

  it("NFR-PRIV-04 records only valid learner consent once without frame content", async () => {
    const { harness, helper, learner } = await pair();
    const requested = nextMessage(learner);
    helper.send(JSON.stringify({ type: "share.request" }));
    await requested;
    const declined = nextMessage(helper);
    learner.send(JSON.stringify({ type: "share.decline" }));
    await declined;
    expect(harness.store.recordShareConsent).not.toHaveBeenCalled();

    const requestedAgain = nextMessage(learner);
    helper.send(JSON.stringify({ type: "share.request" }));
    await requestedAgain;
    const accepted = nextMessage(helper);
    learner.send(JSON.stringify({ type: "share.accept" }));
    expect(await accepted).toEqual({ type: "share.accept" });
    expect(harness.store.recordShareConsent).toHaveBeenCalledExactlyOnceWith(
      requestId,
    );
    const ended = closed(learner);
    learner.send(JSON.stringify({ type: "share.accept" }));
    expect(await ended).toBe(1008);
    expect(harness.store.recordShareConsent).toHaveBeenCalledTimes(1);
  });

  it.each(["helper", "learner"] as const)(
    "NFR-PRIV-04 does not audit unauthorized %s acceptance",
    async (role) => {
      const { harness, helper, learner } = await pair();
      const socket = role === "helper" ? helper : learner;
      const ended = closed(socket);
      socket.send(JSON.stringify({ type: "share.accept" }));
      expect(await ended).toBe(1008);
      expect(harness.store.recordShareConsent).not.toHaveBeenCalled();
    },
  );

  it("NFR-PRIV-04 fails closed if request ends before consent can be stored", async () => {
    const { harness, helper, learner } = await pair();
    const requested = nextMessage(learner);
    helper.send(JSON.stringify({ type: "share.request" }));
    await requested;
    harness.store.recordShareConsent = vi.fn(async () => false);
    const stopped = nextMessage(helper);
    const ended = closed(learner);
    learner.send(JSON.stringify({ type: "share.accept" }));
    expect(await stopped).toEqual({ type: "share.stop", reason: "ended" });
    expect(await ended).toBe(4401);
  });

  it.each([
    ["learner", { type: "share.request" }],
    ["helper", { type: "share.accept" }],
    ["helper", { type: "share.decline" }],
    ["helper", { type: "rtc.offer", sdp: "v=0" }],
    ["learner", { type: "rtc.answer", sdp: "v=0" }],
    ["learner", { type: "share.accept" }],
    ["learner", { type: "rtc.ice", candidate: { candidate: "candidate:1" } }],
  ] as const)(
    "FR-HELP-08 rejects role/state spoofing by %s: %j",
    async (role, frame) => {
      const peers = await pair();
      const socket = peers[role];
      const ended = closed(socket);
      socket.send(JSON.stringify(frame));
      expect(await ended).toBe(1008);
    },
  );

  it("FR-HELP-08 declining leaves chat open and disconnect cancels consent", async () => {
    const { harness, helper, learner } = await pair();
    const request = nextMessage(learner);
    helper.send(JSON.stringify({ type: "share.request" }));
    await request;
    const decline = nextMessage(helper);
    learner.send(JSON.stringify({ type: "share.decline" }));
    expect(await decline).toEqual({ type: "share.decline" });
    const chat = nextMessage(helper);
    learner.send(
      JSON.stringify({
        type: "chat.message",
        id: "after-decline",
        text: "Continue here",
      }),
    );
    expect(await chat).toMatchObject({
      type: "chat.message",
      id: "after-decline",
    });
    const requested = nextMessage(learner);
    helper.send(JSON.stringify({ type: "share.request" }));
    await requested;
    const stopped = nextMessage(helper);
    learner.close();
    expect(await stopped).toEqual({ type: "share.stop", reason: "disconnect" });
    const fresh = await harness.connect();
    const welcome = nextMessage(fresh);
    sendAuth(fresh, "learner", undefined, "after-decline");
    await welcome;
    const ended = closed(fresh);
    fresh.send(JSON.stringify({ type: "share.accept" }));
    expect(await ended).toBe(1008);
  });

  it.each(["learner", "helper"] as const)(
    "revalidates revoked %s credentials on every frame",
    async (role) => {
      const { harness, learner, helper } = await pair();
      if (role === "learner")
        harness.store.authenticateLearner = async () => false;
      else harness.store.isHelperActive = async () => false;
      const socket = role === "learner" ? learner : helper;
      const ended = closed(socket);
      socket.send(JSON.stringify({ type: "chat.typing" }));
      expect(await ended).toBe(4401);
    },
  );

  it("does not deliver chat to a helper revoked while its socket is idle", async () => {
    const { harness, learner, helper } = await pair();
    harness.store.isHelperClaimed = async () => false;
    const ended = closed(helper);
    learner.send(
      JSON.stringify({
        type: "chat.message",
        id: "private",
        text: "Do not relay",
      }),
    );
    expect(await ended).toBe(4401);
  });

  it("FR-HELP-16 identifies helper presence and only the deliberate public name", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    harness.store.getHelperName = async () => "Public first name";
    const learner = await harness.connect();
    const welcome = nextMessage(learner);
    sendAuth(learner, "learner", undefined, seedMessage.id);
    expect(await welcome).toEqual({ type: "help.joined", helperJoined: false });
    const helper = await harness.connect();
    const helperWelcome = nextMessage(helper);
    const joined = nextMessage(learner);
    sendAuth(helper, "helper", await createHelperJwt(), seedMessage.id);
    await helperWelcome;
    expect(await joined).toEqual({
      type: "help.joined",
      helperJoined: true,
      helperName: "Public first name",
    });
    harness.store.getHelperName = async () => undefined;
    const cleared = nextMessage(learner);
    await harness.refreshHelper("helper-one");
    expect(await cleared).toEqual({ type: "help.joined", helperJoined: true });
  });

  it("drops unknown types without closing chat and rejects malformed known signals", async () => {
    const { learner, helper } = await pair();
    learner.send(JSON.stringify({ type: "share.future" }));
    learner.send(JSON.stringify({ type: "future.message" }));
    const message = nextMessage(helper);
    learner.send(
      JSON.stringify({
        type: "chat.message",
        id: "unknown-after",
        text: "Still connected",
      }),
    );
    expect(await message).toMatchObject({ id: "unknown-after" });
    const ended = closed(learner);
    learner.send(
      JSON.stringify({ type: "rtc.offer", sdp: "v=0", deviceId: "forbidden" }),
    );
    expect(await ended).toBe(1008);
  });

  it("FR-HELP-09 either-side stop and help closure end active sharing", async () => {
    const { learner, helper, harness } = await pair();
    const request = nextMessage(learner);
    helper.send(JSON.stringify({ type: "share.request" }));
    await request;
    const accept = nextMessage(helper);
    learner.send(JSON.stringify({ type: "share.accept" }));
    await accept;
    const stopped = nextMessage(learner);
    helper.send(JSON.stringify({ type: "share.stop" }));
    expect(await stopped).toEqual({ type: "share.stop", reason: "ended" });
    const requestedAgain = nextMessage(learner);
    helper.send(JSON.stringify({ type: "share.request" }));
    await requestedAgain;
    const learnerStop = nextMessage(learner);
    const helperStop = nextMessage(helper);
    await harness.closeRequest(requestId);
    expect(await learnerStop).toEqual({ type: "share.stop", reason: "ended" });
    expect(await helperStop).toEqual({ type: "share.stop", reason: "ended" });
  });

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

  it("does not join or replay to a socket closed while its queued authentication completes", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    let resume!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let checks = 0;
    harness.store.authenticateLearner = async () => {
      checks += 1;
      if (checks === 2) {
        entered();
        await pending;
      }
      return true;
    };
    const replay = vi.fn(async () => []);
    harness.store.listMessagesAfter = replay;
    const socket = await harness.connect();
    sendAuth(socket, "learner");
    await waiting;
    const ended = closed(socket);
    socket.close();
    await ended;
    resume();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(replay).not.toHaveBeenCalled();
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
    expect(await learnerWelcome).toMatchObject({ type: "help.joined" });
    expect(await firstReplay).toEqual({
      type: "chat.message",
      id: seedMessage.id,
      text: seedMessage.text,
      from: seedMessage.sender,
    });

    const helper = await harness.connect();
    const helperWelcome = nextMessage(helper);
    sendAuth(helper, "helper", await createHelperJwt(), seedMessage.id);
    expect(await helperWelcome).toMatchObject({ type: "help.joined" });

    expect(await nextMessage(learner)).toMatchObject({
      type: "help.joined",
      helperJoined: true,
    });

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
    expect(await reconnectWelcome).toMatchObject({ type: "help.joined" });
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
    expect(await learnerWelcome).toMatchObject({ type: "help.joined" });
    expect(await learnerReplay).toEqual({
      type: "chat.message",
      id: seedMessage.id,
      text: seedMessage.text,
      from: seedMessage.sender,
    });

    const helper = await harness.connect();
    const helperWelcome = nextMessage(helper);
    sendAuth(helper, "helper", await createHelperJwt(), seedMessage.id);
    expect(await helperWelcome).toMatchObject({ type: "help.joined" });

    expect(await nextMessage(learner)).toMatchObject({
      type: "help.joined",
      helperJoined: true,
    });

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
