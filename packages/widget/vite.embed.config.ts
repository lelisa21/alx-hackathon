import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: "src/embed.ts",
      formats: ["iife"],
      name: "DimtsEmbed",
      fileName: () => "dimts-embed.js",
    },
  },
});
