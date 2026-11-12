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
}

interface Room {
  peers: Set<Peer>;
  queue: Promise<void>;
}

export interface HelpSocketRuntime {
  close(): void;
  closeRequest(requestId: string): Promise<void>;
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
const AUTH_TIMEOUT_MS = 5_000;
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
  message: Record<string, string>,
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
      ...(auth.lastMessageId ? { lastMessageId: auth.lastMessageId } : {}),
    };
  }

  async function joinRoom(
    ws: WebSocket,
    identity: {
      requestId: string;
      role: "learner" | "helper";
      lastMessageId?: string;
    },
    setPeer: (peer: Peer) => void,
  ): Promise<void> {
    const room = getRoom(identity.requestId);
    await enqueue(room, async () => {
      const peer: Peer = {
        ws,
        requestId: identity.requestId,
        role: identity.role,
        lastTypingAt: 0,
      };
      setPeer(peer);
      room.peers.add(peer);
      await sendJson(ws, { type: "help.joined" });
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
    });
  }

  async function relay(
    room: Room,
    peer: Peer,
    message: Record<string, string>,
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
            await joinRoom(ws, identity, (joinedPeer) => {
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
              if (type === "chat.message" || type === "chat.typing") {
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
      void room.queue.then(() => {
        if (
          room.peers.size === 0 &&
          rooms.get(disconnectedPeer.requestId) === room
        ) {
          rooms.delete(disconnectedPeer.requestId);
        }
      });
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
    async closeRequest(requestId) {
      const room = rooms.get(requestId);
      if (!room || closed) return;
      await enqueue(room, async () => {
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
