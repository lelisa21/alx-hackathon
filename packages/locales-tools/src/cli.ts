import path from "node:path";
import { validatePacks } from "./index.js";

const issues = validatePacks(path.resolve(process.cwd(), "locales"));
if (issues.length > 0) {
  console.error("Language pack checks failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  process.stdout.write("Language packs valid.\n");
}
