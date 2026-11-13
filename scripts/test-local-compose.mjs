import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = `dimts-person1-${process.pid}`;
let environment = process.env;
const allocatedPorts = new Set();

async function availablePort() {
  while (true) {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Could not allocate a local test port.");
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (allocatedPorts.has(address.port)) continue;
    allocatedPorts.add(address.port);
    return address.port;
  }
}

function runDocker(args, timeout = 240_000) {
  const result = spawnSync("docker", args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `docker compose ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function runCompose(args, timeout) {
  return runDocker(
    ["compose", "-p", project, "--profile", "local", ...args],
    timeout,
  );
}

async function waitFor(url, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok && (await predicate(response))) return response;
      lastError = new Error(`Unexpected response from ${url}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}.`);
}

const webPort = await availablePort();
const apiPort = await availablePort();
const password = randomBytes(24).toString("base64url");
environment = {
  ...process.env,
  POSTGRES_PASSWORD: password,
  DIMTS_COMPOSE_API_PORT: String(apiPort),
  DIMTS_COMPOSE_WEB_PORT: String(webPort),
  DIMTS_ENC_KEY: randomBytes(32).toString("base64"),
  DIMTS_HASH_KEY: randomBytes(32).toString("base64"),
  DIMTS_JWT_SECRET: randomBytes(32).toString("base64url"),
  DIMTS_CRON_SECRET: randomBytes(24).toString("base64url"),
  DIMTS_HOST_ORIGINS: `http://localhost:${webPort},http://127.0.0.1:${webPort}`,
  DIMTS_LOCAL_WIDGET_KEY: "local-widget-public-id",
  DIMTS_AI_PROVIDER: "offline",
  DIMTS_AI_LADDER: "offline",
  DIMTS_AI_PROVIDERS: "[]",
};
const origin = `http://127.0.0.1:${webPort}`;
const startedAt = Date.now();

try {
  runCompose(["up", "--build", "--detach"]);
  const web = await waitFor(origin, (response) =>
    response.headers.get("content-type")?.includes("text/html"),
  );
  const html = await web.text();
  assert.match(html, /<dimts-assistant\b/u);
  assert.match(html, /data-host-key="local-widget-public-id"/u);
  assert.match(html, /dimts-widget\.js/u);

  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  assert.equal(runCompose(["port", "api", "3000"]), `127.0.0.1:${apiPort}`);
  assert.equal(runCompose(["port", "widget", "80"]), `127.0.0.1:${webPort}`);

  const directHealth = await waitFor(`${apiOrigin}/v1/health`, (response) =>
    response.headers.get("content-type")?.includes("json"),
  );
  const healthResponse = await waitFor(`${origin}/v1/health`, (response) =>
    response.headers.get("content-type")?.includes("json"),
  );
  assert.equal(directHealth.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.db, true);
  assert.equal(health.ok, true);

  const languagesResponse = await fetch(`${origin}/v1/languages`);
  assert.equal(languagesResponse.status, 200);
  assert.ok(Array.isArray((await languagesResponse.json()).languages));

  const backend = runDocker([
    "network",
    "inspect",
    "--format",
    "{{.Internal}}",
    `${project}_backend`,
  ]);
  assert.equal(backend, "true");
  const edge = runDocker([
    "network",
    "inspect",
    "--format",
    "{{.Internal}}",
    `${project}_edge`,
  ]);
  assert.equal(edge, "false");

  runCompose(["down"]);
  runCompose(["up", "--pull", "never", "--no-build", "--detach"]);
  await waitFor(`${origin}/v1/health`, async (response) => {
    if (!response.headers.get("content-type")?.includes("json")) return false;
    return response.ok;
  });
  assert.ok(Date.now() - startedAt < 300_000);
} finally {
  runCompose(
    ["down", "--volumes", "--remove-orphans", "--rmi", "local"],
    60_000,
  );
}
