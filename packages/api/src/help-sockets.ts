import type { IncomingMessage, Server } from "node:http";
import { jwtVerify } from "jose";
import { z } from "zod";
import { sha256 } from "./middleware/auth.js";
import type { ApiConfig } from "./config.js";
import WebSocket, { WebSocketServer } from "ws";

export interface HelpSocketMessage {
  id: string;
  sender: "learner" | "helper";
  text: string;
}

export interface HelpSocketStore {
  authenticateLearner(
    requestId: string,
    sessionId: string,
    tokenHash: string,
  ): Promise<boolean>;
  isHelperActive(helperId: string): Promise<boolean>;
  isHelperClaimed(requestId: string, helperId: string): Promise<boolean>;
  recordShareConsent(requestId: string): Promise<boolean>;
  getHelperName?(requestId: string): Promise<string | undefined>;
  listMessagesAfter(
    requestId: string,
    lastMessageId?: string,
  ): Promise<HelpSocketMessage[]>;
  persistMessage(
    requestId: string,
    sender: "learner" | "helper",
    id: string,
    text: string,
  ): Promise<"stored" | "duplicate" | "rejected">;
}

interface HelpSocketOptions {
  config: ApiConfig;
  store: HelpSocketStore;
  onError(error: unknown): void;
}

interface Peer {
  ws: WebSocket;
  requestId: string;
  role: "learner" | "helper";
  lastTypingAt: number;
  auth: unknown;
  helperId?: string;
}

interface Room {
  peers: Set<Peer>;
  queue: Promise<void>;
  share?: {
    state: "asked" | "accepted" | "offered" | "sharing";
    helper: Peer;
    learner?: Peer;
  };
}

export interface HelpSocketRuntime {
  close(): void;
  closeRequest(requestId: string): Promise<void>;
  publishMessage(requestId: string, message: HelpSocketMessage): Promise<void>;
  refreshHelper(helperId: string): Promise<void>;
}

const authMessageSchema = z.discriminatedUnion("role", [
  z
    .object({
      type: z.literal("auth"),
      requestId: z.string().min(1).max(128),
      role: z.literal("learner"),
      sessionId: z.string().min(8).max(64),
      token: z.string().min(20).max(100),
      lastMessageId: z.string().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("auth"),
      requestId: z.string().min(1).max(128),
      role: z.literal("helper"),
      jwt: z.string().min(20).max(4096),
      lastMessageId: z.string().min(1).max(128).optional(),
    })
    .strict(),
]);

const chatMessageSchema = z
  .object({
    type: z.literal("chat.message"),
    id: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !value.includes("\0")),
    text: z
      .string()
      .min(1)
      .max(2000)
      .refine((value) => !value.includes("\0")),
  })
  .strict();

const chatTypingSchema = z.object({ type: z.literal("chat.typing") }).strict();
const shareSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("share.request") }).strict(),
  z.object({ type: z.literal("share.accept") }).strict(),
  z.object({ type: z.literal("share.decline") }).strict(),
  z
    .object({
      type: z.literal("share.stop"),
      reason: z.string().min(1).max(64).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("rtc.offer"),
      sdp: z.string().min(1).max(12_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("rtc.answer"),
      sdp: z.string().min(1).max(12_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("rtc.ice"),
      candidate: z
        .object({
          candidate: z.string().max(2048),
          sdpMid: z.string().max(256).nullable().optional(),
          sdpMLineIndex: z
            .number()
            .int()
            .min(0)
            .max(65535)
            .nullable()
            .optional(),
          usernameFragment: z.string().max(256).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
]);
const AUTH_TIMEOUT_MS = 5_000;
const SIGNAL_TYPES = new Set(
  shareSchema.options.map((schema) => schema.shape.type.value as string),
);
const TYPING_THROTTLE_MS = 1_000;
const CHAT_SOCKET_PATH = "/v1/help/ws";

function decodeFrame(raw: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return raw.toString("utf8");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sendJson(
  ws: WebSocket,
  message: Record<string, unknown>,
): Promise<void> {
  if (ws.readyState !== WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    ws.send(JSON.stringify(message), (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

function sendClose(ws: WebSocket, code: number, reason: string): void {
  if (
    ws.readyState === WebSocket.OPEN ||
    ws.readyState === WebSocket.CONNECTING
  ) {
    ws.close(code, reason);
  }
}

export function attachHelpWebSockets(
  server: Server,
  options: HelpSocketOptions,
): HelpSocketRuntime {
  const rooms = new Map<string, Room>();
  const signingKey = new TextEncoder().encode(options.config.DIMTS_JWT_SECRET);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
    perMessageDeflate: false,
  });
  let closed = false;

  function getRoom(requestId: string): Room {
    let room = rooms.get(requestId);
    if (!room) {
      room = { peers: new Set(), queue: Promise.resolve() };
      rooms.set(requestId, room);
    }
    return room;
  }

  function enqueue<T>(room: Room, operation: () => Promise<T>): Promise<T> {
    const result = room.queue.then(operation);
    room.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function authenticate(message: unknown): Promise<{
    requestId: string;
    role: "learner" | "helper";
    lastMessageId?: string;
    helperId?: string;
  } | null> {
    const parsed = authMessageSchema.safeParse(message);
    if (!parsed.success) return null;
    const auth = parsed.data;

    if (auth.role === "learner") {
      const valid = await options.store.authenticateLearner(
        auth.requestId,
        auth.sessionId,
        sha256(auth.token),
      );
      return valid
        ? {
            requestId: auth.requestId,
            role: auth.role,
            ...(auth.lastMessageId
              ? { lastMessageId: auth.lastMessageId }
              : {}),
          }
        : null;
    }

    let helperId: string;
    try {
      const verified = await jwtVerify(auth.jwt, signingKey, {
        algorithms: ["HS256"],
      });
      if (
        verified.payload.role !== "helper" ||
        typeof verified.payload.sub !== "string"
      ) {
        return null;
      }
      helperId = verified.payload.sub;
    } catch {
      return null;
    }
    if (
      !(await options.store.isHelperActive(helperId)) ||
      !(await options.store.isHelperClaimed(auth.requestId, helperId))
    ) {
      return null;
    }
    return {
      requestId: auth.requestId,
      role: auth.role,
      helperId,
      ...(auth.lastMessageId ? { lastMessageId: auth.lastMessageId } : {}),
    };
  }

  async function joinRoom(
    ws: WebSocket,
    identity: {
      requestId: string;
      role: "learner" | "helper";
      lastMessageId?: string;
      helperId?: string;
    },
    auth: unknown,
    setPeer: (peer: Peer) => void,
  ): Promise<void> {
    const room = getRoom(identity.requestId);
    await enqueue(room, async () => {
      await revalidate(room);
      if (!(await authenticate(auth)) || ws.readyState !== WebSocket.OPEN) {
        sendClose(ws, 4401, "invalid authentication");
        return;
      }
      const peer: Peer = {
        ws,
        requestId: identity.requestId,
        role: identity.role,
        lastTypingAt: 0,
        auth,
        ...(identity.helperId ? { helperId: identity.helperId } : {}),
      };
      setPeer(peer);
      room.peers.add(peer);
      await sendJoined(room, peer);
      const missed = await options.store.listMessagesAfter(
        peer.requestId,
        identity.lastMessageId,
      );
      for (const message of missed) {
        await sendJson(ws, {
          type: "chat.message",
          id: message.id,
          text: message.text,
          from: message.sender,
        });
      }
      if (peer.role === "helper") {
        for (const learner of room.peers) {
          if (learner.role === "learner") await sendJoined(room, learner);
        }
      }
    });
  }

  async function sendJoined(room: Room, peer: Peer): Promise<void> {
    const helperJoined = [...room.peers].some(
      (candidate) =>
        candidate.role === "helper" &&
        candidate.ws.readyState === WebSocket.OPEN,
    );
    const helperName = helperJoined
      ? await options.store.getHelperName?.(peer.requestId)
      : undefined;
    await sendJson(peer.ws, {
      type: "help.joined",
      helperJoined,
      ...(helperName ? { helperName } : {}),
    });
  }

  async function stopShare(
    room: Room,
    reason: string,
    except?: Peer,
  ): Promise<void> {
    if (!room.share) return;
    delete room.share;
    for (const peer of room.peers) {
      if (peer !== except)
        await sendJson(peer.ws, { type: "share.stop", reason });
    }
  }

  // Revalidate recipients as well: an idle revoked helper must not receive data.
  async function revalidate(room: Room): Promise<void> {
    let invalidated = false;
    for (const peer of [...room.peers]) {
      if (
        peer.ws.readyState !== WebSocket.OPEN ||
        !(await authenticate(peer.auth))
      ) {
        room.peers.delete(peer);
        sendClose(peer.ws, 4401, "invalid authentication");
        invalidated = true;
      }
    }
    if (invalidated) await stopShare(room, "ended");
  }

  async function signal(
    room: Room,
    peer: Peer,
    frame: z.infer<typeof shareSchema>,
  ): Promise<void> {
    const share = room.share;
    const reject = () => sendClose(peer.ws, 1008, "invalid sharing state");
    if (frame.type === "share.request") {
      if (
        peer.role !== "helper" ||
        share ||
        ![...room.peers].some((other) => other.role === "learner")
      )
        return reject();
      room.share = { state: "asked", helper: peer };
      await relay(room, peer, frame);
      return;
    }
    if (frame.type === "share.stop") {
      await stopShare(room, frame.reason ?? "ended", peer);
      return;
    }
    if (!share) return reject();
    if (frame.type === "share.accept" || frame.type === "share.decline") {
      if (peer.role !== "learner" || share.state !== "asked") return reject();
      if (frame.type === "share.decline") delete room.share;
      else {
        if (!(await options.store.recordShareConsent(peer.requestId))) {
          await stopShare(room, "ended");
          sendClose(peer.ws, 4401, "invalid authentication");
          return;
        }
        share.state = "accepted";
        share.learner = peer;
      }
      await sendJson(share.helper.ws, frame);
      return;
    }
    if (frame.type === "rtc.offer") {
      if (peer !== share.learner || share.state !== "accepted") return reject();
      share.state = "offered";
      await sendJson(share.helper.ws, frame);
      return;
    }
    if (frame.type === "rtc.answer") {
      if (peer !== share.helper || share.state !== "offered" || !share.learner)
        return reject();
      share.state = "sharing";
      await sendJson(share.learner.ws, frame);
      return;
    }
    if (
      share.state === "asked" ||
      !share.learner ||
      (peer !== share.learner && peer !== share.helper)
    )
      return reject();
    await sendJson(
      peer === share.learner ? share.helper.ws : share.learner.ws,
      frame,
    );
  }

  async function relay(
    room: Room,
    peer: Peer,
    message: Record<string, unknown>,
  ): Promise<void> {
    const receivers = [...room.peers].filter(
      (candidate) =>
        candidate.role !== peer.role &&
        candidate.ws.readyState === WebSocket.OPEN,
    );
    for (const receiver of receivers) {
      try {
        await sendJson(receiver.ws, message);
      } catch (error) {
        options.onError(error);
        receiver.ws.terminate();
      }
    }
  }

  wss.on("connection", (ws) => {
    let peer: Peer | undefined;
    let receivedFirstMessage = false;
    let processing = Promise.resolve();
    const authTimer = setTimeout(() => {
      if (!peer) sendClose(ws, 4401, "auth required");
    }, AUTH_TIMEOUT_MS);

    ws.on("message", (raw) => {
      if (!receivedFirstMessage) {
        receivedFirstMessage = true;
        clearTimeout(authTimer);
      }
      processing = processing
        .then(async () => {
          const decoded = parseJson(decodeFrame(raw));
          if (!peer) {
            const identity = await authenticate(decoded);
            if (!identity || ws.readyState !== WebSocket.OPEN) {
              sendClose(ws, 4401, "invalid authentication");
              return;
            }
            await joinRoom(ws, identity, decoded, (joinedPeer) => {
              peer = joinedPeer;
            });
            return;
          }

          const authenticatedPeer = peer;
          if (!authenticatedPeer) return;
          if (decoded === null) {
            sendClose(ws, 1008, "invalid message");
            return;
          }
          const room = rooms.get(authenticatedPeer.requestId);
          if (!room) return;
          await enqueue(room, async () => {
            await revalidate(room);
            if (!room.peers.has(authenticatedPeer)) return;
            const sharing = shareSchema.safeParse(decoded);
            if (sharing.success) {
              await signal(room, authenticatedPeer, sharing.data);
              return;
            }
            const chat = chatMessageSchema.safeParse(decoded);
            if (chat.success) {
              const saved = await options.store.persistMessage(
                authenticatedPeer.requestId,
                authenticatedPeer.role,
                chat.data.id,
                chat.data.text,
              );
              if (saved === "rejected") {
                sendClose(ws, 1008, "invalid message");
                return;
              }
              if (saved === "stored") {
                await relay(room, authenticatedPeer, {
                  type: "chat.message",
                  id: chat.data.id,
                  text: chat.data.text,
                  from: authenticatedPeer.role,
                });
              }
              return;
            }

            const typing = chatTypingSchema.safeParse(decoded);
            if (!typing.success) {
              const type =
                typeof decoded === "object" &&
                decoded !== null &&
                "type" in decoded &&
                typeof decoded.type === "string"
                  ? decoded.type
                  : undefined;
              if (
                type === "chat.message" ||
                type === "chat.typing" ||
                (type !== undefined && SIGNAL_TYPES.has(type))
              ) {
                sendClose(ws, 1008, "invalid message");
              }
              return;
            }
            const now = Date.now();
            if (now - authenticatedPeer.lastTypingAt < TYPING_THROTTLE_MS)
              return;
            authenticatedPeer.lastTypingAt = now;
            await relay(room, authenticatedPeer, { type: "chat.typing" });
          });
        })
        .catch((error: unknown) => {
          options.onError(error);
          sendClose(ws, 1011, "internal error");
        });
    });

    ws.once("close", () => {
      clearTimeout(authTimer);
      const disconnectedPeer = peer;
      if (!disconnectedPeer) return;
      const room = rooms.get(disconnectedPeer.requestId);
      if (!room) return;
      room.peers.delete(disconnectedPeer);
      void enqueue(room, async () => {
        await revalidate(room);
        await stopShare(room, "disconnect", disconnectedPeer);
        if (
          room.peers.size === 0 &&
          rooms.get(disconnectedPeer.requestId) === room
        ) {
          rooms.delete(disconnectedPeer.requestId);
        }
      }).catch(options.onError);
    });
    ws.on("error", options.onError);
  });

  wss.on("error", options.onError);

  const onUpgrade = (
    request: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== CHAT_SOCKET_PATH) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  };
  server.on("upgrade", onUpgrade);

  return {
    async publishMessage(requestId, message) {
      const room = rooms.get(requestId);
      if (!room || closed) return;
      await enqueue(room, async () => {
        await revalidate(room);
        for (const peer of room.peers) {
          if (peer.role === message.sender) continue;
          await sendJson(peer.ws, {
            type: "chat.message",
            id: message.id,
            text: message.text,
            from: message.sender,
          });
        }
      });
    },
    async refreshHelper(helperId) {
      for (const room of rooms.values()) {
        if (![...room.peers].some((peer) => peer.helperId === helperId))
          continue;
        await enqueue(room, async () => {
          await revalidate(room);
          for (const peer of room.peers) await sendJoined(room, peer);
        });
      }
    },
    async closeRequest(requestId) {
      const room = rooms.get(requestId);
      if (!room || closed) return;
      await enqueue(room, async () => {
        await stopShare(room, "ended");
        for (const peer of [...room.peers]) {
          if (peer.ws.readyState !== WebSocket.OPEN) continue;
          try {
            await sendJson(peer.ws, { type: "help.closed" });
            peer.ws.close(1000, "help ended");
          } catch (error) {
            options.onError(error);
            peer.ws.terminate();
          }
        }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      server.off("upgrade", onUpgrade);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
