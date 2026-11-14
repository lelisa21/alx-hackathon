import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  CLOUD_AUDIO_TYPES,
  CLOUD_VOICE_CONSENT_VERSION,
  MAX_CLOUD_AUDIO_BYTES,
  type CloudVoice,
} from "../cloud-voice.js";
import { createSessionAuth } from "../middleware/auth.js";
import { sendProblem } from "../middleware/problem.js";
import type { ApiRepository } from "../types.js";

const TranscribeSchema = z
  .object({
    sessionId: z.string().min(8).max(64),
    lang: z.string().min(2).max(8),
    mimeType: z.enum(CLOUD_AUDIO_TYPES),
    audio: z
      .string()
      .min(16)
      .max(Math.ceil((MAX_CLOUD_AUDIO_BYTES * 4) / 3) + 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
    consentVersion: z.literal(CLOUD_VOICE_CONSENT_VERSION),
  })
  .strict();

const SpeakSchema = z
  .object({
    sessionId: z.string().min(8).max(64),
    lang: z.string().min(2).max(8),
    text: z.string().trim().min(1).max(2000),
    consentVersion: z.literal(CLOUD_VOICE_CONSENT_VERSION),
  })
  .strict();

/**
 * Cloud voice routes. Mounted before the API's 100 KB JSON parser because a
 * recording is larger. Nothing here logs or stores audio or text.
 */
export function createVoiceRouter(options: {
  repository: ApiRepository;
  voice?: CloudVoice | undefined;
  /** Content-free failure report (direction, reason, HTTP status). */
  onError?: (event: {
    direction: "transcribe" | "speak";
    reason: string;
    status?: number;
    vendorMessage?: string;
  }) => void;
}): express.Router {
  const report = (direction: "transcribe" | "speak", error: unknown) => {
    const failure = error as {
      reason?: unknown;
      status?: unknown;
      vendorMessage?: unknown;
      name?: unknown;
    };
    options.onError?.({
      direction,
      reason:
        typeof failure?.reason === "string"
          ? failure.reason
          : failure?.name === "TimeoutError"
            ? "timeout"
            : "unknown",
      ...(typeof failure?.status === "number"
        ? { status: failure.status }
        : {}),
      ...(typeof failure?.vendorMessage === "string"
        ? { vendorMessage: failure.vendorMessage }
        : {}),
    });
  };
  const router = express.Router();
  const session = createSessionAuth(options.repository);
  const limit = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_request, response) =>
      sendProblem(response, 429, "rate_limited", "limit.reached"),
  });
  const json = express.json({ limit: "3mb", strict: true });

  router.get("/voice/cloud", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({
      available: Boolean(options.voice),
      languages: options.voice?.languages ?? [],
      speakLanguages: options.voice?.speakLanguages ?? [],
      consentVersion: CLOUD_VOICE_CONSENT_VERSION,
      provider: options.voice ? "Google Gemini" : null,
    });
  });

  const unavailable = (
    response: express.Response,
    lang: string,
    direction: "transcribe" | "speak" = "transcribe",
  ) => {
    const languages =
      direction === "speak"
        ? options.voice?.speakLanguages
        : options.voice?.languages;
    if (languages?.includes(lang)) return false;
    sendProblem(response, 503, "internal", "voice.unsupported");
    return true;
  };

  router.post(
    "/voice/transcribe",
    limit,
    json,
    session,
    async (request, response) => {
      const parsed = TranscribeSchema.safeParse(request.body);
      if (!parsed.success) {
        sendProblem(response, 400, "invalid_request", "error.invalid");
        return;
      }
      const body = parsed.data;
      if (unavailable(response, body.lang)) return;
      const audio = Buffer.from(body.audio, "base64");
      if (audio.byteLength > MAX_CLOUD_AUDIO_BYTES) {
        sendProblem(response, 413, "payload_too_large", "error.invalid");
        return;
      }
      try {
        const text = await options.voice!.transcribe({
          audio,
          mimeType: body.mimeType,
          lang: body.lang,
          signal: AbortSignal.timeout(50_000),
        });
        response.set("Cache-Control", "no-store");
        response.json({ text: text.slice(0, 1000) });
      } catch (error) {
        report("transcribe", error);
        sendProblem(response, 502, "internal", "voice.retry");
      } finally {
        audio.fill(0);
      }
    },
  );

  router.post(
    "/voice/speak",
    limit,
    json,
    session,
    async (request, response) => {
      const parsed = SpeakSchema.safeParse(request.body);
      if (!parsed.success) {
        sendProblem(response, 400, "invalid_request", "error.invalid");
        return;
      }
      const body = parsed.data;
      if (unavailable(response, body.lang, "speak")) return;
      try {
        const result = await options.voice!.synthesize({
          text: body.text,
          lang: body.lang,
          signal: AbortSignal.timeout(50_000),
        });
        response.set("Cache-Control", "no-store");
        response.json({
          mimeType: result.mimeType,
          audio: Buffer.from(result.audio).toString("base64"),
        });
      } catch (error) {
        report("speak", error);
        sendProblem(response, 502, "internal", "voice.outputFailed");
      }
    },
  );

  return router;
}
