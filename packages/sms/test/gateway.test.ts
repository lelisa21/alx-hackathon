import { describe, expect, it, vi } from "vitest";
import { HttpSmsGateway, SimulatedSmsGateway } from "../src/gateway.js";

describe("FR-SMS-01/11/12 gateway conformance", () => {
  it("simulates delivery, deduplicates stable identities and passes inbound metadata", async () => {
    const gateway = new SimulatedSmsGateway();
    const inbound = vi.fn(async () => {});
    gateway.onInbound(inbound);
    await gateway.receive({ id: "in-1", from: "+251911111111", text: "HELP" });
    expect(inbound).toHaveBeenCalledWith("+251911111111", "HELP", {
      id: "in-1",
    });
    const first = await gateway.send("+251911111111", "‘Afaan’", {
      lang: "om",
      idempotencyKey: "out-1",
    });
    expect(await gateway.status(first.id)).toBe("delivered");
    expect(
      await gateway.send("+251911111111", "'Afaan'", {
        lang: "om",
        idempotencyKey: "out-1",
      }),
    ).toEqual(first);
    await expect(
      gateway.send("+251911111111", "Changed", {
        lang: "om",
        idempotencyKey: "out-1",
      }),
    ).rejects.toThrow();
  });
  it("injects two deterministic failures without pretending success", async () => {
    const gateway = new SimulatedSmsGateway({ failuresBeforeSuccess: 2 });
    const opts = { lang: "en", idempotencyKey: "retry" };
    await expect(
      gateway.send("+251911111111", "Hello", opts),
    ).rejects.toThrow();
    await expect(
      gateway.send("+251911111111", "Hello", opts),
    ).rejects.toThrow();
    const result = await gateway.send("+251911111111", "Hello", opts);
    expect(await gateway.status(result.id)).toBe("delivered");
  });
  it("uses exact normalized text, stable keys and a bounded authenticated HTTP send/status protocol", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          version: "dimts.sms.gateway.v1",
          id: "receipt",
          idempotencyKey: "stable",
          segments: 1,
          status: "sent",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          version: "dimts.sms.gateway.v1",
          id: "receipt",
          status: "delivered",
        }),
      );
    const gateway = new HttpSmsGateway({
      url: "https://operator.example/sms",
      token: "synthetic-token-at-least-24-characters",
      transport,
    });
    expect(
      await gateway.send("+251911111111", "“Afaan”", {
        lang: "om",
        idempotencyKey: "stable",
      }),
    ).toEqual({ id: "receipt", segments: 1 });
    expect(await gateway.status("receipt")).toBe("sent");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await gateway.status("receipt")).toBe("delivered");
    const [, request] = transport.mock.calls[0]!;
    expect(request?.redirect).toBe("error");
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request?.body))).toMatchObject({
      action: "send",
      text: '"Afaan"',
      idempotencyKey: "stable",
    });
    expect(JSON.parse(String(transport.mock.calls[1]![1]?.body))).toEqual({
      version: "dimts.sms.gateway.v1",
      action: "status",
      id: "receipt",
    });
  });
  it.each([
    {
      version: "wrong",
      id: "id",
      idempotencyKey: "stable",
      segments: 1,
      status: "sent",
    },
    {
      version: "dimts.sms.gateway.v1",
      id: "id",
      idempotencyKey: "other",
      segments: 1,
      status: "sent",
    },
    {
      version: "dimts.sms.gateway.v1",
      id: "id",
      idempotencyKey: "stable",
      segments: 2,
      status: "sent",
    },
    {
      version: "dimts.sms.gateway.v1",
      id: "id",
      idempotencyKey: "stable",
      segments: 1,
      status: "failed",
    },
  ])("rejects an unconfirmed operator receipt", async (receipt) => {
    const gateway = new HttpSmsGateway({
      url: "https://operator.example/sms",
      token: "synthetic-token-at-least-24-characters",
      transport: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(receipt)),
    });
    await expect(
      gateway.send("+251911111111", "Hello", {
        lang: "en",
        idempotencyKey: "stable",
      }),
    ).rejects.toThrow("SMS gateway delivery failed");
  });
  it("refuses insecure transport configuration", () => {
    expect(
      () =>
        new HttpSmsGateway({
          url: "http://operator.example/sms",
          token: "synthetic-token-at-least-24-characters",
        }),
    ).toThrow();
  });
});
