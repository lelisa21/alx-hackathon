import type { ApiConfig } from "./config.js";

type HelperHours = NonNullable<ApiConfig["DIMTS_HELPER_HOURS"]>;

function minuteOfDay(value: string): number {
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3, 5));
  return hours * 60 + minutes;
}

export function isHelperAvailable(
  hours: HelperHours | undefined,
  now: Date,
): boolean {
  if (!hours) return true;
  if (Number.isNaN(now.getTime())) return false;

  const isoWeekday = now.getUTCDay() || 7;
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  return hours.some(
    (interval) =>
      interval.day === isoWeekday &&
      minute >= minuteOfDay(interval.start) &&
      minute < minuteOfDay(interval.end),
  );
}
