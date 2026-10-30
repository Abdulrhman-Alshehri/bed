import { describe, expect, it } from 'vitest';
import { extractFields } from './extract';
import { genderFromArabicName } from './genderFromName';
import type { DigitDate } from '../ocr/digitReader';
import type { OcrLine, OcrPage } from '../ocr/types';
import { FIXED_NOW, page, saudiId } from '../test/helpers';

/** A positioned OCR line (one token), as sparse-text OCR returns for card layouts. */
const at = (text: string, x0: number, y0: number, x1: number, confidence = 92): OcrLine => ({
  text,
  confidence,
  bbox: { x0, y0, x1, y1: y0 + 24 },
  words: [],
});
const pageOf = (lines: OcrLine[]): OcrPage => ({ lines, confidence: 85 });

describe('label/value pairing by position (residence permit layout)', () => {
  // Two columns, right column labels at x≈1000-1140, values to their left; left column labels at
  // x≈560-680. Rows 48 px apart. Lines are returned out of order, as sparse OCR does.
  const iqama = (nationalityValue: OcrLine | null) =>
    pageOf([
      at('مكان الميلاد:', 560, 373, 680),
      at('العربية السعودية', 330, 373, 540),
      at('الجنسية:', 1068, 421, 1142),
      ...(nationalityValue ? [nationalityValue] : []),
      at('الديانة:', 560, 421, 680),
      at('الاسلام', 420, 421, 540),
      at('رقم الهوية:', 1000, 325, 1140),
      at('تاريخ الميلاد:', 1000, 373, 1140),
      at('المهنة:', 1080, 469, 1142),
      at('بائع ملابس جاهزة', 850, 469, 1060),
    ]);

  it('reads the nationality next to its label, not the place of birth', () => {
    const result = extractFields({ latin: page([]), arabic: iqama(at('افغانستان', 870, 421, 1050)), now: FIXED_NOW });
    expect(result.fields.nationality?.value).toBe('AF');
  });

  it('leaves nationality empty rather than taking «العربية السعودية» from place of birth', () => {
    const result = extractFields({ latin: page([]), arabic: iqama(null), now: FIXED_NOW });
    expect(result.fields.nationality).toBeUndefined();
  });
});

describe('values of other fields are not names', () => {
  it('does not take the occupation as the name', () => {
    const result = extractFields({
      latin: page([]),
      arabic: pageOf([at('المهنة:', 1080, 469, 1142), at('بائع ملابس جاهزة', 850, 469, 1060, 97)]),
      now: FIXED_NOW,
    });
    expect(result.fields.fullName).toBeUndefined();
  });
});

describe('ID numbers', () => {
  it('ignores the employer’s ID printed on a residence permit', () => {
    const employer = saudiId('100000001');
    const result = extractFields({
      latin: page([]),
      arabic: pageOf([
        at('هوية مقيم', 1000, 100, 1140),
        at('رقم الهوية:', 1000, 325, 1140),
        at('2345678901', 850, 325, 990), // misread holder number (fails the check digit)
        at('هوية صاحب العمل:', 950, 517, 1140),
        at(employer, 780, 517, 940),
      ]),
      now: FIXED_NOW,
    });
    expect(result.fields.docNumber).toMatchObject({ value: '2345678901', confidence: 'low' });
    expect(result.fields.nationality).toBeUndefined();
    expect(result.fields.docType?.value).toBe('residence');
  });

  it('prefers the number encoded in the barcode', () => {
    const result = extractFields({
      latin: page([]),
      arabic: pageOf([at('هوية مقيم', 1000, 100, 1140), at('رقم الهوية:', 1000, 325, 1140), at('2191736781', 850, 325, 990)]),
      barcodes: ['2191736731'],
      now: FIXED_NOW,
    });
    expect(result.fields.docNumber).toMatchObject({ value: '2191736731', confidence: 'high', source: 'barcode' });
    expect(result.fields.docType?.value).toBe('residence');
  });
});

describe('unlabeled names on Saudi cards', () => {
  it('takes the Arabic line right above the English name, not the QR note', () => {
    const result = extractFields({
      latin: pageOf([at('AIMAN - - ABDULQADER', 760, 240, 1140, 89)]),
      arabic: pageOf([
        at('وزارة الداخلية', 800, 130, 1000, 95),
        at('أيمن - - عبدالقدر', 900, 200, 1140, 89),
        at('يجب التحقق', 160, 640, 280, 96),
        at('التعامل مع الهوية', 160, 700, 280, 92),
      ]),
      now: FIXED_NOW,
    });
    expect(result.fields.fullName?.value).toBe('أيمن عبدالقدر');
    expect(result.fields.fullName?.alternatives?.[0]?.value).toBe('AIMAN ABDULQADER');
    expect(result.fields.gender).toMatchObject({ value: 'male', source: 'rule', confidence: 'low' });
  });
});

describe('genderFromArabicName', () => {
  it.each([
    ['محمد بن عبدالله الغامدي', 'male'],
    ['نورة بنت سعد', 'female'],
    ['أيمن عبدالقدر', 'male'],
    ['عبدالرحمن علي', 'male'],
    ['فاطمة علي', 'female'],
    ['حمزة محمد', 'male'],
    ['أسامة خالد', 'male'],
    ['رقية أحمد', 'female'],
  ])('%s → %s', (name, gender) => {
    expect(genderFromArabicName(name)?.gender).toBe(gender);
  });

  it.each(['نور محمد', 'جود أحمد', 'وجيه سالم', 'Xyz'])('%s → no suggestion', (name) => {
    expect(genderFromArabicName(name)).toBeNull();
  });
});

describe('labels misread by OCR', () => {
  it('recognizes «الاسم» read without its alef', () => {
    const result = extractFields({ latin: page([]), arabic: page(['لاسم: محمد أحمد التجربة']), now: FIXED_NOW });
    expect(result.fields.fullName?.value).toBe('محمد أحمد التجربة');
  });
});

describe('misread card text is not a name', () => {
  it('rejects a misread «وزارة الداخلية» and does not infer gender from it', () => {
    const result = extractFields({
      latin: pageOf([at('AIMAN - - ABDULQADER', 760, 240, 1140, 89)]),
      arabic: pageOf([at('زارة الذداخلبا', 800, 130, 1000, 95)]),
      now: FIXED_NOW,
    });
    expect(result.fields.fullName?.value).toBe('AIMAN ABDULQADER');
    expect(result.fields.fullName?.alternatives ?? []).toHaveLength(0);
    expect(result.fields.gender).toBeUndefined();
  });

  it('uses the weak «ends with ة» rule only for anchored names', () => {
    const unanchored = extractFields({ latin: page([]), arabic: page(['زبيدة أحمد سالم']), now: FIXED_NOW });
    expect(unanchored.fields.gender).toBeUndefined();
    const anchored = extractFields({ latin: page([]), arabic: page(['الاسم: زبيدة أحمد سالم']), now: FIXED_NOW });
    expect(anchored.fields.gender?.value).toBe('female');
  });
});

describe('Arabic-Indic birth dates from the digit reader', () => {
  const iqamaId = saudiId('219173673');
  const card = pageOf([at('تاريخ الميلاد:', 1000, 373, 1140), at('رقم الهوية:', 1000, 325, 1140), at('هوية مقيم', 100, 40, 260)]);
  const reading = (over: Partial<DigitDate> = {}): DigitDate => ({
    iso: '2000-08-14',
    calendar: 'gregorian',
    printed: '٢٠٠٠/٠٨/١٤',
    score: -0.2,
    margin: 6,
    confident: true,
    alternatives: ['2005-08-14'],
    ...over,
  });
  const run = (birth: DigitDate, idNumber: string | null = null, latinLines: OcrLine[] = []) =>
    extractFields({ latin: page([]), arabic: card, barcodes: [iqamaId], printedDigits: { birth, idNumber }, now: FIXED_NOW, ...(latinLines.length ? { latin: pageOf(latinLines) } : {}) }).fields.birthDate;

  it('fills a confident reading, flagged for comparison with the document', () => {
    expect(run(reading())).toMatchObject({ value: '2000-08-14', confidence: 'medium', source: 'ocr' });
  });

  it('trusts it when the same reader read the ID number correctly on this photo', () => {
    expect(run(reading(), iqamaId)).toMatchObject({ value: '2000-08-14', confidence: 'high' });
  });

  it('does not count a wrong ID reading as a check', () => {
    expect(run(reading(), '2191736730')?.confidence).toBe('medium');
  });

  it('only suggests an uncertain reading: the field stays empty until staff compare it', () => {
    const c = run(reading({ confident: false, margin: 0.8 }));
    expect(c?.value).toBe('');
    expect(c?.alternatives?.[0]).toMatchObject({ value: '2000-08-14' });
    expect(c?.note).toContain('٢٠٠٠/٠٨/١٤');
  });

  it('keeps a date read normally from the text and offers the digit reading as an alternative', () => {
    const c = run(reading({ iso: '2000-08-11' }), null, [at('Date of Birth: 14/08/2000', 100, 200, 600)]);
    expect(c?.value).toBe('2000-08-14');
    expect(c?.alternatives?.some((a) => a.value === '2000-08-11')).toBe(true);
  });

  it('keeps an ambiguous Latin-digit date (flagged) instead of an uncertain digit reading', () => {
    const c = run(reading({ iso: '1985-03-11', confident: false, margin: 0.5 }), null, [at('تاريخ الميلاد: 03/11/1985', 100, 200, 600)]);
    expect(c).toMatchObject({ value: '1985-11-03', confidence: 'low' });
    expect((c?.alternatives ?? []).some((a) => a.value === '1985-03-11')).toBe(false);
  });

  it('confirms a Latin-digit date with the Hijri date printed beside it, settling the day/month order', () => {
    const hijri = { iso: '2003-12-08', calendar: 'hijri' as const, hijri: { year: 1424, month: 10, day: 14 }, printed: '١٤٢٤/١٠/١٤' };
    const dob = [at('DOB: 08/12/2003', 300, 373, 560)];
    const confirmed = run(reading(hijri), null, dob);
    expect(confirmed).toMatchObject({ value: '2003-12-08', confidence: 'high' });
    expect(confirmed?.note).toBeUndefined();
    // Same card if the Hijri date meant 12 August: the swapped order is taken.
    expect(run(reading({ ...hijri, iso: '2003-08-12' }), null, dob)).toMatchObject({ value: '2003-08-12', confidence: 'high' });
    // An uncertain Hijri reading confirms nothing: the ambiguity stays flagged.
    expect(run(reading({ ...hijri, confident: false }), null, dob)).toMatchObject({ value: '2003-12-08', confidence: 'low' });
  });

  it('prefers the digit reader over the OCR engine’s reading of Arabic-Indic digits', () => {
    const c = run(reading(), null, [at('تاريخ الميلاد: ٢٠٠٠/٠٨/١١', 100, 200, 600)]);
    expect(c).toMatchObject({ value: '2000-08-14', confidence: 'medium' });
    expect(c?.alternatives?.some((a) => a.value === '2000-08-11')).toBe(true);
  });

  it('flags Hijri readings with the converted date', () => {
    const c = run(reading({ iso: '1990-05-12', calendar: 'hijri', hijri: { year: 1410, month: 10, day: 17 }, printed: '١٤١٠/١٠/١٧' }), iqamaId);
    expect(c).toMatchObject({ value: '1990-05-12', confidence: 'medium' });
    expect(c?.note).toContain('1410');
  });
});
