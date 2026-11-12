import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { provisionLocalHostKey } from "../src/db/local-bootstrap.js";

describe("local host bootstrap", () => {
  it("stores only a SHA-256 hash and configured origins", async () => {
    const query = vi.fn(async () => undefined);
    const hostKey = "local-widget-public-id";

    await provisionLocalHostKey(
      { query },
      {
        id: "local-widget",
        name: "Local development widget",
        key: hostKey,
        origins: ["http://localhost:5173", "http://127.0.0.1:5173"],
      },
    );

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (id) DO UPDATE"),
      [
        "local-widget",
        "Local development widget",
        createHash("sha256").update(hostKey).digest("hex"),
        ["http://localhost:5173", "http://127.0.0.1:5173"],
      ],
    );
    expect(query.mock.calls[0]?.[1]).not.toContain(hostKey);
  });

  it("rejects non-origin values before writing", async () => {
    const query = vi.fn(async () => undefined);

    await expect(
      provisionLocalHostKey(
        { query },
        {
          id: "local-widget",
          name: "Local development widget",
          key: "local-widget-public-id",
          origins: ["http://localhost:5173/path"],
        },
      ),
    ).rejects.toThrow("must be an origin");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects empty local host credentials before writing", async () => {
    const query = vi.fn(async () => undefined);

    await expect(
      provisionLocalHostKey(
        { query },
        {
          id: "local-widget",
          name: "Local development widget",
          key: " ",
          origins: ["http://localhost:5173"],
        },
      ),
    ).rejects.toThrow("are required");
    expect(query).not.toHaveBeenCalled();
  });
});
