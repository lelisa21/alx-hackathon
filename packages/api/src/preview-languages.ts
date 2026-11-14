import type { LangPack } from "@dimts/locales-tools";

/**
 * Publish host-selected draft packs as `beta` for this deployment.
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
  if (codes.length === 0) return packs;
  const requested = new Set(codes);
  const unknown = codes.filter((code) => !packs.has(code));
  if (unknown.length > 0) {
    throw new Error(
      `DIMTS_PREVIEW_LANGS names unknown language packs: ${unknown.join(", ")}`,
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
