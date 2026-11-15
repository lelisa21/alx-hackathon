/**
 * Cloud speech through Google Gemini, for languages that browsers cannot
 * recognise or speak on the device (Amharic and Afaan Oromoo today).
 *
 * Both directions use the Gemini Interactions API (POST /v1beta/interactions),
 * as documented at https://aistudio.google.com/docs: transcription sends the
 * recording as an `audio` input item to a multimodal model (default
 * gemini-4-hydrogen); speech uses a TTS model (default
 * gemini-3.8-flash-lite-tts) with `response_format: {type:"audio"}`, which
 * returns a complete 24 kHz WAV file.
 *
 * Privacy: audio and text are sent to Google only after the learner allows
 * cloud voice for the session (consent version `cloud-voice-v1`). Dimts never
 * logs or stores the audio, the transcript or the spoken text. Google's own
 * data terms for the Gemini API apply to what is sent.
 */
import { parseRetryDelay } from "@dimts/ai";
import type { createTelegramVoice } from "@dimts/telegram";

type FileVoiceAdapters = NonNullable<
  Parameters<typeof createTelegramVoice>[0]["adapters"]
>;

export const CLOUD_VOICE_CONSENT_VERSION = "cloud-voice-v1";
export const MAX_CLOUD_AUDIO_BYTES = 2 * 1024 * 1024;
export const CLOUD_AUDIO_TYPES = [
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
] as const;
/** Interactions API revision the request and response shapes follow. */
export const GEMINI_API_REVISION = "2026-05-20";

export interface CloudVoice {
  /** Languages cloud speech recognition serves. */
  readonly languages: string[];
  /** Languages cloud read-aloud serves (a subset: TTS covers fewer). */
  readonly speakLanguages: string[];
  transcribe(input: {
    audio: Uint8Array;
    mimeType: string;
    lang: string;
    signal: AbortSignal;
  }): Promise<string>;
  synthesize(input: {
    text: string;
    lang: string;
    signal: AbortSignal;
  }): Promise<{ audio: Uint8Array; mimeType: string }>;
}

/** Content-free failure: HTTP status and the vendor's own error text. */
export class CloudVoiceError extends Error {
  readonly reason: string;
  readonly status: number | undefined;
  readonly vendorMessage: string | undefined;
  /** Quota reset reported with a 429, in milliseconds. */
  readonly retryAfterMs: number | undefined;
  /** The model that failed, for operators choosing fallbacks. */
  model: string | undefined;
  constructor(
    reason: string,
    status?: number,
    vendorMessage?: string,
    retryAfterMs?: number,
  ) {
    super(`cloud_voice_${reason}`);
    this.name = "CloudVoiceError";
    this.reason = reason;
    this.status = status;
    this.vendorMessage = vendorMessage?.replace(/\s+/gu, " ").slice(0, 240);
    this.retryAfterMs = retryAfterMs ?? parseRetryDelay(this.vendorMessage);
  }
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const LANGUAGE_HINTS: Record<string, string> = {
  en: "English",
  am: "Amharic, written in Ethiopic (Ge'ez) script",
  om: "Afaan Oromoo, written in Latin script (Qubee)",
  ti: "Tigrinya, written in Ethiopic (Ge'ez) script, not Amharic",
};

// Gemini TTS language support differs per model: Tigrinya is listed only for
// gemini-3.8-flash-tts, not the Flash-Lite TTS model
// (https://aistudio.google.com/docs/speech-generation).
const LITE_TTS_UNSUPPORTED = new Set(["ti"]);

/** 16-bit little-endian mono PCM wrapped in a WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

interface ContentItem {
  type?: string;
  text?: string;
  data?: string;
  mime_type?: string;
}
interface InteractionResponse {
  status?: string;
  output_text?: string;
  steps?: { type?: string; content?: ContentItem[] }[];
}

/** Output items of the final model turn, in order. */
function modelOutput(response: InteractionResponse): ContentItem[] {
  return (response.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? []);
}

// Gemini 3.x accepts thinking level "minimal"; Gemini 4 rejects it (400) and
// "low" is its lowest level. Gemini 4 and 3.6+ also reject `temperature`.
function generationConfig(model: string): Record<string, unknown> {
  const match = /^(?:models\/)?gemini-(\d+)(?:\.(\d+))?/u.exec(model);
  if (!match || /tts|transcribe/u.test(model)) return {};
  const major = Number(match[1]);
  const minor = Number(match[2] ?? "0");
  return {
    ...(major >= 4
      ? { thinking_level: "low" }
      : major === 3
        ? { thinking_level: "minimal" }
        : {}),
    ...(major < 3 || (major === 3 && minor < 6) ? { temperature: 0 } : {}),
  };
}

export function createGeminiVoice(options: {
  apiKey: string;
  /** Transcription models in order; later ones serve when earlier ones are
   * out of quota or down (each Gemini model has its own free-tier quota). */
  sttModel: string | string[];
  /** Read-aloud models in order, with the same fallback. */
  ttsModel: string | string[];
  languages: string[];
  speakLanguages?: string[];
  voiceName?: string;
  endpoint?: string;
  fetch?: typeof fetch;
  now?: () => number;
}): CloudVoice {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const list = (value: string | string[]) =>
    (Array.isArray(value) ? value : value.split(","))
      .map((model) => model.trim())
      .filter(Boolean);
  const sttModels = list(options.sttModel);
  const ttsModels = list(options.ttsModel);
  if (!sttModels.length || !ttsModels.length)
    throw new Error("Cloud voice needs at least one model per direction.");
  const coolUntil = new Map<string, number>();
  /** Runs `attempt` on each model in order, skipping models whose quota is
   * exhausted until it resets. A request every model would reject (invalid
   * key, bad audio) is not retried on the next model. */
  const withModels = async <T>(
    models: string[],
    signal: AbortSignal,
    attempt: (model: string) => Promise<T>,
  ): Promise<T> => {
    const ready = models.filter(
      (model) => (coolUntil.get(model) ?? 0) <= now(),
    );
    let last: unknown = new CloudVoiceError("unavailable");
    for (const model of ready.length ? ready : models) {
      if (signal.aborted) break;
      try {
        return await attempt(model);
      } catch (error) {
        if (!(error instanceof CloudVoiceError)) throw error;
        error.model = model;
        last = error;
        const status = error.status;
        if (status === 429)
          coolUntil.set(
            model,
            now() + Math.min(DAY, Math.max(MINUTE, error.retryAfterMs ?? 0)),
          );
        else if (status === 404) coolUntil.set(model, now() + 15 * MINUTE);
        else if (status !== undefined && status < 500 && status !== 408)
          throw error;
        else coolUntil.set(model, now() + MINUTE);
      }
    }
    throw last;
  };
  const endpoint = (
    options.endpoint ?? "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/$/u, "");
  const speakLanguages = (options.speakLanguages ?? options.languages).filter(
    (lang) => options.languages.includes(lang),
  );
  const interact = async (
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<InteractionResponse> => {
    let response: Response;
    try {
      response = await fetcher(`${endpoint}/interactions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": options.apiKey,
          "api-revision": GEMINI_API_REVISION,
        },
        // Stateless: Google keeps no interaction history for these calls.
        body: JSON.stringify({ ...body, store: false }),
        // Bounded per model so a slow model leaves time for the next one.
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        redirect: "error",
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new CloudVoiceError("network");
    }
    if (!response.ok) {
      let message: string | undefined;
      let retryDelay: string | undefined;
      try {
        const error = (
          JSON.parse((await response.text()).slice(0, 8_192)) as {
            error?: { message?: unknown; details?: unknown };
          }
        ).error;
        if (typeof error?.message === "string") message = error.message;
        if (Array.isArray(error?.details))
          retryDelay = error.details
            .map((detail: unknown) =>
              detail && typeof detail === "object"
                ? (detail as { retryDelay?: unknown }).retryDelay
                : undefined,
            )
            .find((value): value is string => typeof value === "string");
      } catch {
        // Keep only the status.
      }
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      throw new CloudVoiceError(
        "status",
        response.status,
        message,
        parseRetryDelay(retryDelay) ??
          (retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : undefined),
      );
    }
    try {
      return (await response.json()) as InteractionResponse;
    } catch {
      throw new CloudVoiceError("not_json", response.status);
    }
  };

  return {
    languages: [...options.languages],
    speakLanguages: [...speakLanguages],
    async transcribe({ audio, mimeType, lang, signal }) {
      if (!options.languages.includes(lang))
        throw new CloudVoiceError("language");
      const result = await withModels(sttModels, signal, (model) =>
        interact(
          {
            model,
            input: [
              {
                type: "text",
                text: `Transcribe this recording of a learner asking a question in ${LANGUAGE_HINTS[lang] ?? lang}. Write exactly what is said in that language and script. Do not translate, answer, explain or add anything. Return only the transcript.`,
              },
              {
                type: "audio",
                data: Buffer.from(audio).toString("base64"),
                mime_type: mimeType,
              },
            ],
            generation_config: generationConfig(model),
          },
          signal,
        ),
      );
      const text =
        result.output_text ??
        modelOutput(result)
          .filter((item) => item.type === "text")
          .map((item) => item.text ?? "")
          .join("");
      return text
        .trim()
        .replace(/^["“]|["”]$/gu, "")
        .trim();
    },
    async synthesize({ text, lang, signal }) {
      if (!speakLanguages.includes(lang)) throw new CloudVoiceError("language");
      const models = LITE_TTS_UNSUPPORTED.has(lang)
        ? ttsModels.filter((model) => !/lite/iu.test(model))
        : ttsModels;
      const result = await withModels(
        models.length ? models : ttsModels,
        signal,
        async (model) => {
          const reply = await interact(
            {
              model,
              input: [
                {
                  type: "user_input",
                  content: [
                    {
                      type: "text",
                      text,
                      // Style goes in metadata so the instruction is not read aloud.
                      annotations: [
                        {
                          type: "speech_metadata",
                          style: `clear, warm and calm, at a steady learning pace, in ${LANGUAGE_HINTS[lang] ?? lang}`,
                        },
                      ],
                    },
                  ],
                },
              ],
              response_format: { type: "audio" },
              generation_config: {
                speech_config: [{ voice: options.voiceName ?? "Kore" }],
              },
            },
            signal,
          );
          // A TTS reply without audio is a model failure: try the next model.
          if (
            !modelOutput(reply).some(
              (item) => item.type === "audio" && item.data,
            )
          )
            throw new CloudVoiceError("no_audio", 502);
          return reply;
        },
      );
      const output = modelOutput(result)
        .filter((item) => item.type === "audio" && item.data)
        .at(-1);
      if (!output?.data) throw new CloudVoiceError("no_audio");
      const bytes = Buffer.from(output.data, "base64");
      // Unary TTS returns a complete WAV by default; raw PCM (audio/l16) is
      // wrapped so every browser can play it.
      if (bytes.subarray(0, 4).toString("latin1") === "RIFF")
        return { audio: bytes, mimeType: "audio/wav" };
      const rate = Number(/rate=(\d+)/u.exec(output.mime_type ?? "")?.[1]);
      return {
        audio: pcmToWav(
          bytes,
          Number.isFinite(rate) && rate > 0 ? rate : 24000,
        ),
        mimeType: "audio/wav",
      };
    },
  };
}

/** Telegram voice notes (OGG/Opus) use the same transcriber. Telegram cannot
 * receive WAV, so spoken replies stay text there. */
export function cloudVoiceFileAdapters(voice: CloudVoice): FileVoiceAdapters {
  return {
    speechToText: {
      supported: (lang) => voice.languages.includes(lang),
      transcribe: (input) => voice.transcribe(input),
    },
  };
}
