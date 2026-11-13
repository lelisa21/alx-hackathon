import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SmsService, SmsError } from "../src/service.js";
import { MemorySmsStore, SmsBusyError } from "../src/store.js";
import type { SmsStore } from "../src/store.js";
import type { SmsServiceOptions } from "../src/types.js";

const strings = {
  menu: "1 English 2 አማርኛ 3 Afaan Oromoo",
  more: "Reply 1 for more.",
  welcome: "Ready.",
  callback: "Reply Y for a callback.",
  callback_sent: "Callback requested.",
  stopped: "You will get no more messages.",
  jobs_type: "Job type? Reply 0 for any.",
  jobs_region: "Region? Reply 0 for any.",
  jobs_language: "Choose alert language: 1 English 2 Amharic 3 Afaan Oromoo.",
  jobs_consent: "May we save your number for alerts? Reply Y.",
  jobs_active: "Subscribed.",
  unavailable: "Unavailable.",
  error: "Please try again.",
  invalid: "Invalid.",
  cancelled: "Cancelled.",
  jobs_manage: "1 Subscribe 2 Stop alerts",
  jobs_stopped: "Alerts stopped.",
  no_more: "No more pages.",
  limit: "Daily limit reached.",
};
function setup(extra: Partial<SmsServiceOptions> = {}) {
  const store = new MemorySmsStore();
  const send = vi.fn(
    async (_to: string, _text: string, opts?: { idempotencyKey?: string }) => ({
      id: opts?.idempotencyKey ?? randomUUID(),
      segments: 1,
    }),
  );
  const ask = vi.fn(
    async () => "A grounded answer. https://example.org/course",
  );
  const callback = vi.fn(async () => {});
  const subscribe = vi.fn(async () => ({
    id: "subscription",
    status: "active" as const,
  }));
  const stopContact = vi.fn(async () => {});
  const options: SmsServiceOptions = {
    store,
    hashKey: Buffer.alloc(32, 2),
    encryptionKey: Buffer.alloc(32, 1),
    gateway: { send, status: async () => "delivered", onInbound: () => {} },
    sessions: {
      create: async () => randomUUID(),
      setLanguage: async () => {},
      delete: vi.fn(async () => {}),
    },
    locales: () => ({
      strings,
      keywords: {
        help: ["HELP", "PERSON", "GARGAARSA", "እርዳታ"],
        stop: ["STOP", "DHAABI", "አቁም"],
        language: ["LANG", "AFAAN", "ቋንቋ"],
        jobs: ["JOBS", "HOJII", "ስራ"],
        person: ["PERSON", "2"],
      },
    }),
    ask,
    callback,
    jobs: { subscribe, stopContact },
    ...extra,
  };
  const service = new SmsService(options);
  const from = "+251911234567";
  const inbound = (text: string, id = randomUUID()) =>
    service.inbound({ from, text, id });
  const ready = async () => {
    await inbound("hello");
    await inbound("1");
  };
  return {
    service,
    store,
    send,
    ask,
    callback,
    subscribe,
    stopContact,
    options,
    from,
    inbound,
    ready,
  };
}

describe("P07 durable SMS conversation (FR-SMS-04–11)", () => {
  it("first contact offers the numeric menu and choice 3 persists across service instances", async () => {
    const f = setup();
    expect((await f.inbound("question")).messages[0]?.text).toBe(strings.menu);
    expect(f.ask).not.toHaveBeenCalled();
    expect((await f.inbound("3")).lang).toBe("om");
    const restarted = new SmsService(f.options);
    await restarted.inbound({ id: "question", from: f.from, text: "Explain" });
    expect(f.ask).toHaveBeenCalledWith(
      expect.objectContaining({ lang: "om", text: "Explain" }),
    );
  });
  it("deduplicates delivery and tutor effects, rejects changed replay, serializes concurrent delivery", async () => {
    const f = setup();
    await f.ready();
    const replies = await Promise.all([
      f.inbound("Explain", "same"),
      f.inbound("Explain", "same"),
    ]);
    expect(replies[0]).toEqual(replies[1]);
    expect(f.ask).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(3);
    await expect(f.inbound("Changed", "same")).rejects.toBeInstanceOf(SmsError);
  });
  it.each(["HELP", "pérson", "GARGAARSA", "እርዳታ", "2"])(
    "requires a separate Y after %s before sharing the transient number",
    async (keyword) => {
      const f = setup();
      await f.ready();
      await f.inbound(keyword);
      expect(f.callback).not.toHaveBeenCalled();
      await f.inbound("Y", "consent");
      await f.inbound("Y", "consent");
      expect(f.callback).toHaveBeenCalledTimes(1);
      expect(f.callback).toHaveBeenCalledWith(
        expect.objectContaining({ from: f.from }),
      );
      expect(JSON.stringify(f.store.inspect())).not.toContain(f.from);
    },
  );
  it("reports an unconfigured callback honestly", async () => {
    const f = setup({ callback: undefined });
    await f.ready();
    expect((await f.inbound("HELP")).messages[0]?.text).toBe(
      strings.unavailable,
    );
  });
  it("STOP confirms once, deletes private state, stops subscriptions, and survives a restart", async () => {
    const f = setup();
    await f.ready();
    await f.inbound("private question");
    const reply = await f.inbound("STOP");
    expect(reply.stopped).toBe(true);
    expect(reply.messages[0]?.text).toBe(strings.stopped);
    const count = f.send.mock.calls.length;
    expect((await f.inbound("STOP")).messages).toEqual([]);
    expect(
      (
        await new SmsService(f.options).inbound({
          id: "new",
          from: f.from,
          text: "JOBS",
        })
      ).messages,
    ).toEqual([]);
    await expect(
      f.service.sendAlert({
        contact: f.from,
        lang: "en",
        text: "An alert.",
        idempotencyKey: "alert",
      }),
    ).rejects.toBeInstanceOf(SmsError);
    expect(f.send).toHaveBeenCalledTimes(count);
    expect(f.stopContact).toHaveBeenCalled();
    expect(JSON.stringify(f.store.inspect())).not.toContain("private question");
  });
  it("resumes only the durable STOP confirmation after transport acceptance and a database failure", async () => {
    const underlying = new MemorySmsStore();
    let rejectWrites = false;
    let faultOnce = true;
    const accepted = new Set<string>();
    const store: SmsStore = {
      revoke: (hash, confirmation, now) =>
        underlying.revoke(hash, confirmation, now),
      withPhone: (hash, work) =>
        underlying.withPhone(hash, (locked) =>
          work({
            ...locked,
            save: async (record) => {
              if (rejectWrites) throw new Error("database unavailable");
              await locked.save(record);
            },
          }),
        ),
    };
    const f = setup({
      store,
      gateway: {
        send: async (_to, _text, options) => {
          accepted.add(options!.idempotencyKey!);
          if (faultOnce) {
            rejectWrites = true;
            faultOnce = false;
          }
          return { id: options!.idempotencyKey!, segments: 1 };
        },
        status: async () => "delivered",
        onInbound: () => {},
      },
    });
    await expect(f.inbound("STOP", "stop")).rejects.toThrow(
      "database unavailable",
    );
    expect(underlying.inspect()[0]?.stopped).toBe(true);
    expect(underlying.inspect()[0]?.state.outbox).toEqual([]);
    rejectWrites = false;
    const result = await new SmsService(f.options).inbound({
      from: f.from,
      text: "STOP",
      id: "retry",
    });
    expect(result.messages[0]?.status).toBe("delivered");
    expect(accepted.size).toBe(1);
    expect((await f.inbound("STOP")).messages).toEqual([]);
  });
  it("prioritizes STOP over a blocked tutor and suppresses the in-flight answer", async () => {
    let release!: (text: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = setup({
      ask: async () => {
        entered();
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
    });
    await f.ready();
    const question = f.inbound("slow private question");
    await started;
    const stop = f.inbound("STOP");
    await Promise.resolve();
    expect(f.store.inspect()[0]?.stopped).toBe(true);
    release("This answer must never be sent.");
    expect((await question).messages).toEqual([]);
    expect((await stop).messages[0]?.text).toBe(strings.stopped);
    expect(
      f.send.mock.calls.some((call) => call[1].includes("must never")),
    ).toBe(false);
    expect(JSON.stringify(f.store.inspect())).not.toContain(
      "slow private question",
    );
  });
  it("cleans up subscriptions and session even when the STOP confirmation lock is busy", async () => {
    const underlying = new MemorySmsStore();
    let busy = false;
    const store: SmsStore = {
      revoke: (hash, confirmation, now) =>
        underlying.revoke(hash, confirmation, now),
      withPhone: (hash, work) => {
        if (busy) return Promise.reject(new SmsBusyError());
        return underlying.withPhone(hash, work);
      },
    };
    const f = setup({ store });
    await f.ready();
    busy = true;
    await expect(f.inbound("STOP")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(f.stopContact).toHaveBeenCalledWith(f.from);
    expect(f.options.sessions.delete).toHaveBeenCalled();
    expect(underlying.inspect()[0]?.state.outbox).toEqual([]);
    expect(underlying.inspect()[0]?.stopped).toBe(true);
    busy = false;
    expect((await f.inbound("STOP")).messages[0]?.text).toBe(strings.stopped);
  });
  it("retries a transient tutor failure using the same saved request identity", async () => {
    const ask = vi.fn(async (input: { clientMsgId: string }) => {
      void input;
      return "A recovered grounded answer.";
    });
    ask.mockRejectedValueOnce(new Error("temporary tutor failure"));
    const f = setup({ ask });
    await f.ready();
    await expect(f.inbound("Explain", "tutor-retry")).rejects.toMatchObject({
      code: "unavailable",
    });
    const response = await new SmsService(f.options).inbound({
      from: f.from,
      text: "Explain",
      id: "tutor-retry",
    });
    expect(response.messages[0]?.text).toBe("A recovered grounded answer.");
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[0]?.[0].clientMsgId).toBe(
      ask.mock.calls[1]?.[0].clientMsgId,
    );
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it("retries transient callback acceptance with the same durable idempotency key", async () => {
    const callback = vi.fn(async (input: { idempotencyKey: string }) => {
      void input;
    });
    callback.mockRejectedValueOnce(new Error("temporarily unavailable"));
    const f = setup({ callback });
    await f.ready();
    await f.inbound("HELP");
    await expect(f.inbound("Y", "callback-retry")).rejects.toMatchObject({
      code: "unavailable",
    });
    const result = await new SmsService(f.options).inbound({
      from: f.from,
      text: "Y",
      id: "callback-retry",
    });
    expect(result.messages[0]?.text).toBe(strings.callback_sent);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[0]?.[0].idempotencyKey).toBe(
      callback.mock.calls[1]?.[0].idempotencyKey,
    );
  });
  it("retries transient subscription creation without changing its request identity", async () => {
    const f = setup();
    await f.ready();
    for (const text of ["JOBS", "1", "0", "0", "1"]) await f.inbound(text);
    f.subscribe.mockRejectedValueOnce(new Error("temporarily unavailable"));
    await expect(f.inbound("Y", "subscription-retry")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect((await f.inbound("Y", "subscription-retry")).messages[0]?.text).toBe(
      strings.jobs_active,
    );
    expect(f.subscribe).toHaveBeenCalledTimes(2);
  });
  it("guides JOBS through filters and separate consent using the existing subscription port", async () => {
    const f = setup();
    await f.ready();
    for (const text of ["JOBS", "1", "developer", "Addis Ababa", "3"])
      await f.inbound(text);
    expect(f.subscribe).not.toHaveBeenCalled();
    await f.inbound("Y", "subscribe");
    await f.inbound("Y", "subscribe");
    expect(f.subscribe).toHaveBeenCalledTimes(1);
    expect(f.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: f.from,
        channel: "sms",
        lang: "om",
        jobType: "developer",
        region: "Addis Ababa",
        consent: { accepted: true, noticeVersion: "job-alerts-v1" },
      }),
    );
  });
  it("enforces the shared daily cap for responses and digests across restart", async () => {
    const f = setup({ dailyLimit: 3 });
    await f.ready();
    await f.service.sendAlert({
      contact: f.from,
      lang: "en",
      text: "One digest.",
      idempotencyKey: "digest",
    });
    await expect(
      new SmsService(f.options).sendAlert({
        contact: f.from,
        lang: "en",
        text: "Another.",
        idempotencyKey: "next",
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it("stops job alerts through their service without stopping tutoring", async () => {
    const f = setup();
    await f.ready();
    await f.inbound("JOBS");
    expect((await f.inbound("2")).messages[0]?.text).toBe(strings.jobs_stopped);
    expect(f.stopContact).toHaveBeenCalledWith(f.from);
    expect((await f.inbound("Explain")).stopped).toBe(false);
    expect(f.ask).toHaveBeenCalledTimes(1);
  });
  it("deduplicates alert retries after restart and rejects payload changes", async () => {
    const f = setup();
    await f.ready();
    const input = {
      contact: f.from,
      lang: "en",
      text: "One digest.",
      idempotencyKey: "digest",
    };
    await f.service.sendAlert(input);
    await new SmsService(f.options).sendAlert(input);
    expect(f.send).toHaveBeenCalledTimes(3);
    await expect(
      f.service.sendAlert({ ...input, text: "Changed digest." }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("accepts Amharic choice 2 inside the job language step without invoking help", async () => {
    const f = setup();
    await f.ready();
    for (const text of ["JOBS", "1", "0", "0", "2", "Y"]) await f.inbound(text);
    expect(f.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ lang: "am" }),
    );
    expect(f.callback).not.toHaveBeenCalled();
  });
  it("durably limits inbound bursts while permitting immediate STOP", async () => {
    const f = setup({ dailyLimit: 100 });
    await f.ready();
    for (let index = 0; index < 28; index++) await f.inbound("Explain");
    await expect(f.inbound("Explain")).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect((await f.inbound("STOP")).stopped).toBe(true);
  });
  it("retries delivery exactly twice with one durable idempotency key", async () => {
    const f = setup();
    f.send.mockRejectedValue(new Error("transport failed"));
    const reply = await f.inbound("hello", "failed");
    expect(reply.messages[0]?.status).toBe("failed");
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(
      new Set(f.send.mock.calls.map((call) => call[2]?.idempotencyKey)).size,
    ).toBe(1);
    await f.inbound("hello", "failed");
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it("continuation stays on its session, expires, and remains inside three segments", async () => {
    let now = new Date("2026-11-13T12:00:00Z");
    const f = setup({
      now: () => now,
      ask: async () =>
        "An informative sentence about course material. ".repeat(35),
    });
    await f.ready();
    const first = await f.inbound("long answer");
    expect(first.messages[0]?.segments).toBeLessThanOrEqual(3);
    expect(first.messages[0]?.text.endsWith(strings.more)).toBe(true);
    expect((await f.inbound("1")).messages[0]?.segments).toBeLessThanOrEqual(3);
    now = new Date(now.getTime() + 16 * 60_000);
    expect((await f.inbound("1")).messages[0]?.text).toBe(strings.no_more);
  });
});
