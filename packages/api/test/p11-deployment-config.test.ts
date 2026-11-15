// P11 deployment readiness: hosted and local runtime configuration must match
// the application's real requirements (blueprint 2.6, 3.4, 7.5, 14.1).
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const read = (file: string) => readFile(resolve(file), "utf8");

interface RenderEnv {
  key: string;
  value?: string;
  sync?: boolean;
}
interface RenderService {
  name: string;
  runtime: string;
  buildCommand: string;
  startCommand?: string;
  envVars?: RenderEnv[];
  headers?: Array<{ path: string; name: string; value: string }>;
}

async function renderServices(): Promise<Record<string, RenderService>> {
  const blueprint = parse(await read("render.yaml")) as {
    services: RenderService[];
  };
  return Object.fromEntries(blueprint.services.map((s) => [s.name, s]));
}

function requiredConfigKeys(): string[] {
  try {
    parseConfig({});
  } catch (error) {
    return [
      ...String((error as Error).message).matchAll(/(?:: |; )([A-Z_]+):/gu),
    ].map((match) => match[1]!);
  }
  throw new Error("An empty environment must not be accepted.");
}

describe("hosted Render blueprint", () => {
  it("declares every configuration value the API refuses to start without", async () => {
    const api = (await renderServices())["dimts-api"]!;
    const declared = new Set(api.envVars?.map(({ key }) => key));
    const required = requiredConfigKeys();
    expect(required).toEqual(
      expect.arrayContaining(["DATABASE_URL", "DIMTS_ENC_KEY"]),
    );
    for (const key of required) expect(declared).toContain(key);
    expect(declared).toContain("DATABASE_URL_DIRECT");
    expect(api.envVars).toContainEqual({
      key: "NODE_ENV",
      value: "production",
    });
  });

  it("applies migrations before the API starts", async () => {
    const api = (await renderServices())["dimts-api"]!;
    const start = api.startCommand ?? "";
    expect(start.indexOf("migrate")).toBeGreaterThanOrEqual(0);
    expect(start.indexOf("migrate")).toBeLessThan(start.indexOf(" start"));
  });

  it("pins a Node version that satisfies engine-strict on every Node service", async () => {
    const pkg = JSON.parse(await read("package.json")) as {
      engines: { node: string };
    };
    const minimum = pkg.engines.node.replace(/^>=/u, "");
    for (const service of Object.values(await renderServices())) {
      expect(service.envVars).toContainEqual({
        key: "NODE_VERSION",
        value: minimum,
      });
    }
  });

  it("serves widget modules and fonts with CORS so host pages can import them", async () => {
    const assets = (await renderServices())["dimts-widget-assets"]!;
    expect(assets.headers).toContainEqual({
      path: "/*",
      name: "Access-Control-Allow-Origin",
      value: "*",
    });
  });
});

describe("scheduled jobs for hosted deployments", () => {
  it("runs retention at 06:00 UTC and alerts at 07:30 UTC with the cron secret", async () => {
    const workflow = parse(await read(".github/workflows/cron.yml")) as {
      on: { schedule: Array<{ cron: string }> };
    };
    const text = await read(".github/workflows/cron.yml");
    expect(workflow.on.schedule).toEqual(
      expect.arrayContaining([{ cron: "0 6 * * *" }, { cron: "30 7 * * *" }]),
    );
    expect(text).toContain("/v1/internal/retention");
    expect(text).toContain("/v1/internal/alerts");
    expect(text).toContain("secrets.DIMTS_CRON_SECRET");
    expect(text).toContain("secrets.DIMTS_API_URL");
  });
});

describe("local Compose widget proxy", () => {
  it("forwards WebSocket upgrades for help chat through /v1/", async () => {
    const nginx = await read("packages/widget/nginx.conf");
    expect(nginx).toMatch(/proxy_set_header Upgrade \$http_upgrade;/u);
    expect(nginx).toMatch(/proxy_set_header Connection \$connection_upgrade;/u);
    expect(nginx).toMatch(/map \$http_upgrade \$connection_upgrade/u);
  });
});

describe("CI database", () => {
  it("migrates against a reachable PostgreSQL service container", async () => {
    const ci = parse(await read(".github/workflows/ci.yml")) as {
      jobs: {
        validate: {
          services?: Record<string, { image: string; ports: string[] }>;
        };
      };
    };
    const postgres = ci.jobs.validate.services?.postgres;
    expect(postgres?.image).toMatch(/^postgres:17/u);
    expect(postgres?.ports).toContain("5432:5432");
  });
});

describe("local Compose provider credentials", () => {
  it("passes .env to the API so credentialRef variables resolve", async () => {
    const compose = parse(await read("docker-compose.yml")) as {
      services: {
        api: { env_file?: Array<{ path: string; required: boolean }> };
      };
    };
    expect(compose.services.api.env_file).toContainEqual({
      path: ".env",
      required: false,
    });
  });
});
