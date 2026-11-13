export interface SimulatorMessage {
  id: string;
  text: string;
  encoding: "gsm7" | "ucs2";
  units: number;
  segments: number;
  status: "queued" | "sent" | "delivered" | "failed";
}

export interface SimulatorResponse {
  messages: SimulatorMessage[];
  stopped: boolean;
  lang?: string;
}

/** Configuration never accepts credentials in URLs or an unrelated API path. */
export function inboundEndpoint(value: string, base: string): string {
  if (!value.trim()) throw new Error("sms configuration");
  const url = new URL(value, base);
  const path = url.pathname.replace(/\/+$/u, "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (path !== "" && path !== "/v1")
  )
    throw new Error("sms configuration");
  url.pathname = "/v1/sms/inbound";
  return url.href;
}

export function parseSmsResponse(value: unknown): SimulatorResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("messages" in value) ||
    !Array.isArray(value.messages) ||
    !("stopped" in value) ||
    typeof value.stopped !== "boolean" ||
    ("lang" in value && typeof value.lang !== "string") ||
    !value.messages.every((item: unknown) => {
      if (typeof item !== "object" || item === null) return false;
      const message = item as Record<string, unknown>;
      return (
        typeof message.id === "string" &&
        Boolean(message.id) &&
        typeof message.text === "string" &&
        ["gsm7", "ucs2"].includes(String(message.encoding)) &&
        Number.isSafeInteger(message.units) &&
        Number(message.units) >= 0 &&
        Number.isSafeInteger(message.segments) &&
        Number(message.segments) >= 0 &&
        ["queued", "sent", "delivered", "failed"].includes(
          String(message.status),
        )
      );
    })
  )
    throw new Error("sms response");
  return value as SimulatorResponse;
}
