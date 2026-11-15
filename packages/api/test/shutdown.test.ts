import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { shutdown } from "../src/shutdown.js";

function fakeServer() {
  const server = new EventEmitter() as EventEmitter & {
    close: (callback: () => void) => void;
  };
  server.close = (callback) => queueMicrotask(callback);
  return server;
}

describe("graceful shutdown", () => {
  it("closes sockets, the HTTP server and app resources, then exits 0", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    await shutdown({
      server: fakeServer() as never,
      locals: {
        closeHelpWebSockets: () => order.push("sockets"),
        close: async () => {
          order.push("resources");
        },
      },
      exit,
    });
    expect(order).toEqual(["sockets", "resources"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits 1 when releasing resources fails", async () => {
    const exit = vi.fn();
    await shutdown({
      server: fakeServer() as never,
      locals: {
        close: async () => {
          throw new Error("pool");
        },
      },
      exit,
    });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
