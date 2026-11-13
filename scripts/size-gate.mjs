import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const widgetDist = path.join(repositoryRoot, "packages", "widget", "dist");
const englishUiPack = path.join(repositoryRoot, "locales", "en", "ui.yaml");
const javascriptLimit = 60 * 1024;
const initialLoadLimit = 150 * 1024;
const widgetBundleName = "dimts-widget.js";
const helperBundleName = "dimts-helper-console.js";
const simulatorBundleName = "dimts-sms-simulator.js";

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(entryPath)));
    else files.push(entryPath);
  }
  return files;
}

let files;
try {
  files = await filesUnder(widgetDist);
} catch (error) {
  if (error.code === "ENOENT") {
    throw new Error(
      "Widget build output is missing; run the widget build before the size gate.",
      {
        cause: error,
      },
    );
  }
  throw error;
}

const assets = files.filter(
  (file) =>
    /\.(?:js|css|woff2)$/.test(file) ||
    path.basename(file) === "dimts-assets.json",
);
const javascriptAssets = assets.filter((file) => file.endsWith(".js"));
let widgetJavaScriptAssets = javascriptAssets.filter(
  (file) =>
    ![helperBundleName, simulatorBundleName].includes(path.basename(file)),
);
const simulatorJavaScriptAssets = javascriptAssets.filter(
  (file) => path.basename(file) === simulatorBundleName,
);
const helperJavaScriptAssets = javascriptAssets.filter(
  (file) => path.basename(file) === helperBundleName,
);
if (
  !widgetJavaScriptAssets.some(
    (file) => path.basename(file) === widgetBundleName,
  )
) {
  throw new Error("Widget build output contains no widget bundle.");
}
if (helperJavaScriptAssets.length === 0) {
  throw new Error("Widget build output contains no helper console bundle.");
}

// Vite's static import graph is the initial load. Dynamic voice/help imports
// are reported separately, never silently folded into or omitted from the graph.
let initialAssets = assets.filter(
  (file) =>
    !helperJavaScriptAssets.includes(file) &&
    !simulatorJavaScriptAssets.includes(file),
);
let deferredJavaScriptAssets = [];
const manifestPath = path.join(widgetDist, ".vite", "manifest.json");
if (files.includes(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const initial = new Set();
  const visited = new Set();
  function include(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk)
      throw new Error(`Initial-load manifest entry is missing: ${key}`);
    for (const name of [
      chunk.file,
      ...(chunk.css ?? []),
      ...(chunk.assets ?? []),
    ]) {
      const file = path.resolve(widgetDist, name);
      if (!file.startsWith(widgetDist + path.sep) || !files.includes(file))
        throw new Error(
          "Initial-load asset is missing or outside the build directory.",
        );
      initial.add(file);
    }
    for (const imported of chunk.imports ?? []) include(imported);
  }
  include("src/loader.ts");
  const bootstrap = path.join(widgetDist, "dimts-embed.js");
  if (!files.includes(bootstrap))
    throw new Error("Embed bootstrap build output is missing.");
  initial.add(bootstrap);
  // The service worker and its precache manifest are fetched on first install.
  for (const name of ["service-worker.js", "dimts-assets.json"]) {
    const file = path.join(widgetDist, name);
    if (files.includes(file)) initial.add(file);
  }
  initialAssets = [...initial];
  widgetJavaScriptAssets = initialAssets.filter((file) => file.endsWith(".js"));
  deferredJavaScriptAssets = javascriptAssets.filter(
    (file) =>
      !initial.has(file) &&
      !helperJavaScriptAssets.includes(file) &&
      !simulatorJavaScriptAssets.includes(file) &&
      path.basename(file) !== "service-worker.js",
  );
}

const localeAssets = await readFile(englishUiPack).then(
  () => [englishUiPack],
  (error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  },
);
const sizes = await Promise.all(
  [...assets, ...localeAssets].map(async (file) => ({
    file,
    compressedBytes: gzipSync(await readFile(file)).byteLength,
  })),
);

const widgetJavaScriptBytes = sizes
  .filter(({ file }) => widgetJavaScriptAssets.includes(file))
  .reduce((total, { compressedBytes }) => total + compressedBytes, 0);
const helperJavaScriptBytes = sizes
  .filter(({ file }) => helperJavaScriptAssets.includes(file))
  .reduce((total, { compressedBytes }) => total + compressedBytes, 0);
const simulatorJavaScriptBytes = sizes
  .filter(({ file }) => simulatorJavaScriptAssets.includes(file))
  .reduce((total, { compressedBytes }) => total + compressedBytes, 0);
let initialLoadBytes = sizes
  .filter(
    ({ file }) => initialAssets.includes(file) || localeAssets.includes(file),
  )
  .reduce((total, { compressedBytes }) => total + compressedBytes, 0);
const localeSizesPath = path.join(widgetDist, "dimts-locale-ui-sizes.json");
if (files.includes(localeSizesPath)) {
  const localeSizes = Object.values(
    JSON.parse(await readFile(localeSizesPath, "utf8")),
  );
  if (
    !localeSizes.length ||
    !localeSizes.every((size) => Number.isInteger(size) && size > 0)
  )
    throw new Error("Invalid locale UI size manifest.");
  initialLoadBytes -= sizes
    .filter(({ file }) => localeAssets.includes(file))
    .reduce((total, { compressedBytes }) => total + compressedBytes, 0);
  initialLoadBytes += Math.max(...localeSizes);
}
const faqSizesPath = path.join(widgetDist, "dimts-faq-sizes.json");
if (files.includes(faqSizesPath)) {
  const faqSizes = Object.values(
    JSON.parse(await readFile(faqSizesPath, "utf8")),
  );
  if (
    !faqSizes.length ||
    !faqSizes.every((size) => Number.isInteger(size) && size > 0)
  )
    throw new Error("Invalid authored FAQ budget manifest.");
  initialLoadBytes += Math.max(...faqSizes);
}

console.log(
  `Widget JavaScript: ${widgetJavaScriptBytes} / ${javascriptLimit} compressed bytes`,
);
console.log(
  `Helper console JavaScript: ${helperJavaScriptBytes} / ${javascriptLimit} compressed bytes`,
);
console.log(
  `SMS simulator JavaScript: ${simulatorJavaScriptBytes} / ${javascriptLimit} compressed bytes`,
);
console.log(
  `Deferred JavaScript: ${sizes.filter(({ file }) => deferredJavaScriptAssets.includes(file)).reduce((total, { compressedBytes }) => total + compressedBytes, 0)} compressed bytes`,
);
console.log(
  `Initial-load assets: ${initialLoadBytes} / ${initialLoadLimit} compressed bytes`,
);
if (!sizes.some(({ file }) => file === englishUiPack)) {
  console.log(
    "English UI pack is not present yet; it is not included in the initial-load total.",
  );
}

if (
  widgetJavaScriptBytes > javascriptLimit ||
  helperJavaScriptBytes > javascriptLimit ||
  simulatorJavaScriptBytes > javascriptLimit ||
  initialLoadBytes > initialLoadLimit
) {
  process.exitCode = 1;
}
