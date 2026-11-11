import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatDate,
  getVisiblePacks,
  loadPacks,
  resolveVoice,
  suggestLanguage,
  translate,
  validatePacks,
} from "../../packages/locales-tools/src/index.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const localesRoot = path.join(projectRoot, "locales");
const temporaryRoots: string[] = [];

async function copyLocales() {
  const root = await mkdtemp(path.join(tmpdir(), "dimts-locales-"));
  temporaryRoots.push(root);
  await cp(localesRoot, root, { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("locale pack loading and translation", () => {
  it("loads every language folder without code changes", () => {
    const packs = loadPacks(localesRoot);

    expect([...packs.keys()].sort()).toEqual(["am", "ar-test", "en", "om"]);
    expect(packs.get("en")?.ui["welcome.title"]).toBeTruthy();
  });

  it("falls back along the pack chain and reports the language used", () => {
    const packs = loadPacks(localesRoot);
    const om = packs.get("om");
    if (!om) throw new Error("Missing om fixture pack");
    delete om.ui["help.button"];

    expect(translate(packs, "om", "help.button")).toEqual({
      text: packs.get("am")?.ui["help.button"],
      usedLang: "am",
      didFallback: true,
    });
  });

  it("formats ICU plural messages using each pack's language rules", () => {
    const packs = loadPacks(localesRoot);

    for (const lang of ["en", "am", "om"]) {
      expect(
        translate(packs, lang, "message.count", { count: 2 }).text,
      ).toContain("2");
    }
  });

  it("falls back to the first available voice in the language chain", () => {
    const packs = loadPacks(localesRoot);
    const am = packs.get("am");
    if (!am) throw new Error("Missing am fixture pack");
    am.voice = { engine: "local", bcp_tag: "am-ET" };

    expect(resolveVoice(packs, "om")).toEqual({
      voice: am.voice,
      usedLang: "am",
      didFallback: true,
    });
  });

  it("hides draft packs unless preview is enabled", () => {
    const packs = loadPacks(localesRoot);

    expect(getVisiblePacks(packs).map((pack) => pack.meta.code)).toEqual([
      "en",
    ]);
    expect(getVisiblePacks(packs, true).map((pack) => pack.meta.code)).toEqual([
      "am",
      "ar-test",
      "en",
      "om",
    ]);
  });

  it("suggests Amharic for Ethiopic and asks for a choice for Latin", () => {
    expect(suggestLanguage("ሰላም")).toEqual({ kind: "suggest", lang: "am" });
    expect(suggestLanguage("hello")).toEqual({
      kind: "choose",
      languages: ["om", "en"],
    });
    expect(suggestLanguage("123")).toBeNull();
  });

  it("formats the configured calendar with the alternate calendar in brackets", () => {
    const packs = loadPacks(localesRoot);
    for (const [lang, expectedMonth] of [
      ["am", "ኅዳር"],
      ["om", "Sadaasa"],
    ]) {
      const pack = packs.get(lang);
      if (!pack) throw new Error(`Missing ${lang} fixture pack`);
      const formatted = formatDate(
        new Date("2026-11-14T12:00:00.000Z"),
        pack.meta,
      );
      expect(formatted).toMatch(/5.*2019/);
      expect(formatted).toContain(expectedMonth);
      expect(formatted).toMatch(/\(.*2026.*\)/);
    }
  });
});

describe("locale pack validation", () => {
  it("accepts the checked-in draft packs", () => {
    expect(validatePacks(localesRoot)).toEqual([]);
  });

  it("reports missing metadata and UI keys", async () => {
    const root = await copyLocales();
    const metaPath = path.join(root, "om", "meta.yaml");
    const meta = (await readFile(metaPath, "utf8")).replace(
      "sms_max_chars: 160\n",
      "",
    );
    await writeFile(metaPath, meta);

    const uiPath = path.join(root, "om", "ui.yaml");
    const ui = (await readFile(uiPath, "utf8")).replace(
      /^help\.button:.*\r?\n/m,
      "",
    );
    await writeFile(uiPath, ui);

    const issues = validatePacks(root);
    expect(issues.join("\n")).toContain("sms_max_chars");
    expect(issues.join("\n")).toContain("help.button");
  });

  it("rejects malformed ICU messages and non-whitelisted markup", async () => {
    const root = await copyLocales();
    const uiPath = path.join(root, "en", "ui.yaml");
    const ui = (await readFile(uiPath, "utf8"))
      .replace(
        /^review\.heard:.*\r?\n/m,
        "review.heard: '{text, plural, one {heard}}'\n",
      )
      .replace(
        /^share\.ask:.*\r?\n/m,
        'share.ask: "<script>alert(1)</script>"\n',
      )
      .replace(
        /^share\.stop:.*\r?\n/m,
        'share.stop: "<custom>unsupported</custom>"\n',
      );
    await writeFile(uiPath, ui);

    const issues = validatePacks(root).join("\n");
    expect(issues).toContain("review.heard");
    expect(issues).toContain("share.ask");
    expect(issues).toContain("share.stop");
  });

  it("rejects live packs without reviewer sign-off and required content", async () => {
    const root = await copyLocales();
    const metaPath = path.join(root, "en", "meta.yaml");
    const meta = (await readFile(metaPath, "utf8")).replace(
      "status: beta",
      "status: live",
    );
    await writeFile(metaPath, meta);

    const issues = validatePacks(root).join("\n");
    expect(issues).toContain("reviewed_by");
    expect(issues).toContain("glossary");
    expect(issues).toContain("checks");
  });

  it("rejects SMS strings longer than the configured character budget", async () => {
    const root = await copyLocales();
    const smsPath = path.join(root, "en", "sms.yaml");
    await writeFile(smsPath, `long_message: "${"x".repeat(161)}"\n`);

    expect(validatePacks(root).join("\n")).toContain("sms_max_chars");
  });
});
