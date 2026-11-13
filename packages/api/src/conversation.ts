import { randomBytes } from "node:crypto";
import { ask, detectConversationRule } from "@dimts/engine";
import type { AskDependencies } from "@dimts/engine";
import { translate } from "@dimts/locales-tools";
import type { LangPack } from "@dimts/locales-tools";
import type { z } from "zod";
import type { ApiConfig } from "./config.js";
import { AskRequestSchema, ReplySchema } from "./schemas.js";
import type { ApiReply, ApiRepository } from "./types.js";

export class ConversationError extends Error {
  readonly code: "rate_limited" | "conflict";
  constructor(code: "rate_limited" | "conflict") {
    super(code);
    this.name = "ConversationError";
    this.code = code;
  }
}

function isSmallTalk(pack: LangPack | undefined, text: string): boolean {
  const values = pack?.prompts.small_talk;
  if (!Array.isArray(values)) return false;
  const normalized = text
    .trim()
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim();
  return values.some((value) => {
    if (typeof value !== "string") return false;
    const phrase = value
      .toLocaleLowerCase()
      .replace(/[\p{P}\p{S}]+/gu, " ")
      .trim();
    return normalized === phrase || normalized.startsWith(`${phrase} `);
  });
}

function validateReply(value: unknown): ApiReply {
  const parsed = ReplySchema.safeParse(value);
  if (!parsed.success) throw new Error("API response schema validation failed");
  return parsed.data;
}

function createReply(
  packs: Map<string, LangPack>,
  lang: string,
  kind: ApiReply["kind"],
  key: string,
  actionKey?: string,
): ApiReply {
  const translated = translate(packs, lang, key);
  const actionText = actionKey
    ? translate(packs, lang, actionKey).text
    : undefined;
  return validateReply({
    id: randomBytes(16).toString("base64url"),
    kind,
    text: translated.text,
    lang,
    dir:
      packs.get(lang)?.meta.dir ??
      packs.get(translated.usedLang)?.meta.dir ??
      "ltr",
    citations: [],
    actions: actionText ? [{ type: "help", label: actionText }] : [],
    contentVersion: "unavailable",
  });
}

/** Shared application boundary: every channel keeps the same replay, consent,
 * small-talk, rules, grounding and provider path as the web ask endpoint. */
export function createConversationService(options: {
  config: ApiConfig;
  repository: ApiRepository;
  packs: Map<string, LangPack>;
  askDependencies?: AskDependencies;
}) {
  const { config, repository, packs, askDependencies } = options;
  return async (body: z.infer<typeof AskRequestSchema>): Promise<ApiReply> => {
    const existing = await repository.findReply(
      body.sessionId,
      body.clientMsgId,
    );
    if (existing) return validateReply(existing);
    if ((await repository.countRecentQuestions(body.sessionId)) >= 20)
      throw new ConversationError("rate_limited");
    if (!(await repository.claimQuestion(body))) {
      const concurrent = await repository.findReply(
        body.sessionId,
        body.clientMsgId,
      );
      if (concurrent) return validateReply(concurrent);
      throw new ConversationError("conflict");
    }
    try {
      const rules = askDependencies?.rulesFor?.(body.lang);
      const isGreeting =
        (!rules || !detectConversationRule(body.text, body.lang, rules)) &&
        isSmallTalk(packs.get(body.lang), body.text);
      const thanks = /\b(?:thanks?|thank you)\b/iu.test(body.text);
      const consent =
        !isGreeting && askDependencies
          ? await repository.getCloudConsent(body.sessionId)
          : null;
      const reply = isGreeting
        ? createReply(
            packs,
            body.lang,
            "system",
            thanks ? "smallTalk.thanks" : "smallTalk.hello",
          )
        : askDependencies
          ? ReplySchema.parse(
              await ask(body, askDependencies, {
                cloudOk: Boolean(
                  consent?.cloudOk &&
                  consent.consentVersion === config.DIMTS_AI_CONSENT_VERSION,
                ),
              }),
            )
          : createReply(
              packs,
              body.lang,
              "notfound",
              "answer.notfound",
              "help.button",
            );
      await repository.saveReply({
        sessionId: body.sessionId,
        clientMsgId: body.clientMsgId,
        reply,
      });
      return reply;
    } catch (error) {
      await repository.releaseQuestion(body.sessionId, body.clientMsgId);
      throw error;
    }
  };
}
