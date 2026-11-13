// FR-TG-05/08/11: validate Telegram input, retain only data used by the channel.
import { describe, expect, it } from "vitest";
import { parseTelegramUpdate, TelegramUpdateSchema } from "../src/updates.js";

const message = {
  message_id: 9,
  date: 1700000000,
  chat: {
    id: 123456,
    type: "private",
    first_name: "Private name",
    username: "private_username",
  },
  from: {
    id: 123456,
    is_bot: false,
    first_name: "Private name",
    language_code: "en",
  },
  text: "/start",
};
describe("P08 strict Telegram update projection", () => {
  it("projects a real private message without names or extra profile data", () => {
    const result = parseTelegramUpdate({ update_id: 1, message });
    expect(result).toEqual({
      updateId: 1,
      chatId: "123456",
      messageId: 9,
      kind: "text",
      text: "/start",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Private name|private_username|language_code/,
    );
  });
  it.each(["group", "supergroup", "channel"])(
    "silently ignores %s and bot-authored input",
    (type) => {
      expect(
        parseTelegramUpdate({
          update_id: 1,
          message: { ...message, chat: { id: -100123, type } },
        }),
      ).toBeUndefined();
      expect(
        parseTelegramUpdate({
          update_id: 1,
          message: { ...message, from: { ...message.from, is_bot: true } },
        }),
      ).toBeUndefined();
    },
  );
  it("accepts voice metadata without downloading or exposing a transcript", () => {
    const { text: _text, ...rest } = message;
    void _text;
    expect(
      parseTelegramUpdate({
        update_id: 2,
        message: {
          ...rest,
          voice: {
            file_id: "synthetic-file",
            file_unique_id: "unique",
            duration: 8,
            file_size: 500,
            mime_type: "audio/ogg",
          },
        },
      }),
    ).toEqual({
      updateId: 2,
      chatId: "123456",
      messageId: 9,
      kind: "voice",
      fileId: "synthetic-file",
      duration: 8,
      fileSize: 500,
      mimeType: "audio/ogg",
    });
  });
  it("binds callbacks to the private chat actor and enforces Telegram's 64-byte data bound", () => {
    const callback = {
      id: "opaque-query",
      chat_instance: "opaque-instance",
      from: message.from,
      message,
      data: "send:opaque-nonce",
    };
    expect(
      parseTelegramUpdate({ update_id: 3, callback_query: callback }),
    ).toMatchObject({
      kind: "callback",
      actorId: "123456",
      callbackId: "opaque-query",
      data: callback.data,
    });
    expect(() =>
      parseTelegramUpdate({
        update_id: 3,
        callback_query: { ...callback, from: { ...message.from, id: 654321 } },
      }),
    ).toThrow();
    expect(
      TelegramUpdateSchema.safeParse({
        update_id: 3,
        callback_query: { ...callback, data: "😀".repeat(17) },
      }).success,
    ).toBe(false);
  });
  it.each([
    { update_id: -1, message },
    { update_id: 1, message, unexpected: "private" },
    { update_id: 1, message: { ...message, text: "x".repeat(4097) } },
    { update_id: 1, message: { ...message, unexpected: "private" } },
    {
      update_id: 1,
      message: {
        ...message,
        chat: { id: Number.MAX_SAFE_INTEGER + 1, type: "private" },
      },
    },
  ])("rejects malformed/unbounded input without exposing details", (input) => {
    expect(() => parseTelegramUpdate(input)).toThrow("Invalid Telegram update");
  });
  it("acknowledges unsupported update kinds without effects and asks private image senders for text", () => {
    expect(
      parseTelegramUpdate({
        update_id: 4,
        channel_post: { chat: { id: -100123, type: "channel" } },
      }),
    ).toBeUndefined();
    const { text: _text, ...rest } = message;
    void _text;
    expect(
      parseTelegramUpdate({
        update_id: 5,
        message: {
          ...rest,
          photo: [
            {
              file_id: "image",
              file_unique_id: "image-unique",
              width: 10,
              height: 10,
            },
          ],
        },
      }),
    ).toMatchObject({ kind: "unsupported" });
  });
});
