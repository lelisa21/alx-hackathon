import { createHmac } from "node:crypto";
import { ContactCipher } from "@dimts/jobs";
import {
  countSms,
  normalizeForSms,
  normalizeSmsKeyword,
  paginateSms,
} from "./segments.js";
import {
  emptySmsState,
  PostgresSmsStore,
  SmsRevokedError,
  SmsBusyError,
  type SmsLockedStore,
  type SmsStore,
} from "./store.js";
import type {
  SmsAction,
  SmsInbound,
  SmsInboundResult,
  SmsMessage,
  SmsOutbox,
  SmsReceipt,
  SmsRecord,
  SmsServiceOptions,
} from "./types.js";

export class SmsError extends Error {
  readonly code:
    "invalid" | "conflict" | "rate_limited" | "unavailable" | "delivery_failed";
  readonly lang: string;
  constructor(code: SmsError["code"], lang = "en") {
    super(code);
    this.name = "SmsError";
    this.code = code;
    this.lang = lang;
  }
}

/** Channel adapter. Contacts are transient arguments only; private continuation
 * and outbox text are encrypted by the durable store, never used as identifiers. */
export class SmsService {
  private readonly store: SmsStore;
  private readonly cipher: ContactCipher;
  private readonly now: () => Date;
  private readonly limit: number;
  private readonly options: SmsServiceOptions;
  constructor(options: SmsServiceOptions) {
    this.options = options;
    this.cipher = new ContactCipher(options.encryptionKey, options.hashKey);
    this.now = options.now ?? (() => new Date());
    this.limit = options.dailyLimit ?? 20;
    if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 1000)
      throw new SmsError("invalid");
    if (!options.store && !options.pool) throw new SmsError("unavailable");
    this.store =
      options.store ??
      new PostgresSmsStore(
        options.pool!,
        options.encryptionKey,
        options.hashKey,
        options.revocationPool,
      );
  }
  private hash(value: string): string {
    return createHmac("sha256", this.options.hashKey)
      .update(value)
      .digest("hex");
  }
  private text(lang: string, key: string): string {
    const result =
      this.options.locales(lang).strings[key] ??
      this.options.locales("en").strings[key];
    if (!result) throw new SmsError("unavailable", lang);
    return result;
  }
  private matches(text: string, key: string, lang: string): boolean {
    const normalized = normalizeSmsKeyword(text);
    return [lang, "en", "am", "om"].some((code) =>
      (this.options.locales(code).keywords[key] ?? []).some(
        (keyword) => normalizeSmsKeyword(keyword) === normalized,
      ),
    );
  }
  private fresh(hash: string): SmsRecord {
    return {
      phoneHash: hash,
      sessionId: null,
      lang: "en",
      stopped: false,
      stopDelivery: null,
      day: this.now().toISOString().slice(0, 10),
      count: 0,
      windowAt: this.now().getTime(),
      windowCount: 0,
      state: emptySmsState(),
    };
  }
  private maintain(record: SmsRecord): void {
    const now = this.now().getTime();
    const day = this.now().toISOString().slice(0, 10);
    if (record.day !== day) {
      record.day = day;
      record.count = 0;
    }
    if (now - record.windowAt >= 60_000) {
      record.windowAt = now;
      record.windowCount = 0;
    }
    if (
      record.state.continuation &&
      (record.state.continuation.expiresAt <= now ||
        record.state.continuation.sessionId !== record.sessionId)
    )
      delete record.state.continuation;
    // Keep minimal replay keys for seven days, but no response text beyond 24 h.
    record.state.outbox = record.state.outbox.filter(
      (message) => message.createdAt > now - 86_400_000,
    );
    for (const [key, receipt] of Object.entries(record.state.receipts)) {
      if (receipt.createdAt < now - 7 * 86_400_000)
        delete record.state.receipts[key];
      else if (receipt.createdAt < now - 86_400_000) {
        receipt.action = null;
        receipt.completed = true;
      }
    }
  }
  async inbound(input: SmsInbound): Promise<SmsInboundResult> {
    if (
      !/^\+[1-9]\d{6,14}$/u.test(input.from) ||
      !input.id ||
      input.id.length > 128 ||
      !input.text.trim() ||
      input.text.length > 4000
    )
      throw new SmsError("invalid");
    const phoneHash = this.cipher.hash("sms", input.from);
    const isStop = this.matches(input.text, "stop", "en");
    if (isStop) {
      const revoked = await this.store.revoke(
        phoneHash,
        (lang) => {
          const text = normalizeForSms(this.text(lang, "stopped"));
          const count = countSms(text);
          return {
            id: `sms-stop:${phoneHash}`,
            text,
            lang,
            encoding: count.encoding,
            units: count.units,
            segments: count.segments,
            status: "queued",
            attempts: 0,
            createdAt: this.now().getTime(),
          };
        },
        this.now(),
      );
      // Privacy cleanup must not depend on acquiring the contested phone lock.
      // P06 takes its subscription lock before SMS delivery, so do this outside
      // withPhone even when an earlier tutor turn is still finishing.
      try {
        await this.options.jobs?.stopContact(input.from);
      } finally {
        if (revoked.sessionId)
          await this.options.sessions.delete(revoked.sessionId);
      }
    }
    let deleteSession: string | null = null;
    let stopped = false;
    let unsubscribeKey: string | null = null;
    const result = await this.store
      .withPhone(phoneHash, async (store) => {
        const record = (await store.load()) ?? this.fresh(phoneHash);
        this.maintain(record);
        if (record.stopped) {
          stopped = true;
          deleteSession = record.sessionId;
          const confirmation = record.stopDelivery;
          if (
            confirmation &&
            (confirmation.status === "queued" ||
              (confirmation.status === "failed" &&
                confirmation.attempts < 3)) &&
            this.matches(input.text, "stop", record.lang)
          ) {
            await this.deliver(store, record, confirmation, input.from);
            return {
              messages: [this.publicMessage(confirmation)],
              stopped: true,
              lang: record.lang,
            };
          }
          return { messages: [], stopped: true, lang: record.lang };
        }
        const key = this.hash(
          JSON.stringify(["sms-inbound", phoneHash, input.id]),
        );
        const fingerprint = this.hash(input.text);
        let receipt = record.state.receipts[key];
        if (receipt && receipt.fingerprint !== fingerprint)
          throw new SmsError("conflict", record.lang);
        if (!receipt) {
          if (record.windowCount >= 30)
            throw new SmsError("rate_limited", record.lang);
          // Bound durable replay metadata without silently discarding valid keys.
          if (Object.keys(record.state.receipts).length >= 10_000)
            throw new SmsError("rate_limited", record.lang);
          record.windowCount += 1;
          if (record.count >= this.limit) {
            await store.save(record);
            throw new SmsError("rate_limited", record.lang);
          }
          const newSession = !record.sessionId;
          if (newSession)
            record.sessionId = await this.options.sessions.create(record.lang);
          const action = newSession
            ? {
                kind: "reply" as const,
                lang: record.lang,
                text: this.text(record.lang, "menu"),
              }
            : this.action(record, input.text);
          receipt = {
            fingerprint,
            createdAt: this.now().getTime(),
            action,
            messageIds: [],
            completed: false,
          };
          record.state.receipts[key] = receipt;
          await store.save(record);
        }
        if (!receipt.completed && receipt.action?.kind === "unsubscribe") {
          unsubscribeKey = key;
          return { messages: [], stopped: false, lang: record.lang };
        }
        if (!receipt.completed)
          await this.execute(store, record, receipt, key, input.from);
        const messages = record.state.outbox.filter((message) =>
          receipt!.messageIds.includes(message.id),
        );
        for (const message of messages)
          await this.deliver(store, record, message, input.from);
        return {
          messages: messages.map((message) => this.publicMessage(message)),
          stopped: false,
          lang: record.lang,
        };
      })
      .catch((error: unknown): SmsInboundResult => {
        if (error instanceof SmsRevokedError)
          return { messages: [], stopped: true, lang: error.lang };
        if (error instanceof SmsBusyError) throw new SmsError("unavailable");
        throw error;
      });
    if (stopped) {
      // P06 sends while holding its subscription lock. Never acquire that lock
      // while holding the SMS lock, or concurrent STOP and alerts could deadlock.
      await this.options.jobs?.stopContact(input.from);
      if (deleteSession) await this.options.sessions.delete(deleteSession);
    }
    if (unsubscribeKey) {
      // P06's subscription lock precedes SMS delivery; release SMS before taking it.
      await this.options.jobs?.stopContact(input.from);
      const key = unsubscribeKey;
      return this.store.withPhone(phoneHash, async (store) => {
        const record = await store.load();
        if (!record || record.stopped)
          return { messages: [], stopped: true, lang: record?.lang ?? "en" };
        const receipt = record.state.receipts[key];
        if (!receipt) throw new SmsError("conflict", record.lang);
        if (!receipt.completed) {
          receipt.action = {
            kind: "reply",
            lang: record.lang,
            text: this.text(record.lang, "jobs_stopped"),
          };
          await store.save(record);
          await this.execute(store, record, receipt, key, input.from);
        }
        const messages = record.state.outbox.filter((message) =>
          receipt.messageIds.includes(message.id),
        );
        for (const message of messages)
          await this.deliver(store, record, message, input.from);
        return {
          messages: messages.map((message) => this.publicMessage(message)),
          stopped: false,
          lang: record.lang,
        };
      });
    }
    return result;
  }
  private action(record: SmsRecord, raw: string): SmsAction {
    const text = raw.trim();
    const lang = record.lang;
    const reply = (key: string): SmsAction => ({
      kind: "reply",
      lang: record.lang,
      text: this.text(record.lang, key),
    });
    if (this.matches(text, "language", lang)) {
      record.state.step = "language";
      delete record.state.continuation;
      return reply("menu");
    }
    if (this.matches(text, "cancel", lang)) {
      record.state.step = "ready";
      delete record.state.jobType;
      delete record.state.region;
      delete record.state.jobLang;
      return reply("cancelled");
    }
    if (record.state.step === "language") {
      const selected = this.language(text);
      if (!selected) return reply("menu");
      record.lang = selected;
      record.state.step = "ready";
      return { kind: "language", lang: selected };
    }
    if (
      (text !== "2" &&
        (this.matches(text, "help", lang) ||
          this.matches(text, "person", lang))) ||
      (text === "2" && record.state.step === "ready")
    ) {
      if (!this.options.callback) {
        record.state.step = "ready";
        return reply("unavailable");
      }
      record.state.step = "callback";
      return reply("callback");
    }
    if (this.matches(text, "jobs", lang)) {
      if (!this.options.jobs) return reply("unavailable");
      record.state.step = "jobs_manage";
      delete record.state.jobType;
      delete record.state.region;
      delete record.state.jobLang;
      return reply("jobs_manage");
    }
    switch (record.state.step) {
      case "jobs_manage":
        if (text === "1") {
          record.state.step = "jobs_type";
          return reply("jobs_type");
        }
        if (text === "2") {
          record.state.step = "ready";
          return { kind: "unsubscribe", lang };
        }
        return reply("jobs_manage");
      case "callback":
        if (
          this.matches(text, "confirm", lang) ||
          normalizeSmsKeyword(text) === "y"
        )
          return { kind: "callback", lang };
        return reply("callback");
      case "jobs_type":
        if (text.length > 100) return reply("invalid");
        if (text !== "0" && !this.matches(text, "all", lang))
          record.state.jobType = text;
        record.state.step = "jobs_region";
        return reply("jobs_region");
      case "jobs_region":
        if (text.length > 100) return reply("invalid");
        if (text !== "0" && !this.matches(text, "all", lang))
          record.state.region = text;
        record.state.step = "jobs_language";
        return reply("jobs_language");
      case "jobs_language": {
        const selected = this.language(text);
        if (!selected) return reply("jobs_language");
        record.state.jobLang = selected;
        record.state.step = "jobs_consent";
        return reply("jobs_consent");
      }
      case "jobs_consent":
        if (
          this.matches(text, "confirm", lang) ||
          normalizeSmsKeyword(text) === "y"
        )
          return {
            kind: "subscribe",
            lang: record.state.jobLang ?? lang,
            ...(record.state.jobType ? { jobType: record.state.jobType } : {}),
            ...(record.state.region ? { region: record.state.region } : {}),
          };
        return reply("jobs_consent");
    }
    if (text === "1") {
      const page = record.state.continuation?.pages.shift();
      if (!record.state.continuation?.pages.length)
        delete record.state.continuation;
      return page ? { kind: "reply", lang, text: page } : reply("no_more");
    }
    return { kind: "ask", lang, text };
  }
  private language(text: string): string | undefined {
    return ({ "1": "en", "2": "am", "3": "om" } as Record<string, string>)[
      text
    ];
  }
  private async execute(
    store: SmsLockedStore,
    record: SmsRecord,
    receipt: SmsReceipt,
    key: string,
    from: string,
  ): Promise<void> {
    if (await store.isStopped()) throw new SmsRevokedError(record.lang);
    const action = receipt.action!;
    let text: string;
    if (action.kind === "language") {
      await this.options.sessions.setLanguage(record.sessionId!, action.lang);
      text = this.text(action.lang, "welcome");
    } else if (action.kind === "ask") {
      try {
        text = await this.options.ask({
          sessionId: record.sessionId!,
          lang: action.lang,
          text: action.text!,
          clientMsgId: key,
        });
      } catch {
        if (await store.isStopped()) throw new SmsRevokedError(record.lang);
        throw new SmsError("unavailable", action.lang);
      }
    } else if (action.kind === "callback") {
      if (!this.options.callback) text = this.text(action.lang, "unavailable");
      else {
        await store.recordCallbackConsent(this.hash(`callback-consent:${key}`));
        try {
          if (await store.isStopped()) throw new SmsRevokedError(record.lang);
          await this.options.callback({
            from,
            sessionId: record.sessionId!,
            lang: action.lang,
            idempotencyKey: `sms-callback:${key}`,
          });
          text = this.text(action.lang, "callback_sent");
        } catch (error) {
          if (error instanceof SmsRevokedError) throw error;
          throw new SmsError("unavailable", action.lang);
        }
      }
      record.state.step = "ready";
    } else if (action.kind === "subscribe") {
      if (!this.options.jobs) text = this.text(record.lang, "unavailable");
      else {
        try {
          if (await store.isStopped()) throw new SmsRevokedError(record.lang);
          const subscription = await this.options.jobs.subscribe({
            sessionId: record.sessionId!,
            clientRequestId: key,
            lang: action.lang,
            channel: "sms",
            contact: from,
            consent: { accepted: true, noticeVersion: "job-alerts-v1" },
            ...(action.jobType ? { jobType: action.jobType } : {}),
            ...(action.region ? { region: action.region } : {}),
          });
          text = this.text(
            record.lang,
            subscription.status === "active" ? "jobs_active" : "jobs_stopped",
          );
        } catch (error) {
          if (error instanceof SmsRevokedError) throw error;
          throw new SmsError("unavailable", record.lang);
        }
      }
      record.state.step = "ready";
      delete record.state.jobType;
      delete record.state.region;
      delete record.state.jobLang;
    } else text = action.text!;
    const pages = paginateSms(
      text.slice(0, 24_000),
      action.lang,
      this.text(action.lang, "more"),
      3,
      10,
    );
    if (pages.length > 1)
      record.state.continuation = {
        sessionId: record.sessionId!,
        pages: pages.slice(1),
        expiresAt: this.now().getTime() + 15 * 60_000,
      };
    else if (action.kind === "ask") delete record.state.continuation;
    const message = this.enqueue(
      record,
      pages[0] ?? this.text(action.lang, "error"),
      action.lang,
      `sms:${key}`,
    );
    receipt.messageIds = [message.id];
    receipt.action = null;
    receipt.completed = true;
    await store.save(record);
  }
  private enqueue(
    record: SmsRecord,
    text: string,
    lang: string,
    id: string,
    stop = false,
  ): SmsOutbox {
    if (!stop && record.count >= this.limit)
      throw new SmsError("rate_limited", record.lang);
    const normalized = normalizeForSms(text);
    const count = countSms(normalized);
    const message: SmsOutbox = {
      id,
      text: normalized,
      lang,
      encoding: count.encoding,
      units: count.units,
      segments: count.segments,
      status: "queued",
      attempts: 0,
      createdAt: this.now().getTime(),
    };
    record.state.outbox.push(message);
    record.count += 1;
    return message;
  }
  private async deliver(
    store: SmsLockedStore,
    record: SmsRecord,
    message: SmsOutbox,
    to: string,
  ): Promise<void> {
    if (
      message.status === "delivered" ||
      message.status === "sent" ||
      (message.status === "failed" && message.attempts >= 3)
    )
      return;
    while (message.attempts < 3) {
      if (!record.stopped && (await store.isStopped()))
        throw new SmsRevokedError(record.lang);
      message.attempts += 1;
      await store.save(record);
      try {
        const response = await this.options.gateway.send(to, message.text, {
          lang: message.lang,
          idempotencyKey: message.id,
        });
        message.gatewayId = response.id;
        message.status = await this.options.gateway.status(response.id);
        await store.save(record);
        if (message.status !== "failed") return;
      } catch (error) {
        if (error instanceof SmsRevokedError) throw error;
        message.status = "failed";
        await store.save(record);
      }
    }
    if (message.status === "queued") {
      message.status = "failed";
      await store.save(record);
    }
  }
  private publicMessage(message: SmsOutbox): SmsMessage {
    return {
      id: message.id,
      text: message.text,
      encoding: message.encoding,
      units: message.units,
      segments: message.segments,
      status: message.status,
    };
  }
  /** P06 supplies one daily digest; this adapter shares the reply cap and ledger. */
  async sendAlert(input: {
    contact: string;
    text: string;
    lang: string;
    idempotencyKey: string;
  }): Promise<void> {
    if (
      !/^\+[1-9]\d{6,14}$/u.test(input.contact) ||
      !input.idempotencyKey ||
      !input.text
    )
      throw new SmsError("invalid", input.lang);
    const hash = this.cipher.hash("sms", input.contact);
    await this.store
      .withPhone(hash, async (store) => {
        const record = (await store.load()) ?? this.fresh(hash);
        this.maintain(record);
        if (record.stopped) throw new SmsError("unavailable", record.lang);
        const key = this.hash(
          JSON.stringify(["alert", hash, input.idempotencyKey]),
        );
        const id = `sms-alert:${key}`;
        const fingerprint = this.hash(JSON.stringify([input.lang, input.text]));
        let receipt = record.state.receipts[key];
        if (receipt && receipt.fingerprint !== fingerprint)
          throw new SmsError("conflict", input.lang);
        let message = record.state.outbox.find(
          (candidate) => candidate.id === id,
        );
        if (receipt && !message) {
          if (receipt.outcome === "failed" || !receipt.outcome)
            throw new SmsError("delivery_failed", input.lang);
          return;
        }
        if (!message) {
          if (!record.sessionId) {
            record.lang = input.lang;
            record.sessionId = await this.options.sessions.create(input.lang);
            record.state.step = "ready";
          }
          const pages = paginateSms(
            input.text.slice(0, 24_000),
            input.lang,
            this.text(input.lang, "more"),
            3,
            10,
          );
          if (pages.length > 1)
            record.state.continuation = {
              sessionId: record.sessionId,
              pages: pages.slice(1),
              expiresAt: this.now().getTime() + 15 * 60_000,
            };
          message = this.enqueue(record, pages[0]!, input.lang, id);
          receipt = {
            fingerprint,
            createdAt: this.now().getTime(),
            action: null,
            completed: true,
            messageIds: [id],
          };
          record.state.receipts[key] = receipt;
          await store.save(record);
        }
        await this.deliver(store, record, message, input.contact);
        if (receipt) {
          receipt.outcome = message.status;
          await store.save(record);
        }
        if (message.status === "failed")
          throw new SmsError("delivery_failed", input.lang);
      })
      .catch((error: unknown) => {
        if (error instanceof SmsRevokedError || error instanceof SmsBusyError)
          throw new SmsError("unavailable", input.lang);
        throw error;
      });
  }
}
