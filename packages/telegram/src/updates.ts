import { z } from "zod";

const integer = z.number().int().safe();
const positiveId = integer.positive();
const user = z
  .object({
    id: positiveId,
    is_bot: z.boolean(),
    first_name: z.string().max(256).optional(),
    last_name: z.string().max(256).optional(),
    username: z.string().max(64).optional(),
    language_code: z.string().max(35).optional(),
    is_premium: z.boolean().optional(),
    added_to_attachment_menu: z.boolean().optional(),
  })
  .strict();
const chat = z
  .object({
    id: integer,
    type: z.enum(["private", "group", "supergroup", "channel"]),
    first_name: z.string().max(256).optional(),
    last_name: z.string().max(256).optional(),
    username: z.string().max(64).optional(),
    title: z.string().max(256).optional(),
    is_forum: z.boolean().optional(),
    is_direct_messages: z.boolean().optional(),
  })
  .strict();
const file = z.object({
  file_id: z.string().min(1).max(256),
  file_unique_id: z.string().max(256).optional(),
  file_size: integer.nonnegative().optional(),
});
const entity = z
  .object({
    type: z.string().min(1).max(64),
    offset: integer.nonnegative(),
    length: integer.nonnegative(),
    url: z.string().max(4096).optional(),
    user: user.optional(),
    language: z.string().max(64).optional(),
    custom_emoji_id: z.string().max(128).optional(),
    unix_time: integer.optional(),
    date_time_format: z.string().max(64).optional(),
  })
  .strict();
const message = z
  .object({
    message_id: positiveId,
    date: integer.nonnegative().optional(),
    chat,
    from: user.optional(),
    text: z.string().min(1).max(4096).optional(),
    entities: z.array(entity).max(100).optional(),
    voice: file
      .extend({
        duration: integer.min(0).max(86400),
        mime_type: z.string().max(128).optional(),
      })
      .strict()
      .optional(),
    photo: z
      .array(
        file
          .extend({ width: integer.positive(), height: integer.positive() })
          .strict(),
      )
      .max(10)
      .optional(),
    caption: z.string().max(2048).optional(),
    caption_entities: z.array(entity).max(100).optional(),
    // Supported upstream metadata is discarded, never stored or passed to the engine.
    document: z.unknown().optional(),
    audio: z.unknown().optional(),
    video: z.unknown().optional(),
    video_note: z.unknown().optional(),
    sticker: z.unknown().optional(),
    animation: z.unknown().optional(),
    contact: z.unknown().optional(),
    location: z.unknown().optional(),
    venue: z.unknown().optional(),
    poll: z.unknown().optional(),
    dice: z.unknown().optional(),
    reply_to_message: z.unknown().optional(),
    reply_markup: z.unknown().optional(),
    forward_origin: z.unknown().optional(),
    external_reply: z.unknown().optional(),
    quote: z.unknown().optional(),
    media_group_id: z.string().max(256).optional(),
    edit_date: integer.nonnegative().optional(),
    via_bot: user.optional(),
    has_protected_content: z.boolean().optional(),
    is_automatic_forward: z.boolean().optional(),
    message_thread_id: integer.optional(),
    business_connection_id: z.string().max(256).optional(),
  })
  .strict();
const callback = z
  .object({
    id: z.string().min(1).max(256),
    from: user,
    message: message.optional(),
    inline_message_id: z.string().max(256).optional(),
    chat_instance: z.string().max(256).optional(),
    data: z
      .string()
      .min(1)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 64)
      .optional(),
    game_short_name: z.string().max(256).optional(),
  })
  .strict();

export const TelegramUpdateSchema = z
  .object({
    update_id: integer.nonnegative(),
    message: message.optional(),
    callback_query: callback.optional(),
    edited_message: z.unknown().optional(),
    channel_post: z.unknown().optional(),
    edited_channel_post: z.unknown().optional(),
    my_chat_member: z.unknown().optional(),
    chat_member: z.unknown().optional(),
    chat_join_request: z.unknown().optional(),
    inline_query: z.unknown().optional(),
    chosen_inline_result: z.unknown().optional(),
    poll: z.unknown().optional(),
    poll_answer: z.unknown().optional(),
    message_reaction: z.unknown().optional(),
    message_reaction_count: z.unknown().optional(),
    business_connection: z.unknown().optional(),
    business_message: z.unknown().optional(),
    edited_business_message: z.unknown().optional(),
    deleted_business_messages: z.unknown().optional(),
    shipping_query: z.unknown().optional(),
    pre_checkout_query: z.unknown().optional(),
    purchased_paid_media: z.unknown().optional(),
  })
  .strict()
  .refine((value) => !(value.message && value.callback_query));

interface InboundBase {
  updateId: number;
  chatId: string;
  messageId: number;
}
export type TelegramInbound = InboundBase &
  (
    | { kind: "text"; text: string }
    | {
        kind: "voice";
        fileId: string;
        duration: number;
        fileSize?: number;
        mimeType?: string;
      }
    | { kind: "callback"; callbackId: string; data: string; actorId: string }
    | { kind: "unsupported" }
  );

export function parseTelegramUpdate(raw: unknown): TelegramInbound | undefined {
  const parsed = TelegramUpdateSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid Telegram update");
  const update = parsed.data;
  const query = update.callback_query;
  const msg = query?.message ?? update.message;
  if (!msg || msg.chat.type !== "private") return undefined;
  const sender = query?.from ?? msg.from;
  if (sender?.is_bot) return undefined;
  if (!sender || msg.chat.id <= 0 || sender.id !== msg.chat.id)
    throw new Error("Invalid Telegram update");
  const base = {
    updateId: update.update_id,
    chatId: String(msg.chat.id),
    messageId: msg.message_id,
  };
  if (query)
    return query.data
      ? {
          ...base,
          kind: "callback",
          callbackId: query.id,
          actorId: String(sender.id),
          data: query.data,
        }
      : { ...base, kind: "unsupported" };
  if (msg.text) return { ...base, kind: "text", text: msg.text };
  if (msg.voice)
    return {
      ...base,
      kind: "voice",
      fileId: msg.voice.file_id,
      duration: msg.voice.duration,
      ...(msg.voice.file_size !== undefined
        ? { fileSize: msg.voice.file_size }
        : {}),
      ...(msg.voice.mime_type ? { mimeType: msg.voice.mime_type } : {}),
    };
  return { ...base, kind: "unsupported" };
}
