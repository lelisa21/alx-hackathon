import { createHash, randomUUID } from "node:crypto";
import { countSms, normalizeForSms } from "./segments.js";

export type SmsDeliveryStatus = "queued" | "sent" | "delivered" | "failed";
export type SmsGatewayProvider =
  "simulator" | "gateway" | "afromessage" | "smsethiopia";
export type SmsInboundHandler = (
  from: string,
  text: string,
  metadata?: { id: string },
) => Promise<void>;
export interface SmsGateway {
  send(
    to: string,
    text: string,
    opts?: { lang: string; idempotencyKey?: string },
  ): Promise<{ id: string; segments: number }>;
  onInbound(handler: SmsInboundHandler): void;
  status(id: string): Promise<SmsDeliveryStatus>;
}
export class SmsGatewayError extends Error {
  constructor() {
    super("SMS gateway delivery failed");
    this.name = "SmsGatewayError";
  }
}

export interface SmsGatewayFactoryOptions {
  type?: SmsGatewayProvider;
  url?: string;
  token?: string;
  from?: string;
  sender?: string;
  callback?: string;
  transport?: typeof fetch;
}

export function createSmsGateway(
  options: SmsGatewayFactoryOptions = {},
): SmsGateway {
  switch (options.type ?? "gateway") {
    case "simulator":
      return new SimulatedSmsGateway();
    case "gateway": {
      const url = options.url;
      const token = options.token;
      if (!url || !token) {
        throw new SmsGatewayError();
      }
      const gatewayOptions: ConstructorParameters<typeof HttpSmsGateway>[0] = {
        url,
        token,
      };
      if (options.transport) gatewayOptions.transport = options.transport;
      return new HttpSmsGateway(gatewayOptions);
    }
    case "afromessage": {
      const url = options.url;
      const token = options.token;
      if (!url || !token) {
        throw new SmsGatewayError();
      }
      const gatewayOptions: ConstructorParameters<
        typeof AfromessageSmsGateway
      >[0] = {
        url,
        token,
      };
      if (options.from) gatewayOptions.from = options.from;
      if (options.sender) gatewayOptions.sender = options.sender;
      if (options.callback) gatewayOptions.callback = options.callback;
      if (options.transport) gatewayOptions.transport = options.transport;
      return new AfromessageSmsGateway(gatewayOptions);
    }
    case "smsethiopia": {
      if (!options.token) throw new SmsGatewayError();
      const gatewayOptions: ConstructorParameters<
        typeof SmsEthiopiaGateway
      >[0] = { token: options.token };
      if (options.url) gatewayOptions.url = options.url;
      if (options.transport) gatewayOptions.transport = options.transport;
      return new SmsEthiopiaGateway(gatewayOptions);
    }
    default:
      throw new SmsGatewayError();
  }
}

function status(value: unknown): value is SmsDeliveryStatus {
  return ["queued", "sent", "delivered", "failed"].includes(String(value));
}
/** In-process simulation only. Durable retries/counters belong to SmsService. */
export class SimulatedSmsGateway implements SmsGateway {
  private handler: SmsInboundHandler | undefined;
  private readonly receipts = new Map<
    string,
    {
      id: string;
      segments: number;
      fingerprint: string;
      attempts: number;
      status: SmsDeliveryStatus;
    }
  >();
  private readonly failures: number;
  constructor(options: { failuresBeforeSuccess?: number } = {}) {
    this.failures = options.failuresBeforeSuccess ?? 0;
    if (
      !Number.isInteger(this.failures) ||
      this.failures < 0 ||
      this.failures > 3
    )
      throw new RangeError("Invalid simulator failure count");
  }
  onInbound(handler: SmsInboundHandler): void {
    this.handler = handler;
  }
  async receive(input: {
    id: string;
    from: string;
    text: string;
  }): Promise<void> {
    if (!this.handler) throw new SmsGatewayError();
    await this.handler(input.from, input.text, { id: input.id });
  }
  async send(
    to: string,
    raw: string,
    opts?: { lang: string; idempotencyKey?: string },
  ): Promise<{ id: string; segments: number }> {
    const text = normalizeForSms(raw);
    const key = opts?.idempotencyKey ?? randomUUID();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([to, text, opts?.lang ?? "en"]))
      .digest("hex");
    let receipt = this.receipts.get(key);
    if (receipt && receipt.fingerprint !== fingerprint)
      throw new SmsGatewayError();
    if (!receipt) {
      receipt = {
        id: `sim-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
        segments: countSms(text).segments,
        fingerprint,
        attempts: 0,
        status: "queued",
      };
      this.receipts.set(key, receipt);
    }
    if (receipt.status === "delivered")
      return { id: receipt.id, segments: receipt.segments };
    receipt.attempts++;
    if (receipt.attempts <= this.failures) {
      receipt.status = "failed";
      throw new SmsGatewayError();
    }
    receipt.status = "delivered";
    return { id: receipt.id, segments: receipt.segments };
  }
  async status(id: string): Promise<SmsDeliveryStatus> {
    const receipt = [...this.receipts.values()].find(
      (entry) => entry.id === id,
    );
    if (!receipt) throw new SmsGatewayError();
    return receipt.status;
  }
}
export const SMS_GATEWAY_VERSION = "dimts.sms.gateway.v1";
/** Operator bridge protocol, not an assertion that any operator is configured. */
export class AfromessageSmsGateway implements SmsGateway {
  private readonly url: string;
  private readonly token: string;
  private readonly from: string;
  private readonly sender: string;
  private readonly callback?: string;
  private readonly transport: typeof fetch;
  private readonly acknowledgements = new Map<string, SmsDeliveryStatus>();
  private handler: SmsInboundHandler | undefined;

  constructor(options: {
    url: string;
    token: string;
    from?: string;
    sender?: string;
    callback?: string;
    transport?: typeof fetch;
  }) {
    const url = new URL(options.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      options.token.length < 24
    )
      throw new SmsGatewayError();
    if (!options.from || !options.sender) {
      throw new SmsGatewayError();
    }
    this.url = url.href;
    this.token = options.token;
    this.from = options.from;
    this.sender = options.sender;
    if (typeof options.callback === "string") this.callback = options.callback;
    this.transport = options.transport ?? fetch;
  }

  onInbound(handler: SmsInboundHandler): void {
    this.handler = handler;
  }

  async receive(input: {
    id: string;
    from: string;
    text: string;
  }): Promise<void> {
    if (!this.handler) throw new SmsGatewayError();
    await this.handler(input.from, input.text, { id: input.id });
  }

  async send(
    to: string,
    raw: string,
    opts?: { lang: string; idempotencyKey?: string },
  ): Promise<{ id: string; segments: number }> {
    const text = normalizeForSms(raw);
    const segments = countSms(text).segments;
    const params = new URLSearchParams({
      from: this.from,
      sender: this.sender,
      to,
      message: text,
    });
    if (this.callback) params.set("callback", this.callback);
    const response = await this.transport(`${this.url}?${params.toString()}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(2500),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(opts?.idempotencyKey
          ? { "Idempotency-Key": opts.idempotencyKey }
          : {}),
      },
    });
    if (!response.ok) throw new SmsGatewayError();
    const result: unknown = await response.json();
    const id =
      typeof result === "object" &&
      result &&
      "id" in result &&
      typeof result.id === "string"
        ? result.id
        : `afromessage-${createHash("sha256")
            .update(`${to}:${text}:${opts?.idempotencyKey ?? ""}`)
            .digest("hex")
            .slice(0, 24)}`;
    const outletStatus: SmsDeliveryStatus =
      typeof result === "object" &&
      result &&
      "status" in result &&
      status(result.status)
        ? result.status
        : "queued";
    this.acknowledgements.set(id, outletStatus);
    return { id, segments };
  }

  async status(id: string): Promise<SmsDeliveryStatus> {
    const acknowledged = this.acknowledgements.get(id);
    if (acknowledged) {
      this.acknowledgements.delete(id);
      return acknowledged;
    }
    return "queued";
  }
}

export class HttpSmsGateway implements SmsGateway {
  private readonly acknowledgements = new Map<string, SmsDeliveryStatus>();
  private readonly url: string;
  private readonly token: string;
  private readonly transport: typeof fetch;
  private handler: SmsInboundHandler | undefined;
  constructor(options: {
    url: string;
    token: string;
    transport?: typeof fetch;
  }) {
    const url = new URL(options.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      options.token.length < 24
    )
      throw new SmsGatewayError();
    this.url = url.href;
    this.token = options.token;
    this.transport = options.transport ?? fetch;
  }
  onInbound(handler: SmsInboundHandler): void {
    this.handler = handler;
  }
  async receive(input: {
    id: string;
    from: string;
    text: string;
  }): Promise<void> {
    if (!this.handler) throw new SmsGatewayError();
    await this.handler(input.from, input.text, { id: input.id });
  }
  private async call(
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.transport(this.url, {
        method: "POST",
        redirect: "error",
        // Three attempts stay within the P06 delivery port's ten-second bound.
        signal: AbortSignal.timeout(2500),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(typeof body.idempotencyKey === "string"
            ? { "Idempotency-Key": body.idempotencyKey }
            : {}),
        },
        body: JSON.stringify({ version: SMS_GATEWAY_VERSION, ...body }),
      });
      if (!response.ok) throw new SmsGatewayError();
      const result: unknown = await response.json();
      if (
        typeof result !== "object" ||
        !result ||
        !("version" in result) ||
        result.version !== SMS_GATEWAY_VERSION
      )
        throw new SmsGatewayError();
      return result as Record<string, unknown>;
    } catch {
      throw new SmsGatewayError();
    }
  }
  async send(
    to: string,
    raw: string,
    opts?: { lang: string; idempotencyKey?: string },
  ): Promise<{ id: string; segments: number }> {
    const text = normalizeForSms(raw);
    const idempotencyKey = opts?.idempotencyKey ?? randomUUID();
    const segments = countSms(text).segments;
    const result = await this.call({
      action: "send",
      to,
      text,
      lang: opts?.lang ?? "en",
      idempotencyKey,
    });
    if (
      result.idempotencyKey !== idempotencyKey ||
      typeof result.id !== "string" ||
      !result.id ||
      result.id.length > 256 ||
      result.segments !== segments ||
      !status(result.status) ||
      result.status === "failed"
    )
      throw new SmsGatewayError();
    if (this.acknowledgements.size >= 1024)
      this.acknowledgements.delete(this.acknowledgements.keys().next().value!);
    this.acknowledgements.set(result.id, result.status);
    return { id: result.id, segments };
  }
  async status(id: string): Promise<SmsDeliveryStatus> {
    const acknowledged = this.acknowledgements.get(id);
    if (acknowledged) {
      this.acknowledgements.delete(id);
      return acknowledged;
    }
    const result = await this.call({ action: "status", id });
    if (result.id !== id || !status(result.status)) throw new SmsGatewayError();
    return result.status;
  }
}

/**
 * Converts a local or international Ethiopian mobile number to the
 * 251XXXXXXXXX form SMS Ethiopia requires (Ethio Telecom 9x, Safaricom 7x).
 */
export function toEthiopianMsisdn(raw: string): string {
  const digits = raw.replace(/[\s()-]/gu, "").replace(/^\+/u, "");
  let national: string | undefined;
  if (/^251[79]\d{8}$/u.test(digits)) national = digits.slice(3);
  else if (/^0[79]\d{8}$/u.test(digits)) national = digits.slice(1);
  else if (/^[79]\d{8}$/u.test(digits)) national = digits;
  if (!national) throw new SmsGatewayError();
  return `251${national}`;
}

const smsEthiopiaStatus: Record<string, SmsDeliveryStatus> = {
  ACCEPTED: "queued",
  SENT: "sent",
  DELIVERED: "delivered",
  UNDELIVERED: "failed",
};

/**
 * SMS Ethiopia API v2: POST /api/v2/sms/send with a `KEY` header and a
 * `{msisdn, text}` body; GET /api/v2/sms/{id} for the delivery status. The
 * sender ID and billing come from the campaign the key belongs to. The
 * provider documents no inbound (learner-to-service) SMS API.
 */
export class SmsEthiopiaGateway implements SmsGateway {
  private readonly base: string;
  private readonly token: string;
  private readonly transport: typeof fetch;
  private handler: SmsInboundHandler | undefined;

  constructor(options: {
    token: string;
    url?: string;
    transport?: typeof fetch;
  }) {
    const url = new URL(options.url ?? "https://smsethiopia.com");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      options.token.trim().length < 24
    )
      throw new SmsGatewayError();
    this.base = url.origin;
    this.token = options.token.trim();
    this.transport = options.transport ?? fetch;
  }

  onInbound(handler: SmsInboundHandler): void {
    this.handler = handler;
  }

  async receive(input: {
    id: string;
    from: string;
    text: string;
  }): Promise<void> {
    if (!this.handler) throw new SmsGatewayError();
    await this.handler(input.from, input.text, { id: input.id });
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.transport(`${this.base}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          KEY: this.token,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      if (!response.ok) throw new SmsGatewayError();
      const result: unknown = await response.json();
      if (typeof result !== "object" || !result) throw new SmsGatewayError();
      return result as Record<string, unknown>;
    } catch {
      throw new SmsGatewayError();
    }
  }

  async send(
    to: string,
    raw: string,
    _opts?: { lang: string; idempotencyKey?: string },
  ): Promise<{ id: string; segments: number }> {
    void _opts;
    const text = normalizeForSms(raw);
    const result = await this.request("/api/v2/sms/send", {
      method: "POST",
      body: JSON.stringify({ msisdn: toEthiopianMsisdn(to), text }),
    });
    if (
      typeof result.id !== "string" ||
      !result.id ||
      result.id.length > 256 ||
      result.status === "UNDELIVERED"
    )
      throw new SmsGatewayError();
    const segments =
      typeof result.segments === "number" && result.segments > 0
        ? result.segments
        : countSms(text).segments;
    return { id: result.id, segments };
  }

  async status(id: string): Promise<SmsDeliveryStatus> {
    const result = await this.request(`/api/v2/sms/${encodeURIComponent(id)}`, {
      method: "GET",
    });
    const mapped = smsEthiopiaStatus[String(result.status)];
    if (!mapped) throw new SmsGatewayError();
    return mapped;
  }
}
