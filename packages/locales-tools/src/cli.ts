import { fileURLToPath } from "node:url";
import { validatePacks } from "./index.js";

const issues = validatePacks(
  fileURLToPath(new URL("../../../locales/", import.meta.url)),
);
if (issues.length > 0) {
  console.error("Language pack checks failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  process.stdout.write("Language packs valid.\n");
}
