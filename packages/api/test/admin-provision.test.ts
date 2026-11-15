import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  parseAdminArguments,
  provisionHelper,
  provisionHostKey,
} from "../src/db/admin.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe("production host key provisioning (NFR-SEC-12)", () => {
  it("stores a public widget key as a hash with its HTTPS origins", async () => {
    const query = vi.fn(async () => undefined);
    const key = "savanna-widget-public-id";

    await provisionHostKey(
      { query },
      {
        id: "savanna-widget",
        name: "Savanna widget",
        key,
        keyType: "public",
        origins: ["https://learn.example.org"],
      },
    );

    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("key_type");
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(values).toEqual([
      "savanna-widget",
      "Savanna widget",
      sha(key),
      ["https://learn.example.org"],
      "public",
    ]);
    expect(values).not.toContain(key);
  });

  it("requires an origin for a public browser key", async () => {
    const query = vi.fn(async () => undefined);
    await expect(
      provisionHostKey(
        { query },
        {
          id: "w",
          name: "Widget",
          key: "public-id",
          keyType: "public",
          origins: [],
        },
      ),
    ).rejects.toThrow(/origin/u);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects plain-HTTP origins other than loopback", async () => {
    const query = vi.fn(async () => undefined);
    await expect(
      provisionHostKey(
        { query },
        {
          id: "w",
          name: "Widget",
          key: "public-id",
          keyType: "public",
          origins: ["http://learn.example.org"],
        },
      ),
    ).rejects.toThrow(/HTTPS/u);
    await provisionHostKey(
      { query },
      {
        id: "w",
        name: "Widget",
        key: "public-id",
        keyType: "public",
        origins: ["http://localhost:5173"],
      },
    );
    expect(query).toHaveBeenCalledOnce();
  });

  it("allows a server-only secret key without origins but requires 32+ characters", async () => {
    const query = vi.fn(async () => undefined);
    await expect(
      provisionHostKey(
        { query },
        {
          id: "jobs",
          name: "Jobs import",
          key: "short",
          keyType: "secret",
          origins: [],
        },
      ),
    ).rejects.toThrow(/32/u);

    const secret = randomBytes(32).toString("base64url");
    await provisionHostKey(
      { query },
      {
        id: "jobs",
        name: "Jobs import",
        key: secret,
        keyType: "secret",
        origins: [],
      },
    );
    const values = query.mock.calls[0]?.[1] as unknown as unknown[];
    expect(values).toEqual(["jobs", "Jobs import", sha(secret), [], "secret"]);
  });
});

describe("production helper provisioning", () => {
  it("stores only the helper token hash and languages", async () => {
    const query = vi.fn(async () => undefined);
    const token = randomBytes(32).toString("base64url");

    await provisionHelper(
      { query },
      { id: "helper-1", displayName: "Helper One", token, langs: ["en", "am"] },
    );

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO helper");
    expect(values).toEqual([
      "helper-1",
      "Helper One",
      sha(token),
      ["en", "am"],
    ]);
    expect(values).not.toContain(token);
  });

  it("rejects weak tokens and empty language lists before writing", async () => {
    const query = vi.fn(async () => undefined);
    await expect(
      provisionHelper(
        { query },
        { id: "h", displayName: "H", token: "weak", langs: ["en"] },
      ),
    ).rejects.toThrow(/32-byte/u);
    await expect(
      provisionHelper(
        { query },
        {
          id: "h",
          displayName: "H",
          token: randomBytes(32).toString("base64url"),
          langs: [],
        },
      ),
    ).rejects.toThrow(/language/u);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("admin CLI arguments", () => {
  it("reads secrets from the environment, never from argv", () => {
    const parsed = parseAdminArguments(
      [
        "host-key",
        "--id",
        "savanna-widget",
        "--name",
        "Savanna widget",
        "--type",
        "public",
        "--origins",
        "https://a.example, https://b.example",
      ],
      { DIMTS_PROVISION_SECRET: "public-id" },
    );
    expect(parsed).toEqual({
      command: "host-key",
      host: {
        id: "savanna-widget",
        name: "Savanna widget",
        key: "public-id",
        keyType: "public",
        origins: ["https://a.example", "https://b.example"],
      },
    });
  });

  it("parses helper commands", () => {
    const token = randomBytes(32).toString("base64url");
    expect(
      parseAdminArguments(
        ["helper", "--id", "h1", "--name", "Helper", "--langs", "en,om"],
        { DIMTS_PROVISION_SECRET: token },
      ),
    ).toEqual({
      command: "helper",
      helper: {
        id: "h1",
        displayName: "Helper",
        token,
        langs: ["en", "om"],
      },
    });
  });

  it("fails without the secret environment value or with an unknown command", () => {
    expect(() =>
      parseAdminArguments(["host-key", "--id", "x", "--name", "X"], {}),
    ).toThrow(/DIMTS_PROVISION_SECRET/u);
    expect(() => parseAdminArguments(["drop-tables"], {})).toThrow(/Usage/u);
  });
});
