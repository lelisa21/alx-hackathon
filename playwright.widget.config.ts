import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./packages/widget/e2e",
  testMatch: "**/*.spec.ts",
  use: {
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command:
      "pnpm --filter @dimts/widget exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/dimts-widget.js",
    reuseExistingServer: !process.env.CI,
  },
});
