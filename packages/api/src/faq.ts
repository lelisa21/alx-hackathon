import { createHash } from "node:crypto";
import type { LangPack } from "@dimts/locales-tools";
import type { PostgresGrounding } from "@dimts/grounding";
import { z } from "zod";
import { LocaleFaqCitationSchema, LocaleFaqSchema } from "./schemas.js";

const AuthoringEntrySchema = z
  .object({
    q: z.string().trim().min(1).max(1000),
    a: z.string().trim().min(1).max(4000),
    source: z.string().trim().min(1).max(256),
  })
  .strict();

function reviewedOn(pack: LangPack): string | null {
  const { status, reviewed_by: reviewer, reviewed_on: date } = pack.meta;
  if (
    status === "draft" ||
    !reviewer?.trim() ||
    /^(todo|tbd|unknown|none|pending)$/iu.test(reviewer.trim()) ||
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(date)
  )
    return null;
  const instant = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(instant) &&
    instant <= Date.now() &&
    new Date(instant).toISOString().slice(0, 10) === date
    ? date
    : null;
}

/** FAQ publication does not synthesize, translate, or expose unreviewed pack drafts. */
export async function buildReviewedFaq(
  pack: LangPack,
  contentVersion: string,
  resolveCitations?: PostgresGrounding["resolveFaqCitations"],
): Promise<z.infer<typeof LocaleFaqSchema>> {
  const result: z.infer<typeof LocaleFaqSchema> = {
    lang: pack.meta.code,
    dir: pack.meta.dir,
    contentVersion,
    reviewedOn: reviewedOn(pack),
    items: [],
  };
  if (!result.reviewedOn || !resolveCitations)
    return LocaleFaqSchema.parse(result);
  const entries = (Array.isArray(pack.faq) ? pack.faq : [])
    .slice(0, 100)
    .flatMap((entry: unknown) => {
      const parsed = AuthoringEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  const citations = await resolveCitations(entries.map(({ source }) => source));
  for (const entry of entries) {
    const parsed = LocaleFaqCitationSchema.safeParse(
      citations.get(entry.source),
    );
    if (
      !parsed.success ||
      !/^https?:\/\//iu.test(parsed.data.url) ||
      parsed.data.sourceType !== "course"
    )
      continue;
    result.items.push({
      id: createHash("sha256")
        .update(
          JSON.stringify([
            pack.meta.code,
            entry.q,
            entry.a,
            parsed.data.passageId,
          ]),
        )
        .digest("hex"),
      question: entry.q,
      answer: entry.a,
      citations: [parsed.data],
    });
  }
  return LocaleFaqSchema.parse(result);
}
