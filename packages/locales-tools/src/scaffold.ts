import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { packFiles, validatePacks } from "./validate.js";

/** Copy English as clearly unreviewed data, without overwriting an existing pack. */
export function scaffoldPack(root: string, code: string): string {
  if (
    !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/u.test(code) ||
    Intl.getCanonicalLocales(code)[0] !== code
  )
    throw new Error("Use a canonical BCP 47 language tag.");
  const destination = path.join(path.resolve(root), code);
  if (existsSync(destination))
    throw new Error("The language folder already exists.");
  if (validatePacks(root).length)
    throw new Error("Fix lang:check findings before copying the English pack.");
  const staging = mkdtempSync(path.join(path.resolve(root), ".draft-"));
  try {
    for (const file of packFiles)
      cpSync(path.join(root, "en", file), path.join(staging, file));
    const source = parse(
      readFileSync(path.join(staging, "meta.yaml"), "utf8"),
    ) as Record<string, unknown>;
    writeFileSync(
      path.join(staging, "meta.yaml"),
      stringify({
        ...source,
        code,
        name_native: code,
        name_en: code,
        fallback: "en",
        status: "draft",
        stt: false,
        tts: false,
        reviewed_by: null,
        reviewed_on: null,
      }),
    );
    writeFileSync(
      path.join(staging, "voice.yaml"),
      stringify({ engine: null, bcp_tag: null }),
    );
    renameSync(staging, destination);
    return destination;
  } finally {
    // staging is created directly inside the supplied locale root, never derived from a tag.
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}
