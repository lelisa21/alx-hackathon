// FR-UI-16, NFR-PERF-06: cached public FAQ, never a persisted question or session.
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFaqCache, loadFaq } from "../src/faq.js";

const faq = {
  lang: "en",
  dir: "ltr",
  contentVersion: "v1",
  reviewedOn: "2026-01-01",
  items: [
    {
      id: "faq-one",
      question: "Choose a goal?",
      answer: "Choose one goal.",
      citations: [
        {
          passageId: "p",
          label: "Study",
          url: "https://course.example/study",
          sourceLang: "en",
          sourceType: "course",
        },
      ],
    },
  ],
};
const response = () =>
  new Response(JSON.stringify(faq), {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: '"v1"' },
  });
afterEach(async () => {
  await clearFaqCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("reviewed FAQ browser data cache", () => {
  it("keeps a reviewed saved answer usable when the API takes over two seconds, while aborting the abandoned request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    await loadFaq("/v1", "en");
    vi.useFakeTimers();
    let cancelled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options.signal?.addEventListener(
              "abort",
              () => {
                cancelled = true;
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          }),
      ),
    );
    const loading = loadFaq("/v1", "en");
    await vi.advanceTimersByTimeAsync(2_100);
    expect((await loading).cached).toBe(true);
    expect(cancelled).toBe(true);
  });
  it("removes withdrawn answers and keeps another API's cache when one installation uninstalls", async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    await loadFaq("https://one.example/v1", "en");
    await loadFaq("https://two.example/v1", "en");
    await clearFaqCache("https://one.example/v1");
    fetch.mockRejectedValue(new Error("offline"));
    await expect(loadFaq("https://one.example/v1", "en")).rejects.toThrow();
    expect((await loadFaq("https://two.example/v1", "en")).cached).toBe(true);
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(loadFaq("https://two.example/v1", "en")).rejects.toThrow();
    await expect(loadFaq("https://two.example/v1", "en")).rejects.toThrow();
  });
  it("returns reviewed content, revalidates with ETag and permits offline reuse", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetch);
    const first = await loadFaq("https://api.example/v1", "en");
    expect(first).toMatchObject({
      cached: false,
      items: [{ lang: "en", dir: "ltr", answer: faq.items[0]!.answer }],
    });
    expect(await loadFaq("https://api.example/v1", "en")).toEqual(first);
    expect(fetch.mock.calls[1]?.[1].headers).toEqual({
      "If-None-Match": '"v1"',
    });
    expect(fetch.mock.calls[0]?.[1].credentials).toBe("omit");
    expect(await loadFaq("https://api.example/v1", "en")).toEqual({
      ...first,
      cached: true,
    });
  });
  it("preserves online operation with storage disabled, never sends credentials or question data", async () => {
    vi.stubGlobal("caches", {
      open: () => {
        throw new Error("disabled");
      },
    });
    const fetch = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetch);
    expect((await loadFaq("/v1", "en", true)).items).toHaveLength(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("/v1/locales/en/faq?lang_preview=1");
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });
  it("caches empty approved representations to remove withdrawn content, while isolating languages and API origins", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...faq, items: [], reviewedOn: null })),
      )
      .mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    await loadFaq("https://api.example/v1", "en");
    expect((await loadFaq("https://api.example/v1", "en")).items).toEqual([]);
    expect((await loadFaq("https://api.example/v1", "en")).items).toEqual([]);
    await expect(loadFaq("https://other.example/v1", "en")).rejects.toThrow();
    await expect(loadFaq("https://api.example/v1", "am")).rejects.toThrow();
  });
  it("rejects uncited, unreviewed, wrong-language, unsafe-link and malformed payloads rather than saving them", async () => {
    for (const invalid of [
      { ...faq, reviewedOn: null },
      { ...faq, lang: "am" },
      { ...faq, items: [{ ...faq.items[0], citations: [] }] },
      {
        ...faq,
        items: [
          {
            ...faq.items[0],
            citations: [
              { ...faq.items[0]!.citations[0], url: "javascript:alert(1)" },
            ],
          },
        ],
      },
      { oops: true },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(invalid))),
      );
      await expect(loadFaq("/v1", "en")).rejects.toThrow();
    }
  });
  it("supports cancellation and removes only its own stored entries on uninstall", async () => {
    const entries = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (key: string) => entries.get(key)?.clone()),
      put: vi.fn(async (key: string, value: Response) => {
        entries.set(key, value);
      }),
    };
    const remove = vi.fn(async () => {
      entries.clear();
      return true;
    });
    vi.stubGlobal("caches", { open: async () => cache, delete: remove });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    await loadFaq("/v1", "en");
    expect(cache.put).toHaveBeenCalled();
    await clearFaqCache();
    expect(remove).toHaveBeenCalledWith("dimts-faq-v1");
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadFaq("/v1", "en", false, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
