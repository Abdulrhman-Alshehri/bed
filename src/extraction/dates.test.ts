import { describe, expect, it } from 'vitest';
import { findDates, gregorianToHijri, hijriToGregorian, isHijriConversionSupported, formatGregorianArabic } from './dates';
import { FIXED_NOW } from '../test/helpers';

describe('Umm al-Qura conversion', () => {
  it('is supported by the runtime', () => {
    expect(isHijriConversionSupported()).toBe(true);
  });

  it('converts known Hijri dates to Gregorian', () => {
    expect(hijriToGregorian(1445, 1, 1)).toBe('2023-07-19');
    expect(hijriToGregorian(1444, 9, 1)).toBe('2023-03-23');
    // Older dates follow the tabulated Umm al-Qura calendar, which can differ by a day from the
    // calendar in use at the time (1 Muharram 1400 was observed on 20 Nov 1979). Converted dates
    // are therefore always flagged for review.
    expect(hijriToGregorian(1400, 1, 1)).toBe('1979-11-21');
  });

  it('round-trips through gregorianToHijri', () => {
    const iso = hijriToGregorian(1410, 10, 17)!;
    expect(gregorianToHijri(iso)).toEqual({ year: 1410, month: 10, day: 17 });
  });

  it('returns null for dates that do not exist', () => {
    expect(hijriToGregorian(1445, 13, 1)).toBeNull();
    expect(hijriToGregorian(1445, 1, 31)).toBeNull();
  });
});

describe('findDates', () => {
  it('reads day-first Gregorian dates and flags day/month ambiguity', () => {
    const [d] = findDates('DOB 05/06/1990', FIXED_NOW);
    expect(d).toMatchObject({ iso: '1990-06-05', calendar: 'gregorian', ambiguous: true });
    const [e] = findDates('DOB 25/06/1990', FIXED_NOW);
    expect(e).toMatchObject({ iso: '1990-06-25', ambiguous: false });
  });

  it('detects month-first dates when the day cannot be a month', () => {
    const [d] = findDates('12/25/1990', FIXED_NOW);
    expect(d).toMatchObject({ iso: '1990-12-25', monthFirst: true });
  });

  it('reads ISO and year-first dates', () => {
    expect(findDates('1990-06-25', FIXED_NOW)[0]?.iso).toBe('1990-06-25');
  });

  it('recognizes Hijri years and converts them', () => {
    const [d] = findDates('تاريخ الميلاد: ١٤١٠/١٠/١٧', FIXED_NOW);
    expect(d?.calendar).toBe('hijri');
    expect(d?.hijri).toEqual({ year: 1410, month: 10, day: 17 });
    expect(d?.iso).toBe(hijriToGregorian(1410, 10, 17));
  });

  it('reads passport-style dates with month names', () => {
    expect(findDates('12 AUG 1974', FIXED_NOW)[0]?.iso).toBe('1974-08-12');
    expect(findDates('12 AUG/AOUT 74', FIXED_NOW)[0]?.iso).toBe('1974-08-12');
  });

  it('rejects impossible dates', () => {
    expect(findDates('31/02/1990', FIXED_NOW)).toHaveLength(0);
    expect(findDates('12/05/1700', FIXED_NOW)).toHaveLength(0);
  });
});

describe('formatGregorianArabic', () => {
  it('formats in Arabic with Western digits', () => {
    expect(formatGregorianArabic('1990-05-12')).toContain('1990');
    expect(formatGregorianArabic('1990-05-12')).toContain('مايو');
  });
});
