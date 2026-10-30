import { useEffect, useRef, useState } from 'react';
import {
  formatGregorianArabic,
  formatHijriArabic,
  gregorianToHijri,
  hijriToGregorian,
  isHijriConversionSupported,
  isValidIsoDate,
  toIsoDate,
} from '../extraction/dates';
import { normalizeDigits } from '../extraction/text';

export type Calendar = 'gregorian' | 'hijri';

interface Props {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  /** Calendar shown first: Saudi national IDs print the birth date in Hijri. */
  defaultCalendar: Calendar;
  /** Picture of the birth date as printed on the document (from the OCR), for comparison. */
  evidence?: string;
  aria: { 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean };
}

const pad = (n: number) => String(n).padStart(2, '0');
const digitsOf = (text: string) => normalizeDigits(text).replace(/\D/g, '').slice(0, 8);

type Order = 'dayFirst' | 'yearFirst';

const split = (digits: string, order: Order): [number, number, number] =>
  order === 'yearFirst'
    ? [Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6))]
    : [Number(digits.slice(4)), Number(digits.slice(2, 4)), Number(digits.slice(0, 2))];

function toIso(digits: string, order: Order, calendar: Calendar): string | null {
  const [y, m, d] = split(digits, order);
  if (calendar === 'hijri') return hijriToGregorian(y, m, d);
  return y >= 1900 && y <= 2100 ? toIsoDate(y, m, d) : null;
}

/**
 * Eight typed digits as a Gregorian ISO date, or null. Day first (as people say it) or year first
 * (as Saudi cards print it, «20000814»): whichever gives a valid date, day first if both do.
 */
export function parseTypedDate(digits: string, calendar: Calendar): string | null {
  if (digits.length !== 8) return null;
  return toIso(digits, 'dayFirst', calendar) ?? toIso(digits, 'yearFirst', calendar);
}

/** Slashes added while typing: «1408» → «14/08», «200008» → «2000/08». */
export function formatDigits(digits: string, calendar: Calendar = 'gregorian'): string {
  const month = Number(digits.slice(2, 4));
  const yearFirst =
    digits.length === 8
      ? !toIso(digits, 'dayFirst', calendar) && !!toIso(digits, 'yearFirst', calendar)
      : digits.length >= 4 && /^(1[34]|19|20)\d\d/.test(digits) && !(month >= 1 && month <= 12);
  const groups = yearFirst ? [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)] : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
  return groups.filter(Boolean).join('/');
}

/** dd/mm/yyyy in the chosen calendar. */
function formatValue(iso: string, calendar: Calendar): string {
  if (!isValidIsoDate(iso)) return '';
  const h = calendar === 'hijri' ? gregorianToHijri(iso) : null;
  if (h) return `${pad(h.day)}/${pad(h.month)}/${h.year}`;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Birth date typed with the number keyboard (no calendar to scroll back through decades), in the
 * Gregorian or Hijri calendar, with an Arabic readout in both calendars.
 */
export function BirthDateField({ id, value, onChange, defaultCalendar, evidence, aria }: Props) {
  const hijriSupported = isHijriConversionSupported();
  const [calendar, setCalendar] = useState<Calendar>(hijriSupported ? defaultCalendar : 'gregorian');
  // Digits being typed; null shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const emitted = useRef(value);
  const hijri = value && hijriSupported ? gregorianToHijri(value) : null;

  useEffect(() => {
    if (hijriSupported) setCalendar(defaultCalendar);
  }, [defaultCalendar, hijriSupported]);

  // A value set from outside (OCR, a suggestion, reset) replaces what was being typed.
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setDraft(null);
    }
  }, [value]);

  const shown = draft !== null ? formatDigits(draft, calendar) : formatValue(value, calendar);
  const problem =
    draft === null || draft === ''
      ? ''
      : draft.length === 8 && !parseTypedDate(draft, calendar)
        ? 'التاريخ غير صحيح. تحقق من اليوم والشهر والسنة'
        : draft.length < 8 && left
          ? 'التاريخ ناقص. اكتب اليوم والشهر والسنة، مثل 14/08/2000'
          : '';

  const type = (input: string) => {
    const digits = digitsOf(input);
    const iso = parseTypedDate(digits, calendar) ?? '';
    if (iso !== value) {
      emitted.current = iso;
      onChange(iso);
    }
    setDraft(digits);
  };

  const switchCalendar = (next: Calendar) => {
    setCalendar(next);
    // Typed digits are re-read in the other calendar; a stored value is just shown in it.
    if (draft !== null) {
      const iso = parseTypedDate(draft, next) ?? '';
      if (iso !== value) {
        emitted.current = iso;
        onChange(iso);
      }
    }
  };

  return (
    <>
      {hijriSupported && (
        <div className="calendar-switch" role="group" aria-label="التقويم">
          {(['gregorian', 'hijri'] as const).map((c) => (
            <button key={c} type="button" className="calendar-option" aria-pressed={calendar === c} onClick={() => switchCalendar(c)}>
              {c === 'gregorian' ? 'ميلادي' : 'هجري'}
            </button>
          ))}
        </div>
      )}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        dir="ltr"
        autoComplete="off"
        placeholder={calendar === 'hijri' ? 'يوم/شهر/سنة هجري' : 'يوم/شهر/سنة'}
        value={shown}
        data-value={value}
        onChange={(e) => type(e.target.value)}
        onFocus={() => setLeft(false)}
        onBlur={() => {
          setLeft(true);
          if (value && draft !== null) setDraft(null);
        }}
        {...aria}
      />
      {value && isValidIsoDate(value) && (
        <p className="field-readout">
          {formatGregorianArabic(value)} م{hijri && <> · الموافق {formatHijriArabic(hijri)}</>}
        </p>
      )}
      {problem && <p className="field-issue field-issue--error">{problem}</p>}
      {evidence && (
        <figure className="date-evidence">
          <img src={evidence} alt="تاريخ الميلاد كما يظهر في صورة المستند" />
          <figcaption>كما يظهر في المستند: قارن به التاريخ المكتوب أعلاه</figcaption>
        </figure>
      )}
    </>
  );
}
