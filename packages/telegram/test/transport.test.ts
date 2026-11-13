import { describe, expect, it, vi } from "vitest";
import {
  createTelegramTransport,
  startTelegramPolling,
} from "../src/transport.js";
import { formatTelegramReply, splitTelegramText } from "../src/format.js";

const token = "123456:synthetic_bot_token_1234567890";
const hashKey = "synthetic-hmac-key-32-characters-long";
const success = () => Response.json({ ok: true, result: { message_id: 3 } });
function setup(
  fetcher = vi.fn<typeof fetch>().mockImplementation(async () => success()),
) {
  let clock = 0;
  const sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });
  const transport = createTelegramTransport({
    token,
    hashKey,
    fetch: fetcher,
    now: () => clock,
    sleep,
  });
  return { transport, fetcher, sleep, time: () => clock };
}

describe("FR-TG-03/06 safe plain text", () => {
  it("preserves sentence boundaries, Ethiopic punctuation and UTF-16 pairs", () => {
    const sentence = "ይህ ሙከራ ነው። ";
    const text = sentence.repeat(700);
    const parts = splitTelegramText(text);
    expect(parts.join("")).toBe(text);
    expect(parts.every((part) => part.length <= 4096)).toBe(true);
    expect(
      parts.slice(0, -1).every((part) => part.trimEnd().endsWith("።")),
    ).toBe(true);
    const long = splitTelegramText("😀".repeat(3000));
    expect(long.join("")).toBe("😀".repeat(3000));
    expect(
      long.every(
        (part) => part.length <= 4096 && !/[\uD800-\uDBFF]$/u.test(part),
      ),
    ).toBe(true);
  });
  it("uses literal citation links without executable markup or credential URLs", () => {
    expect(
      formatTelegramReply({
        text: "Answer",
        citations: [
          { label: "Source", url: "https://example.org/lesson#section" },
          { label: "Bad", url: "javascript:alert(1)" },
          { label: "Secret", url: "https://user:password@example.org" },
        ],
      }),
    ).toBe("Answer\n\nSource\nhttps://example.org/lesson#section");
  });
});

describe("FR-TG-08/11 production transport", () => {
  it("registers default commands without language_code and rejects non-ISO language tags", async () => {
    const { transport, fetcher } = setup();
    const commands = [{ command: "help", description: "Human help" }];
    await expect(transport.setCommands(commands, "")).resolves.toBeUndefined();
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({
      commands,
    });
    expect(
      JSON.parse(String(fetcher.mock.calls[0]![1]?.body)),
    ).not.toHaveProperty("language_code");
    await expect(transport.setCommands(commands, "fr-CA")).rejects.toThrow(
      /^telegram_transport_unavailable$/u,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    await transport.close();
  });
  it("cancels queued sends for one contact while permitting a fresh Stop confirmation", async () => {
    let finishFirst!: (response: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockImplementation(async () => success());
    const { transport } = setup(fetcher);
    const first = transport.send({
      chatId: "123",
      key: "before-stop",
      text: "Already in flight",
    });
    const queued = transport.send({
      chatId: "123",
      key: "queued",
      text: "Must not send",
    });
    const other = transport.send({
      chatId: "456",
      key: "other",
      text: "Other learner",
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    transport.cancelContact?.("123");
    finishFirst(success());
    expect(await first).toBe("sent");
    expect(await queued).toBe("failed");
    expect(await other).toBe("sent");
    expect(
      await transport.send({
        chatId: "123",
        key: "stop-confirmed",
        text: "Stopped",
      }),
    ).toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.some(
        ([, request]) =>
          JSON.parse(String(request?.body)).text === "Must not send",
      ),
    ).toBe(false);
    await transport.close();
  });
  it("cancels a delayed retry after a definite rejection", async () => {
    let clock = 0;
    let release!: () => void;
    const sleep = vi.fn(
      (ms: number) =>
        new Promise<void>((resolve) => {
          release = () => {
            clock += ms;
            resolve();
          };
        }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ok: false,
          error_code: 429,
          description: "rejected",
          parameters: { retry_after: 2 },
        }),
      )
      .mockImplementation(async () => success());
    const transport = createTelegramTransport({
      token,
      hashKey,
      fetch: fetcher,
      now: () => clock,
      sleep,
    });
    const sending = transport.send({
      chatId: "123",
      key: "delayed",
      text: "Must not retry",
    });
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
    transport.cancelContact?.("123");
    release();
    expect(await sending).toBe("failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await transport.close();
  });
  it("cancels audio continuation after its equivalent text was already in flight", async () => {
    let finishText!: (response: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishText = resolve;
          }),
      )
      .mockImplementation(async () => success());
    const { transport } = setup(fetcher);
    const sending = transport.sendAudio({
      chatId: "123",
      key: "audio-cancel",
      equivalentText: "Already in flight",
      audio: new Uint8Array([79, 103, 103, 83]),
      mimeType: "audio/ogg",
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    transport.cancelContact?.("123");
    finishText(success());
    expect(await sending).toBe("failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await transport.close();
  });
  it("serializes bursts per chat at one second and suppresses concurrent replay", async () => {
    const { transport, fetcher, sleep } = setup();
    const first = { chatId: "123", key: "one", text: "hello" };
    expect(
      await Promise.all([
        transport.send(first),
        transport.send(first),
        transport.send({ ...first, key: "two" }),
        transport.send({ ...first, key: "three" }),
      ]),
    ).toEqual(["sent", "sent", "sent", "sent"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000]);
    expect(transport.status("123", "one")).toBe("sent");
    await expect(transport.send({ ...first, text: "changed" })).resolves.toBe(
      "failed",
    );
    const [, request] = fetcher.mock.calls[0]!;
    expect(request?.redirect).toBe("error");
    expect(request?.signal).toMatchObject({
      aborted: false,
      addEventListener: expect.any(Function),
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      chat_id: "123",
      text: "hello",
      link_preview_options: { is_disabled: true },
    });
    expect(JSON.parse(String(request?.body))).not.toHaveProperty("parse_mode");
    await transport.close();
  });
  it("retries explicit 429 rejection using retry_after, then caches success", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ok: false,
          error_code: 429,
          description: "sensitive text",
          parameters: { retry_after: 2 },
        }),
      )
      .mockResolvedValueOnce(success());
    const { transport, sleep } = setup(fetcher);
    expect(
      await transport.send({ chatId: "123", key: "retry", text: "hello" }),
    ).toBe("sent");
    expect(sleep).toHaveBeenCalledWith(2000, expect.any(AbortSignal));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await transport.close();
  });
  it("never retries ambiguous network failure or leaks native error detail", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`private ${token} 123 hello`));
    const { transport } = setup(fetcher);
    const input = { chatId: "123", key: "ambiguous", text: "hello" };
    expect(await transport.send(input)).toBe("uncertain");
    expect(await transport.send(input)).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(transport.status("123", "ambiguous")).toBe("uncertain");
    await transport.close();
  });
  it("rejects permanent failures, invalid buttons and nonprivate identifiers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: false,
        error_code: 403,
        description: "private detail",
      }),
    );
    const { transport } = setup(fetcher);
    expect(
      await transport.send({ chatId: "123", key: "blocked", text: "hello" }),
    ).toBe("failed");
    expect(
      await transport.send({ chatId: "-123", key: "group", text: "hello" }),
    ).toBe("failed");
    expect(
      await transport.send({
        chatId: "123",
        key: "button",
        text: "hello",
        buttons: [[{ text: "😀", data: "go" }]],
      }),
    ).toBe("failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await transport.close();
  });
  it("does not infer successful delivery from a malformed acknowledgement", async () => {
    const { transport, fetcher } = setup(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ ok: true, result: {} })),
    );
    expect(
      await transport.send({ chatId: "123", key: "malformed", text: "hello" }),
    ).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await transport.close();
  });
  it("retries bounded explicit transient rejects and never repeats permanent rejects", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ ok: false, error_code: 503, description: "private" }),
      );
    const { transport } = setup(fetcher);
    expect(
      await transport.send({ chatId: "123", key: "retry503", text: "hello" }),
    ).toBe("failed");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      await transport.send({ chatId: "123", key: "retry503", text: "hello" }),
    ).toBe("failed");
    expect(fetcher).toHaveBeenCalledTimes(3);
    await transport.close();
  });
  it("sends equivalent text before audio and never audio after text failure", async () => {
    const { transport, fetcher } = setup();
    expect(
      await transport.sendAudio({
        chatId: "123",
        key: "voice",
        equivalentText: "answer",
        audio: new Uint8Array([79, 103, 103, 83, 1]),
        mimeType: "audio/ogg",
      }),
    ).toBe("sent");
    expect(String(fetcher.mock.calls[0]![0])).toContain("/sendMessage");
    expect(String(fetcher.mock.calls[1]![0])).toContain("/sendVoice");
    await transport.close();
    const failed = setup(
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          Response.json({ ok: false, error_code: 403, description: "private" }),
        ),
    );
    expect(
      await failed.transport.sendAudio({
        chatId: "123",
        key: "voice",
        equivalentText: "answer",
        audio: new Uint8Array([79, 103, 103, 83]),
        mimeType: "audio/ogg",
      }),
    ).toBe("failed");
    expect(failed.fetcher).toHaveBeenCalledTimes(1);
    await failed.transport.close();
  });
  it("produces multipart voice uploads accepted by native Node fetch", async () => {
    const bodies: string[] = [];
    const errors: string[] = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, options) => {
        try {
          const request = new Request(String(url), options);
          bodies.push(await request.text());
        } catch (error) {
          errors.push(String(error));
          throw error;
        }
        return success();
      });
    const { transport } = setup(fetcher);
    const result = await transport.sendAudio({
      chatId: "123",
      key: "multipart",
      equivalentText: "answer",
      audio: new Uint8Array([79, 103, 103, 83]),
      mimeType: "audio/ogg",
    });
    expect(errors).toEqual([]);
    expect(result).toBe("sent");
    expect(bodies[1]).toContain("filename=voice.ogg");
    expect(bodies[1]).toContain("OggS");
    await transport.close();
  });
  it("downloads only bounded voice files, checks MIME and signature, and refuses traversal", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          result: { file_path: "voice/file_1.oga", file_size: 5 },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([79, 103, 103, 83, 1]), {
          headers: { "content-type": "audio/ogg" },
        }),
      );
    const { transport } = setup(fetcher);
    const downloaded = await transport.downloadVoice({
      file_id: "fixture",
      duration: 5,
      file_size: 5,
      mime_type: "audio/ogg",
    });
    expect([...downloaded.audio]).toEqual([79, 103, 103, 83, 1]);
    expect(fetcher.mock.calls[1]![1]?.redirect).toBe("error");
    await expect(
      transport.downloadVoice({ file_id: "fixture", duration: 61 }),
    ).rejects.toThrow(/^telegram_transport_unavailable$/u);
    await expect(
      transport.downloadVoice({
        file_id: "fixture",
        duration: 2,
        file_size: 9 * 1024 * 1024,
      }),
    ).rejects.toThrow();
    await expect(
      transport.downloadVoice({
        file_id: "fixture",
        duration: 2,
        mime_type: "text/html",
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(
      Response.json({ ok: true, result: { file_path: "../secret.ogg" } }),
    );
    await expect(
      transport.downloadVoice({ file_id: "fixture", duration: 2 }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    await transport.close();
  });
  it("rejects forged MIME, streamed oversize, and redirects without exposing URLs", async () => {
    for (const response of [
      new Response("secret transcript", {
        headers: { "content-type": "audio/ogg" },
      }),
      new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
        headers: { "content-type": "audio/ogg" },
      }),
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example" },
      }),
    ]) {
      const { transport } = setup(
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            Response.json({
              ok: true,
              result: { file_path: "voice/file_1.oga" },
            }),
          )
          .mockResolvedValueOnce(response),
      );
      await expect(
        transport.downloadVoice({ file_id: "fixture", duration: 5 }),
      ).rejects.toThrow(/^telegram_transport_unavailable$/u);
      await transport.close();
    }
  });
  it("aborts active work during shutdown and refuses new work", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (_url, request) =>
          new Promise((_resolve, reject) =>
            request?.signal?.addEventListener(
              "abort",
              () => reject(new Error("private detail")),
              { once: true },
            ),
          ),
      );
    const { transport } = setup(fetcher);
    const sending = transport.send({
      chatId: "123",
      key: "shutdown",
      text: "hello",
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    await transport.close();
    expect(await sending).toBe("uncertain");
    expect(
      await transport.send({ chatId: "123", key: "afterclose", text: "hello" }),
    ).toBe("failed");
  });
});

describe("FR-TG-08 local polling", () => {
  it("forbids production polling and acknowledges only handled updates", async () => {
    const controller = new AbortController();
    const getUpdates = vi
      .fn()
      .mockResolvedValueOnce([{ update_id: 7 }])
      .mockImplementation(
        async (_offset, signal: AbortSignal) =>
          new Promise<unknown[]>((resolve) =>
            signal.addEventListener("abort", () => resolve([]), { once: true }),
          ),
      );
    const handleUpdate = vi.fn(async () => {
      controller.abort();
    });
    expect(() =>
      startTelegramPolling({
        transport: { getUpdates },
        environment: "production",
        handleUpdate,
      }),
    ).toThrow("telegram_polling_forbidden");
    const polling = startTelegramPolling({
      transport: { getUpdates },
      environment: "test",
      handleUpdate,
    });
    await vi.waitFor(() => expect(getUpdates).toHaveBeenCalledTimes(2));
    expect(getUpdates.mock.calls[1]![0]).toBe(8);
    await polling.stop();
    expect(handleUpdate).toHaveBeenCalledTimes(1);
  });
});
