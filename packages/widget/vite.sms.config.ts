import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { loadPacks } from "../locales-tools/src/index.js";

export default defineConfig({
  plugins: [
    {
      name: "dimts-sms-simulator",
      resolveId(id) {
        return id === "virtual:dimts-simulator-locales"
          ? "\0dimts-simulator-locales"
          : null;
      },
      load(id) {
        if (id !== "\0dimts-simulator-locales") return null;
        const packs = loadPacks(
          fileURLToPath(new URL("../../locales", import.meta.url)),
        );
        return `export default ${JSON.stringify(
          Object.fromEntries(
            [...packs].map(([code, pack]) => [
              code,
              {
                name: pack.meta.name_native,
                dir: pack.meta.dir,
                status: pack.meta.status,
                ui: Object.fromEntries(
                  Object.entries(pack.ui).filter(
                    ([key]) =>
                      key.startsWith("smsSim.") || key === "status.beta",
                  ),
                ),
              },
            ]),
          ),
        )};`;
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "sim/sms/index.html",
          source:
            '<!doctype html><html lang="en" dir="ltr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title></title><style>html{background:#f2f5f1}body{margin:0}</style></head><body><dimts-sms-simulator></dimts-sms-simulator><script type="module" src="/dimts-sms-simulator.js"></script></body></html>',
        });
      },
    },
  ],
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/sms-simulator.ts",
      formats: ["es"],
      fileName: "dimts-sms-simulator",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
