import { ContactCipher } from "@dimts/jobs";
import { formatTelegramReply } from "./format.js";
import { parseTelegramUpdate, type TelegramInbound } from "./updates.js";
import type { TelegramButton } from "./transport.js";
import { PostgresTelegramStore, emptyTelegramState } from "./store.js";
import type { TelegramStore, TelegramLockedStore } from "./store.js";
import type { TelegramServiceOptions, TelegramRecord } from "./types.js";

export class TelegramService {
  private readonly options: TelegramServiceOptions;
  private readonly cipher: ContactCipher;
  private readonly store: TelegramStore;
  private readonly now: () => Date;
  constructor(options: TelegramServiceOptions) {
    this.options = options;
    this.cipher = new ContactCipher(options.encryptionKey, options.hashKey);
    this.now = options.now ?? (() => new Date());
    if (!options.store && !options.pool)
      throw new Error("Telegram store required");
    this.store =
      options.store ??
      new PostgresTelegramStore(
        options.pool!,
        options.encryptionKey,
        options.hashKey,
        options.revocationPool,
      );
    if (!options.languages.some((l) => l.code === "en"))
      throw new Error("Default language required");
  }
  private copy(
    lang: string,
    key: string,
    params: Record<string, string> = {},
  ): string {
    let text =
      this.options.locales(lang)["telegram." + key] ??
      this.options.locales("en")["telegram." + key];
    if (!text) throw new Error("Missing Telegram locale key");
    for (const [name, value] of Object.entries(params))
      text = text.replaceAll("{" + name + "}", value);
    return text;
  }
  private button(lang: string, key: string, data: string): TelegramButton {
    return { text: this.copy(lang, "button_" + key), data };
  }
  private hash(chatId: string): string {
    return this.cipher.hash("telegram", chatId);
  }
  private async send(
    chatId: string,
    key: string,
    text: string,
    buttons?: TelegramButton[][],
  ): Promise<void> {
    if (!(await this.store.claimDelivery(this.hash(chatId), key))) return;
    const status = await this.options.transport.send({
      chatId,
      key,
      text,
      ...(buttons ? { buttons } : {}),
    });
    if (status !== "sent") throw new Error("Telegram delivery unavailable");
  }
  private blank(hash: string): TelegramRecord {
    const now = this.now().getTime();
    return {
      contactHash: hash,
      sessionId: null,
      lang: "en",
      stopped: false,
      lastUpdate: -1,
      windowAt: now,
      windowCount: 0,
      expiresAt: now + 86400000,
      state: emptyTelegramState(),
    };
  }
  async handleUpdate(raw: unknown): Promise<void> {
    const update = parseTelegramUpdate(raw);
    if (update) await this.handle(update);
  }
  async handle(update: TelegramInbound): Promise<void> {
    const hash = this.hash(update.chatId);
    const command =
      update.kind === "text" ? update.text.trim().toLowerCase() : "";
    if (
      command === "/stop" ||
      (update.kind === "callback" && update.data === "jobs:stop")
    ) {
      await this.stop(update.chatId, update.updateId);
      return;
    }
    await this.store.withContact(hash, async (locked) => {
      const record = (await locked.load()) ?? this.blank(hash);
      const now = this.now().getTime();
      if (record.expiresAt <= now) {
        record.state = emptyTelegramState();
        record.lastUpdate = -1;
        record.replayCutoff = -1;
      }
      if (update.updateId <= (record.replayCutoff ?? -1)) return;
      record.lastUpdate = Math.max(record.lastUpdate, update.updateId);
      record.expiresAt = now + 86400000;
      if (now - record.windowAt >= 60000) {
        record.windowAt = now;
        record.windowCount = 0;
      }
      // Commit the receipt before every provider, helper or subscription effect.
      await locked.save(record);
      const receiptPrefix =
        command === "/privacy" ||
        (update.kind === "callback" && update.data.startsWith("privacy:"))
          ? "privacy-update:"
          : "update:";
      if (
        !(await this.store.claimDelivery(hash, receiptPrefix + update.updateId))
      )
        return;
      record.windowCount += 1;
      await locked.save(record);
      const key = "telegram:update:" + update.updateId;
      const reply = (
        name: string,
        buttons?: TelegramButton[][],
        params?: Record<string, string>,
      ) =>
        this.send(
          update.chatId,
          key + ":" + name,
          this.copy(record.lang, name, params),
          buttons,
        );
      if (
        record.windowCount > (this.options.perMinuteLimit ?? 20) &&
        command !== "/privacy" &&
        !(update.kind === "callback" && update.data.startsWith("privacy:"))
      ) {
        await reply("rate_limit");
        return;
      }
      try {
        const firstContact = record.sessionId === null;
        const session = await this.options.sessions.ensure({
          contactHash: hash,
          lang: record.lang,
        });
        if (record.sessionId && record.sessionId !== session.id)
          record.state = emptyTelegramState();
        record.sessionId = session.id;
        record.lang = session.lang;
        await locked.save(record);
        if (firstContact) await reply("privacy");
        if (record.state.helpRequestId)
          await this.options.help?.bind?.({
            sessionId: session.id,
            chatId: update.chatId,
            requestId: record.state.helpRequestId,
          });
        if (update.kind === "callback") {
          await this.callback(update, record, locked, key);
          return;
        }
        if (update.kind === "voice") {
          await this.voice(update, record, locked, key);
          return;
        }
        if (update.kind !== "text") {
          await reply("unsupported");
          return;
        }
        if (command.startsWith("/")) {
          if (command === "/start") {
            await this.endHelp(record);
            record.state = {
              ...emptyTelegramState(),
              ...(record.state.simple ? { simple: true } : {}),
            };
            await locked.save(record);
            await reply("welcome", [
              [this.button(record.lang, "audio", "audio:toggle")],
            ]);
            await reply("privacy");
            await this.languageMenu(update.chatId, key, record.lang);
            return;
          }
          if (command === "/language") {
            await this.languageMenu(update.chatId, key, record.lang);
            return;
          }
          if (command === "/privacy") {
            await reply("privacy", [
              [this.button(record.lang, "delete", "privacy:delete")],
            ]);
            return;
          }
          if (command === "/simple") {
            record.state.simple = !record.state.simple;
            await locked.save(record);
            await reply(record.state.simple ? "simple_on" : "simple_off");
            return;
          }
          if (command === "/help") {
            if (!this.options.help) {
              await reply("help_unavailable");
              return;
            }
            record.state.step = "ready";
            delete record.state.jobType;
            delete record.state.region;
            delete record.state.jobLang;
            delete record.state.voice;
            if (!record.state.helpRequestId)
              record.state.helpRequestId = await this.options.help.start({
                sessionId: session.id,
                chatId: update.chatId,
              });
            await locked.save(record);
            await reply("help_waiting", [
              [this.button(record.lang, "endhelp", "help:end")],
            ]);
            return;
          }
          if (command === "/endhelp") {
            await this.endHelp(record);
            await locked.save(record);
            await reply("help_ended");
            return;
          }
          if (command === "/jobs") {
            await this.jobs(update.chatId, record, key);
            return;
          }
          await reply("error");
          return;
        }
        if (
          record.state.step === "jobs_type" ||
          record.state.step === "jobs_region"
        ) {
          const value = update.text.trim();
          if (value.length > 100 || !value) {
            await reply("error");
            return;
          }
          if (record.state.step === "jobs_type") {
            if (this.isAll(record.lang, value)) delete record.state.jobType;
            else record.state.jobType = value;
            record.state.step = "jobs_region";
            await locked.save(record);
            await reply("jobs_region", [
              [this.button(record.lang, "cancel", "cancel")],
            ]);
            return;
          }
          if (this.isAll(record.lang, value)) delete record.state.region;
          else record.state.region = value;
          record.state.step = "jobs_language";
          await locked.save(record);
          await reply(
            "jobs_language",
            this.options.languages.map((l) => [
              {
                text: Array.from(l.label).slice(0, 20).join(""),
                data: "jobs:language:" + l.code,
              },
            ]),
          );
          return;
        }
        if (record.state.step !== "ready") {
          await reply("error");
          return;
        }
        await this.answer(update.chatId, update.text, record, key);
      } catch {
        const current = await locked.load();
        if (current && (current.replayCutoff ?? -1) >= update.updateId) return;
        await reply("error");
      }
    });
  }
  private async languageMenu(
    chatId: string,
    key: string,
    lang: string,
  ): Promise<void> {
    await this.send(
      chatId,
      key + ":language",
      this.copy(lang, "language"),
      this.options.languages.map((l) => [
        {
          text: Array.from(l.label).slice(0, 20).join(""),
          data: "language:" + l.code,
        },
      ]),
    );
  }
  private async callback(
    update: Extract<TelegramInbound, { kind: "callback" }>,
    record: TelegramRecord,
    locked: TelegramLockedStore,
    key: string,
  ): Promise<void> {
    const { data, chatId } = update;
    const lang = record.lang;
    const reply = (
      name: string,
      buttons?: TelegramButton[][],
      params?: Record<string, string>,
    ) =>
      this.send(
        chatId,
        key + ":" + name,
        this.copy(record.lang, name, params),
        buttons,
      );
    if (data === "audio:toggle") {
      record.state.readAloud = !record.state.readAloud;
      await locked.save(record);
      await reply(record.state.readAloud ? "read_aloud_on" : "read_aloud_off");
      return;
    }
    if (data.startsWith("language:")) {
      const value = data.slice(9);
      if (!this.options.languages.some((l) => l.code === value)) {
        await reply("error");
        return;
      }
      await this.options.sessions.setLanguage(record.sessionId!, value);
      record.lang = value;
      await locked.save(record);
      await reply("language_saved");
      await this.send(
        chatId,
        key + ":language:privacy",
        this.copy(record.lang, "privacy"),
      );
      return;
    }
    if (data === "help:end") {
      await this.endHelp(record);
      await locked.save(record);
      await reply("help_ended");
      return;
    }
    if (data === "privacy:delete") {
      record.state.step = "delete_confirm";
      await locked.save(record);
      await reply("delete_confirm", [
        [
          this.button(lang, "confirm", "privacy:confirm"),
          this.button(lang, "cancel", "cancel"),
        ],
      ]);
      return;
    }
    if (data === "privacy:confirm" && record.state.step === "delete_confirm") {
      await this.store.revoke(record.contactHash, this.now());
      this.options.transport.cancelContact?.(chatId);
      await this.options.jobs?.stopContact({
        channel: "telegram",
        contact: chatId,
      });
      await this.endHelp(record);
      await this.options.sessions.delete(record.sessionId!);
      await locked.clear();
      await this.send(chatId, key + ":deleted", this.copy(lang, "deleted"));
      return;
    }
    if (data === "cancel" || data === "jobs:decline") {
      const simple = record.state.simple;
      record.state = {
        ...record.state,
        step: "ready",
        ...(simple ? { simple: true } : {}),
      };
      delete record.state.jobType;
      delete record.state.region;
      delete record.state.jobLang;
      delete record.state.voice;
      await locked.save(record);
      await reply("welcome");
      return;
    }
    if (data.startsWith("voice:")) {
      const [_, action, id] = data.split(":");
      void _;
      const pending = record.state.voice;
      if (
        !pending ||
        pending.id !== Number(id) ||
        pending.expiresAt <= this.now().getTime()
      ) {
        delete record.state.voice;
        await locked.save(record);
        await reply("voice_expired");
        return;
      }
      delete record.state.voice;
      await locked.save(record);
      if (action === "retry") {
        await reply("voice_retry");
        return;
      }
      if (action === "send") {
        await this.answer(chatId, pending.text, record, key);
        return;
      }
      await reply("error");
      return;
    }
    if (data.startsWith("jobs:")) {
      if (!this.options.jobs) {
        await reply("jobs_unavailable");
        return;
      }
      if (await locked.isStopped()) {
        await reply("jobs_stopped");
        return;
      }
      if (data === "jobs:create") {
        record.state.step = "jobs_type";
        record.state.flowId = update.updateId;
        delete record.state.jobType;
        delete record.state.region;
        delete record.state.jobLang;
        await locked.save(record);
        await reply("jobs_type", [
          [this.button(record.lang, "cancel", "cancel")],
        ]);
        return;
      }
      if (
        data.startsWith("jobs:language:") &&
        record.state.step === "jobs_language"
      ) {
        const value = data.slice(14);
        if (!this.options.languages.some((l) => l.code === value)) {
          await reply("error");
          return;
        }
        record.state.jobLang = value;
        record.state.step = "jobs_review";
        await locked.save(record);
        await reply(
          "jobs_review",
          [
            [
              this.button(lang, "review", "jobs:review:" + record.state.flowId),
              this.button(lang, "cancel", "cancel"),
            ],
          ],
          {
            type:
              record.state.jobType ??
              this.options.locales(lang)["jobs.all"] ??
              this.options.locales("en")["jobs.all"] ??
              "",
            region:
              record.state.region ??
              this.options.locales(lang)["jobs.all"] ??
              this.options.locales("en")["jobs.all"] ??
              "",
            language: this.options.languages.find((l) => l.code === value)!
              .label,
          },
        );
        return;
      }
      if (
        data === "jobs:review:" + record.state.flowId &&
        record.state.step === "jobs_review"
      ) {
        record.state.step = "jobs_consent";
        await locked.save(record);
        await reply("jobs_consent", [
          [
            this.button(lang, "consent", "jobs:consent:" + record.state.flowId),
            this.button(lang, "decline", "jobs:decline"),
          ],
        ]);
        return;
      }
      if (
        data === "jobs:consent:" + record.state.flowId &&
        record.state.step === "jobs_consent"
      ) {
        record.state.step = "jobs_confirm";
        await locked.save(record);
        await reply(
          "jobs_review",
          [
            [
              this.button(
                lang,
                "confirm",
                "jobs:confirm:" + record.state.flowId,
              ),
              this.button(lang, "cancel", "cancel"),
            ],
          ],
          {
            type:
              record.state.jobType ??
              this.options.locales(lang)["jobs.all"] ??
              this.options.locales("en")["jobs.all"] ??
              "",
            region:
              record.state.region ??
              this.options.locales(lang)["jobs.all"] ??
              this.options.locales("en")["jobs.all"] ??
              "",
            language:
              this.options.languages.find(
                (l) => l.code === record.state.jobLang,
              )?.label ?? lang,
          },
        );
        return;
      }
      if (
        data === "jobs:confirm:" + record.state.flowId &&
        record.state.step === "jobs_confirm"
      ) {
        const result = await this.options.jobs.subscribe({
          sessionId: record.sessionId!,
          clientRequestId: "telegram:" + record.state.flowId,
          lang: record.state.jobLang ?? lang,
          channel: "telegram",
          contact: chatId,
          consent: { accepted: true, noticeVersion: "job-alerts-v1" },
          ...(record.state.jobType ? { jobType: record.state.jobType } : {}),
          ...(record.state.region ? { region: record.state.region } : {}),
        });
        // A concurrent STOP may have completed while P06 held its transaction.
        const stopped = await locked.isStopped();
        if (stopped)
          await this.options.jobs.stopContact({
            channel: "telegram",
            contact: chatId,
          });
        record.state = { ...record.state, step: "ready" };
        delete record.state.jobType;
        delete record.state.region;
        delete record.state.jobLang;
        await locked.save(record);
        await reply(
          stopped || result.status === "stopped"
            ? "jobs_stopped"
            : "jobs_active",
          [[this.button(lang, "stop", "jobs:stop")]],
        );
        return;
      }
    }
    await reply("error");
  }
  private isAll(lang: string, value: string): boolean {
    return [
      "all",
      "0",
      this.options.locales(lang)["jobs.all"]?.toLowerCase(),
    ].includes(value.toLowerCase());
  }
  private async endHelp(record: TelegramRecord): Promise<void> {
    if (record.state.helpRequestId)
      await this.options.help?.end({
        sessionId: record.sessionId!,
        requestId: record.state.helpRequestId,
      });
    delete record.state.helpRequestId;
    record.state.step = "ready";
  }
  private async jobs(
    chatId: string,
    record: TelegramRecord,
    key: string,
  ): Promise<void> {
    const jobs = this.options.jobs;
    if (!jobs) {
      await this.send(
        chatId,
        key + ":jobs",
        this.copy(record.lang, "jobs_unavailable"),
      );
      return;
    }
    const postings = await jobs.listJobs({ lang: record.lang });
    const subscriptions = await jobs.listSubscriptions({
      sessionId: record.sessionId!,
    });
    const active = subscriptions.some(
      (s) => s.channel === "telegram" && s.status === "active",
    );
    const text = postings.length
      ? this.copy(record.lang, "jobs_intro") +
        "\n\n" +
        (this.options.renderJobs?.({
          lang: record.lang,
          jobs: postings.slice(0, 5),
        }) ??
          postings
            .slice(0, 5)
            .map((j) => [j.title, j.organization, j.location, j.url].join("\n"))
            .join("\n\n"))
      : this.copy(record.lang, "jobs_empty");
    if (record.stopped) {
      await this.send(
        chatId,
        key + ":jobs",
        text + "\n\n" + this.copy(record.lang, "jobs_stopped"),
      );
      return;
    }
    await this.send(chatId, key + ":jobs", text, [
      [
        this.button(
          record.lang,
          active ? "stop" : "alerts",
          active ? "jobs:stop" : "jobs:create",
        ),
      ],
    ]);
  }
  private async answer(
    chatId: string,
    text: string,
    record: TelegramRecord,
    key: string,
  ): Promise<void> {
    if (record.state.helpRequestId && this.options.help) {
      const sent = await this.options.help.relay({
        sessionId: record.sessionId!,
        chatId,
        requestId: record.state.helpRequestId,
        text,
        key,
      });
      if (sent) {
        await this.send(
          chatId,
          key + ":relay",
          this.copy(record.lang, "help_sent"),
        );
        return;
      }
      delete record.state.helpRequestId;
    }
    if (Array.from(text).length > 1000) {
      await this.send(
        chatId,
        key + ":too_long",
        this.copy(record.lang, "too_long"),
      );
      return;
    }
    const response = await this.options.ask({
      sessionId: record.sessionId!,
      lang: record.lang,
      text,
      clientMsgId: key,
      simple: record.state.simple ?? false,
    });
    if (
      !(await this.store.isSessionCurrent(
        record.contactHash,
        record.sessionId!,
      ))
    )
      return;
    const equivalentText = formatTelegramReply(response);
    if (
      record.state.readAloud &&
      this.options.voice?.supported(record.lang).tts
    ) {
      try {
        const audio = await this.options.voice.synthesize(
          equivalentText,
          record.lang,
        );
        try {
          if (
            await this.store.claimDelivery(record.contactHash, key + ":audio")
          ) {
            const status = await this.options.transport.sendAudio({
              chatId,
              key: key + ":answer",
              equivalentText,
              ...audio,
            });
            if (status !== "sent") {
              await this.send(
                chatId,
                key + ":tts",
                this.copy(record.lang, "tts_unavailable"),
              );
              return;
            }
          }
        } finally {
          audio.audio.fill(0);
        }
        return;
      } catch {
        await this.send(chatId, key + ":answer", equivalentText);
        await this.send(
          chatId,
          key + ":tts",
          this.copy(record.lang, "tts_unavailable"),
        );
        return;
      }
    }
    await this.send(chatId, key + ":answer", equivalentText);
    if (record.state.readAloud)
      await this.send(
        chatId,
        key + ":tts",
        this.copy(record.lang, "tts_unavailable"),
      );
  }
  private async voice(
    update: Extract<TelegramInbound, { kind: "voice" }>,
    record: TelegramRecord,
    locked: TelegramLockedStore,
    key: string,
  ): Promise<void> {
    const voice = this.options.voice;
    if (!voice?.supported(record.lang).stt) {
      await this.send(
        update.chatId,
        key + ":voice",
        this.copy(record.lang, "voice_unavailable"),
      );
      return;
    }
    const text = await voice.transcribe(
      {
        file_id: update.fileId,
        duration: update.duration,
        ...(update.fileSize === undefined
          ? {}
          : { file_size: update.fileSize }),
        ...(update.mimeType ? { mime_type: update.mimeType } : {}),
      },
      record.lang,
    );
    if (!record.stopped && (await locked.isStopped())) return;
    if (Array.from(text).length > 1000) {
      await this.send(
        update.chatId,
        key + ":too_long",
        this.copy(record.lang, "too_long"),
      );
      return;
    }
    if (!text.trim()) throw new Error("Invalid transcript");
    record.state.voice = {
      text,
      id: update.updateId,
      expiresAt: this.now().getTime() + 86400000,
    };
    await locked.save(record);
    if (!record.state.voice) return;
    await this.send(
      update.chatId,
      key + ":voice",
      this.copy(record.lang, "voice_review", { text }),
      [
        [
          this.button(record.lang, "send", "voice:send:" + update.updateId),
          this.button(record.lang, "retry", "voice:retry:" + update.updateId),
        ],
      ],
    );
  }
  private async stop(chatId: string, cutoff?: number): Promise<void> {
    const hash = this.hash(chatId);
    const { lang, sessionId } = await this.store.revoke(
      hash,
      this.now(),
      cutoff,
    );
    this.options.transport.cancelContact?.(chatId);
    try {
      await this.options.jobs?.stopContact({
        channel: "telegram",
        contact: chatId,
      });
      if (sessionId) await this.options.help?.stopSession?.(sessionId);
    } catch {
      await this.send(chatId, "telegram:stop:error", this.copy(lang, "error"));
      throw new Error("Telegram alert deletion unavailable");
    }
    await this.send(chatId, "telegram:stop", this.copy(lang, "stopped"));
  }
  async sendHelper(input: {
    chatId: string;
    sessionId: string;
    requestId: string;
    text: string;
    key: string;
  }): Promise<void> {
    await this.send(input.chatId, input.key, input.text);
  }
  async sendAlert(input: {
    contact: string;
    text: string;
    lang: string;
    idempotencyKey: string;
  }): Promise<void> {
    const hash = this.hash(input.contact);
    await this.store.withContact(hash, async (locked) => {
      const record = (await locked.load()) ?? this.blank(hash);
      if (record.stopped) return;
      record.lang = input.lang;
      await locked.save(record);
      if (!(await this.store.claimDelivery(hash, input.idempotencyKey))) return;
      const status = await this.options.transport.send({
        chatId: input.contact,
        key: input.idempotencyKey,
        text: input.text,
        buttons: [[this.button(input.lang, "stop", "jobs:stop")]],
      });
      if (status !== "sent") throw new Error("Telegram delivery unavailable");
    });
  }
}
