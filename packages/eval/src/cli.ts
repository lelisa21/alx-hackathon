import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runEvaluation } from "./runner.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
runEvaluation(root)
  .then(async (result) => {
    await writeFile(path.join(root, "docs", "EVAL.md"), result.report, "utf8");
    process.stdout.write(
      `Evaluation: ${result.issues.length} measured gate failures, ${result.blockers.length} acceptance blockers. See docs/EVAL.md.\n`,
    );
    process.exitCode = result.issues.length ? 1 : 0;
  })
  .catch(() => {
    // Do not echo arbitrary input, source text, file paths or provider errors.
    process.stderr.write(
      "Evaluation could not complete. Check local pack/source configuration.\n",
    );
    process.exitCode = 1;
  });
