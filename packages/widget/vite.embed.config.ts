import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: "src/embed.ts",
      formats: ["iife"],
      name: "BridgelyEmbed",
      fileName: () => "bridgely-embed.js",
    },
  },
});
