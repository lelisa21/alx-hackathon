import type { LangPack } from "@bridgely/locales-tools";

/**
 * Publish explicitly public or host-selected draft packs as `beta`.
 *
 * Only the visibility status changes. Review metadata stays as authored, so
 * everything that depends on a named reviewer — cross-language glossary
 * retrieval, published FAQ answers, and voice capability flags — stays off
 * until a real review is recorded in the pack. The pack files are unchanged.
 */
export function withPreviewLanguages(
  packs: Map<string, LangPack>,
  codes: readonly string[],
): Map<string, LangPack> {
  const requested = new Set([
    ...codes,
    ...[...packs]
      .filter(([, pack]) => pack.meta.public_preview === true)
      .map(([code]) => code),
  ]);
  if (requested.size === 0) return packs;
  const unknown = codes.filter((code) => !packs.has(code));
  if (unknown.length > 0) {
    throw new Error(
      `PREVIEW_LANGS names unknown language packs: ${unknown.join(", ")}`,
    );
  }
  return new Map(
    [...packs].map(([code, pack]) => [
      code,
      requested.has(code) && pack.meta.status === "draft"
        ? { ...pack, meta: { ...pack.meta, status: "beta" as const } }
        : pack,
    ]),
  );
}
