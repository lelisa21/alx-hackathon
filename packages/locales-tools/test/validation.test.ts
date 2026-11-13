import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { validatePacks } from "../src/index.js";

const locales = fileURLToPath(new URL("../../../locales", import.meta.url));
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "dimts-validation-"));
  roots.push(root);
  cpSync(locales, root, { recursive: true });
  return root;
}
function edit(
  root: string,
  file: string,
  update: (value: Record<string, unknown>) => unknown,
) {
  const target = path.join(root, file);
  writeFileSync(
    target,
    stringify(
      update(parse(readFileSync(target, "utf8")) as Record<string, unknown>),
    ),
  );
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

describe("P01 language data validation", () => {
  it("rejects malformed script codes", () => {
    const root = fixture();
    edit(root, "en/meta.yaml", (value) => ({ ...value, script: "nonsense" }));
    expect(validatePacks(root).join("\n")).toContain("script");
  });
  it("rejects missing SMS templates and non-text keyword values", () => {
    const root = fixture();
    edit(root, "en/sms.yaml", (value) => ({
      ...value,
      help: 12,
      keywords: { stop: [false] },
    }));
    const errors = validatePacks(root).join("\n");
    expect(errors).toContain("sms.yaml: help");
    expect(errors).toContain("sms.yaml: keywords.stop");
  });
  it("rejects recursive YAML aliases instead of crashing validation", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "en/sms.yaml"),
      "loop: &loop\n  self: *loop\n",
    );
    expect(() => validatePacks(root)).not.toThrow();
    expect(validatePacks(root).join("\n")).toContain("en/sms.yaml");
  });
  it("rejects removal of a required application key even when every pack removes it", () => {
    const root = fixture();
    for (const code of ["en", "am", "om", "ar-test"]) {
      edit(root, `${code}/ui.yaml`, (value) => {
        delete value["help.button"];
        return value;
      });
    }
    expect(validatePacks(root)).toContain(
      "en/ui.yaml: missing key help.button",
    );
  });
  it("reports malformed YAML without throwing or echoing its contents", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "am/prompts.yaml"),
      "secret_private_phrase: [",
    );
    const errors = validatePacks(root).join("\n");
    expect(errors).toContain("am/prompts.yaml");
    expect(errors).not.toContain("secret_private_phrase");
  });
  it.each(["prompts", "voice", "sms"])(
    "rejects the wrong %s document shape",
    (name) => {
      const root = fixture();
      writeFileSync(path.join(root, `en/${name}.yaml`), "[]\n");
      expect(validatePacks(root).join("\n")).toContain(`${name}.yaml`);
    },
  );
  it.each(["glossary", "faq", "checks"])(
    "rejects malformed %s entries",
    (name) => {
      const root = fixture();
      writeFileSync(path.join(root, `en/${name}.yaml`), "- broken: true\n");
      expect(validatePacks(root).join("\n")).toContain(`${name}.yaml`);
    },
  );
  it("checks markup in all pack files, balanced tags and missing ICU arguments", () => {
    const root = fixture();
    edit(root, "en/prompts.yaml", (value) => ({
      ...value,
      small_talk: ["<img src=x>"],
    }));
    edit(root, "am/ui.yaml", (value) => ({
      ...value,
      "review.heard": "No variable",
      "help.button": "<b>Help</i>",
    }));
    const errors = validatePacks(root).join("\n");
    expect(errors).toContain("en/prompts.yaml");
    expect(errors).toContain("review.heard");
    expect(errors).toContain("help.button");
  });
  it("requires native review before am/om become beta", () => {
    const root = fixture();
    edit(root, "am/meta.yaml", (value) => ({ ...value, status: "beta" }));
    expect(validatePacks(root).join("\n")).toContain(
      "am/meta.yaml: reviewed_by",
    );
  });
  it("rejects impossible review dates and live TODO phrases, requires sourced FAQs", () => {
    const root = fixture();
    edit(root, "en/meta.yaml", (value) => ({
      ...value,
      status: "live",
      reviewed_by: "review fixture",
      reviewed_on: "2026-02-30",
    }));
    edit(root, "en/prompts.yaml", (value) => ({
      ...value,
      distress: ["TODO"],
    }));
    writeFileSync(
      path.join(root, "en/faq.yaml"),
      "- q: Question\n  a: Answer\n",
    );
    const errors = validatePacks(root).join("\n");
    expect(errors).toContain("reviewed_on");
    expect(errors).toContain("TODO");
    expect(errors).toContain("30");
    expect(errors).toContain("source");
  });
  it("rejects unsupported voice claims and inconsistent engine declarations", () => {
    const root = fixture();
    edit(root, "en/meta.yaml", (value) => ({ ...value, tts: true }));
    expect(validatePacks(root).join("\n")).toContain("voice.yaml");
  });
  it("rejects curly apostrophes in stored Oromo copy, leaving evaluation variants allowed", () => {
    const root = fixture();
    edit(root, "om/ui.yaml", (value) => ({
      ...value,
      "help.button": "Waa’ee",
    }));
    expect(validatePacks(root).join("\n")).toContain("straight apostrophe");
  });
  it("does not allow CI pseudo-RTL data to become public", () => {
    const root = fixture();
    edit(root, "ar-test/meta.yaml", (value) => ({ ...value, status: "beta" }));
    expect(validatePacks(root).join("\n")).toContain("ar-test");
  });
  it("rejects duplicate IDs instead of accepting padded glossary counts", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "en/glossary.yaml"),
      stringify(
        Array.from({ length: 200 }, () => ({
          id: "same",
          en: "word",
          am: "ቃል",
          om: "jecha",
          simple_definition: "A word",
          do_not_translate: false,
        })),
      ),
    );
    expect(validatePacks(root).join("\n")).toContain("duplicate");
  });
});
