// FR-TG-07/08/11, NFR-PRIV: the native relay shares the helper store and fails closed.
import { describe, expect, it, vi } from "vitest";
import { createTelegramHelpBridge } from "../src/telegram-help.js";
import {
  createTelegramAsk,
  telegramCommandRegistrations,
  withTelegramJobsDelivery,
} from "../src/telegram-runtime.js";
import type { TelegramApiService } from "../src/telegram-runtime.js";
import type { HelpStore } from "../src/types.js";
import type { HelpSocketStore } from "../src/help-sockets.js";
import type { ApiReply } from "../src/types.js";
import { loadPacks, type LangPack } from "@dimts/locales-tools";
import { resolve } from "node:path";

describe("P08 Telegram platform command languages", () => {
  const english = loadPacks(resolve("locales")).get("en")!;
  const pack = (
    code: string,
    description: string,
    status: "beta" | "draft" = "beta",
  ): LangPack => ({
    ...english,
    meta: { ...english.meta, code, status },
    ui: { ...english.ui, "telegram.command_start": description },
  });
  it("registers English defaults, maps regional tags, prefers base packs and skips unsupported command codes", () => {
    const packs = new Map([
      ["fr-CA", pack("fr-CA", "Canadian start")],
      ["fil", pack("fil", "Filipino start")],
      ["fr-FR", pack("fr-FR", "French region start")],
      ["de", pack("de", "Draft start", "draft")],
      ["en", english],
      ["fr", pack("fr", "Base French start")],
    ]);
    const registrations = telegramCommandRegistrations(packs);
    expect(registrations.map(({ languageCode }) => languageCode)).toEqual([
      "",
      "en",
      "fr",
    ]);
    expect(
      registrations[0]?.commands.find(({ command }) => command === "start")
        ?.description,
    ).toBe(english.ui["telegram.command_start"]);
    expect(
      registrations[2]?.commands.find(({ command }) => command === "start")
        ?.description,
    ).toBe("Base French start");
    expect(packs.has("fil")).toBe(true);
    expect(packs.has("fr-CA")).toBe(true);
  });
  it("chooses the same regional alias regardless of registry insertion order", () => {
    const entries: [string, LangPack][] = [
      ["fr-FR", pack("fr-FR", "French region start")],
      ["en", english],
      ["fr-CA", pack("fr-CA", "Canadian start")],
    ];
    const registrations = telegramCommandRegistrations(new Map(entries));
    expect(registrations).toEqual(
      telegramCommandRegistrations(new Map(entries.reverse())),
    );
    expect(
      registrations
        .find(({ languageCode }) => languageCode === "fr")
        ?.commands.find(({ command }) => command === "start")?.description,
    ).toBe("Canadian start");
  });
});

describe("P08 shared ask contract", () => {
  it("uses bounded replay keys and accepts 1000 Unicode code points", async () => {
    const response = {
      text: "Synthetic answer",
      citations: [],
    } as unknown as ApiReply;
    const conversation = vi.fn(async () => response),
      touchSession = vi.fn(async () => undefined);
    const ask = createTelegramAsk({
      conversation,
      repository: { touchSession },
    });
    const input = {
      sessionId: "session-telegram-one",
      clientMsgId: "telegram:" + "a".repeat(64) + ":1",
      lang: "en",
      text: "😀".repeat(1000),
      simple: false,
    };
    await expect(ask(input)).resolves.toBe(response);
    await ask(input);
    expect(conversation.mock.calls[0]?.[0]).toMatchObject({
      sessionId: input.sessionId,
      text: input.text,
      via: "telegram",
    });
    expect(conversation.mock.calls[0]?.[0].clientMsgId).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(conversation.mock.calls[0]?.[0].clientMsgId).toBe(
      conversation.mock.calls[1]?.[0].clientMsgId,
    );
  });
  it("rejects oversize text and invalid language/session fields before touching storage or invoking the engine", async () => {
    const conversation = vi.fn(),
      touchSession = vi.fn(async () => undefined);
    const ask = createTelegramAsk({
      conversation,
      repository: { touchSession },
    });
    const input = {
      sessionId: "session-telegram-one",
      clientMsgId: "telegram:" + "a".repeat(64) + ":1",
      lang: "en",
      text: "x".repeat(1001),
      simple: false,
    };
    await expect(ask(input)).rejects.toThrow("too_long");
    await expect(
      ask({ ...input, text: "Short", sessionId: "short" }),
    ).rejects.toThrow();
    await expect(
      ask({ ...input, text: "Short", lang: "invalid-language" }),
    ).rejects.toThrow();
    expect(touchSession).not.toHaveBeenCalled();
    expect(conversation).not.toHaveBeenCalled();
  });
});

function fixture() {
  const help = {
    createRequest: vi.fn(async () => ({ id: "help-one", status: "waiting" })),
    authorizeRequest: vi.fn(async () => true),
    closeRequest: vi.fn(async () => true),
  } as unknown as HelpStore;
  const store = {
    persistMessage: vi.fn(async () => "stored"),
    listMessagesAfter: vi.fn(async () => []),
  } as unknown as HelpSocketStore;
  const send = vi.fn(async () => undefined);
  const publish = vi.fn(async () => undefined);
  const closeRequest = vi.fn(async () => undefined);
  const bridge = createTelegramHelpBridge({
    help,
    store,
    send,
    socket: () => ({ publishMessage: publish, closeRequest }),
  });
  const route = {
    sessionId: "session-one",
    chatId: "900001",
    requestId: "help-one",
  };
  return { help, store, send, publish, closeRequest, bridge, route };
}

describe("P08 shared helper relay", () => {
  it("preserves long Telegram messages within the shared console message limit", async () => {
    const f = fixture();
    const text = "A".repeat(1999) + "😀" + "B".repeat(500);
    await f.bridge.relay({ ...f.route, text, key: "long-message" });
    const chunks = vi
      .mocked(f.store.persistMessage)
      .mock.calls.map((call) => call[3]);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true);
    expect(f.publish).toHaveBeenCalledTimes(2);
  });
  it("creates without summary and relays persisted learner and helper messages", async () => {
    const f = fixture();
    expect(await f.bridge.start(f.route)).toBe("help-one");
    expect(f.help.createRequest).toHaveBeenCalledWith("session-one", false);
    await f.bridge.relay({
      ...f.route,
      text: "Synthetic question",
      key: "learner-one",
    });
    expect(f.store.persistMessage).toHaveBeenCalledWith(
      "help-one",
      "learner",
      "learner-one",
      "Synthetic question",
    );
    expect(f.publish).toHaveBeenCalledWith("help-one", {
      id: "learner-one",
      sender: "learner",
      text: "Synthetic question",
    });
    await f.bridge.store.persistMessage(
      "help-one",
      "helper",
      "helper-one",
      "Synthetic answer",
    );
    expect(f.send).toHaveBeenCalledWith({
      chatId: "900001",
      sessionId: "session-one",
      requestId: "help-one",
      key: "helper:help-one:helper-one",
      text: "Synthetic answer",
    });
  });
  it("rebinds after restart, ignores duplicate commits and forgets closed/deleted requests", async () => {
    const f = fixture();
    vi.mocked(f.store.listMessagesAfter).mockResolvedValue([
      { id: "reply-one", sender: "helper", text: "Synthetic replay" },
    ]);
    await f.bridge.bind(f.route);
    expect(f.send).toHaveBeenCalledOnce();
    vi.mocked(f.store.persistMessage).mockResolvedValue("duplicate");
    await f.bridge.store.persistMessage(
      "help-one",
      "helper",
      "reply-one",
      "Synthetic replay",
    );
    expect(f.send).toHaveBeenCalledOnce();
    vi.mocked(f.help.authorizeRequest!).mockResolvedValue(false);
    vi.mocked(f.store.persistMessage).mockResolvedValue("stored");
    await f.bridge.store.persistMessage(
      "help-one",
      "helper",
      "reply-two",
      "Should not deliver",
    );
    expect(f.send).toHaveBeenCalledOnce();
    await f.bridge.end(f.route);
    expect(f.closeRequest).toHaveBeenCalledWith("help-one");
  });
  it("does not expose provider details or prevent persistence on delivery failure", async () => {
    const f = fixture();
    await f.bridge.bind(f.route);
    f.send.mockRejectedValue(new Error("sensitive provider detail"));
    await expect(
      f.bridge.store.persistMessage(
        "help-one",
        "helper",
        "reply-one",
        "Synthetic answer",
      ),
    ).resolves.toBe("stored");
  });
});

describe("P08 native P06 Telegram delivery", () => {
  it("uses the native alert port and preserves host accommodation delivery", async () => {
    const host = {
      channels: ["sms" as const],
      relayAvailable: true,
      sendDigest: vi.fn(async () => undefined),
      sendAccommodation: vi.fn(async () => undefined),
    };
    const sendAlert = vi.fn(async () => undefined);
    const port = withTelegramJobsDelivery(
      host,
      () => ({ sendAlert }) as unknown as TelegramApiService,
      true,
    );
    expect(port.channels).toEqual(["sms", "telegram"]);
    const digest = {
      channel: "telegram" as const,
      contact: "900001",
      text: "Synthetic digest",
      lang: "om",
      jobs: [],
      idempotencyKey: "native-one",
    };
    await port.sendDigest(digest);
    expect(sendAlert).toHaveBeenCalledWith({
      contact: digest.contact,
      text: digest.text,
      lang: digest.lang,
      idempotencyKey: digest.idempotencyKey,
    });
    expect(host.sendDigest).not.toHaveBeenCalled();
    const accommodation = {
      to: "host@example.org",
      message: "Approved request",
      lang: "en",
      idempotencyKey: "approved-one",
    };
    await port.sendAccommodation(accommodation);
    expect(host.sendAccommodation).toHaveBeenCalledWith(accommodation);
    sendAlert.mockRejectedValue(new Error("private provider detail"));
    await expect(
      port.sendDigest({ ...digest, idempotencyKey: "native-two" }),
    ).rejects.toMatchObject({
      code: "delivery_failed",
      message: "delivery_failed",
    });
  });
  it("disables legacy Telegram relay and preserves accommodation and SMS", async () => {
    const host = {
      channels: ["sms" as const, "telegram" as const],
      relayAvailable: true,
      sendDigest: vi.fn(async () => undefined),
      sendAccommodation: vi.fn(async () => undefined),
    };
    const port = withTelegramJobsDelivery(host, () => undefined, false);
    expect(port.channels).toEqual(["sms"]);
    await expect(
      port.sendDigest({
        channel: "telegram",
        contact: "900001",
        text: "Digest",
        lang: "en",
        jobs: [],
        idempotencyKey: "digest-one",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(host.sendDigest).not.toHaveBeenCalled();
    const sms = {
      channel: "sms" as const,
      contact: "+251900000001",
      text: "Digest",
      lang: "en",
      jobs: [],
      idempotencyKey: "digest-two",
    };
    await port.sendDigest(sms);
    expect(host.sendDigest).toHaveBeenCalledWith(sms);
  });
});
