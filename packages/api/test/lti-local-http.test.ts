// A local demo LMS may use plain HTTP on this machine in development only.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://dimts:password@localhost:5432/dimts",
  DIMTS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
  DIMTS_HASH_KEY: Buffer.alloc(32, 2).toString("base64"),
  DIMTS_JWT_SECRET: Buffer.alloc(32, 3).toString("base64"),
  DIMTS_CRON_SECRET: "a-cron-secret-that-is-long-enough",
};
const platform = (host: string) =>
  JSON.stringify([
    {
      platformId: "demo-lms",
      issuer: `http://${host}:5180`,
      clientId: "dimts-demo-client",
      authLoginUrl: `http://${host}:5180/auth`,
      authTokenUrl: `http://${host}:5180/token`,
      jwksUri: "http://host.docker.internal:5180/jwks",
      deploymentId: "demo-deployment-1",
    },
  ]);

describe("local HTTP LTI platforms", () => {
  it("are accepted in development for loopback hosts", () => {
    expect(
      parseConfig({
        ...base,
        NODE_ENV: "development",
        DIMTS_LTI_PLATFORMS: platform("localhost"),
        DIMTS_LTI_WIDGET_URL: "http://localhost:5173/dimts-widget.js",
        DIMTS_LTI_WIDGET_KEY: "local-widget-public-id",
      }).DIMTS_LTI_PLATFORMS,
    ).toHaveLength(1);
  });

  it("are rejected in production and for non-local hosts", () => {
    expect(() =>
      parseConfig({
        ...base,
        NODE_ENV: "production",
        DIMTS_LTI_PLATFORMS: platform("localhost"),
      }),
    ).toThrow(/Plain-HTTP LTI URLs/u);
    expect(() =>
      parseConfig({
        ...base,
        NODE_ENV: "development",
        DIMTS_LTI_PLATFORMS: platform("lms.example.org"),
      }),
    ).toThrow();
  });
});
