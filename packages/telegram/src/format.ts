/** FR-TG-06: Telegram limits text and entity offsets in UTF-16 code units. */
export const TELEGRAM_TEXT_LIMIT = 4096;

export function splitTelegramText(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_TEXT_LIMIT) {
    const window = remaining.slice(0, TELEGRAM_TEXT_LIMIT + 1);
    // Include following whitespace in the earlier chunk, preserving exact text.
    const boundaries = [...window.matchAll(/[.!?።፧؟。！？][\s]+/gu)]
      .map((match) => match.index + match[0].length)
      .filter((end) => end <= TELEGRAM_TEXT_LIMIT);
    let end = boundaries.at(-1) ?? 0;
    if (!end) {
      const spaces = [...window.matchAll(/\s+/gu)]
        .map((match) => match.index + match[0].length)
        .filter((length) => length <= TELEGRAM_TEXT_LIMIT);
      end = spaces.at(-1) ?? TELEGRAM_TEXT_LIMIT;
    }
    // One oversized sentence/token has no valid sentence boundary. Use a word
    // boundary, then a Unicode code-point boundary, instead of dropping content.
    if (/[\uD800-\uDBFF]/u.test(remaining[end - 1]!)) end--;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function formatTelegramReply(reply: {
  text: string;
  citations: readonly { label: string; url: string }[];
}): string {
  const sources = reply.citations.flatMap((citation) => {
    try {
      const url = new URL(citation.url);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.href.length > 2048
      )
        return [];
      return [`${citation.label.replace(/[\r\n]/gu, " ")}\n${url.href}`];
    } catch {
      return [];
    }
  });
  return [reply.text, ...sources].join("\n\n");
}
