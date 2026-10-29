import { describe, expect, it } from 'vitest';
import { cleanMrzLine, computeCheckDigit, findMrz, parseMrz } from './mrz';
import { FIXED_NOW } from '../test/helpers';

// Specimen data from ICAO Doc 9303 (fictional state "UTO").
const TD3 = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'];
const TD1 = ['I<UTOD231458907<<<<<<<<<<<<<<<', '7408122F1204159UTO<<<<<<<<<<<6', 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'];

describe('computeCheckDigit', () => {
  it('matches the ICAO specimen check digits', () => {
    expect(computeCheckDigit('L898902C3')).toBe(6);
    expect(computeCheckDigit('740812')).toBe(2);
    expect(computeCheckDigit('120415')).toBe(9);
    expect(computeCheckDigit('D23145890')).toBe(7);
  });
});

describe('parseMrz', () => {
  it('parses the TD3 passport specimen with all check digits passing', () => {
    const r = parseMrz(TD3, 'TD3', FIXED_NOW);
    expect(r.documentCode).toBe('P');
    expect(r.issuingState).toBe('UTO');
    expect(r.documentNumber).toBe('L898902C3');
    expect(r.nationality).toBe('UTO');
    expect(r.birthDate).toBe('1974-08-12');
    expect(r.sex).toBe('F');
    expect(r.surname).toBe('ERIKSSON');
    expect(r.givenNames).toBe('ANNA MARIA');
    expect(r.nameMayBeTruncated).toBe(false);
    expect(r.checks).toEqual({ documentNumber: true, birthDate: true, expiryDate: true, composite: true });
  });

  it('parses the TD1 ID card specimen', () => {
    const r = parseMrz(TD1, 'TD1', FIXED_NOW);
    expect(r.documentCode).toBe('I');
    expect(r.documentNumber).toBe('D23145890');
    expect(r.birthDate).toBe('1974-08-12');
    expect(r.surname).toBe('ERIKSSON');
    expect(r.givenNames).toBe('ANNA MARIA');
    expect(r.checks).toEqual({ documentNumber: true, birthDate: true, expiryDate: true, composite: true });
  });

  it('corrects letter/digit confusions in numeric and alphabetic fields', () => {
    // O instead of 0 in the birth date, 0 instead of O in the nationality, spaces and lowercase.
    const noisy = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'l898902C36UT0 74O8122F1204159ZE184226B<<<<<10'];
    const r = parseMrz(noisy, 'TD3', FIXED_NOW);
    expect(r.birthDate).toBe('1974-08-12');
    expect(r.nationality).toBe('UTO');
    expect(r.checks.birthDate).toBe(true);
  });

  it('detects a misread document number through its check digit', () => {
    const misread = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898982C36UTO7408122F1204159ZE184226B<<<<<10'];
    const r = parseMrz(misread, 'TD3', FIXED_NOW);
    expect(r.checks.documentNumber).toBe(false);
    expect(r.checks.birthDate).toBe(true);
  });

  it('treats runs of K as misread filler in names', () => {
    const r = parseMrz(['P<UTOERIKSSON<<ANNA<MARIAKKKKKKKKKKKKKKKKKKK', TD3[1]!], 'TD3', FIXED_NOW);
    expect(r.givenNames).toBe('ANNA MARIA');
  });

  it('flags a name that fills the whole field as possibly truncated', () => {
    const r = parseMrz(['P<UTOABDULRAHMANALQAHTANI<<MOHAMMEDABDULLAHSA', TD3[1]!], 'TD3', FIXED_NOW);
    expect(r.nameMayBeTruncated).toBe(true);
  });

  it('uses the previous century for two-digit birth years in the future', () => {
    const line2 = 'L898902C36UTO9912315F3001014<<<<<<<<<<<<<<00';
    const r = parseMrz([TD3[0]!, line2], 'TD3', FIXED_NOW);
    expect(r.birthDate).toBe('1999-12-31');
  });
});

describe('findMrz', () => {
  it('finds the MRZ among other OCR lines', () => {
    const lines = ['PASSPORT', 'Surname ERIKSSON', 'Given names ANNA MARIA', ...TD3, ''];
    const r = findMrz(lines, FIXED_NOW);
    expect(r?.format).toBe('TD3');
    expect(r?.documentNumber).toBe('L898902C3');
  });

  it('finds a TD1 MRZ', () => {
    expect(findMrz(TD1, FIXED_NOW)?.format).toBe('TD1');
  });

  it('rejects text that only resembles an MRZ', () => {
    expect(findMrz(['<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<', 'ABC<<DEF<<GHI<<JKL<<MNO<<PQR<<STU<<'], FIXED_NOW)).toBeNull();
  });

  it('maps guillemets to fillers when cleaning', () => {
    expect(cleanMrzLine('P<UTO ERIKSSON«ANNA')).toBe('P<UTOERIKSSON<<ANNA');
  });
});
