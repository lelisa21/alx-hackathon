import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { IntlMessageFormat } from "intl-messageformat";
import { parse } from "yaml";
import { requiredUiKeys } from "./required-ui-keys.js";

export const packFiles = [
  "meta.yaml",
  "ui.yaml",
  "prompts.yaml",
  "glossary.yaml",
  "sms.yaml",
  "voice.yaml",
  "faq.yaml",
  "checks.yaml",
] as const;
const metaFields = [
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
];
const inlineTags = new Set(["b", "br", "code", "em", "i", "strong"]);
const dataKey = (key: string) => /^transliteration\.(map|word)\./u.test(key);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const isRecord = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : Object.values(record(value)).flatMap(strings);

function markup(value: string, file: string, issues: string[]) {
  const stack: string[] = [];
  for (const match of value.matchAll(/<([^>]*)>/gu)) {
    const tag = match[1] ?? "";
    const parsed = /^(\/?)([a-z]+)(\s*\/?)$/iu.exec(tag);
    const name = parsed?.[2]?.toLowerCase();
    if (!parsed || !name || !inlineTags.has(name)) {
      issues.push(`${file}: markup tag or attributes are not allowed`);
      continue;
    }
    if (name === "br") continue;
    if (parsed[1]) {
      if (stack.pop() !== name)
        issues.push(`${file}: unbalanced inline markup`);
    } else if (!parsed[3]?.includes("/")) stack.push(name);
  }
  if (stack.length) issues.push(`${file}: unbalanced inline markup`);
  if (value.replace(/<[^>]*>/gu, "").includes("<"))
    issues.push(`${file}: malformed markup is not allowed`);
}

function variables(message: string, code: string): string[] {
  const format = new IntlMessageFormat(message, code, undefined, {
    ignoreTag: true,
  });
  const names = new Set<string>();
  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const item = record(value);
    if (
      typeof item.type === "number" &&
      item.type >= 1 &&
      item.type <= 6 &&
      typeof item.value === "string"
    )
      names.add(`${item.value}:${item.type}`);
    Object.values(item).forEach((entry) => {
      if (typeof entry === "object" && entry !== null) visit(entry);
    });
  }
  visit(format.getAst());
  return [...names].sort();
}

function reviewDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getTime() <= Date.now()
  );
}

function validateMeta(
  meta: Record<string, unknown>,
  code: string,
  issues: string[],
) {
  const file = `${code}/meta.yaml`;
  for (const key of metaFields)
    if (!(key in meta)) issues.push(`${file}: missing ${key}`);
  try {
    if (
      meta.code !== code ||
      (code !== "ar-test" && Intl.getCanonicalLocales(code)[0] !== code)
    )
      throw new Error();
  } catch {
    issues.push(
      `${file}: code must be a canonical BCP 47 tag matching the folder`,
    );
  }
  for (const key of ["name_native", "name_en", "script"])
    if (!nonempty(meta[key]))
      issues.push(`${file}: ${key} must be a non-empty string`);
  if (typeof meta.script !== "string" || !/^[A-Z][a-z]{3}$/u.test(meta.script))
    issues.push(`${file}: script must be a four-letter ISO 15924 code`);
  for (const [key, allowed] of Object.entries({
    dir: ["ltr", "rtl"],
    calendar: ["ethiopic", "gregorian", "gregory"],
    status: ["live", "beta", "draft"],
    sms_encoding: ["gsm7", "ucs2"],
  }))
    if (!allowed.includes(String(meta[key])))
      issues.push(`${file}: unknown ${key}`);
  if (meta.fallback !== null && !nonempty(meta.fallback))
    issues.push(`${file}: fallback must be a language code or null`);
  for (const key of ["stt", "tts"])
    if (typeof meta[key] !== "boolean")
      issues.push(`${file}: ${key} must be a boolean`);
  if (
    typeof meta.sms_max_chars !== "number" ||
    !Number.isInteger(meta.sms_max_chars) ||
    meta.sms_max_chars < 1
  )
    issues.push(`${file}: sms_max_chars must be a positive integer`);
  const needsReview =
    meta.status === "live" || (code !== "en" && meta.status === "beta");
  if (
    (needsReview || meta.reviewed_by !== null) &&
    (!nonempty(meta.reviewed_by) ||
      /^(?:todo|tbd|unknown|none|pending)$/iu.test(meta.reviewed_by))
  )
    issues.push(`${file}: reviewed_by must identify the actual reviewer`);
  if (
    (needsReview || meta.reviewed_on !== null) &&
    !reviewDate(meta.reviewed_on)
  )
    issues.push(`${file}: reviewed_on must be a real, non-future ISO date`);
  if ((meta.reviewed_by === null) !== (meta.reviewed_on === null))
    issues.push(`${file}: review fields must be set together`);
  if (code === "ar-test" && meta.status !== "draft")
    issues.push(`${file}: CI-only pseudo-RTL pack must remain draft`);
}

function list(value: unknown, file: string, issues: string[]): unknown[] {
  if (!Array.isArray(value)) {
    issues.push(`${file}: must be a list`);
    return [];
  }
  return value;
}
function unique(
  values: unknown[],
  field: string,
  file: string,
  issues: string[],
) {
  const seen = new Set<unknown>();
  for (const value of values) {
    const key = record(value)[field];
    if (seen.has(key)) issues.push(`${file}: duplicate ${field}`);
    seen.add(key);
  }
}

export function validatePacks(root: string): string[] {
  const issues: string[] = [];
  if (!existsSync(root)) return ["locales: directory does not exist"];
  const directories = readdirSync(root, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  );
  if (!directories.length) return ["locales: no language packs found"];
  const packs = new Map<string, Record<string, unknown>>();
  for (const directory of directories) {
    const files: Record<string, unknown> = {};
    for (const file of packFiles) {
      const filename = path.join(root, directory.name, file);
      if (!existsSync(filename)) {
        issues.push(`${directory.name}/${file}: required pack file is missing`);
        continue;
      }
      try {
        files[file] = parse(readFileSync(filename, "utf8"), {
          maxAliasCount: 0,
        });
      } catch {
        issues.push(`${directory.name}/${file}: invalid YAML`);
      }
    }
    packs.set(directory.name, files);
  }
  const reference = record(packs.get("en")?.["ui.yaml"]);
  if (!packs.has("en")) issues.push("en: English reference pack is required");
  const requiredKeys = new Set([
    ...requiredUiKeys,
    ...Object.keys(reference).filter((key) => !dataKey(key)),
  ]);
  for (const prefix of ["month", "gmonth"])
    for (let month = 1; month <= (prefix === "month" ? 13 : 12); month++)
      requiredKeys.add(`${prefix}.${month}`);
  for (const key of [
    "number.locale",
    "number.numbering_system",
    "date.ethiopic",
    "date.gregorian",
    "date.dual",
    "notice.languageFallback",
  ])
    requiredKeys.add(key);

  for (const [code, files] of packs) {
    const meta = record(files["meta.yaml"]);
    validateMeta(meta, code, issues);
    for (const file of [
      "meta.yaml",
      "ui.yaml",
      "prompts.yaml",
      "sms.yaml",
      "voice.yaml",
    ])
      if (!isRecord(files[file]))
        issues.push(`${code}/${file}: must be a mapping`);
    const ui = record(files["ui.yaml"]);
    for (const key of requiredKeys)
      if (!(key in ui)) issues.push(`${code}/ui.yaml: missing key ${key}`);
    for (const [key, value] of Object.entries(ui)) {
      const file = `${code}/ui.yaml (${key})`;
      if (dataKey(key) && !/^transliteration\.(map|word)\.[a-z]+$/u.test(key))
        issues.push(`${file}: invalid transliteration data key`);
      if (!requiredKeys.has(key) && !dataKey(key))
        issues.push(`${file}: unknown key`);
      if (!nonempty(value)) {
        issues.push(`${file}: must be a non-empty string`);
        continue;
      }
      markup(value, file, issues);
      try {
        const args = variables(value, code);
        if (
          typeof reference[key] === "string" &&
          JSON.stringify(args) !==
            JSON.stringify(variables(reference[key], "en"))
        )
          issues.push(`${file}: ICU variables must match English`);
      } catch {
        issues.push(`${file}: invalid ICU message`);
      }
    }
    if (ui["number.numbering_system"] !== "latn")
      issues.push(`${code}/ui.yaml: number.numbering_system must be latn`);
    try {
      if (!nonempty(ui["number.locale"])) throw new Error();
      new Intl.NumberFormat(ui["number.locale"]);
    } catch {
      issues.push(`${code}/ui.yaml: invalid number.locale`);
    }

    const prompts = record(files["prompts.yaml"]);
    if (!nonempty(prompts.system_addendum))
      issues.push(`${code}/prompts.yaml: system_addendum is required`);
    if (!["extractive", "generative"].includes(String(prompts.answer_mode)))
      issues.push(`${code}/prompts.yaml: unknown answer_mode`);
    if (
      typeof prompts.floor !== "number" ||
      prompts.floor < 0 ||
      prompts.floor > 1 ||
      !Number.isFinite(prompts.floor)
    )
      issues.push(`${code}/prompts.yaml: floor must be between zero and one`);
    for (const field of ["escalation", "distress", "small_talk"]) {
      const entries = list(
        prompts[field],
        `${code}/prompts.yaml (${field})`,
        issues,
      );
      if (entries.some((entry) => !nonempty(entry)))
        issues.push(
          `${code}/prompts.yaml: ${field} entries must be non-empty strings`,
        );
      if (
        meta.status === "live" &&
        entries.length < (field === "escalation" ? 5 : 1)
      )
        issues.push(`${code}/prompts.yaml: live ${field} list is incomplete`);
    }
    const voice = record(files["voice.yaml"]);
    if (
      !("engine" in voice) ||
      !("bcp_tag" in voice) ||
      (voice.engine !== null && !nonempty(voice.engine)) ||
      (voice.bcp_tag !== null && !nonempty(voice.bcp_tag)) ||
      (voice.engine === null) !== (voice.bcp_tag === null)
    )
      issues.push(
        `${code}/voice.yaml: engine and bcp_tag must both be strings or null`,
      );
    if (nonempty(voice.bcp_tag)) {
      try {
        Intl.getCanonicalLocales(voice.bcp_tag);
      } catch {
        issues.push(`${code}/voice.yaml: invalid bcp_tag`);
      }
    }
    if (
      (meta.stt === true || meta.tts === true) &&
      (!nonempty(voice.engine) ||
        !nonempty(meta.reviewed_by) ||
        !reviewDate(meta.reviewed_on))
    )
      issues.push(
        `${code}/voice.yaml: enabled voice requires an engine and review evidence`,
      );

    const sms = record(files["sms.yaml"]);
    for (const key of [
      "help",
      "stop",
      "menu",
      "more",
      "human",
      "stopped",
      "callback",
    ]) {
      if (!nonempty(sms[key]))
        issues.push(`${code}/sms.yaml: ${key} must be a non-empty template`);
    }
    for (const [key, value] of Object.entries(sms)) {
      if (key !== "keywords" && !nonempty(value))
        issues.push(`${code}/sms.yaml: ${key} must be text`);
    }
    const keywords = record(sms.keywords);
    for (const key of ["help", "stop", "language", "jobs"]) {
      const values = keywords[key];
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.some((value) => !nonempty(value))
      )
        issues.push(
          `${code}/sms.yaml: keywords.${key} must be a non-empty string list`,
        );
    }

    const glossary = list(
      files["glossary.yaml"],
      `${code}/glossary.yaml`,
      issues,
    );
    unique(glossary, "id", `${code}/glossary.yaml`, issues);
    for (const value of glossary) {
      const entry = record(value);
      if (
        ["id", "en", "am", "om", "simple_definition"].some(
          (field) => !nonempty(entry[field]),
        ) ||
        typeof entry.do_not_translate !== "boolean"
      )
        issues.push(
          `${code}/glossary.yaml: entries require id/en/am/om/simple_definition and boolean do_not_translate`,
        );
    }
    const faq = list(files["faq.yaml"], `${code}/faq.yaml`, issues);
    unique(faq, "q", `${code}/faq.yaml`, issues);
    for (const value of faq)
      if (["q", "a", "source"].some((field) => !nonempty(record(value)[field])))
        issues.push(
          `${code}/faq.yaml: each entry requires q, a and source passage ID`,
        );
    const checks = list(files["checks.yaml"], `${code}/checks.yaml`, issues);
    unique(checks, "id", `${code}/checks.yaml`, issues);
    for (const value of checks) {
      const entry = record(value);
      const passages = entry.expect_passages ?? [];
      if (
        !nonempty(entry.id) ||
        !nonempty(entry.question) ||
        !["answer", "notfound", "escalation", "distress", "system"].includes(
          String(entry.expect),
        ) ||
        !Array.isArray(passages) ||
        passages.some((id: unknown) => !nonempty(id)) ||
        (entry.expect === "answer" && passages.length === 0)
      )
        issues.push(
          `${code}/checks.yaml: invalid id/question/expect/expect_passages`,
        );
    }
    if (meta.status === "live") {
      for (const [file, entries, minimum] of [
        ["glossary", glossary, 200],
        ["faq", faq, 30],
        ["checks", checks, 10],
      ] as const)
        if (entries.length < minimum)
          issues.push(
            `${code}/${file}.yaml: live packs need at least ${minimum} entries`,
          );
    }
    for (const [file, value] of Object.entries(files)) {
      for (const text of strings(value)) {
        markup(text, `${code}/${file}`, issues);
        if (meta.status === "live" && /\b(?:TODO|TBD|FIXME)\b/iu.test(text))
          issues.push(
            `${code}/${file}: TODO text is forbidden in live content`,
          );
        if (
          code === "om" &&
          file !== "checks.yaml" &&
          /[\u2018\u2019\u02bb\u02bc]/u.test(text)
        )
          issues.push(
            `${code}/${file}: store a straight apostrophe; variants belong in evaluation input`,
          );
      }
    }
    for (const text of strings(files["sms.yaml"])) {
      if (
        typeof meta.sms_max_chars === "number" &&
        [...text].length > meta.sms_max_chars
      )
        issues.push(
          `${code}/sms.yaml: message exceeds sms_max_chars (${meta.sms_max_chars})`,
        );
      try {
        variables(text, code);
      } catch {
        issues.push(`${code}/sms.yaml: invalid ICU message`);
      }
    }
  }
  for (const [code, files] of packs) {
    const visited = new Set([code]);
    let fallback = record(files["meta.yaml"]).fallback;
    while (nonempty(fallback)) {
      if (!packs.has(fallback)) {
        issues.push(`${code}/meta.yaml: unknown fallback language ${fallback}`);
        break;
      }
      if (visited.has(fallback)) {
        issues.push(`${code}/meta.yaml: fallback chain contains a cycle`);
        break;
      }
      visited.add(fallback);
      fallback = record(packs.get(fallback)?.["meta.yaml"]).fallback;
    }
  }
  return [...new Set(issues)];
}
