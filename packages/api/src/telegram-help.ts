import type { HelpStore } from "./types.js";
import type {
  HelpSocketMessage,
  HelpSocketRuntime,
  HelpSocketStore,
} from "./help-sockets.js";

interface Route {
  sessionId: string;
  chatId: string;
  requestId: string;
}

/** Private addresses live only here, for the life of an active help connection.
 * The shared request/message tables remain the source of authorization/history. */
export function createTelegramHelpBridge(options: {
  help: HelpStore;
  store: HelpSocketStore;
  send(input: {
    chatId: string;
    sessionId: string;
    requestId: string;
    key: string;
    text: string;
  }): Promise<void>;
  socket():
    Pick<HelpSocketRuntime, "publishMessage" | "closeRequest"> | undefined;
}) {
  const routes = new Map<string, Route & { expires: number }>();
  const cleanup = setInterval(() => {
    for (const [id, route] of routes)
      if (route.expires <= Date.now()) routes.delete(id);
  }, 60_000);
  cleanup.unref();
  const forget = (requestId: string) => {
    routes.delete(requestId);
  };
  async function authorized(route: Route) {
    const valid = await options.help.authorizeRequest?.(
      route.requestId,
      { role: "learner", sessionId: route.sessionId },
      false,
    );
    if (!valid) forget(route.requestId);
    return Boolean(valid);
  }
  async function deliver(requestId: string, message: HelpSocketMessage) {
    const route = routes.get(requestId);
    if (!route || message.sender !== "helper") return;
    if (route.expires <= Date.now()) {
      forget(requestId);
      return;
    }
    if (!(await authorized(route))) return;
    await options.send({
      chatId: route.chatId,
      sessionId: route.sessionId,
      requestId,
      key: `helper:${requestId}:${message.id}`,
      text: message.text,
    });
  }
  const store: HelpSocketStore = {
    ...options.store,
    async persistMessage(requestId, sender, id, text) {
      const result = await options.store.persistMessage(
        requestId,
        sender,
        id,
        text,
      );
      // Persistence already committed. A failed channel delivery must not make
      // a helper's durable message look rejected; bind replays it safely.
      if (result === "stored" && sender === "helper") {
        try {
          await deliver(requestId, { sender, id, text });
        } catch {
          /* retry on next inbound */
        }
      }
      return result;
    },
  };
  async function bind(route: Route) {
    if (!(await authorized(route))) return false;
    for (const [id, value] of routes)
      if (value.expires <= Date.now()) routes.delete(id);
    if (!routes.has(route.requestId) && routes.size >= 1000)
      routes.delete(routes.keys().next().value!);
    routes.set(route.requestId, {
      ...route,
      expires: Date.now() + 24 * 60 * 60 * 1000,
    });
    const messages = await options.store.listMessagesAfter(route.requestId);
    for (const message of messages) await deliver(route.requestId, message);
    return true;
  }
  return {
    store,
    bind,
    forget,
    clear() {
      clearInterval(cleanup);
      routes.clear();
    },
    async start(input: { sessionId: string; chatId: string }) {
      const request = await options.help.createRequest(input.sessionId, false);
      if (!request) throw new Error("unavailable");
      await bind({ ...input, requestId: request.id });
      return request.id;
    },
    async relay(input: Route & { key: string; text: string }) {
      if (!(await bind(input))) return false;
      if (!input.text || input.text.length > 4096 || input.text.includes("\0"))
        throw new Error("invalid");
      const chunks: string[] = [];
      let remaining = input.text;
      while (remaining.length > 2000) {
        const length = /[\uD800-\uDBFF]/u.test(remaining[1999]!) ? 1999 : 2000;
        chunks.push(remaining.slice(0, length));
        remaining = remaining.slice(length);
      }
      chunks.push(remaining);
      for (const [index, text] of chunks.entries()) {
        const id = chunks.length === 1 ? input.key : `${input.key}:${index}`;
        const result = await store.persistMessage(
          input.requestId,
          "learner",
          id,
          text,
        );
        if (result === "rejected") return false;
        if (result === "stored")
          await options
            .socket()
            ?.publishMessage(input.requestId, { id, sender: "learner", text });
      }
      return true;
    },
    async end(input: Pick<Route, "sessionId" | "requestId">) {
      await options.help.closeRequest(input.requestId, {
        role: "learner",
        sessionId: input.sessionId,
      });
      forget(input.requestId);
      await options.socket()?.closeRequest(input.requestId);
    },
  };
}
