import { createHash } from "node:crypto";
import {
  parseJobPostingPassages,
  type PassageRecord,
  type JobPostingParseError,
} from "@dimts/grounding";
import type { PublicJob } from "./types.js";

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function texts(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .map(
      (item) =>
        text(item) || text(object(item).name) || text(object(item).value),
    )
    .filter(Boolean);
}
export interface NormalizedJob {
  publicJob: PublicJob;
  passage: PassageRecord;
  employerEmail: string | null;
}
export function normalizePostings(
  input: unknown,
  lang: string,
): { jobs: NormalizedJob[]; errors: JobPostingParseError[] } {
  const graph = object(input)["@graph"];
  const items = Array.isArray(input)
    ? input
    : Array.isArray(graph)
      ? graph
      : [input];
  const jobs: NormalizedJob[] = [];
  const errors: JobPostingParseError[] = [];
  for (const [index, item] of items.entries()) {
    const parsed = parseJobPostingPassages([item], { lang });
    const passage = parsed.passages[0];
    if (!passage) {
      errors.push({
        index,
        reason: parsed.errors[0]?.reason ?? "invalid_job_posting",
      });
      continue;
    }
    const raw = object(item);
    const organization = object(raw.hiringOrganization);
    const places = Array.isArray(raw.jobLocation)
      ? raw.jobLocation
      : [raw.jobLocation];
    const location = places
      .map((place) => {
        const record = object(place);
        const address = object(record.address);
        return (
          text(place) ||
          [
            text(record.name),
            text(record.address),
            text(address.streetAddress),
            text(address.addressLocality),
            text(address.addressRegion),
            text(address.addressCountry),
          ]
            .filter(Boolean)
            .join(", ")
        );
      })
      .filter(Boolean)
      .join(", ");
    const region =
      places
        .map((place) => text(object(object(place).address).addressRegion))
        .find(Boolean) ?? null;
    const contacts = Array.isArray(organization.contactPoint)
      ? organization.contactPoint
      : [organization.contactPoint];
    const employerEmail =
      contacts
        .map((contact) => text(object(contact).email))
        .find(
          (email) =>
            /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/u.test(email) &&
            ![...email].some(
              (character) =>
                character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            ) &&
            email.length <= 254,
        ) ?? null;
    const id = `job-${createHash("sha256")
      .update(JSON.stringify([passage.id, lang]))
      .digest("hex")
      .slice(0, 24)}`;
    const publicJob: PublicJob = {
      id,
      title: passage.lessonTitle,
      description: passage.text.split("\n").at(-1) ?? "",
      organization: text(raw.hiringOrganization) || text(organization.name),
      location,
      region,
      jobType: texts(raw.employmentType).join(", ") || null,
      datePosted: text(raw.datePosted),
      deadline: text(raw.validThrough) || null,
      url: passage.url,
      lang,
      accommodationsOffered: texts(raw.accommodationsOffered),
    };
    jobs.push({ publicJob, passage, employerEmail });
  }
  return { jobs, errors };
}
