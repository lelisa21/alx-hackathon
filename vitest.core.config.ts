import { defineConfig } from "vitest/config";

const floor = { statements: 70, branches: 70, functions: 70, lines: 70 };
export default defineConfig({
  test: {
    include: [
      "packages/engine/test/**/*.test.ts",
      "packages/grounding/test/**/*.test.ts",
      "packages/ai/test/**/*.test.ts",
      "packages/eval/test/**/*.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      include: [
        "packages/engine/src/**/*.ts",
        "packages/grounding/src/**/*.ts",
        "packages/ai/src/**/*.ts",
      ],
      exclude: ["packages/grounding/src/cli.ts"],
      reportsDirectory: "coverage/core",
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        ...floor,
        "packages/engine/src/**": floor,
        "packages/grounding/src/**": floor,
        "packages/ai/src/**": floor,
      },
    },
  },
});
