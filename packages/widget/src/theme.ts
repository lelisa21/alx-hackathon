export interface Theme {
  surface: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  border: string;
  focus: string;
  fontFamily: string;
  radius: string;
}

const light: Theme = {
  surface: "#ffffff",
  text: "#14232b",
  muted: "#344b55",
  primary: "#164e63",
  primaryText: "#ffffff",
  border: "#526773",
  focus: "#005fcc",
  fontFamily: "system-ui, sans-serif",
  radius: "0.75rem",
};
const themes: Record<string, Theme> = {
  light,
  dark: {
    ...light,
    surface: "#0f1b2d",
    text: "#f5f1e8",
    muted: "#f5f1e8",
    primary: "#5ed0cb",
    primaryText: "#0f1b2d",
    border: "#a8c8d0",
    focus: "#ffffff",
  },
  contrast: {
    ...light,
    surface: "#000000",
    text: "#ffffff",
    muted: "#ffffff",
    primary: "#ffd54a",
    primaryText: "#000000",
    border: "#ffffff",
    focus: "#ffffff",
  },
};

function channels(value: string): number[] | null {
  if (/^#[0-9a-f]{3}$/iu.test(value))
    return [...value.slice(1)].map((part) => parseInt(part + part, 16));
  if (/^#[0-9a-f]{6}$/iu.test(value))
    return [1, 3, 5].map((start) =>
      parseInt(value.slice(start, start + 2), 16),
    );
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/iu.exec(
    value,
  );
  const values = rgb?.slice(1).map(Number);
  return values?.every((channel) => channel <= 255) ? values : null;
}

export function contrastRatio(foreground: string, background: string): number {
  function luminance(color: string): number {
    const values = channels(color);
    if (!values) return Number.NaN;
    const linear = values.map((value) => {
      const n = value / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  }
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function resolveTheme(name: string, overrides: Partial<Theme>): Theme {
  const defaults = themes[name] ?? light;
  const candidate = { ...defaults, ...overrides };
  const colorsValid =
    [candidate.text, candidate.muted].every(
      (value) => contrastRatio(value, candidate.surface) >= 7,
    ) &&
    contrastRatio(candidate.primaryText, candidate.primary) >= 7 &&
    [candidate.border, candidate.focus].every(
      (value) => contrastRatio(value, candidate.surface) >= 3,
    );
  const fontFamily = /^[\w\s,"'-]{1,160}$/u.test(candidate.fontFamily)
    ? candidate.fontFamily
    : defaults.fontFamily;
  const radiusMatch = /^(\d+(?:\.\d+)?)(px|rem|em)$/u.exec(candidate.radius);
  const radius =
    radiusMatch && Number(radiusMatch[1]) <= (radiusMatch[2] === "px" ? 32 : 2)
      ? candidate.radius
      : defaults.radius;
  return { ...(colorsValid ? candidate : defaults), fontFamily, radius };
}

const properties: Record<keyof Theme, string> = {
  surface: "--dimts-surface",
  text: "--dimts-text",
  muted: "--dimts-muted",
  primary: "--dimts-primary",
  primaryText: "--dimts-primary-text",
  border: "--dimts-border",
  focus: "--dimts-focus",
  fontFamily: "--dimts-font-family",
  radius: "--dimts-radius",
};

/** Validate host overrides before applying them; restore safe defaults after mutations. */
export function applyThemeGuard(element: HTMLElement): () => void {
  let previous: Theme | undefined;
  let previousName = "";
  const apply = () => {
    const name = element.hasAttribute("high-contrast")
      ? "contrast"
      : (element.dataset.theme ?? "light");
    const computed = getComputedStyle(element);
    const overrides: Partial<Theme> = {};
    for (const [key, property] of Object.entries(properties) as [
      keyof Theme,
      string,
    ][]) {
      const value = computed.getPropertyValue(property).trim();
      // Values applied by the guard are not new host overrides on theme changes.
      if (value && value !== previous?.[key]) overrides[key] = value;
    }
    const next = resolveTheme(
      name,
      previousName === name ? { ...previous, ...overrides } : overrides,
    );
    previous = next;
    previousName = name;
    observer.disconnect();
    for (const [key, property] of Object.entries(properties) as [
      keyof Theme,
      string,
    ][])
      element.style.setProperty(property, next[key]);
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["style", "data-theme", "high-contrast"],
    });
  };
  const observer = new MutationObserver(apply);
  apply();
  return () => observer.disconnect();
}
