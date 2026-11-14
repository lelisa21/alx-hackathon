// FR-SMS delivery through the SMS Ethiopia v2 API (https://smsethiopia.com/developer-docs.txt).
import { describe, expect, it, vi } from "vitest";
import {
  SmsEthiopiaGateway,
  SmsGatewayError,
  createSmsGateway,
  toEthiopianMsisdn,
} from "../src/gateway.js";

const KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD";

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SMS Ethiopia gateway", () => {
  it("sends msisdn and text with the KEY header to the v2 endpoint", async () => {
    const transport = vi.fn(async () =>
      reply(200, {
        id: "01JZX5M8Q3T5V0X8YW9RCB2K7D",
        description: "Accepted for delivery",
        segments: 1,
        status: "ACCEPTED",
      }),
    );
    const gateway = new SmsEthiopiaGateway({ token: KEY, transport });

    const result = await gateway.send("+251911639555", "Hello", { lang: "en" });

    expect(result).toEqual({ id: "01JZX5M8Q3T5V0X8YW9RCB2K7D", segments: 1 });
    const [url, init] = transport.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://smsethiopia.com/api/v2/sms/send");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.KEY).toBe(KEY);
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({
      msisdn: "251911639555",
      text: "Hello",
    });
  });

  it("maps the documented status lifecycle", async () => {
    const statuses = ["ACCEPTED", "SENT", "DELIVERED", "UNDELIVERED"];
    const transport = vi.fn(async () =>
      reply(200, { id: "x", status: statuses.shift() }),
    );
    const gateway = new SmsEthiopiaGateway({ token: KEY, transport });
    expect(await gateway.status("x")).toBe("queued");
    expect(await gateway.status("x")).toBe("sent");
    expect(await gateway.status("x")).toBe("delivered");
    expect(await gateway.status("x")).toBe("failed");
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://smsethiopia.com/api/v2/sms/x",
    );
  });

  it.each([
    [429, { message: "Too Many Requests" }],
    [400, { message: "Error Code :: 10007" }],
    [200, { status: "ACCEPTED" }],
  ])(
    "rejects HTTP %i / malformed responses without leaking the key",
    async (code, body) => {
      const gateway = new SmsEthiopiaGateway({
        token: KEY,
        transport: async () => reply(code, body),
      });
      const error = await gateway.send("0911639555", "Hi").catch((e) => e);
      expect(error).toBeInstanceOf(SmsGatewayError);
      expect(String(error.message)).not.toContain(KEY);
    },
  );

  it("is selectable from the gateway factory with an optional base URL", () => {
    expect(
      createSmsGateway({ type: "smsethiopia", token: KEY }),
    ).toBeInstanceOf(SmsEthiopiaGateway);
    expect(() => createSmsGateway({ type: "smsethiopia" })).toThrow(
      SmsGatewayError,
    );
    expect(
      () =>
        new SmsEthiopiaGateway({ token: KEY, url: "http://smsethiopia.com" }),
    ).toThrow(SmsGatewayError);
  });
});

describe("Ethiopian MSISDN normalisation", () => {
  it.each([
    ["+251911639555", "251911639555"],
    ["251911639555", "251911639555"],
    ["0911639555", "251911639555"],
    ["911639555", "251911639555"],
    ["0711639555", "251711639555"],
    ["+251 91 163 9555", "251911639555"],
  ])("%s -> %s", (input, expected) => {
    expect(toEthiopianMsisdn(input)).toBe(expected);
  });

  it("rejects non-Ethiopian or malformed numbers", () => {
    expect(() => toEthiopianMsisdn("+254711000000")).toThrow(SmsGatewayError);
    expect(() => toEthiopianMsisdn("12345")).toThrow(SmsGatewayError);
  });
});
