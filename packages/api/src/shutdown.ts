import type { Server } from "node:http";

export interface ShutdownLocals {
  closeHelpWebSockets?: () => void;
  close?: () => Promise<void>;
}

/**
 * Stops accepting connections, then releases timers, sockets, source sync,
 * channel runtimes and the database pool before exiting.
 */
export async function shutdown(options: {
  server: Pick<Server, "close">;
  locals: ShutdownLocals;
  exit: (code: number) => void;
}): Promise<void> {
  const { server, locals, exit } = options;
  locals.closeHelpWebSockets?.();
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await locals.close?.();
    exit(0);
  } catch {
    exit(1);
  }
}
