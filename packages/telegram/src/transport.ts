import { createHmac } from "node:crypto";
import { Api, GrammyError, InputFile } from "grammy";
import { splitTelegramText } from "./format.js";

export type TelegramSendStatus = "sent" | "failed" | "uncertain";
export interface TelegramButton {
  text: string;
  data: string;
}
export interface TelegramVoiceFile {
  file_id: string;
  duration: number;
  file_size?: number;
  mime_type?: string;
}
export interface TelegramTransport {
  send(input: {
    chatId: string;
    key: string;
    text: string;
    buttons?: TelegramButton[][];
  }): Promise<TelegramSendStatus>;
  sendAudio(input: {
    chatId: string;
    key: string;
    audio: Uint8Array;
    mimeType: string;
    equivalentText: string;
    textKey?: string;
  }): Promise<TelegramSendStatus>;
  status(
    chatId: string,
    key: string,
  ): TelegramSendStatus | "queued" | "unknown";
  setCommands(
    commands: { command: string; description: string }[],
    languageCode: string,
  ): Promise<void>;
  answerCallback(callbackId: string): Promise<void>;
  cancelContact?(chatId: string): void;
  getUpdates(offset?: number, signal?: AbortSignal): Promise<unknown[]>;
  /** Removes any registered webhook; Telegram refuses getUpdates while one is set. */
  deleteWebhook?(): Promise<void>;
  downloadVoice(
    voice: TelegramVoiceFile,
  ): Promise<{ audio: Uint8Array; mimeType: string }>;
  close(): Promise<void>;
}

export class TelegramTransportError extends Error {
  constructor() {
    super("telegram_transport_unavailable");
    this.name = "TelegramTransportError";
  }
}
const MAX_AUDIO = 8 * 1024 * 1024;
const RECEIPT_TTL = 24 * 60 * 60 * 1000;
const MAX_RECEIPTS = 10_000;
const AUDIO_TYPES = ["audio/ogg", "audio/mpeg", "audio/mp4"];
// grammY 1.x types its Node abort-controller polyfill. Native signals implement
// the abort event contract the SDK consumes, without needing another runtime.
type GrammySignal = NonNullable<Parameters<Api["raw"]["sendMessage"]>[1]>;
const sdkSignal = (signal: AbortSignal) => signal as unknown as GrammySignal;
function privateId(id: string): boolean {
  return /^[1-9][0-9]{0,15}$/u.test(id) && Number.isSafeInteger(Number(id));
}
async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new TelegramTransportError();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new TelegramTransportError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function createTelegramTransport(options: {
  token: string;
  hashKey: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): TelegramTransport {
  type GrammyFetch = NonNullable<
    NonNullable<ConstructorParameters<typeof Api>[1]>["fetch"]
  >;
  if (
    !/^[0-9]+:[A-Za-z0-9_-]{20,}$/u.test(options.token) ||
    options.hashKey.length < 32
  )
    throw new TelegramTransportError();
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const lifetime = new AbortController();
  // grammY creates a polyfill signal internally. Node's native fetch rejects
  // that object; relay its abort event to a native controller. Keep the listener
  // through JSON consumption so a stalled response body is bounded too.
  // grammY types fetch with its own RequestInit/Response shims, which are
  // structurally compatible with Node's but not assignable; convert here.
  const sdkFetch = async (url: URL | RequestInfo, request?: RequestInit) => {
    const controller = new AbortController();
    const upstream = request?.signal;
    const abort = () => controller.abort();
    if (upstream?.aborted) abort();
    else upstream?.addEventListener("abort", abort, { once: true });
    const cleanup = () => upstream?.removeEventListener("abort", abort);
    try {
      const response = await fetcher(url, {
        ...request,
        signal: controller.signal,
      });
      const json = response.json.bind(response);
      response.json = async () => {
        try {
          return await json();
        } finally {
          cleanup();
        }
      };
      return response;
    } catch {
      cleanup();
      throw new TelegramTransportError();
    }
  };
  const api = new Api(options.token, {
    fetch: sdkFetch as unknown as GrammyFetch,
    timeoutSeconds: 35,
    sensitiveLogs: false,
    baseFetchConfig: { redirect: "error" },
  });
  const signals = (ms: number, signal?: AbortSignal) =>
    AbortSignal.any([
      lifetime.signal,
      AbortSignal.timeout(ms),
      ...(signal ? [signal] : []),
    ]);
  const hash = (value: string) =>
    createHmac("sha256", options.hashKey).update(value).digest("hex");
  const receipts = new Map<
    string,
    {
      fingerprint: string;
      status: TelegramSendStatus | "queued";
      result: Promise<TelegramSendStatus>;
      created: number;
    }
  >();
  const chats = new Map<
    string,
    {
      tail: Promise<unknown>;
      last: number;
      pending: number;
      generation: AbortController;
    }
  >();
  function chatFor(chatId: string) {
    const key = hash(chatId);
    let chat = chats.get(key);
    if (!chat) {
      chat = {
        tail: Promise.resolve(),
        last: -Infinity,
        pending: 0,
        generation: new AbortController(),
      };
      chats.set(key, chat);
    }
    return chat;
  }
  function prune() {
    for (const [key, receipt] of receipts)
      if (receipt.status !== "queued" && now() - receipt.created >= RECEIPT_TTL)
        receipts.delete(key);
    for (const [key, chat] of chats)
      if (!chat.pending && now() - chat.last >= 1000) chats.delete(key);
  }
  async function attempt(
    chatId: string,
    generation: AbortSignal,
    call: (signal: AbortSignal) => Promise<unknown>,
  ): Promise<TelegramSendStatus> {
    const chat = chats.get(hash(chatId))!;
    for (let retry = 0; retry < 3; retry++) {
      if (lifetime.signal.aborted || generation.aborted) return "failed";
      const pause = chat.last + 1000 - now();
      if (pause > 0)
        await sleep(pause, AbortSignal.any([lifetime.signal, generation]));
      if (lifetime.signal.aborted || generation.aborted) return "failed";
      chat.last = now();
      try {
        const response = await call(signals(8000, generation));
        return response &&
          typeof response === "object" &&
          "message_id" in response &&
          Number.isSafeInteger(response.message_id) &&
          Number(response.message_id) > 0
          ? "sent"
          : "uncertain";
      } catch (error) {
        if (!(error instanceof GrammyError)) return "uncertain";
        const transient = error.error_code === 429 || error.error_code >= 500;
        if (!transient || retry === 2) return "failed";
        const retryAfter = error.parameters.retry_after;
        const pause =
          retryAfter === undefined ? 1000 * 2 ** retry : retryAfter * 1000;
        // Do not occupy an inbound request indefinitely for a long global ban.
        if (!Number.isFinite(pause) || pause < 0 || pause > 30_000)
          return "failed";
        await sleep(
          Math.max(1000, pause),
          AbortSignal.any([lifetime.signal, generation]),
        );
      }
    }
    return "failed";
  }
  function enqueue(
    chatId: string,
    key: string,
    fingerprint: string,
    work: (generation: AbortSignal) => Promise<TelegramSendStatus>,
  ): Promise<TelegramSendStatus> {
    if (
      lifetime.signal.aborted ||
      !privateId(chatId) ||
      !key ||
      key.length > 256
    )
      return Promise.resolve("failed");
    prune();
    const receiptKey = hash(`${chatId}\0${key}`);
    const existing = receipts.get(receiptKey);
    if (existing)
      return existing.fingerprint === fingerprint
        ? existing.result
        : Promise.resolve("failed");
    if (receipts.size >= MAX_RECEIPTS) return Promise.resolve("failed");
    const chat = chatFor(chatId);
    const generation = chat.generation.signal;
    chat.pending++;
    const receipt = {
      fingerprint,
      status: "queued" as TelegramSendStatus | "queued",
      created: now(),
      result: Promise.resolve("failed" as TelegramSendStatus),
    };
    receipt.result = chat.tail
      .then(() => (generation.aborted ? ("failed" as const) : work(generation)))
      .catch(() => "failed" as const)
      .then((status) => {
        receipt.status = status;
        chat.pending--;
        return status;
      });
    chat.tail = receipt.result;
    receipts.set(receiptKey, receipt);
    return receipt.result;
  }
  const transport: TelegramTransport = {
    send(input) {
      if (
        !input.text.trim() ||
        input.text.length > 65_536 ||
        input.buttons?.some(
          (row) =>
            row.length > 8 ||
            row.some(
              (button) =>
                [...button.text].length > 20 ||
                !/[\p{L}\p{N}]/u.test(button.text) ||
                Buffer.byteLength(button.data) > 64 ||
                !button.data,
            ),
        )
      )
        return Promise.resolve("failed");
      const fingerprint = hash(JSON.stringify([input.text, input.buttons]));
      return enqueue(
        input.chatId,
        input.key,
        fingerprint,
        async (generation) => {
          const chunks = splitTelegramText(input.text);
          for (const [index, text] of chunks.entries()) {
            const buttons =
              index === chunks.length - 1 ? input.buttons : undefined;
            const result = await attempt(input.chatId, generation, (signal) =>
              api.raw.sendMessage(
                {
                  chat_id: input.chatId,
                  text,
                  link_preview_options: { is_disabled: true },
                  ...(buttons
                    ? {
                        reply_markup: {
                          inline_keyboard: buttons.map((row) =>
                            row.map((button) => ({
                              text: button.text,
                              callback_data: button.data,
                            })),
                          ),
                        },
                      }
                    : {}),
                },
                sdkSignal(signal),
              ),
            );
            if (result !== "sent") return result;
          }
          return "sent";
        },
      );
    },
    async sendAudio(input) {
      if (
        lifetime.signal.aborted ||
        !privateId(input.chatId) ||
        !AUDIO_TYPES.includes(input.mimeType) ||
        !input.audio.byteLength ||
        input.audio.byteLength > MAX_AUDIO
      )
        return "failed";
      const chat = chatFor(input.chatId);
      const generation = chat.generation.signal;
      // Hold the contact generation across both awaits, including a cached text
      // acknowledgement. Stop must also cancel audio not yet queued for upload.
      chat.pending++;
      try {
        const textStatus = await transport.send({
          chatId: input.chatId,
          key: input.textKey ?? `${input.key}:text`,
          text: input.equivalentText,
        });
        if (generation.aborted) return "failed";
        if (textStatus !== "sent") return textStatus;
        const fingerprint = hash(
          `${input.mimeType}\0${hash(Buffer.from(input.audio).toString("base64"))}`,
        );
        return await enqueue(
          input.chatId,
          input.key,
          fingerprint,
          (generation) =>
            attempt(input.chatId, generation, (signal) =>
              api.raw.sendVoice(
                {
                  chat_id: input.chatId,
                  voice: new InputFile(
                    input.audio,
                    input.mimeType === "audio/ogg"
                      ? "voice.ogg"
                      : input.mimeType === "audio/mpeg"
                        ? "voice.mp3"
                        : "voice.m4a",
                  ),
                },
                sdkSignal(signal),
              ),
            ),
        );
      } finally {
        chat.pending--;
      }
    },
    status(chatId, key) {
      return receipts.get(hash(`${chatId}\0${key}`))?.status ?? "unknown";
    },
    cancelContact(chatId) {
      const chat = chats.get(hash(chatId));
      if (!chat) return;
      // Abort this generation's queued work and retry waits. A fresh generation
      // permits the localized Stop confirmation; remote acceptance is not recalled.
      chat.generation.abort();
      chat.generation = new AbortController();
    },
    async setCommands(commands, languageCode) {
      if (languageCode !== "" && !/^[a-z]{2}$/u.test(languageCode))
        throw new TelegramTransportError();
      try {
        await api.raw.setMyCommands(
          {
            commands,
            ...(languageCode
              ? {
                  language_code: languageCode as NonNullable<
                    Parameters<Api["raw"]["setMyCommands"]>[0]["language_code"]
                  >,
                }
              : {}),
          },
          sdkSignal(signals(8000)),
        );
      } catch {
        throw new TelegramTransportError();
      }
    },
    async answerCallback(callbackId) {
      try {
        await api.raw.answerCallbackQuery(
          { callback_query_id: callbackId },
          sdkSignal(signals(8000)),
        );
      } catch {
        throw new TelegramTransportError();
      }
    },
    async deleteWebhook() {
      try {
        await api.raw.deleteWebhook(
          { drop_pending_updates: false },
          sdkSignal(signals(8000)),
        );
      } catch {
        throw new TelegramTransportError();
      }
    },
    async getUpdates(offset, signal) {
      try {
        return await api.raw.getUpdates(
          {
            ...(offset === undefined ? {} : { offset }),
            timeout: 25,
            limit: 100,
            allowed_updates: ["message", "callback_query"],
          },
          sdkSignal(signals(30_000, signal)),
        );
      } catch {
        throw new TelegramTransportError();
      }
    },
    async downloadVoice(voice) {
      let audio: Uint8Array | undefined;
      try {
        if (
          !Number.isInteger(voice.duration) ||
          voice.duration < 0 ||
          voice.duration > 60 ||
          !voice.file_id ||
          voice.file_id.length > 256 ||
          (voice.file_size !== undefined &&
            (!Number.isSafeInteger(voice.file_size) ||
              voice.file_size < 1 ||
              voice.file_size > MAX_AUDIO)) ||
          (voice.mime_type !== undefined &&
            !AUDIO_TYPES.includes(voice.mime_type))
        )
          throw new TelegramTransportError();
        const file = await api.raw.getFile(
          { file_id: voice.file_id },
          sdkSignal(signals(8000)),
        );
        if (
          !file.file_path ||
          file.file_path.length > 512 ||
          !/^[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/u.test(file.file_path) ||
          file.file_path.includes("..") ||
          (file.file_size !== undefined && file.file_size > MAX_AUDIO)
        )
          throw new TelegramTransportError();
        const response = await fetcher(
          `https://api.telegram.org/file/bot${options.token}/${file.file_path}`,
          { redirect: "error", signal: signals(15_000) },
        );
        if (
          !response.ok ||
          !response.body ||
          Number(response.headers.get("content-length") ?? 0) > MAX_AUDIO
        ) {
          await response.body?.cancel();
          throw new TelegramTransportError();
        }
        const mimeType = (
          response.headers.get("content-type") ??
          voice.mime_type ??
          ""
        )
          .split(";")[0]!
          .trim();
        if (
          !AUDIO_TYPES.includes(mimeType) &&
          mimeType !== "application/octet-stream"
        ) {
          await response.body.cancel();
          throw new TelegramTransportError();
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            length += item.value.byteLength;
            if (length > MAX_AUDIO) {
              item.value.fill(0);
              await reader.cancel();
              throw new TelegramTransportError();
            }
            chunks.push(item.value);
          }
          audio = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            audio.set(chunk, offset);
            offset += chunk.byteLength;
          }
        } finally {
          for (const chunk of chunks) chunk.fill(0);
          reader.releaseLock();
        }
        const signature = String.fromCharCode(...audio.slice(0, 4));
        const detected =
          signature === "OggS"
            ? "audio/ogg"
            : signature.startsWith("ID3") ||
                (audio[0] === 255 && ((audio[1] ?? 0) & 224) === 224)
              ? "audio/mpeg"
              : String.fromCharCode(...audio.slice(4, 8)) === "ftyp"
                ? "audio/mp4"
                : undefined;
        if (
          !detected ||
          (mimeType !== "application/octet-stream" && detected !== mimeType) ||
          (voice.mime_type !== undefined && detected !== voice.mime_type)
        )
          throw new TelegramTransportError();
        return { audio, mimeType: detected };
      } catch {
        audio?.fill(0);
        throw new TelegramTransportError();
      }
    },
    async close() {
      lifetime.abort();
      await Promise.allSettled([...chats.values()].map((chat) => chat.tail));
      receipts.clear();
      chats.clear();
    },
  };
  return transport;
}

export function startTelegramPolling(options: {
  transport: Pick<TelegramTransport, "getUpdates" | "deleteWebhook">;
  environment: "development" | "test" | "production";
  handleUpdate(update: unknown): Promise<unknown>;
  /** Called on each failed poll; carries no update content. */
  onError?(): void;
}): { stop(): Promise<void>; done: Promise<void> } {
  if (options.environment === "production")
    throw new Error("telegram_polling_forbidden");
  const controller = new AbortController();
  const done = (async () => {
    let offset: number | undefined;
    // A webhook left over from a hosted deploy makes getUpdates fail (409).
    await options.transport.deleteWebhook?.().catch(() => options.onError?.());
    while (!controller.signal.aborted) {
      try {
        const updates = await options.transport.getUpdates(
          offset,
          controller.signal,
        );
        for (const update of updates) {
          if (controller.signal.aborted) break;
          if (
            !update ||
            typeof update !== "object" ||
            !("update_id" in update) ||
            !Number.isSafeInteger(update.update_id) ||
            Number(update.update_id) < 0
          )
            throw new TelegramTransportError();
          await options.handleUpdate(update);
          offset = Number(update.update_id) + 1;
        }
      } catch {
        if (!controller.signal.aborted) {
          options.onError?.();
          await delay(1000, controller.signal).catch(() => {});
        }
      }
    }
  })();
  return {
    done,
    async stop() {
      controller.abort();
      await done;
    },
  };
}
