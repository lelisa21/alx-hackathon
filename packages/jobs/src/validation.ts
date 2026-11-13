import { accommodationNeeds, JobsError } from "./types.js";

export function validInterviewDate(value: string): boolean {
  const match =
    /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  return (
    !!match &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) === match[1]
  );
}
export function validateAccommodation(fields: {
  needs: string[];
  otherText?: string;
  name?: string;
  interviewAt?: string;
}): void {
  if (
    !fields.needs.length ||
    fields.needs.length > 6 ||
    new Set(fields.needs).size !== fields.needs.length ||
    fields.needs.some(
      (need) => !(accommodationNeeds as readonly string[]).includes(need),
    )
  )
    throw new JobsError("invalid");
  if (
    fields.needs.includes("other") !== !!fields.otherText?.trim() ||
    (fields.otherText?.length ?? 0) > 1000 ||
    (fields.name?.length ?? 0) > 120 ||
    (fields.name !== undefined && !fields.name.trim()) ||
    (fields.interviewAt !== undefined &&
      !validInterviewDate(fields.interviewAt))
  )
    throw new JobsError("invalid");
}
