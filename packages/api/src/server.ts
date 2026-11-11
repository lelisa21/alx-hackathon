import { createServer } from "node:http";
import { buildApp } from "./app.js";
import { parseConfig } from "./config.js";

const config = parseConfig(process.env);
const server = createServer(buildApp({ config }));

server.listen(config.PORT, () => {
  process.stdout.write(`Dimts API listening on port ${config.PORT}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void (server as typeof server & { app: { locals: { close?: () => Promise<void> } } }).app.locals
        .close?.()
        .then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 8000).unref();
  });
}
