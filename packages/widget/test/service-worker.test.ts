import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

async function worker() {
  interface WorkerEvent {
    request: Request;
    respondWith: (value: Promise<Response>) => void;
    waitUntil: (value: Promise<void>) => void;
  }
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const entries = new Map<string, Response>();
  const cache = {
    add: vi.fn(async () => undefined),
    match: vi.fn(async (request: Request, options?: CacheQueryOptions) => {
      void options;
      return entries.get(request.url)?.clone();
    }),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response);
    }),
    delete: async (request: Request) => entries.delete(request.url),
  };
  const fetch = vi.fn();
  runInNewContext(
    await readFile("packages/widget/public/service-worker.js", "utf8"),
    {
      URL,
      Response,
      Headers,
      fetch,
      location: new URL(
        "https://host.example/service-worker.js?api=https%3A%2F%2Fapi.example%2Fv1&asset=https%3A%2F%2Fhost.example%2Fdimts-widget.js",
      ),
      caches: { open: async () => cache },
      skipWaiting: async () => undefined,
      addEventListener: (
        name: string,
        callback: (event: WorkerEvent) => void,
      ) => listeners.set(name, callback),
    },
  );
  return {
    fetch,
    cache,
    install: () => {
      let completion: Promise<void> | undefined;
      listeners.get("install")!({
        waitUntil: (value) => {
          completion = value;
        },
      } as WorkerEvent);
      return completion;
    },
    dispatch: (url: string, method = "GET") => {
      let answer: Promise<Response> | undefined;
      listeners.get("fetch")!({
        request: new Request(url, { method }),
        respondWith: (value) => {
          answer = value;
        },
      } as WorkerEvent);
      return answer;
    },
  };
}

describe("NFR-PERF-06 scoped service-worker offline content", () => {
  it("restores same-origin public shell modules despite a precache versus module Origin-header difference, while preserving API Vary checks", async () => {
    const runtime = await worker();
    runtime.cache.match.mockImplementation(async (_request, options) =>
      options?.ignoreVary
        ? new Response("export const cached = true", {
            headers: { Vary: "Origin" },
          })
        : undefined,
    );
    runtime.fetch.mockRejectedValue(new Error("offline"));
    expect(
      (await runtime.dispatch("https://host.example/dimts-widget.js"))?.status,
    ).toBe(200);
    await expect(
      runtime.dispatch("https://api.example/v1/locales/en/faq"),
    ).rejects.toThrow("offline");
  });
  it("precaches the built static import graph without fetching unrelated manifest entries", async () => {
    const runtime = await worker();
    runtime.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          assets: [
            "dimts-widget.js",
            "dimts-loader.js",
            "dimts-shared-123.js",
            "https://other.example/unrelated.js",
            "../unrelated.js",
          ],
        }),
      ),
    );
    await runtime.install();
    expect(runtime.cache.add.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        "https://host.example/dimts-widget.js",
        "https://host.example/dimts-loader.js",
        "https://host.example/dimts-shared-123.js",
      ]),
    );
    expect(
      runtime.cache.add.mock.calls.every((call) =>
        String(call[0]).startsWith("https://host.example/dimts-"),
      ),
    ).toBe(true);
  });
  it("caches active UI and FAQ responses and marks offline copies", async () => {
    const runtime = await worker();
    for (const route of ["ui", "faq"]) {
      const url = `https://api.example/v1/locales/en/${route}`;
      runtime.fetch.mockResolvedValueOnce(
        new Response("{}", { headers: { ETag: '"v1"' } }),
      );
      expect((await runtime.dispatch(url))?.status).toBe(200);
      runtime.fetch.mockRejectedValueOnce(new Error("offline"));
      expect(
        (await runtime.dispatch(url))?.headers.get("X-Dimts-Offline"),
      ).toBe("1");
    }
    expect(runtime.cache.put).toHaveBeenCalledTimes(2);
  });
  it("does not intercept private API data, mutation, unrelated scripts or other APIs", async () => {
    const runtime = await worker();
    for (const url of [
      "https://api.example/v1/ask",
      "https://api.example/v1/sessions",
      "https://other.example/v1/locales/en/faq",
      "https://host.example/unrelated.js",
    ])
      expect(runtime.dispatch(url)).toBeUndefined();
    expect(
      runtime.dispatch("https://api.example/v1/locales/en/faq", "POST"),
    ).toBeUndefined();
    expect(runtime.fetch).not.toHaveBeenCalled();
  });
  it("never caches errors and does not mask withdrawn FAQ with stale data", async () => {
    const runtime = await worker();
    const url = "https://api.example/v1/locales/en/faq";
    runtime.fetch.mockResolvedValueOnce(new Response("{}"));
    await runtime.dispatch(url);
    runtime.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await runtime.dispatch(url))?.status).toBe(404);
    expect(runtime.cache.put).toHaveBeenCalledTimes(1);
  });
});
