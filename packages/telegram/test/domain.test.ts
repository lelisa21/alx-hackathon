import { describe, expect, it, vi } from "vitest";
import { TelegramService } from "../src/service.js";
import { MemoryTelegramStore } from "../src/store.js";
import type { TelegramServiceOptions } from "../src/types.js";
const languages = [
  { code: "en", label: "English" },
  { code: "am", label: "አማርኛ" },
  { code: "om", label: "Afaan Oromoo" },
];
function setup(extra: Partial<TelegramServiceOptions> = {}) {
  const store = new MemoryTelegramStore();
  let lang = "en";
  const send = vi.fn(async () => "sent" as const);
  const ask = vi.fn(async () => ({
    text: "Grounded answer.",
    citations: [{ label: "Lesson", url: "https://example.org/lesson" }],
  }));
  const jobs = {
    listJobs: vi.fn(async () => []),
    listSubscriptions: vi.fn(async () => []),
    subscribe: vi.fn(async () => ({ id: "sub", status: "active" as const })),
    stopContact: vi.fn(async () => {}),
  };
  const help = {
    start: vi.fn(async () => "help-1"),
    relay: vi.fn(async () => true),
    end: vi.fn(async () => {}),
    bind: vi.fn(async () => {}),
  };
  const options: TelegramServiceOptions = {
    store,
    hashKey: Buffer.alloc(32, 2),
    encryptionKey: Buffer.alloc(32, 1),
    languages,
    locales: (locale) =>
      new Proxy({}, { get: (_, key) => locale + ":" + String(key) }),
    transport: { send, sendAudio: vi.fn(async () => "sent" as const) },
    sessions: {
      ensure: vi.fn(async () => ({ id: "session-1", lang })),
      setLanguage: vi.fn(async (_id, value) => {
        lang = value;
      }),
      delete: vi.fn(async () => {}),
    },
    ask,
    jobs,
    help,
    ...extra,
  };
  const service = new TelegramService(options);
  let id = 0;
  const text = (text: string) =>
    service.handleUpdate({
      update_id: ++id,
      message: {
        message_id: id,
        chat: { id: 12345, type: "private" },
        from: { id: 12345, is_bot: false },
        text,
      },
    });
  const callback = (data: string) => {
    if (["jobs:review", "jobs:consent", "jobs:confirm"].includes(data)) {
      const prefix = data + ":";
      data =
        [...send.mock.calls]
          .reverse()
          .flatMap(([message]) => (message.buttons ?? []).flat())
          .find((button) => button.data.startsWith(prefix))?.data ?? data;
    }
    return service.handleUpdate({
      update_id: ++id,
      callback_query: {
        id: String(id),
        from: { id: 12345, is_bot: false },
        data,
        message: { message_id: id, chat: { id: 12345, type: "private" } },
      },
    });
  };
  return { service, options, store, send, ask, jobs, help, text, callback };
}
describe("P08 Telegram domain FR-TG-01–12", () => {
  for (const lang of languages.map((l) => l.code))
    it(
      "commands, shared tutoring and localized recovery in " + lang,
      async () => {
        const h = setup();
        await h.text("/start");
        await h.callback("language:" + lang);
        await h.text("/language");
        await h.text("/privacy");
        await h.text("/simple");
        await h.text("What is a variable?");
        expect(h.ask).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: "session-1",
            lang,
            simple: true,
            text: "What is a variable?",
          }),
        );
        expect(h.send).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining("https://example.org/lesson"),
          }),
        );
        await h.text("/help");
        await h.text("A helper question");
        expect(h.help.relay).toHaveBeenCalledTimes(1);
        await h.text("/endhelp");
        expect(h.help.end).toHaveBeenCalledTimes(1);
        await h.text("/jobs");
        expect(h.jobs.listJobs).toHaveBeenCalledWith({ lang });
        await h.text("/stop");
        expect(h.jobs.stopContact).toHaveBeenCalledWith({
          channel: "telegram",
          contact: "12345",
        });
        expect(
          h.send.mock.calls.some(
            ([m]) => m.text === lang + ":telegram.stopped",
          ),
        ).toBe(true);
      },
    );
  it("silently ignores groups, blocks replay and retains only HMAC identity", async () => {
    const h = setup();
    await h.service.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: -12, type: "group" },
        text: "secret",
      },
    });
    expect(h.send).not.toHaveBeenCalled();
    const raw = {
      update_id: 2,
      message: {
        message_id: 2,
        chat: { id: 12345, type: "private" },
        from: { id: 12345, is_bot: false },
        text: "question",
      },
    };
    await h.service.handleUpdate(raw);
    await h.service.handleUpdate(raw);
    expect(h.ask).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.store.inspect())).not.toContain("12345");
    expect(JSON.stringify(h.store.inspect())).not.toContain("question");
  });
  it("accepts unseen out-of-order updates but skips their replays across restart", async () => {
    const h = setup();
    const update = (id: number) => ({
      update_id: id,
      message: {
        message_id: id,
        chat: { id: 12345, type: "private" },
        from: { id: 12345, is_bot: false },
        text: "question " + id,
      },
    });
    await h.service.handleUpdate(update(1002));
    await h.service.handleUpdate(update(1001));
    await new TelegramService(h.options).handleUpdate(update(1001));
    expect(h.ask).toHaveBeenCalledTimes(2);
  });
  it("read-aloud sends equivalent text and erases synthesized bytes", async () => {
    const audio = new Uint8Array([1, 2, 3]);
    const sendAudio = vi.fn(async () => "sent" as const);
    const h = setup({
      voice: {
        supported: () => ({ stt: true, tts: true }),
        transcribe: async () => "words",
        synthesize: async () => ({ audio, mimeType: "audio/mpeg" }),
      },
      transport: { send: vi.fn(async () => "sent" as const), sendAudio },
    });
    await h.callback("audio:toggle");
    await h.text("question");
    expect(sendAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        equivalentText: expect.stringContaining("Grounded answer."),
        mimeType: "audio/mpeg",
      }),
    );
    expect([...audio]).toEqual([0, 0, 0]);
  });
  it("pending voice is discarded if STOP arrives during transcription", async () => {
    let finish!: (text: string) => void;
    const voice = {
      supported: () => ({ stt: true, tts: false }),
      transcribe: vi.fn(
        () =>
          new Promise<string>((r) => {
            finish = r;
          }),
      ),
      synthesize: vi.fn(),
    };
    const h = setup({ voice });
    const running = h.service.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 12345, type: "private" },
        from: { id: 12345, is_bot: false },
        voice: { file_id: "opaque", duration: 2 },
      },
    });
    await vi.waitFor(() => expect(voice.transcribe).toHaveBeenCalledTimes(1));
    await h.service.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        chat: { id: 12345, type: "private" },
        from: { id: 12345, is_bot: false },
        text: "/stop",
      },
    });
    finish("private words");
    await running;
    expect(h.store.inspect()[0]?.state.voice).toBeUndefined();
    expect(
      h.send.mock.calls.some(([m]) => m.text === "en:telegram.voice_review"),
    ).toBe(false);
  });
  it("/help exits an unfinished jobs flow and /endhelp restores tutoring", async () => {
    const h = setup();
    await h.text("/jobs");
    await h.callback("jobs:create");
    await h.text("/help");
    await h.text("Please explain this");
    expect(h.help.relay).toHaveBeenCalledTimes(1);
    await h.text("/endhelp");
    await h.text("A tutoring question");
    expect(h.ask).toHaveBeenCalledTimes(1);
  });
  it("ALL and zero select unfiltered alerts; filter inputs remain bounded", async () => {
    const h = setup();
    await h.text("/jobs");
    await h.callback("jobs:create");
    await h.text("x".repeat(101));
    expect(h.store.inspect()[0]?.state.step).toBe("jobs_type");
    await h.text("all");
    await h.text("0");
    await h.callback("jobs:language:en");
    await h.callback("jobs:review");
    await h.callback("jobs:consent");
    await h.callback("jobs:confirm");
    expect(h.jobs.subscribe).toHaveBeenCalledTimes(1);
    const input = h.jobs.subscribe.mock.calls[0]?.[0];
    expect(input).not.toHaveProperty("jobType");
    expect(input).not.toHaveProperty("region");
  });
  it("enforces 1000 Unicode codepoints for tutoring while preserving helper relay", async () => {
    const h = setup();
    await h.text("x".repeat(1001));
    expect(h.ask).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "en:telegram.too_long" }),
    );
    await h.text("😀".repeat(1000));
    expect(h.ask).toHaveBeenCalledTimes(1);
    await h.text("/help");
    await h.text("x".repeat(1500));
    expect(h.help.relay).toHaveBeenCalledTimes(1);
  });
  it("uses the shared career renderer for job dates and details", async () => {
    const job = {
      id: "job",
      title: "Developer",
      description: "Build",
      organization: "Example",
      location: "Addis",
      region: null,
      jobType: null,
      datePosted: "2026-11-01",
      deadline: "2026-12-01",
      url: "https://example.org/job",
      lang: "en",
      accommodationsOffered: [],
    };
    const renderJobs = vi.fn(() => "Localized date and job");
    const h = setup({
      renderJobs,
      jobs: {
        listJobs: async () => [job],
        listSubscriptions: async () => [],
        subscribe: vi.fn(),
        stopContact: vi.fn(),
      },
    });
    await h.text("/jobs");
    expect(renderJobs).toHaveBeenCalledWith({ lang: "en", jobs: [job] });
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Localized date and job"),
      }),
    );
  });
  it("rejects confirmation buttons from a previous alert consent flow", async () => {
    const h = setup();
    const flow = async () => {
      await h.text("/jobs");
      await h.callback("jobs:create");
      await h.text("ALL");
      await h.text("ALL");
      await h.callback("jobs:language:en");
      await h.callback("jobs:review");
      await h.callback("jobs:consent");
    };
    await flow();
    const oldConfirm = [...h.send.mock.calls]
      .reverse()
      .flatMap(([m]) => (m.buttons ?? []).flat())
      .find((b) => b.data.startsWith("jobs:confirm:"))!.data;
    await h.callback("cancel");
    await flow();
    await h.callback(oldConfirm);
    expect(h.jobs.subscribe).not.toHaveBeenCalled();
    await h.callback("jobs:confirm");
    expect(h.jobs.subscribe).toHaveBeenCalledTimes(1);
  });
  it("limits dynamic language buttons to20Unicodecharacters", async () => {
    const h = setup({
      languages: [...languages, { code: "zz", label: "😀".repeat(25) }],
    });
    await h.text("/language");
    await h.callback("jobs:create");
    await h.text("ALL");
    await h.text("ALL");
    const buttons = h.send.mock.calls.flatMap(([m]) =>
      (m.buttons ?? []).flat(),
    );
    expect(buttons.filter((b) => b.data.endsWith(":zz"))).toHaveLength(2);
    expect(
      buttons
        .filter(
          (b) =>
            b.data.startsWith("language:") ||
            b.data.startsWith("jobs:language:"),
        )
        .every((b) => Array.from(b.text).length <= 20),
    ).toBe(true);
  });
  it("cancels queued contact sends before STOP confirmation", async () => {
    const events: string[] = [];
    const cancelContact = vi.fn(() => events.push("cancel"));
    const send = vi.fn(async (input: { text: string }) => {
      events.push(input.text);
      return "sent" as const;
    });
    const h = setup({ transport: { send, sendAudio: vi.fn(), cancelContact } });
    await h.text("/stop");
    expect(cancelContact).toHaveBeenCalledWith("12345");
    expect(events.indexOf("cancel")).toBeLessThan(
      events.indexOf("en:telegram.stopped"),
    );
  });
  it("cancels queued contact sends before privacy deletion and confirmation", async () => {
    const events: string[] = [];
    const cancelContact = vi.fn(() => events.push("cancel"));
    const send = vi.fn(async (input: { text: string }) => {
      events.push(input.text);
      return "sent" as const;
    });
    const h = setup({ transport: { send, sendAudio: vi.fn(), cancelContact } });
    await h.text("/privacy");
    await h.callback("privacy:delete");
    events.length = 0;
    await h.callback("privacy:confirm");
    expect(cancelContact).toHaveBeenCalledWith("12345");
    expect(events.indexOf("cancel")).toBeLessThan(
      events.indexOf("en:telegram.deleted"),
    );
    expect(cancelContact.mock.invocationCallOrder[0]).toBeLessThan(
      h.options.sessions.delete.mock.invocationCallOrder[0],
    );
  });
  it("does not send an old recovery error after STOP cancels its answer", async () => {
    let cancel!: () => void;
    let started = false;
    const send = vi.fn(async (input: { text: string }) => {
      if (input.text.includes("Grounded answer.")) {
        started = true;
        return new Promise<"failed">((r) => {
          cancel = () => r("failed");
        });
      }
      return "sent" as const;
    });
    const h = setup({
      transport: { send, sendAudio: vi.fn(), cancelContact: () => cancel?.() },
    });
    const answer = h.text("question");
    await vi.waitFor(() => expect(started).toBe(true));
    await h.text("/stop");
    await answer;
    expect(send.mock.calls.some(([m]) => m.text === "en:telegram.error")).toBe(
      false,
    );
    expect(
      send.mock.calls.some(([m]) => m.text === "en:telegram.stopped"),
    ).toBe(true);
  });
  it("full jobs review, consent and confirm lifecycle; stale buttons cannot bypass steps", async () => {
    const h = setup();
    await h.text("/jobs");
    await h.callback("jobs:confirm");
    expect(h.jobs.subscribe).not.toHaveBeenCalled();
    await h.callback("jobs:create");
    await h.text("FULL_TIME");
    await h.text("Addis Ababa");
    await h.callback("jobs:language:am");
    await h.callback("jobs:review");
    expect(h.jobs.subscribe).not.toHaveBeenCalled();
    await h.callback("jobs:consent");
    expect(h.jobs.subscribe).not.toHaveBeenCalled();
    await h.callback("jobs:confirm");
    expect(h.jobs.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "am",
        jobType: "FULL_TIME",
        region: "Addis Ababa",
        channel: "telegram",
        contact: "12345",
        consent: { accepted: true, noticeVersion: "job-alerts-v1" },
      }),
    );
    await h.text("/stop");
    await h.text("/jobs");
    await h.callback("jobs:create");
    await h.text("FULL_TIME");
    await h.text("Oromia");
    await h.callback("jobs:language:en");
    await h.callback("jobs:review");
    await h.callback("jobs:consent");
    await h.callback("jobs:confirm");
    expect(h.jobs.subscribe).toHaveBeenCalledTimes(1);
    await h.text("/start");
    await h.text("Can I still learn?");
    expect(h.ask).toHaveBeenCalled();
  });
  it("voice never answers before Send, retry discards transcript and expired reviews fail closed", async () => {
    let now = new Date();
    const voice = {
      supported: () => ({ stt: true, tts: false }),
      transcribe: vi.fn(async () => "Reviewed words"),
      synthesize: vi.fn(),
    };
    const h = setup({ voice, now: () => now });
    const voiceUpdate = (id: number) =>
      h.service.handleUpdate({
        update_id: id,
        message: {
          message_id: id,
          chat: { id: 12345, type: "private" },
          from: { id: 12345, is_bot: false },
          voice: { file_id: "opaque", duration: 2 },
        },
      });
    await voiceUpdate(1);
    expect(h.ask).not.toHaveBeenCalled();
    await h.service.handleUpdate({
      update_id: 2,
      callback_query: {
        id: "2",
        from: { id: 12345, is_bot: false },
        data: "voice:retry:1",
        message: { message_id: 1, chat: { id: 12345, type: "private" } },
      },
    });
    expect(h.ask).not.toHaveBeenCalled();
    await voiceUpdate(3);
    await h.service.handleUpdate({
      update_id: 4,
      callback_query: {
        id: "4",
        from: { id: 12345, is_bot: false },
        data: "voice:send:3",
        message: { message_id: 3, chat: { id: 12345, type: "private" } },
      },
    });
    expect(h.ask).toHaveBeenCalledTimes(1);
    await voiceUpdate(5);
    now = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    await h.service.handleUpdate({
      update_id: 6,
      callback_query: {
        id: "6",
        from: { id: 12345, is_bot: false },
        data: "voice:send:5",
        message: { message_id: 5, chat: { id: 12345, type: "private" } },
      },
    });
    expect(h.ask).toHaveBeenCalledTimes(1);
  });
  it("asks once before sending voice notes to a remote transcriber", async () => {
    const voice = {
      supported: () => ({ stt: true, tts: false }),
      transcribe: vi.fn(async () => "Reviewed words"),
      synthesize: vi.fn(),
    };
    const h = setup({ voice, voiceConsentRequired: true });
    const voiceUpdate = (id: number) =>
      h.service.handleUpdate({
        update_id: id,
        message: {
          message_id: id,
          chat: { id: 12345, type: "private" },
          from: { id: 12345, is_bot: false },
          voice: { file_id: "opaque", duration: 2 },
        },
      });
    const tap = (id: number, data: string) =>
      h.service.handleUpdate({
        update_id: id,
        callback_query: {
          id: String(id),
          from: { id: 12345, is_bot: false },
          data,
          message: { message_id: id, chat: { id: 12345, type: "private" } },
        },
      });
    const sentKeys = () => h.send.mock.calls.map(([message]) => message.text);

    // "Not now" discards the held note without transcribing it.
    await voiceUpdate(1);
    expect(voice.transcribe).not.toHaveBeenCalled();
    expect(sentKeys()).toContain("en:telegram.voice_consent");
    await tap(2, "voice:deny:1");
    expect(voice.transcribe).not.toHaveBeenCalled();
    expect(h.store.inspect()[0]?.state.voiceFile).toBeUndefined();

    // "I agree" transcribes the held note, then later notes go straight through.
    await voiceUpdate(3);
    await tap(4, "voice:allow:3");
    expect(voice.transcribe).toHaveBeenCalledTimes(1);
    expect(sentKeys()).toContain("en:telegram.voice_review");
    await voiceUpdate(5);
    expect(voice.transcribe).toHaveBeenCalledTimes(2);
    expect(h.ask).not.toHaveBeenCalled();
  });
  it("reports unavailable file voice honestly and does not trust a transcript in update", async () => {
    const h = setup();
    await h.service.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 12345, type: "private" },
        from: { id: 12345, is_bot: false },
        voice: { file_id: "file", duration: 1 },
      },
    });
    expect(h.ask).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "en:telegram.voice_unavailable" }),
    );
  });
  it("STOP bypasses a blocked tutor and rate limit, cannot be undone by stale save", async () => {
    let finish!: () => void;
    const blocked = new Promise<void>((r) => {
      finish = r;
    });
    const h = setup({
      perMinuteLimit: 1,
      ask: async () => {
        await blocked;
        return { text: "Answer", citations: [] };
      },
    });
    const running = h.text("question");
    await vi.waitFor(() => expect(h.options.ask).toBeDefined());
    await new Promise((r) => setTimeout(r, 5));
    await h.text("/stop");
    expect(h.jobs.stopContact).toHaveBeenCalledTimes(1);
    finish();
    await running;
    expect(h.store.inspect()[0]?.stopped).toBe(true);
  });
  it("global data deletion clears pending voice/help/jobs and keeps alert tombstone", async () => {
    const h = setup();
    await h.text("/help");
    await h.text("/privacy");
    await h.callback("privacy:delete");
    await h.callback("privacy:confirm");
    expect(h.options.sessions.delete).toHaveBeenCalledWith("session-1");
    expect(h.store.inspect()[0]?.state).toEqual({ step: "ready" });
    expect(h.store.inspect()[0]?.stopped).toBe(true);
  });
  it("durable helper delivery claims suppress replay after service restart", async () => {
    const h = setup();
    await h.text("/help");
    const payload = {
      chatId: "12345",
      sessionId: "session-1",
      requestId: "help-1",
      text: "Helper reply",
      key: "helper:1",
    };
    await h.service.sendHelper(payload);
    const restarted = new TelegramService(h.options);
    await restarted.sendHelper(payload);
    expect(
      h.send.mock.calls.filter(([m]) => m.text === "Helper reply"),
    ).toHaveLength(1);
  });
  it("rate limits persist across instances and still provide /help recovery", async () => {
    const h = setup({ perMinuteLimit: 1 });
    await h.text("one");
    const restarted = new TelegramService(h.options);
    await restarted.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        chat: { id: 12345, type: "private" },
        from: { id: 12345, is_bot: false },
        text: "two",
      },
    });
    expect(h.ask).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "en:telegram.rate_limit" }),
    );
  });
  it("failure is localized and replay does not repeat an uncertain effect", async () => {
    const ask = vi.fn(async () => {
      throw new Error("sensitive");
    });
    const h = setup({ ask });
    const raw = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 12345, type: "private" },
        from: { id: 12345, is_bot: false },
        text: "secret",
      },
    };
    await h.service.handleUpdate(raw);
    await h.service.handleUpdate(raw);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "en:telegram.error" }),
    );
  });
});
