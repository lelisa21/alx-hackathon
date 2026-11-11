import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const widgetDist = path.resolve("packages/widget/dist");
const englishUiPack = path.resolve("locales/en/ui.yaml");
const javascriptLimit = 60 * 1024;
const initialLoadLimit = 150 * 1024;

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
if (javascriptAssets.length === 0) {
  throw new Error("Widget build output contains no JavaScript bundle.");
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

const javascriptBytes = sizes
  .filter(({ file }) => file.endsWith(".js"))
  .reduce((total, { compressedBytes }) => total + compressedBytes, 0);
const initialLoadBytes = sizes.reduce(
  (total, { compressedBytes }) => total + compressedBytes,
  0,
);

console.log(
  `Widget JavaScript: ${javascriptBytes} / ${javascriptLimit} compressed bytes`,
);
console.log(
  `Initial-load assets: ${initialLoadBytes} / ${initialLoadLimit} compressed bytes`,
);
if (!sizes.some(({ file }) => file === englishUiPack)) {
  console.log(
    "English UI pack is not present yet; it is not included in the initial-load total.",
  );
}

if (javascriptBytes > javascriptLimit || initialLoadBytes > initialLoadLimit) {
  process.exitCode = 1;
}
