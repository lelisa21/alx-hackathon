import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/lang/**/*.test.ts",
      "packages/locales-tools/test/**/*.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/locales-tools/src/**/*.ts"],
      exclude: [
        "packages/locales-tools/src/cli.ts",
        "packages/locales-tools/src/new-cli.ts",
      ],
      reportsDirectory: "coverage/locales",
      reporter: ["text", "json-summary", "html"],
      thresholds: { statements: 70, branches: 70, functions: 70, lines: 70 },
    },
  },
});
