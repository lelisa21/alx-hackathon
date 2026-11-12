import { randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const sourceScript = fileURLToPath(
  new URL("../scripts/size-gate.mjs", import.meta.url),
);

let fixtureRoot = "";
let scriptPath = "";
let widgetDist = "";
let englishUiPack = "";
let outsideWorkingDirectory = "";

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "dimts-size-gate-"));
  const scriptsDirectory = path.join(fixtureRoot, "scripts");
  widgetDist = path.join(fixtureRoot, "packages", "widget", "dist");
  englishUiPack = path.join(fixtureRoot, "locales", "en", "ui.yaml");
  outsideWorkingDirectory = path.join(fixtureRoot, "outside");
  scriptPath = path.join(scriptsDirectory, "size-gate.mjs");

  await Promise.all([
    mkdir(scriptsDirectory, { recursive: true }),
    mkdir(widgetDist, { recursive: true }),
    mkdir(path.dirname(englishUiPack), { recursive: true }),
    mkdir(outsideWorkingDirectory),
  ]);
  await copyFile(sourceScript, scriptPath);
});

afterEach(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

function runSizeGate(cwd = fixtureRoot) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
  });
}

async function writeEnglishPack() {
  await writeFile(englishUiPack, "welcome: Hello\n");
}

describe("widget size gate", () => {
  it("finds build assets relative to the script when run from another directory", async () => {
    await Promise.all([
      writeFile(path.join(widgetDist, "dimts-widget.js"), "export {};\n"),
      writeFile(
        path.join(widgetDist, "dimts-helper-console.js"),
        "export {};\n",
      ),
      writeFile(
        path.join(widgetDist, "widget.css"),
        "body { color: black; }\n",
      ),
      writeEnglishPack(),
    ]);

    const result = runSizeGate(outsideWorkingDirectory);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Widget JavaScript:");
    expect(result.stdout).toContain("Initial-load assets:");
  });

  it("fails when compressed widget JavaScript exceeds its budget", async () => {
    await Promise.all([
      writeFile(
        path.join(widgetDist, "dimts-widget.js"),
        randomBytes(64 * 1024),
      ),
      writeFile(
        path.join(widgetDist, "dimts-helper-console.js"),
        "export {};\n",
      ),
      writeEnglishPack(),
    ]);

    const result = runSizeGate();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Widget JavaScript:");
    expect(result.stderr).toBe("");
  });

  it("fails when the initial-load asset budget is exceeded", async () => {
    await Promise.all([
      writeFile(path.join(widgetDist, "dimts-widget.js"), "export {};\n"),
      writeFile(
        path.join(widgetDist, "dimts-helper-console.js"),
        "export {};\n",
      ),
      writeFile(path.join(widgetDist, "widget.css"), randomBytes(160 * 1024)),
      writeEnglishPack(),
    ]);

    const result = runSizeGate();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Initial-load assets:");
    expect(result.stderr).toBe("");
  });

  it("fails when the build contains no JavaScript bundle", async () => {
    await Promise.all([
      writeFile(
        path.join(widgetDist, "widget.css"),
        "body { color: black; }\n",
      ),
      writeEnglishPack(),
    ]);

    const result = runSizeGate();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Widget build output contains no widget bundle.",
    );
  });

  it("measures the helper console separately from the learner initial load", async () => {
    await Promise.all([
      writeFile(
        path.join(widgetDist, "dimts-widget.js"),
        randomBytes(50 * 1024),
      ),
      writeFile(
        path.join(widgetDist, "dimts-helper-console.js"),
        randomBytes(50 * 1024),
      ),
      writeEnglishPack(),
    ]);

    const result = runSizeGate();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Widget JavaScript:");
    expect(result.stdout).toContain("Helper console JavaScript:");
  });

  it("fails when the helper console is over its independent budget", async () => {
    await Promise.all([
      writeFile(path.join(widgetDist, "dimts-widget.js"), "export {};\n"),
      writeFile(
        path.join(widgetDist, "dimts-helper-console.js"),
        randomBytes(64 * 1024),
      ),
      writeEnglishPack(),
    ]);

    const result = runSizeGate();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Helper console JavaScript:");
  });

  it("fails when the separately built helper console is missing", async () => {
    await Promise.all([
      writeFile(path.join(widgetDist, "dimts-widget.js"), "export {};\n"),
      writeEnglishPack(),
    ]);

    const result = runSizeGate();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Widget build output contains no helper console bundle.",
    );
  });
});
