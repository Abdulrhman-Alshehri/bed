import { describe, expect, it } from 'vitest';
import { hijriToGregorian } from '../extraction/dates';
import { formatDigits, parseTypedDate } from './BirthDateField';

describe('typing a birth date', () => {
  it('adds the slashes while typing', () => {
    expect(formatDigits('14')).toBe('14');
    expect(formatDigits('1408')).toBe('14/08');
    expect(formatDigits('14082000')).toBe('14/08/2000');
  });

  it('reads day first, as people say it', () => {
    expect(parseTypedDate('14082000', 'gregorian')).toBe('2000-08-14');
    expect(parseTypedDate('01011990', 'gregorian')).toBe('1990-01-01');
  });

  it('reads year first, as Saudi cards print it', () => {
    expect(formatDigits('20000814')).toBe('2000/08/14');
    expect(parseTypedDate('20000814', 'gregorian')).toBe('2000-08-14');
  });

  it('converts Hijri dates, typed in either order', () => {
    expect(parseTypedDate('17101410', 'hijri')).toBe(hijriToGregorian(1410, 10, 17));
    expect(parseTypedDate('14101017', 'hijri')).toBe(hijriToGregorian(1410, 10, 17));
    expect(formatDigits('14101017', 'hijri')).toBe('1410/10/17');
  });

  it('reads year-first dates whose year looks like a day and month («2010…»)', () => {
    expect(parseTypedDate('20100514', 'gregorian')).toBe('2010-05-14');
    expect(formatDigits('20100514')).toBe('2010/05/14');
  });

  it('rejects incomplete or impossible dates', () => {
    expect(parseTypedDate('140820', 'gregorian')).toBeNull();
    expect(parseTypedDate('31022000', 'gregorian')).toBeNull();
    expect(parseTypedDate('14132000', 'gregorian')).toBeNull();
  });
});
