/**
 * Cloud speech through Google Gemini, for languages that browsers cannot
 * recognise or speak on the device (Amharic and Afaan Oromoo today).
 *
 * Privacy: audio and text are sent to Google only after the learner allows
 * cloud voice for the session (consent version `cloud-voice-v1`). Dimts never
 * logs or stores the audio, the transcript or the spoken text. Google's own
 * data terms for the Gemini API apply to what is sent.
 */
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

export interface CloudVoice {
  readonly languages: string[];
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

const LANGUAGE_HINTS: Record<string, string> = {
  en: "English",
  am: "Amharic, written in Ethiopic (Ge'ez) script",
  om: "Afaan Oromoo, written in Latin script (Qubee)",
};

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

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

export function createGeminiVoice(options: {
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  languages: string[];
  voiceName?: string;
  endpoint?: string;
  fetch?: typeof fetch;
}): CloudVoice {
  const fetcher = options.fetch ?? fetch;
  const endpoint = (
    options.endpoint ?? "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/$/u, "");
  const call = async (
    model: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<GeminiPart[]> => {
    const response = await fetcher(
      `${endpoint}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": options.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error(`cloud_voice_status_${response.status}`);
    const json = (await response.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] } }[];
    };
    return json.candidates?.[0]?.content?.parts ?? [];
  };
  const thinking = (model: string) =>
    /^gemini-3\./u.test(model)
      ? { thinkingConfig: { thinkingLevel: "minimal" } }
      : {};
  const supported = (lang: string) => options.languages.includes(lang);

  return {
    languages: [...options.languages],
    async transcribe({ audio, mimeType, lang, signal }) {
      if (!supported(lang)) throw new Error("cloud_voice_language");
      const parts = await call(
        options.sttModel,
        {
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: Buffer.from(audio).toString("base64"),
                  },
                },
                {
                  text: `Transcribe this recording of a learner asking a question in ${LANGUAGE_HINTS[lang] ?? lang}. Write exactly what is said in that language and script. Do not translate, answer, explain or add anything. Return only the transcript.`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0, ...thinking(options.sttModel) },
        },
        signal,
      );
      return parts
        .map((part) => part.text ?? "")
        .join("")
        .trim()
        .replace(/^["“]|["”]$/gu, "");
    },
    async synthesize({ text, lang, signal }) {
      if (!supported(lang)) throw new Error("cloud_voice_language");
      const parts = await call(
        options.ttsModel,
        {
          contents: [
            {
              parts: [
                {
                  text: `Read this aloud clearly and warmly in ${LANGUAGE_HINTS[lang] ?? lang}, exactly as written:\n${text}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: options.voiceName ?? "Kore" },
              },
            },
          },
        },
        signal,
      );
      const inline = parts.find((part) => part.inlineData?.data)?.inlineData;
      if (!inline?.data) throw new Error("cloud_voice_no_audio");
      const pcm = Buffer.from(inline.data, "base64");
      const rate = Number(/rate=(\d+)/u.exec(inline.mimeType ?? "")?.[1]);
      return {
        audio: pcmToWav(pcm, Number.isFinite(rate) && rate > 0 ? rate : 24000),
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
