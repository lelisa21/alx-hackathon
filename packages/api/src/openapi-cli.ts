import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateOpenApiYaml } from "./openapi.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
await writeFile(
  path.join(packageRoot, "openapi.yaml"),
  generateOpenApiYaml(),
  "utf8",
);
