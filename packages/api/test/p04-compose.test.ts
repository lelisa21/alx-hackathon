// FR-VOICE-01/02: local deployment must honor the configured voice adapter.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("P04 Compose voice configuration", () => {
  it.each(["DIMTS_STT_ENGINE", "DIMTS_TTS_ENGINE"])(
    "forwards %s from the host environment with a none default",
    async (key) => {
      const compose = parse(
        await readFile(resolve("docker-compose.yml"), "utf8"),
      );
      // Compose's :- expansion honors an explicit browser value while an
      // unset or empty value stays disabled. A literal none would ignore it.
      expect(compose.services.api.environment[key]).toBe(`\${${key}:-none}`);
    },
  );
});
