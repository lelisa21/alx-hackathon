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
  speakLanguages: ["am", "om"],
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
      speakLanguages: [],
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
  it("uses the Interactions API: native-script transcript and WAV speech", async () => {
    const calls: {
      url: string;
      headers: Headers;
      body: Record<string, unknown>;
    }[] = [];
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json(
          calls.length === 1
            ? {
                status: "completed",
                steps: [
                  { type: "thought" },
                  {
                    type: "model_output",
                    content: [{ type: "text", text: "“Akkam jirtu?”" }],
                  },
                ],
              }
            : {
                status: "completed",
                steps: [
                  {
                    type: "model_output",
                    content: [
                      {
                        type: "audio",
                        mime_type: "audio/l16; rate=24000",
                        data: Buffer.alloc(4).toString("base64"),
                      },
                    ],
                  },
                ],
              },
        );
      },
    ) as unknown as typeof fetch;
    const voice = createGeminiVoice({
      apiKey: "key",
      sttModel: "gemini-4-hydrogen",
      ttsModel: "gemini-3.8-flash-lite-tts",
      languages: ["am", "om"],
      speakLanguages: ["am"],
      fetch: fetcher,
    });
    expect(voice.speakLanguages).toEqual(["am"]);
    const signal = new AbortController().signal;
    expect(
      await voice.transcribe({
        audio: new Uint8Array([1]),
        mimeType: "audio/ogg",
        lang: "om",
        signal,
      }),
    ).toBe("Akkam jirtu?");
    const stt = calls[0]!;
    expect(stt.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    expect(stt.headers.get("x-goog-api-key")).toBe("key");
    expect(stt.headers.get("api-revision")).toBe("2026-05-20");
    expect(stt.body).toMatchObject({
      model: "gemini-4-hydrogen",
      store: false,
      generation_config: { thinking_level: "low" },
      input: [
        { type: "text" },
        { type: "audio", mime_type: "audio/ogg", data: "AQ==" },
      ],
    });
    expect(JSON.stringify(stt.body)).toContain("Qubee");
    // Afaan Oromoo is not in Gemini TTS: read-aloud refuses before any call.
    await expect(
      voice.synthesize({ text: "Akkam", lang: "om", signal }),
    ).rejects.toMatchObject({ reason: "language" });
    const speech = await voice.synthesize({ text: "ሰላም", lang: "am", signal });
    expect(calls[1]!.body).toMatchObject({
      model: "gemini-3.8-flash-lite-tts",
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Kore" }] },
      input: [{ type: "user_input", content: [{ type: "text", text: "ሰላም" }] }],
    });
    expect(speech.mimeType).toBe("audio/wav");
    expect(Buffer.from(speech.audio).subarray(0, 4).toString()).toBe("RIFF");
    expect(pcmToWav(new Uint8Array(4), 24000).byteLength).toBe(48);
  });

  it("reports the HTTP status and vendor message, never the audio", async () => {
    const voice = createGeminiVoice({
      apiKey: "bad",
      sttModel: "gemini-4-hydrogen",
      ttsModel: "gemini-3.8-flash-lite-tts",
      languages: ["am"],
      fetch: (async () =>
        Response.json(
          { error: { code: 400, message: "API key not valid." } },
          { status: 400 },
        )) as unknown as typeof fetch,
    });
    await expect(
      voice.transcribe({
        audio: new Uint8Array([9]),
        mimeType: "audio/wav",
        lang: "am",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      reason: "status",
      status: 400,
      vendorMessage: "API key not valid.",
    });
  });
});
