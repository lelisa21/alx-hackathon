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

const packFiles = [
  "meta.yaml",
  "ui.yaml",
  "prompts.yaml",
  "glossary.yaml",
  "sms.yaml",
  "voice.yaml",
  "faq.yaml",
  "checks.yaml",
] as const;

const inlineTags = new Set(["b", "br", "code", "em", "i", "strong"]);
const requiredMetaFields = [
  "code",
  "name_native",
  "name_en",
  "script",
  "dir",
  "calendar",
  "fallback",
  "status",
  "stt",
  "tts",
  "sms_encoding",
  "sms_max_chars",
  "reviewed_by",
  "reviewed_on",
] as const;

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
        text: new IntlMessageFormat(raw, current).format(vars) as string,
        usedLang: current,
        didFallback: current !== lang,
      };
    }
    current = pack?.meta.fallback ?? null;
  }

  return { text: key, usedLang: "none", didFallback: true };
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
      typeof voice.bcp_tag === "string"
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

export function formatDate(date: Date, meta: LangMeta): string {
  const primaryCalendar = meta.calendar === "ethiopic" ? "ethiopic" : "gregory";
  const alternateCalendar =
    primaryCalendar === "ethiopic" ? "gregory" : "ethiopic";
  const locale = meta.code === "ar-test" ? "ar" : meta.code;

  const format = (calendar: string) =>
    new Intl.DateTimeFormat(`${locale}-ET-u-ca-${calendar}-nu-latn`, {
      calendar,
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);

  return `${format(primaryCalendar)} (${format(alternateCalendar)})`;
}

function validateMeta(
  meta: Record<string, unknown>,
  directoryName: string,
  issues: string[],
): void {
  for (const field of requiredMetaFields) {
    if (!(field in meta))
      issues.push(`${directoryName}/meta.yaml: missing ${field}`);
  }

  if (
    typeof meta.code !== "string" ||
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(meta.code)
  ) {
    issues.push(
      `${directoryName}/meta.yaml: code must be a BCP 47 language tag`,
    );
  } else if (meta.code !== directoryName) {
    issues.push(`${directoryName}/meta.yaml: code must match the folder name`);
  }
  if (typeof meta.name_native !== "string" || !meta.name_native.trim()) {
    issues.push(
      `${directoryName}/meta.yaml: name_native must be a non-empty string`,
    );
  }
  if (typeof meta.name_en !== "string" || !meta.name_en.trim()) {
    issues.push(
      `${directoryName}/meta.yaml: name_en must be a non-empty string`,
    );
  }
  if (typeof meta.script !== "string" || !meta.script.trim()) {
    issues.push(
      `${directoryName}/meta.yaml: script must be a non-empty string`,
    );
  }
  if (meta.dir !== "ltr" && meta.dir !== "rtl") {
    issues.push(`${directoryName}/meta.yaml: dir must be ltr or rtl`);
  }
  if (
    typeof meta.calendar !== "string" ||
    !["ethiopic", "gregorian", "gregory"].includes(meta.calendar)
  ) {
    issues.push(`${directoryName}/meta.yaml: unknown calendar`);
  }
  if (meta.fallback !== null && typeof meta.fallback !== "string") {
    issues.push(
      `${directoryName}/meta.yaml: fallback must be a language code or null`,
    );
  }
  if (!["live", "beta", "draft"].includes(String(meta.status))) {
    issues.push(`${directoryName}/meta.yaml: unknown status`);
  }
  if (typeof meta.stt !== "boolean") {
    issues.push(`${directoryName}/meta.yaml: stt must be a boolean`);
  }
  if (typeof meta.tts !== "boolean") {
    issues.push(`${directoryName}/meta.yaml: tts must be a boolean`);
  }
  if (!["gsm7", "ucs2"].includes(String(meta.sms_encoding))) {
    issues.push(`${directoryName}/meta.yaml: unknown sms_encoding`);
  }
  if (
    typeof meta.sms_max_chars !== "number" ||
    !Number.isInteger(meta.sms_max_chars) ||
    meta.sms_max_chars < 1
  ) {
    issues.push(
      `${directoryName}/meta.yaml: sms_max_chars must be a positive integer`,
    );
  }
}

function countEntries(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return Object.keys(asRecord(value)).length;
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringValues);
  }
  return [];
}

function validateInlineMarkup(
  value: string,
  file: string,
  issues: string[],
): void {
  const tags = value.match(/<\/?([A-Za-z][\w-]*)([^>]*)>/gu) ?? [];

  for (const tag of tags) {
    const parsed = tag.match(/^<\s*\/?\s*([A-Za-z][\w-]*)([^>]*)>$/u);
    const name = parsed?.[1]?.toLowerCase();
    const attributes = parsed?.[2]?.replace(/\/$/u, "").trim();
    if (!name || !inlineTags.has(name)) {
      issues.push(`${file}: markup tag is not allowed`);
      continue;
    }
    if (attributes) issues.push(`${file}: markup attributes are not allowed`);
  }

  if (value.replace(/<\/?([A-Za-z][\w-]*)([^>]*)>/gu, "").includes("<")) {
    issues.push(`${file}: malformed markup is not allowed`);
  }
}

export function validatePacks(root: string): string[] {
  const issues: string[] = [];
  const directories = readdirSync(root, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  );
  const packs = loadPacks(root);
  const referenceKeys = new Set(Object.keys(packs.get("en")?.ui ?? {}));

  if (directories.length === 0) issues.push("locales: no language packs found");

  for (const entry of directories) {
    const directory = path.join(root, entry.name);
    for (const file of packFiles) {
      if (!existsSync(path.join(directory, file))) {
        issues.push(`${entry.name}/${file}: required pack file is missing`);
      }
    }

    const meta = asRecord(readYaml(path.join(directory, "meta.yaml")));
    const ui = asRecord(readYaml(path.join(directory, "ui.yaml")));
    const sms = readYaml(path.join(directory, "sms.yaml"));
    const glossary = readYaml(path.join(directory, "glossary.yaml"));
    const checks = readYaml(path.join(directory, "checks.yaml"));
    validateMeta(meta, entry.name, issues);

    for (const key of referenceKeys) {
      if (!(key in ui))
        issues.push(`${entry.name}/ui.yaml: missing key ${key}`);
    }
    for (const key of Object.keys(ui)) {
      if (!referenceKeys.has(key)) {
        issues.push(`${entry.name}/ui.yaml: unknown key ${key}`);
      }
    }

    for (const [key, value] of Object.entries(ui)) {
      if (typeof value !== "string") {
        issues.push(`${entry.name}/ui.yaml: ${key} must be a string`);
        continue;
      }
      try {
        new IntlMessageFormat(value, String(meta.code));
      } catch {
        issues.push(`${entry.name}/ui.yaml: invalid ICU message for ${key}`);
      }
      validateInlineMarkup(value, `${entry.name}/ui.yaml (${key})`, issues);
    }

    if (typeof meta.sms_max_chars === "number") {
      for (const value of stringValues(sms)) {
        if ([...value].length > meta.sms_max_chars) {
          issues.push(
            `${entry.name}/sms.yaml: message exceeds sms_max_chars (${meta.sms_max_chars})`,
          );
        }
      }
    }

    if (meta.status === "live") {
      if (typeof meta.reviewed_by !== "string" || !meta.reviewed_by.trim()) {
        issues.push(
          `${entry.name}/meta.yaml: reviewed_by is required for live packs`,
        );
      }
      if (
        typeof meta.reviewed_on !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(meta.reviewed_on)
      ) {
        issues.push(
          `${entry.name}/meta.yaml: reviewed_on is required for live packs`,
        );
      }
      if (countEntries(glossary) < 200) {
        issues.push(
          `${entry.name}/glossary.yaml: live packs need at least 200 terms`,
        );
      }
      if (countEntries(checks) < 10) {
        issues.push(
          `${entry.name}/checks.yaml: live packs need at least 10 questions`,
        );
      }
    }
  }

  for (const [code, pack] of packs) {
    let fallback = pack.meta.fallback;
    const visited = new Set([code]);
    while (fallback) {
      if (!packs.has(fallback)) {
        issues.push(`${code}/meta.yaml: unknown fallback language ${fallback}`);
        break;
      }
      if (visited.has(fallback)) {
        issues.push(`${code}/meta.yaml: fallback chain contains a cycle`);
        break;
      }
      visited.add(fallback);
      fallback = packs.get(fallback)?.meta.fallback ?? null;
    }
  }

  return issues;
}
