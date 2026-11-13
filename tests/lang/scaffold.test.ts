import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPacks,
  validatePacks,
} from "../../packages/locales-tools/src/index.js";
import { scaffoldPack } from "../../packages/locales-tools/src/scaffold.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "dimts-scaffold-"));
  roots.push(root);
  cpSync(fileURLToPath(new URL("../../locales", import.meta.url)), root, {
    recursive: true,
  });
  return root;
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
describe("FR-LANG-13 pack scaffolder", () => {
  it("creates all eight files as an unreviewed draft with safe disabled voice in under five minutes", () => {
    const root = fixture();
    const start = performance.now();
    scaffoldPack(root, "ti");
    const pack = loadPacks(root).get("ti");
    expect(pack?.meta).toMatchObject({
      code: "ti",
      status: "draft",
      fallback: "en",
      reviewed_by: null,
      reviewed_on: null,
      stt: false,
      tts: false,
    });
    expect(Object.keys(pack?.ui ?? {})).toEqual(
      Object.keys(loadPacks(root).get("en")?.ui ?? {}),
    );
    expect(validatePacks(root)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(300_000);
  });
  it.each([
    "../escape",
    "en-US/other",
    "",
    "not_a_tag",
    "en-u",
    "en-1234-1234",
  ])("rejects invalid/unsafe language tag %s", (code) => {
    const root = fixture();
    expect(() => scaffoldPack(root, code)).toThrow();
  });
  it("does not overwrite an existing pack", () => {
    const root = fixture();
    const original = readFileSync(path.join(root, "en/meta.yaml"), "utf8");
    expect(() => scaffoldPack(root, "en")).toThrow();
    expect(readFileSync(path.join(root, "en/meta.yaml"), "utf8")).toBe(
      original,
    );
  });
  it("validates before publishing the draft folder", () => {
    const root = fixture();
    writeFileSync(path.join(root, "en/ui.yaml"), "broken: [\n");
    expect(() => scaffoldPack(root, "ti")).toThrow();
    expect(existsSync(path.join(root, "ti"))).toBe(false);
  });
});
