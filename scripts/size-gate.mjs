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

const assets = files.filter((file) => /\.(?:js|css)$/.test(file));
const javascriptAssets = assets.filter((file) => file.endsWith(".js"));
const widgetJavaScriptAssets = javascriptAssets.filter(
  (file) => path.basename(file) !== helperBundleName,
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
const initialLoadBytes = sizes
  .filter(({ file }) => !helperJavaScriptAssets.includes(file))
  .reduce((total, { compressedBytes }) => total + compressedBytes, 0);

console.log(
  `Widget JavaScript: ${widgetJavaScriptBytes} / ${javascriptLimit} compressed bytes`,
);
console.log(
  `Helper console JavaScript: ${helperJavaScriptBytes} / ${javascriptLimit} compressed bytes`,
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
  initialLoadBytes > initialLoadLimit
) {
  process.exitCode = 1;
}
