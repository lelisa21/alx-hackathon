import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPacks } from "../../locales-tools/src/index.js";
import { requiredUiKeys } from "../../locales-tools/src/required-ui-keys.js";

describe("P08 FR-TG-07 helper channel copy", () => {
  it("provides the Telegram label and truthful text capability in every locale", () => {
    for (const key of ["helper.channel.telegram", "helper.telegramTextOnly"]) {
      expect(requiredUiKeys).toContain(key);
      for (const pack of loadPacks(resolve("locales")).values()) {
        expect(pack.ui[key], `${pack.meta.code}/${key}`).toMatch(/\p{L}/u);
      }
    }
  });
});
