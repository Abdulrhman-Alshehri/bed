// Date parsing for identity documents, including Hijri (Umm al-Qura) dates used on Saudi IDs.
import { normalizeDigits } from './text';

const DAY_MS = 86_400_000;

export interface FoundDate {
  /** Gregorian ISO date (YYYY-MM-DD), or null when a Hijri date could not be converted. */
  iso: string | null;
  calendar: 'gregorian' | 'hijri';
  /** The date as printed. */
  raw: string;
  /** Day and month could be swapped (e.g. 05/06/1990). Day-first was assumed. */
  ambiguous: boolean;
  /** Month-first order was detected (e.g. 12/25/1990). */
  monthFirst: boolean;
  hijri?: { year: number; month: number; day: number };
  /** Character offset in the searched text. */
  index: number;
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10,
  NOVEMBER: 11, DECEMBER: 12,
};

export function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!m && toIsoDate(Number(m[1]), Number(m[2]), Number(m[3])) === value;
}

export function todayIso(now = new Date()): string {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate())!;
}

// ---------------------------------------------------------------------------------------------
// Hijri (Umm al-Qura) conversion via Intl. Browsers ship the official Umm al-Qura tables in ICU.

let hijriFormatter: Intl.DateTimeFormat | null | undefined;

function getHijriFormatter(): Intl.DateTimeFormat | null {
  if (hijriFormatter !== undefined) return hijriFormatter;
  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    // 1 Muharram 1445 AH = 19 July 2023 (Umm al-Qura).
    const probe = hijriPartsWith(fmt, Date.UTC(2023, 6, 19));
    hijriFormatter = probe.year === 1445 && probe.month === 1 && probe.day === 1 ? fmt : null;
  } catch {
    hijriFormatter = null;
  }
  return hijriFormatter;
}

function hijriPartsWith(fmt: Intl.DateTimeFormat, time: number) {
  const parts = fmt.formatToParts(new Date(time));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function isHijriConversionSupported(): boolean {
  return getHijriFormatter() !== null;
}

export function gregorianToHijri(iso: string): { year: number; month: number; day: number } | null {
  const fmt = getHijriFormatter();
  if (!fmt || !isValidIsoDate(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return hijriPartsWith(fmt, Date.UTC(y, m - 1, d));
}

/** Converts an Umm al-Qura Hijri date to a Gregorian ISO date. Returns null if the date does not exist. */
export function hijriToGregorian(year: number, month: number, day: number): string | null {
  const fmt = getHijriFormatter();
  if (!fmt || month < 1 || month > 12 || day < 1 || day > 30 || year < 1300 || year > 1600) return null;
  // Mean-length estimate (1 Muharram 1 AH = 16 July 622), then search nearby days for the exact match.
  const estimate = Date.UTC(622, 6, 16) + ((year - 1) * 354.36707 + (month - 1) * 29.530588 + (day - 1)) * DAY_MS;
  for (let offset = 0; offset <= 45; offset++) {
    for (const sign of offset === 0 ? [1] : [1, -1]) {
      const t = estimate + sign * offset * DAY_MS;
      const h = hijriPartsWith(fmt, t);
      if (h.year === year && h.month === month && h.day === day) {
        const d = new Date(t);
        return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------

const isHijriYear = (y: number) => y >= 1300 && y <= 1500;
const isGregorianYear = (y: number, now: Date) => y >= 1900 && y <= now.getFullYear() + 30;

function buildDate(year: number, a: number, b: number, raw: string, index: number, yearFirst: boolean, now: Date): FoundDate | null {
  // yearFirst: Y/M/D. Otherwise D/M/Y (the convention on Saudi and ICAO documents), unless the
  // second number cannot be a month, in which case the date must be M/D/Y.
  let day: number;
  let month: number;
  let ambiguous = false;
  let monthFirst = false;
  if (yearFirst) {
    month = a;
    day = b;
  } else if (b > 12 && a <= 12) {
    month = a;
    day = b;
    monthFirst = true;
  } else {
    day = a;
    month = b;
    ambiguous = a <= 12 && b <= 12 && a !== b;
  }
  if (isHijriYear(year)) {
    if (month > 12 || day > 30 || month < 1 || day < 1) return null;
    return {
      iso: hijriToGregorian(year, month, day),
      calendar: 'hijri',
      raw,
      ambiguous,
      monthFirst,
      hijri: { year, month, day },
      index,
    };
  }
  if (!isGregorianYear(year, now)) return null;
  const iso = toIsoDate(year, month, day);
  if (!iso) return null;
  return { iso, calendar: 'gregorian', raw, ambiguous, monthFirst, index };
}

/** Finds dates such as 12/05/1990, 1990-05-12, 1410/10/17 (Hijri), 12 MAY 1990 or 12 MAY/MAI 90. */
export function findDates(text: string, now = new Date()): FoundDate[] {
  const src = normalizeDigits(text);
  const results: FoundDate[] = [];

  // D/M/Y or M/D/Y with a 4-digit year.
  for (const m of src.matchAll(/(?<!\d)(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{4})(?!\d)/g)) {
    const found = buildDate(Number(m[3]), Number(m[1]), Number(m[2]), m[0], m.index, false, now);
    if (found) results.push(found);
  }
  // Y/M/D with a 4-digit year (ISO dates and Hijri dates printed year-first).
  for (const m of src.matchAll(/(?<!\d)(\d{4})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{1,2})(?!\d)/g)) {
    const found = buildDate(Number(m[1]), Number(m[2]), Number(m[3]), m[0], m.index, true, now);
    if (found) results.push(found);
  }
  // 12 MAY 1990, 12 MAY 90, 12MAY1990, 12 MAY/MAI 1990 (bilingual passports).
  for (const m of src.matchAll(/(?<!\d)(\d{1,2})\s?([A-Za-z]{3,9})(?:\s?\/\s?[A-Za-z]{3,9})?\s?(\d{4}|\d{2})(?!\d)/g)) {
    const month = MONTHS[m[2]!.toUpperCase()];
    if (!month) continue;
    let year = Number(m[3]);
    if (m[3]!.length === 2) year += year > now.getFullYear() % 100 ? 1900 : 2000;
    const iso = isGregorianYear(year, now) ? toIsoDate(year, month, Number(m[1])) : null;
    if (iso) results.push({ iso, calendar: 'gregorian', raw: m[0], ambiguous: false, monthFirst: false, index: m.index });
  }
  return results.sort((x, y) => x.index - y.index);
}

/** Age in whole years on `now` for an ISO birth date. */
export function ageOn(iso: string, now = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

const AR_GREGORIAN = new Intl.DateTimeFormat('ar-u-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

/** "12 مايو 1990" */
export function formatGregorianArabic(iso: string): string {
  if (!isValidIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return AR_GREGORIAN.format(new Date(Date.UTC(y, m - 1, d)));
}

const HIJRI_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];

/** "17 شوال 1410 هـ" */
export function formatHijriArabic(h: { year: number; month: number; day: number }): string {
  return `${h.day} ${HIJRI_MONTHS[h.month - 1] ?? ''} ${h.year} هـ`;
}
