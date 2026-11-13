import { expect, it } from "vitest";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import widgetConfig from "../vite.config.js";
import embedConfig from "../vite.embed.config.js";

it("NFR-PERF-02 builds one complete widget module directly behind the async bootstrap", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const widget = await build({
    ...widgetConfig,
    configFile: false,
    root,
    logLevel: "silent",
    build: { ...widgetConfig.build, write: false },
  });
  const widgetOutputs = (Array.isArray(widget) ? widget : [widget]).flatMap(
    (result) => ("output" in result ? result.output : []),
  );
  const entries = widgetOutputs.filter(
    (item) => item.type === "chunk" && item.isEntry,
  );
  expect(entries.map((entry) => entry.fileName)).toEqual(["dimts-widget.js"]);
  const entry = entries[0]!;
  if (entry.type !== "chunk") throw new Error("Missing widget entry");
  expect(entry.imports).toEqual([]);
  expect(entry.exports).toEqual(
    expect.arrayContaining(["DimtsAssistant", "installEmbed"]),
  );
  expect(entry.dynamicImports.length).toBeGreaterThanOrEqual(2);

  const bootstrap = await build({
    ...embedConfig,
    configFile: false,
    root,
    logLevel: "silent",
    build: { ...embedConfig.build, write: false },
  });
  const bootstrapOutputs = (
    Array.isArray(bootstrap) ? bootstrap : [bootstrap]
  ).flatMap((result) => ("output" in result ? result.output : []));
  const script = bootstrapOutputs.find(
    (item) => item.type === "chunk" && item.fileName === "dimts-embed.js",
  );
  if (script?.type !== "chunk") throw new Error("Missing classic bootstrap");
  expect(script.code).toContain("./dimts-widget.js");
  expect(script.code).not.toContain("dimts-loader.js");
}, 20_000);
