import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldPack } from "./scaffold.js";

const root = fileURLToPath(new URL("../../../locales/", import.meta.url));
try {
  const code = process.argv[2];
  if (!code || process.argv.length !== 3)
    throw new Error("Usage: pnpm lang:new <code>");
  const destination = scaffoldPack(root, code);
  process.stdout.write(
    `Created draft ${path.basename(destination)}. Follow docs/ADD_A_LANGUAGE.md before enabling it.\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Could not create the draft pack."}\n`,
  );
  process.exitCode = 1;
}
