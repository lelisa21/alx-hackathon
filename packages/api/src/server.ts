import { createServer } from "node:http";
import { buildApp } from "./app.js";
import { parseConfig } from "./config.js";
import { shutdown } from "./shutdown.js";

const config = parseConfig(process.env);
const app = buildApp({ config });
await app.locals.sourceSyncReady;
const server = createServer(app);
if (typeof app.locals.attachHelpWebSockets === "function") {
  app.locals.attachHelpWebSockets(server);
}

server.listen(config.PORT, () => {
  process.stdout.write(`Dimts API listening on port ${config.PORT}\n`);
});

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    // Hard stop if draining hangs (for example a stuck database connection).
    setTimeout(() => process.exit(1), 8000).unref();
    void shutdown({
      server,
      locals: app.locals,
      exit: (code) => process.exit(code),
    });
  });
}
