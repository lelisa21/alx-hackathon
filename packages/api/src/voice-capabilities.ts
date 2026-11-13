import type { LangPack } from "@dimts/locales-tools";
import type { ApiConfig } from "./config.js";

export interface VoiceCapabilities {
  stt: boolean;
  tts: boolean;
  voice: { engine: "browser"; bcp_tag: string } | null;
}

/** Dialects may differ, but a voice must preserve the language and script. */
export function isMatchingVoiceLanguage(
  language: string,
  tag: string,
): boolean {
  try {
    const pack = new Intl.Locale(language).maximize();
    const voice = new Intl.Locale(tag).maximize();
    return pack.language === voice.language && pack.script === voice.script;
  } catch {
    return false;
  }
}

function isReviewed(pack: LangPack): boolean {
  const { status, reviewed_by: reviewer, reviewed_on: date } = pack.meta;
  if (
    (status !== "beta" && status !== "live") ||
    typeof reviewer !== "string" ||
    !reviewer.trim() ||
    /^(todo|tbd|unknown|none|pending)$/iu.test(reviewer.trim()) ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(date)
  )
    return false;
  const instant = Date.parse(`${date}T00:00:00Z`);
  return (
    Number.isFinite(instant) &&
    instant <= Date.now() &&
    new Date(instant).toISOString().slice(0, 10) === date
  );
}

/** Pack flags record human approval of the device protocol, never a computed score. */
export function getVoiceCapabilities(
  pack: LangPack,
  config: Pick<ApiConfig, "DIMTS_STT_ENGINE" | "DIMTS_TTS_ENGINE">,
): VoiceCapabilities {
  const unavailable: VoiceCapabilities = {
    stt: false,
    tts: false,
    voice: null,
  };
  const { engine, bcp_tag: tag } = pack.voice;
  if (
    !isReviewed(pack) ||
    engine !== "browser" ||
    typeof tag !== "string" ||
    tag.length < 2 ||
    tag.length > 35 ||
    !isMatchingVoiceLanguage(pack.meta.code, tag)
  )
    return unavailable;
  const stt = config.DIMTS_STT_ENGINE === "browser" && pack.meta.stt === true;
  const tts = config.DIMTS_TTS_ENGINE === "browser" && pack.meta.tts === true;
  return {
    stt,
    tts,
    voice: stt || tts ? { engine, bcp_tag: tag } : null,
  };
}
