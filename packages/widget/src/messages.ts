import { IntlMessageFormat } from "intl-messageformat";

/** Returns plain text for Lit interpolation; never interprets locale markup as HTML. */
export function messageFor(
  messages: Record<string, unknown>,
  key: string,
  values: Record<string, string | number> = {},
  locale = "en",
): string {
  const value = messages[key];
  if (typeof value !== "string") return "";
  try {
    return String(
      new IntlMessageFormat(value, locale, undefined, {
        ignoreTag: true,
      }).format(values),
    );
  } catch {
    return value;
  }
}
