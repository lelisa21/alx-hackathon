import { describe, expect, it } from "vitest";
import {
  inboundEndpoint,
  parseSmsResponse,
} from "../src/sms-simulator-runtime.js";

describe("P07 FR-SMS-02: simulator transport boundary", () => {
  it("uses the same versioned inbound path for relative and configured API roots", () => {
    expect(inboundEndpoint("/v1", "https://dimts.test/sim/sms")).toBe(
      "https://dimts.test/v1/sms/inbound",
    );
    expect(
      inboundEndpoint("http://localhost:3000/", "https://dimts.test"),
    ).toBe("http://localhost:3000/v1/sms/inbound");
    expect(inboundEndpoint("https://api.test/v1/", "https://dimts.test")).toBe(
      "https://api.test/v1/sms/inbound",
    );
  });

  it.each([
    "javascript:alert(1)",
    "file:///tmp/private",
    "https://user:password@api.test",
    "https://api.test?secret=private",
    "https://api.test#private",
    "https://api.test/other-path",
    "",
  ])("rejects an ambiguous or unsafe API destination: %s", (value) => {
    expect(() => inboundEndpoint(value, "https://dimts.test")).toThrow();
  });

  it("accepts delivered messages and a permanently stopped empty exchange", () => {
    const body = {
      messages: [
        {
          id: "outbound-1",
          text: "1 English",
          encoding: "gsm7",
          units: 9,
          segments: 1,
          status: "delivered",
        },
      ],
      stopped: false,
      lang: "en",
    };
    expect(parseSmsResponse(body)).toEqual(body);
    expect(parseSmsResponse({ messages: [], stopped: true })).toEqual({
      messages: [],
      stopped: true,
    });
  });

  it.each([
    null,
    { messages: [] },
    { messages: [], stopped: "false" },
    { messages: [], stopped: false, lang: 1 },
    { messages: [{ id: "a", text: "private" }], stopped: false },
    {
      messages: [
        {
          id: "a",
          text: "a",
          encoding: "utf8",
          units: 1,
          segments: 1,
          status: "delivered",
        },
      ],
      stopped: false,
    },
  ])(
    "rejects malformed responses without including private response text",
    (body) => {
      expect(() => parseSmsResponse(body)).toThrow("sms response");
    },
  );
});
