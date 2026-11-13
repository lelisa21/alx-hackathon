import { describe, expect, it } from "vitest";
import { contrastRatio, resolveTheme } from "../src/theme.js";

describe("FR-UI-19 host theme contrast guard", () => {
  it.each(["light", "dark", "contrast"] as const)(
    "keeps %s theme text at 7:1 and controls at 3:1",
    (name) => {
      const theme = resolveTheme(name, {});
      for (const foreground of [theme.text, theme.muted])
        expect(contrastRatio(foreground, theme.surface)).toBeGreaterThanOrEqual(
          7,
        );
      expect(
        contrastRatio(theme.primaryText, theme.primary),
      ).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(theme.border, theme.surface)).toBeGreaterThanOrEqual(
        3,
      );
      expect(contrastRatio(theme.focus, theme.surface)).toBeGreaterThanOrEqual(
        3,
      );
    },
  );
  it("rejects a low contrast palette as a unit", () => {
    expect(
      resolveTheme("light", { surface: "#fff", text: "#eee", border: "#fff" }),
    ).toEqual(resolveTheme("light", {}));
  });
  it("accepts accessible colors, a safe font family and radius", () => {
    const theme = resolveTheme("light", {
      surface: "#000",
      text: "#fff",
      muted: "#fff",
      primary: "#fff",
      primaryText: "#000",
      border: "#fff",
      focus: "#fff",
      fontFamily: '"Example Font", serif',
      radius: "1rem",
    });
    expect(theme.surface).toBe("#000");
    expect(theme.fontFamily).toBe('"Example Font", serif');
    expect(theme.radius).toBe("1rem");
  });
  it("rejects unsafe or unresolved custom properties without a network request", () => {
    const theme = resolveTheme("light", {
      surface: "var(--unknown)",
      fontFamily: "url(https://third-party.test/font)",
      radius: "99rem",
    });
    expect(theme).toEqual(resolveTheme("light", {}));
  });
});
