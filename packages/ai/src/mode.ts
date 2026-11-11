import type { ProviderName } from "./provider.js";

export function modeFor(
  provider: ProviderName,
  lang: string,
  isProven: (provider: ProviderName, lang: string) => boolean,
): "generative" | "extractive" {
  return provider !== "offline" && isProven(provider, lang)
    ? "generative"
    : "extractive";
}
