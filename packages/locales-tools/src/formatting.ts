import { IntlMessageFormat } from "intl-messageformat";
import type { LangMeta } from "./index.js";

export interface EthiopianDate {
  y: number;
  m: number;
  d: number;
}

/** UTC Gregorian date to the Ethiopic calendar (SRS 19.15, Blueprint D20). */
export function toEthiopian(date: Date): EthiopianDate {
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid date");
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const a = Math.floor((14 - m) / 12);
  const year = y + 4800 - a;
  const month = m + 12 * a - 3;
  const julianDay =
    d +
    Math.floor((153 * month + 2) / 5) +
    365 * year +
    Math.floor(year / 4) -
    Math.floor(year / 100) +
    Math.floor(year / 400) -
    32045;
  const days = julianDay - 1723856;
  const cycleDay = ((days % 1461) + 1461) % 1461;
  const dayOfYear = (cycleDay % 365) + 365 * Math.floor(cycleDay / 1460);
  return {
    y:
      4 * Math.floor(days / 1461) +
      Math.floor(cycleDay / 365) -
      Math.floor(cycleDay / 1460),
    m: Math.floor(dayOfYear / 30) + 1,
    d: (dayOfYear % 30) + 1,
  };
}

function formatLocale(meta: LangMeta, ui: Record<string, string>): string {
  return ui["number.locale"] ?? meta.code;
}

/** Both month names and layout are pack data; calendar arithmetic never rewrites them. */
export function formatDate(
  date: Date,
  meta: LangMeta,
  ui: Record<string, string>,
): string {
  const ethiopic = toEthiopian(date);
  const locale = formatLocale(meta, ui);
  const message = (key: string, values: Record<string, string | number>) => {
    const template = ui[key];
    if (!template) throw new Error(`Missing date format key: ${key}`);
    return String(
      new IntlMessageFormat(template, locale, undefined, {
        ignoreTag: true,
      }).format(values),
    );
  };
  const monthName = (key: string) => {
    const value = ui[key];
    if (!value) throw new Error(`Missing month key: ${key}`);
    return value;
  };
  const e = message("date.ethiopic", {
    month: monthName(`month.${ethiopic.m}`),
    day: ethiopic.d,
    year: ethiopic.y,
  });
  const g = message("date.gregorian", {
    month: monthName(`gmonth.${date.getUTCMonth() + 1}`),
    day: date.getUTCDate(),
    year: date.getUTCFullYear(),
  });
  return message(
    "date.dual",
    meta.calendar === "ethiopic"
      ? { primary: e, alternate: g }
      : { primary: g, alternate: e },
  );
}

/** Locale separators with the Western digits required by Blueprint section 8.2. */
export function formatNumber(
  value: number,
  meta: LangMeta,
  ui: Record<string, string>,
  options: Omit<Intl.NumberFormatOptions, "numberingSystem"> = {},
): string {
  return new Intl.NumberFormat(formatLocale(meta, ui), {
    ...options,
    numberingSystem: ui["number.numbering_system"] ?? "latn",
  }).format(value);
}
