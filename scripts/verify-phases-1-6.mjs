import { spawnSync } from "node:child_process";

if (!process.env.DIMTS_TEST_DATABASE_URL?.trim()) {
  process.stderr.write(
    "Set DIMTS_TEST_DATABASE_URL to an isolated PostgreSQL database; the verification suite will not silently skip database tests.\n",
  );
  process.exit(1);
}

let databaseUrl;
try {
  databaseUrl = new URL(process.env.DIMTS_TEST_DATABASE_URL);
} catch {
  process.stderr.write(
    "DIMTS_TEST_DATABASE_URL must be a valid PostgreSQL URL.\n",
  );
  process.exit(1);
}
if (
  !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)
) {
  process.stderr.write(
    "DIMTS_TEST_DATABASE_URL must point to a local PostgreSQL database.\n",
  );
  process.exit(1);
}

const checks = [
  ["Build all workspace packages", ["build"]],
  ["Typecheck all packages", ["typecheck"]],
  ["Lint code, styles, and locale strings", ["lint"]],
  ["Validate language packs", ["lang:check"]],
  ["Core package coverage", ["test:core"]],
  ["Locale tooling coverage", ["test:lang"]],
  ["Unit and PostgreSQL integration tests", ["test"]],
  [
    "Widget browser and accessibility tests",
    ["test:widget", "--", "--workers=1"],
  ],
  [
    "Widget startup performance budget",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.widget.config.ts",
      "packages/widget/e2e/embed-performance.spec.ts",
      "--workers=1",
    ],
  ],
  ["Grounded tutor evaluation", ["eval"]],
  ["Widget bundle-size budgets", ["size"]],
];

for (const [label, args] of checks) {
  process.stdout.write(`\n== ${label} ==\n`);
  const isWindows = process.platform === "win32";
  const command = isWindows ? `pnpm.cmd ${args.join(" ")}` : "pnpm";
  const commandArgs = isWindows ? [] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    shell: isWindows,
    stdio: "inherit",
  });
  if (result.error) {
    process.stderr.write(`${label} could not start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`${label} failed with exit code ${result.status}.\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\nPhases 1-6 automated checks passed.\n");
