import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widgetDist = path.join(root, "packages", "widget", "dist");
const templatesDir = path.join(root, "packages", "widget", "public", "templates");

const widgetKey = process.env.LOCAL_WIDGET_KEY || "local-widget-public-id";
const publicApi = process.env.PUBLIC_API || "/v1";
const telegramBot = (process.env.PUBLIC_TELEGRAM_BOT || "").replace(/^@/, "");

await mkdir(widgetDist, { recursive: true });

try {
  const indexTemplatePath = path.join(templatesDir, "index.html.template");
  let indexHtml = await readFile(indexTemplatePath, "utf8");
  indexHtml = indexHtml
    .replaceAll("${LOCAL_WIDGET_KEY}", widgetKey)
    .replaceAll("${PUBLIC_API}", publicApi)
    .replaceAll("${PUBLIC_TELEGRAM_BOT}", telegramBot);
  await writeFile(path.join(widgetDist, "index.html"), indexHtml, "utf8");
  process.stdout.write("Generated packages/widget/dist/index.html\n");
} catch (err) {
  process.stderr.write(`Could not build index.html template: ${err.message}\n`);
}

try {
  const hostTemplatePath = path.join(templatesDir, "dimts-host.js.template");
  let hostJs = await readFile(hostTemplatePath, "utf8");
  hostJs = hostJs
    .replaceAll("${LOCAL_WIDGET_KEY}", widgetKey)
    .replaceAll("${PUBLIC_API}", publicApi);
  await writeFile(path.join(widgetDist, "Bridgely-host.js"), hostJs, "utf8");
  await writeFile(path.join(widgetDist, "dimts-host.js"), hostJs, "utf8");
  process.stdout.write("Generated packages/widget/dist/Bridgely-host.js\n");
} catch (err) {
  process.stderr.write(`Could not build host.js template: ${err.message}\n`);
}
