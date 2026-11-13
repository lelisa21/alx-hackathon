import { formatDate, resolveUi, translate } from "@dimts/locales-tools";
import type { LangPack } from "@dimts/locales-tools";
import type {
  AccommodationNeed,
  JobsServiceOptions,
  PublicJob,
} from "@dimts/jobs";

const needLabels: Record<AccommodationNeed, string> = {
  sign_language_interpreter: "sign_language",
  step_free_access: "step_free",
  written_questions: "written_questions",
  extra_time: "extra_time",
  screen_reader_friendly_test: "screen_reader",
  other: "other",
};

export function careerDate(
  packs: Map<string, LangPack>,
  lang: string,
  value: string,
): string {
  const pack = packs.get(lang);
  if (!pack) throw new Error("Career date language is unavailable");
  return formatDate(new Date(value), pack.meta, resolveUi(packs, lang).ui);
}

export function careerInterview(
  packs: Map<string, LangPack>,
  lang: string,
  value: string,
): string {
  const date = new Date(value);
  return `${careerDate(packs, lang, value)} ${new Intl.DateTimeFormat(lang, { timeZone: "UTC", hour: "2-digit", minute: "2-digit", timeZoneName: "short", numberingSystem: "latn" }).format(date)}`;
}

export function publicJobView(
  packs: Map<string, LangPack>,
  lang: string,
  job: PublicJob,
) {
  return {
    ...job,
    deadlineDisplay: job.deadline
      ? careerDate(packs, lang, job.deadline)
      : null,
  };
}

export function careerGlossary(packs: Map<string, LangPack>, lang: string) {
  const entries = packs.get(lang)?.glossary;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const value = entry as Record<string, unknown>;
    if (
      !["probation", "deadline", "reference", "interview_panel"].includes(
        String(value.id),
      )
    )
      return [];
    return typeof value[lang] === "string" &&
      typeof value.simple_definition === "string"
      ? [{ term: value[lang] as string, meaning: value.simple_definition }]
      : [];
  });
}

export function createCareerRenderers(
  packs: Map<string, LangPack>,
): Pick<JobsServiceOptions, "renderDigest" | "renderAccommodation"> {
  return {
    renderDigest({ lang, jobs }) {
      return jobs
        .map(
          (job) =>
            translate(packs, lang, "jobs.digest_item", {
              title: job.title,
              organization: job.organization,
              deadline: job.deadline
                ? careerDate(packs, lang, job.deadline)
                : translate(packs, lang, "jobs.unknown_deadline").text,
              url: job.url,
            }).text,
        )
        .join("\n");
    },
    renderAccommodation({ lang, job, needs, otherText, name, interviewAt }) {
      return translate(packs, lang, "jobs.accommodation_message", {
        title: job.title,
        needs: needs
          .map(
            (need) =>
              translate(packs, lang, `jobs.supportLabels.${needLabels[need]}`)
                .text,
          )
          .join(", "),
        other: otherText ?? "",
        name: name
          ? `${translate(packs, lang, "jobs.name").text}: ${name}`
          : "",
        interview: interviewAt
          ? `${translate(packs, lang, "jobs.interview").text}: ${careerInterview(packs, lang, interviewAt)}`
          : "",
      }).text;
    },
  };
}
