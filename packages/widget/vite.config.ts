import { defineConfig } from "vite";
import { loadPacks } from "../locales-tools/src/index.js";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

export default defineConfig({
  plugins: [
    {
      name: "dimts-private-lit-metadata",
      enforce: "pre",
      resolveId(id) {
        return id === "virtual:dimts-lit-metadata"
          ? "\0dimts-lit-metadata"
          : null;
      },
      load(id) {
        if (id !== "\0dimts-lit-metadata") return null;
        // Reuse an existing host map for decorator interoperability, but never
        // create a property on window. All bundled Lit modules share this cell.
        return "const existing = globalThis.litPropertyMetadata; export const state = { value: existing instanceof WeakMap ? existing : new WeakMap() };";
      },
      transform(code, id) {
        if (
          !id.replaceAll("\\", "/").includes("/@lit/reactive-element/") ||
          !code.includes("litPropertyMetadata")
        )
          return null;
        // Lit 2.1 uses both an aliased global member and a bare global binding.
        // Redirect both reads and initialization; do not delete functional data
        // after class registration. This also covers the bundled decorators.
        const isolated = code.replace(
          /\b(?:[\w$]+\.)?litPropertyMetadata\b/gu,
          "dimtsLitMetadata.value",
        );
        return {
          code: `import { state as dimtsLitMetadata } from "virtual:dimts-lit-metadata";\n${isolated}`,
          map: null,
        };
      },
    },
    {
      name: "dimts-bootstrap-ui",
      resolveId(id) {
        return id === "virtual:dimts-bootstrap-ui"
          ? "\0dimts-bootstrap-ui"
          : null;
      },
      load(id) {
        if (id !== "\0dimts-bootstrap-ui") return null;
        const packs = loadPacks(
          fileURLToPath(new URL("../../locales", import.meta.url)),
        );
        return `export default ${JSON.stringify(packs.get("en")!.ui)};`;
      },
      generateBundle(_options, bundle) {
        const assets = new Set<string>(["dimts-embed.js"]);
        const visit = (file: string) => {
          if (assets.has(file)) return;
          assets.add(file);
          const item = bundle[file];
          if (item?.type === "chunk")
            for (const imported of item.imports) visit(imported);
        };
        visit("dimts-widget.js");
        this.emitFile({
          type: "asset",
          fileName: "dimts-assets.json",
          source: JSON.stringify({ assets: [...assets] }),
        });
        const packs = loadPacks(
          fileURLToPath(new URL("../../locales", import.meta.url)),
        );
        this.emitFile({
          type: "asset",
          fileName: "dimts-locale-ui-sizes.json",
          source: JSON.stringify(
            Object.fromEntries(
              [...packs].map(([code, pack]) => [
                code,
                gzipSync(JSON.stringify(pack.ui)).byteLength,
              ]),
            ),
          ),
        });
        this.emitFile({
          type: "asset",
          fileName: "dimts-faq-sizes.json",
          source: JSON.stringify(
            Object.fromEntries(
              [...packs].map(([code, pack]) => {
                // Budget authored text even while publication is review-gated. This
                // build-only fixture does not approve or publish draft answers.
                const authored = Array.isArray(pack.faq)
                  ? (pack.faq as { q: string; a: string; source: string }[])
                  : [];
                const items = authored.map((entry, index) => ({
                  id: createHash("sha256")
                    .update(`${code}:${index}`)
                    .digest("hex"),
                  question: entry.q,
                  answer: entry.a,
                  citations: [
                    {
                      passageId: createHash("sha256")
                        .update(entry.source)
                        .digest("hex"),
                      label: entry.source,
                      url: `https://content.invalid/${encodeURIComponent(entry.source)}`,
                      sourceLang: code,
                      sourceType: "course",
                    },
                  ],
                }));
                const document = {
                  lang: code,
                  dir: pack.meta.dir,
                  contentVersion: createHash("sha256")
                    .update(JSON.stringify(authored))
                    .digest("hex"),
                  reviewedOn: pack.meta.reviewed_on,
                  items,
                };
                // Reserve additional compressed provenance bytes for each real
                // canonical label/URL, which are resolved only by the deployed API.
                return [
                  code,
                  gzipSync(JSON.stringify(document)).byteLength +
                    items.length * 256,
                ];
              }),
            ),
          ),
        });
      },
    },
  ],
  build: {
    manifest: true,
    lib: {
      entry: "src/loader.ts",
      formats: ["es"],
      fileName: () => "dimts-widget.js",
    },
    rollupOptions: {
      // Lazy help shares Lit with the entry. Permit internal exports instead
      // of creating a facade module and another serial download round trip.
      preserveEntrySignatures: "allow-extension",
      output: { chunkFileNames: "dimts-[name]-[hash].js" },
    },
  },
});
