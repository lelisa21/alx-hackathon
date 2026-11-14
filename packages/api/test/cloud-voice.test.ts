// Cloud voice: consent-gated transcription and speech, never logged or stored.
import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createGeminiVoice, pcmToWav } from "../src/cloud-voice.js";
import { createVoiceRouter } from "../src/routes/voice.js";
import type { ApiRepository } from "../src/types.js";

const token = "t".repeat(43);
const repository = {
  getSessionTokenHash: async () =>
    createHash("sha256").update(token).digest("hex"),
  touchSession: async () => undefined,
} as unknown as ApiRepository;

function app(voice?: Parameters<typeof createVoiceRouter>[0]["voice"]) {
  const instance = express();
  instance.use("/v1", createVoiceRouter({ repository, voice }));
  return instance;
}

const fakeVoice = {
  languages: ["am", "om"],
  transcribe: vi.fn(async () => "ኮርስ ለማለፍ ምን ያህል ውጤት ያስፈልገኛል?"),
  synthesize: vi.fn(async () => ({
    audio: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
  })),
};
const audio = Buffer.alloc(64, 7).toString("base64");

describe("cloud voice routes", () => {
  it("reports availability and languages publicly", async () => {
    expect((await request(app()).get("/v1/voice/cloud")).body).toEqual({
      available: false,
      languages: [],
      consentVersion: "cloud-voice-v1",
      provider: null,
    });
    expect(
      (await request(app(fakeVoice)).get("/v1/voice/cloud")).body,
    ).toMatchObject({ available: true, languages: ["am", "om"] });
  });

  it("requires a session and the cloud-voice consent version", async () => {
    const base = {
      sessionId: "session-1",
      lang: "am",
      mimeType: "audio/wav",
      audio,
    };
    expect(
      (await request(app(fakeVoice)).post("/v1/voice/transcribe").send(base))
        .status,
    ).toBe(401);
    const noConsent = await request(app(fakeVoice))
      .post("/v1/voice/transcribe")
      .set("authorization", `Bearer ${token}`)
      .send(base);
    expect(noConsent.status).toBe(400);
    expect(fakeVoice.transcribe).not.toHaveBeenCalled();
  });

  it("transcribes and speaks for supported languages only", async () => {
    const ok = await request(app(fakeVoice))
      .post("/v1/voice/transcribe")
      .set("authorization", `Bearer ${token}`)
      .send({
        sessionId: "session-1",
        lang: "am",
        mimeType: "audio/wav",
        audio,
        consentVersion: "cloud-voice-v1",
      });
    expect(ok.status).toBe(200);
    expect(ok.body.text).toBe("ኮርስ ለማለፍ ምን ያህል ውጤት ያስፈልገኛል?");

    const unsupported = await request(app(fakeVoice))
      .post("/v1/voice/speak")
      .set("authorization", `Bearer ${token}`)
      .send({
        sessionId: "session-1",
        lang: "en",
        text: "Hello",
        consentVersion: "cloud-voice-v1",
      });
    expect(unsupported.status).toBe(503);

    const spoken = await request(app(fakeVoice))
      .post("/v1/voice/speak")
      .set("authorization", `Bearer ${token}`)
      .send({
        sessionId: "session-1",
        lang: "om",
        text: "Akkam",
        consentVersion: "cloud-voice-v1",
      });
    expect(spoken.body).toEqual({ mimeType: "audio/wav", audio: "AQID" });
  });
});

describe("Gemini voice adapter", () => {
  it("asks for a native-script transcript and wraps speech as WAV", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts:
                    bodies.length === 1
                      ? [{ text: "“Akkam jirtu?”" }]
                      : [
                          {
                            inlineData: {
                              mimeType: "audio/l16; rate=24000; channels=1",
                              data: Buffer.alloc(4).toString("base64"),
                            },
                          },
                        ],
                },
              },
            ],
          }),
        );
      },
    ) as unknown as typeof fetch;
    const voice = createGeminiVoice({
      apiKey: "key",
      sttModel: "gemini-3.5-flash-lite",
      ttsModel: "gemini-3.1-flash-tts-preview",
      languages: ["om"],
      fetch: fetcher,
    });
    const signal = new AbortController().signal;
    expect(
      await voice.transcribe({
        audio: new Uint8Array([1]),
        mimeType: "audio/ogg",
        lang: "om",
        signal,
      }),
    ).toBe("Akkam jirtu?");
    expect(JSON.stringify(bodies[0])).toContain("Qubee");
    const speech = await voice.synthesize({
      text: "Akkam",
      lang: "om",
      signal,
    });
    expect(speech.mimeType).toBe("audio/wav");
    expect(Buffer.from(speech.audio).subarray(0, 4).toString()).toBe("RIFF");
    expect(pcmToWav(new Uint8Array(4), 24000).byteLength).toBe(48);
  });
});
