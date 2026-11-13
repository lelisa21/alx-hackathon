import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { IntlMessageFormat } from "intl-messageformat";
import { parse } from "yaml";

export interface LangMeta {
  code: string;
  name_native: string;
  name_en: string;
  script: string;
  dir: "ltr" | "rtl";
  calendar: string;
  fallback: string | null;
  status: "live" | "beta" | "draft";
  stt: boolean;
  tts: boolean;
  sms_encoding: "gsm7" | "ucs2";
  sms_max_chars: number;
  reviewed_by: string | null;
  reviewed_on: string | null;
}

export interface LangPack {
  meta: LangMeta;
  ui: Record<string, string>;
  prompts: Record<string, unknown>;
  glossary: unknown;
  sms: unknown;
  voice: Record<string, unknown>;
  faq: unknown;
  checks: unknown;
}

export interface Translation {
  text: string;
  usedLang: string;
  didFallback: boolean;
}

export interface VoiceResolution {
  voice: Record<string, unknown> | null;
  usedLang: string;
  didFallback: boolean;
}

export interface UiResolution {
  ui: Record<string, string>;
  usedLanguages: string[];
  didFallback: boolean;
}

function readYaml(filePath: string): unknown {
  if (!existsSync(filePath)) return {};
  return parse(readFileSync(filePath, "utf8")) ?? {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function loadPacks(root: string): Map<string, LangPack> {
  const packs = new Map<string, LangPack>();

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const directory = path.join(root, entry.name);
    const meta = readYaml(path.join(directory, "meta.yaml")) as LangMeta;
    if (!meta || typeof meta.code !== "string") continue;

    packs.set(entry.name, {
      meta,
      ui: asRecord(readYaml(path.join(directory, "ui.yaml"))) as Record<
        string,
        string
      >,
      prompts: asRecord(readYaml(path.join(directory, "prompts.yaml"))),
      glossary: readYaml(path.join(directory, "glossary.yaml")),
      sms: readYaml(path.join(directory, "sms.yaml")),
      voice: asRecord(readYaml(path.join(directory, "voice.yaml"))),
      faq: readYaml(path.join(directory, "faq.yaml")),
      checks: readYaml(path.join(directory, "checks.yaml")),
    });
  }

  return packs;
}

export function translate(
  packs: Map<string, LangPack>,
  lang: string,
  key: string,
  vars: Record<string, unknown> = {},
): Translation {
  const visited = new Set<string>();
  let current: string | null = lang;

  while (current && !visited.has(current)) {
    visited.add(current);
    const pack = packs.get(current);
    const raw = pack?.ui[key];
    if (typeof raw === "string") {
      return {
        text: String(
          new IntlMessageFormat(raw, current, undefined, {
            ignoreTag: true,
          }).format(vars),
        ),
        usedLang: current,
        didFallback: current !== lang,
      };
    }
    current = pack?.meta.fallback ?? null;
  }

  return { text: key, usedLang: "none", didFallback: true };
}

/** Merge raw ICU messages by their configured chain, retaining requested-language values. */
export function resolveUi(
  packs: Map<string, LangPack>,
  lang: string,
): UiResolution {
  const ui: Record<string, string> = {};
  const usedLanguages: string[] = [];
  const visited = new Set<string>();
  let current: string | null = lang;
  while (current && !visited.has(current)) {
    visited.add(current);
    const pack = packs.get(current);
    for (const [key, value] of Object.entries(pack?.ui ?? {})) {
      // Input-method data is a language capability, not translated interface copy.
      if (current !== lang && /^transliteration\.(map|word)\./u.test(key))
        continue;
      if (!(key in ui) && typeof value === "string") {
        ui[key] = value;
        if (!usedLanguages.includes(current)) usedLanguages.push(current);
      }
    }
    current = pack?.meta.fallback ?? null;
  }
  return {
    ui,
    usedLanguages,
    didFallback:
      !packs.has(lang) || usedLanguages.some((code) => code !== lang),
  };
}

export function resolveVoice(
  packs: Map<string, LangPack>,
  lang: string,
): VoiceResolution {
  const visited = new Set<string>();
  let current: string | null = lang;

  while (current && !visited.has(current)) {
    visited.add(current);
    const pack = packs.get(current);
    const voice = pack?.voice;
    if (
      typeof voice?.engine === "string" &&
      voice.engine.trim().length > 0 &&
      typeof voice.bcp_tag === "string" &&
      voice.bcp_tag.trim().length > 0
    ) {
      return {
        voice,
        usedLang: current,
        didFallback: current !== lang,
      };
    }
    current = pack?.meta.fallback ?? null;
  }

  return { voice: null, usedLang: "none", didFallback: true };
}

export function getVisiblePacks(
  packs: Map<string, LangPack>,
  langPreview = false,
): LangPack[] {
  return [...packs.values()]
    .filter((pack) => langPreview || pack.meta.status !== "draft")
    .sort((left, right) => left.meta.code.localeCompare(right.meta.code));
}

export function suggestLanguage(
  text: string,
):
  | { kind: "suggest"; lang: "am" }
  | { kind: "choose"; languages: ["om", "en"] }
  | null {
  if (/[\u1200-\u137f]/u.test(text)) return { kind: "suggest", lang: "am" };
  if (/[A-Za-z]/u.test(text))
    return { kind: "choose", languages: ["om", "en"] };
  return null;
}

export { formatDate, formatNumber, toEthiopian } from "./formatting.js";
export { validatePacks } from "./validate.js";
