import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { textGrams } from "./grams.js";
import { normalise } from "./normalise.js";
import type { PassageRecord } from "./ingest.js";

export interface JobPostingParseError {
  index: number;
  reason: "unsupported_type" | "invalid_job_posting";
}

export interface JobPostingPassageResult {
  passages: PassageRecord[];
  errors: JobPostingParseError[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function plainText(value: string): string {
  const { document } = parseHTML(
    `<!doctype html><html><body>${value}</body></html>`,
  );
  document.querySelectorAll("script,style").forEach((node) => node.remove());
  return document.body.textContent?.replace(/\s+/gu, " ").trim() ?? "";
}

function locationText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(locationText).filter(Boolean).join(", ");
  }
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";

  const placeName = stringValue(value.name);
  const address = value.address;
  if (typeof address === "string") return [placeName, address.trim()].filter(Boolean).join(", ");
  if (!isRecord(address)) return placeName;
  return [
    placeName,
    stringValue(address.streetAddress),
    stringValue(address.addressLocality),
    stringValue(address.addressRegion),
    stringValue(address.addressCountry),
  ]
    .filter(Boolean)
    .join(", ");
}

function organizationName(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return isRecord(value) ? stringValue(value.name) : "";
}

function textValue(value: unknown): string {
  if (typeof value === "string") return plainText(value);
  if (Array.isArray(value))
    return value.map(textValue).filter(Boolean).join(", ");
  if (isRecord(value)) return stringValue(value.name) || stringValue(value.value);
  return "";
}

function validPostingUrl(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function validDate(value: unknown): string | undefined {
  const date = stringValue(value);
  if (!date || !Number.isFinite(Date.parse(date))) return undefined;
  return date;
}

function isJobPosting(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  return types.some(
    (type) =>
      type === "JobPosting" ||
      type === "https://schema.org/JobPosting" ||
      type === "http://schema.org/JobPosting",
  );
}

function parsePosting(
  value: Record<string, unknown>,
  lang: string,
): PassageRecord | undefined {
  const title = stringValue(value.title);
  const description = plainText(stringValue(value.description));
  const datePosted = validDate(value.datePosted);
  const url = validPostingUrl(value.url);
  const organization = organizationName(value.hiringOrganization);
  const location = locationText(value.jobLocation);
  const deadline =
    value.validThrough === undefined ? "" : validDate(value.validThrough) ?? "";

  if (!title || !description || !datePosted || !url || !organization || !location) {
    return undefined;
  }
  if (value.validThrough !== undefined && !deadline) return undefined;

  const id = `job-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
  const text = [
    title,
    organization,
    location,
    datePosted,
    deadline,
    textValue(value.accommodationsOffered),
    description,
  ]
    .filter(Boolean)
    .join("\n");
  const textNorm = normalise(`${title} ${location} ${text}`, lang);
  return {
    id,
    lessonId: id,
    lessonTitle: title,
    sectionTitle: title,
    anchor: "posting",
    url,
    lang,
    sourceType: "job",
    text,
    textNorm,
    grams: textGrams(textNorm),
  };
}

function sourceItems(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input["@graph"])) {
    return input["@graph"];
  }
  return [input];
}

export function parseJobPostingPassages(
  input: unknown,
  options: { lang: string },
): JobPostingPassageResult {
  const passages: PassageRecord[] = [];
  const errors: JobPostingParseError[] = [];
  for (const [index, item] of sourceItems(input).entries()) {
    if (!isJobPosting(item)) {
      errors.push({ index, reason: "unsupported_type" });
      continue;
    }
    const passage = parsePosting(item, options.lang);
    if (!passage) {
      errors.push({ index, reason: "invalid_job_posting" });
      continue;
    }
    passages.push(passage);
  }
  return { passages, errors };
}
