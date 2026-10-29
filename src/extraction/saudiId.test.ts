import { describe, expect, it } from 'vitest';
import { findSaudiIdNumbers, isValidSaudiIdNumber } from './saudiId';
import { saudiId } from '../test/helpers';

describe('isValidSaudiIdNumber', () => {
  it('accepts Luhn-valid numbers starting with 1 or 2', () => {
    expect(isValidSaudiIdNumber(saudiId('100000000'))).toBe(true);
    expect(isValidSaudiIdNumber('1000000008')).toBe(true);
    expect(isValidSaudiIdNumber(saudiId('234567890'))).toBe(true);
  });

  it('rejects a single wrong digit, wrong prefix or length', () => {
    expect(isValidSaudiIdNumber('1000000007')).toBe(false);
    expect(isValidSaudiIdNumber('3000000008')).toBe(false);
    expect(isValidSaudiIdNumber('100000008')).toBe(false);
  });
});

describe('findSaudiIdNumbers', () => {
  it('finds numbers written with Arabic-Indic digits and validates them', () => {
    const id = saudiId('210987654');
    const arabicDigits = id.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    expect(findSaudiIdNumbers(`رقم الإقامة ${arabicDigits}`)).toEqual([{ value: id, valid: true }]);
  });

  it('ignores longer digit runs and numbers with other prefixes', () => {
    expect(findSaudiIdNumbers('0501234567 12345678901')).toEqual([]);
  });
});
