import { describe, expect, it } from 'vitest';
import { extractFields, shouldRunArabicPass } from './extract';
import { findMrz } from './mrz';
import { hijriToGregorian } from './dates';
import { FIXED_NOW, page, saudiId } from '../test/helpers';

// Synthetic passport (fictional person) with valid check digits.
const EGY_MRZ = ['P<EGYALTEST<<MOHAMMED<AHMED<<<<<<<<<<<<<<<<<<', 'A123456784EGY9001158M3005017<<<<<<<<<<<<<<00'];

describe('extractFields: passport', () => {
  it('uses the MRZ for all fields and suggests the Arabic name', () => {
    const result = extractFields({
      latin: page(['ARAB REPUBLIC OF EGYPT', 'PASSPORT', 'Date of birth 15/01/1990', ...EGY_MRZ]),
      arabic: page(['جمهورية مصر العربية', 'الاسم: محمد أحمد التجربة']),
      now: FIXED_NOW,
    });
    expect(result.stats.mrz).toBe('valid');
    expect(result.fields.docType).toMatchObject({ value: 'passport', confidence: 'high', source: 'mrz' });
    expect(result.fields.docNumber).toMatchObject({ value: 'A12345678', confidence: 'high' });
    expect(result.fields.nationality).toMatchObject({ value: 'EG', confidence: 'high' });
    expect(result.fields.birthDate).toMatchObject({ value: '1990-01-15', confidence: 'high' });
    expect(result.fields.gender).toMatchObject({ value: 'male', confidence: 'high' });
    expect(result.fields.fullName?.value).toBe('MOHAMMED AHMED ALTEST');
    expect(result.fields.fullName?.alternatives?.[0]?.value).toBe('محمد أحمد التجربة');
  });

  it('flags a conflict between the MRZ and the printed birth date', () => {
    const result = extractFields({
      latin: page(['PASSPORT', 'Date of birth 16/01/1990', ...EGY_MRZ]),
      now: FIXED_NOW,
    });
    expect(result.fields.birthDate).toMatchObject({ value: '1990-01-15', conflict: true });
    expect(result.fields.birthDate?.alternatives?.[0]?.value).toBe('1990-01-16');
  });

  it('runs the Arabic pass only when useful', () => {
    expect(shouldRunArabicPass(findMrz(EGY_MRZ, FIXED_NOW))).toBe(true);
    const ind = ['P<INDTESTER<<SAMPLE<<<<<<<<<<<<<<<<<<<<<<<<<<', 'A123456784IND9001158M3005017<<<<<<<<<<<<<<00'];
    expect(shouldRunArabicPass(findMrz(ind, FIXED_NOW))).toBe(false);
  });
});

describe('extractFields: Saudi documents', () => {
  it('reads a national ID: type and nationality from the ID prefix, Hijri birth date converted', () => {
    const id = saudiId('105678901');
    const result = extractFields({
      latin: page(['KINGDOM OF SAUDI ARABIA', 'NATIONAL ID', `ID No ${id}`]),
      arabic: page(['المملكة العربية السعودية', 'وزارة الداخلية', 'الهوية الوطنية', 'الاسم: سعد عبدالله التجربة', 'تاريخ الميلاد: 1410/10/17']),
      now: FIXED_NOW,
    });
    expect(result.fields.docType).toMatchObject({ value: 'national_id', confidence: 'high' });
    expect(result.fields.docNumber).toMatchObject({ value: id, confidence: 'high' });
    expect(result.fields.nationality).toMatchObject({ value: 'SA', source: 'rule' });
    expect(result.fields.fullName?.value).toBe('سعد عبدالله التجربة');
    expect(result.fields.birthDate?.value).toBe(hijriToGregorian(1410, 10, 17));
    expect(result.fields.birthDate?.note).toContain('هجري');
    // Gender is not printed, so it must not be invented.
    expect(result.fields.gender).toBeUndefined();
  });

  it('reads a residence permit and prefers the holder number over a sponsor number', () => {
    const holder = saudiId('234567890');
    const sponsor = saudiId('101010101');
    const result = extractFields({
      latin: page(['RESIDENT IDENTITY', `ID No ${holder}`, 'Nationality: PAKISTAN', `Sponsor ${sponsor}`, 'Date of Birth 03/11/1985']),
      arabic: page(['هوية مقيم', 'الجنسية: باكستان', 'ذكر']),
      now: FIXED_NOW,
    });
    expect(result.fields.docType?.value).toBe('residence');
    expect(result.fields.docNumber).toMatchObject({ value: holder, confidence: 'high' });
    expect(result.fields.nationality?.value).toBe('PK');
    expect(result.fields.gender).toMatchObject({ value: 'male', source: 'ocr' });
    expect(result.fields.birthDate).toMatchObject({ value: '1985-11-03' });
    expect(result.fields.birthDate?.note).toContain('معكوسين');
  });

  it('flags an ID number that fails the check digit instead of trusting it', () => {
    const result = extractFields({ latin: page(['ID No 2345678901']), now: FIXED_NOW });
    expect(result.fields.docNumber).toMatchObject({ value: '2345678901', confidence: 'low' });
  });

  it('flags conflicting nationalities', () => {
    const result = extractFields({
      latin: page([`ID No ${saudiId('234567890')}`, 'Nationality: INDIA']),
      arabic: page(['الجنسية: باكستان']),
      now: FIXED_NOW,
    });
    expect(result.fields.nationality?.conflict).toBe(true);
  });
});

describe('extractFields: OCR line clean-up', () => {
  // Words in Arabic reading order (right to left), 30 px tall. The last two words come from another
  // column of the card, far to the left, and are low-confidence garbage.
  const word = (text: string, x0: number, x1: number, confidence = 92) => ({ text, confidence, bbox: { x0, y0: 0, x1, y1: 30 } });
  const line = (words: ReturnType<typeof word>[]) => ({
    text: words.map((w) => w.text).join(' '),
    confidence: 85,
    bbox: { x0: Math.min(...words.map((w) => w.bbox.x0)), y0: 0, x1: Math.max(...words.map((w) => w.bbox.x1)), y1: 30 },
    words,
  });

  it('does not mix words from another column into a name', () => {
    const arabic = {
      confidence: 85,
      lines: [
        line([
          word('الاسم:', 1300, 1380),
          word('محمد', 1220, 1290),
          word('أحمد', 1140, 1210),
          word('التجربة', 1040, 1130),
          word('ولا', 300, 340, 55),
          word('وم', 250, 290, 45),
        ]),
      ],
    };
    const result = extractFields({ latin: page([]), arabic, now: FIXED_NOW });
    expect(result.fields.fullName?.value).toBe('محمد أحمد التجربة');
  });
});

describe('extractFields: nothing readable', () => {
  it('returns no fields rather than guessing', () => {
    const result = extractFields({ latin: page(['~~ ##', 'lorem ipsum'], 30), now: FIXED_NOW });
    expect(result.fields).toEqual({});
    expect(result.stats.mrz).toBe('none');
  });
});
