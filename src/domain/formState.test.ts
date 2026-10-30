import { describe, expect, it } from 'vitest';
import { createInitialState, formReducer, totalPieces, type FormAction } from './formState';
import type { ExtractionResult } from '../extraction/result';
import type { FormState } from './types';

const run = (...actions: FormAction[]): FormState => actions.reduce(formReducer, createInitialState());

const extraction = (fields: ExtractionResult['fields']): FormAction => ({
  type: 'applyExtraction',
  result: { fields, warnings: [], stats: { meanConfidence: 90, mrz: 'valid' } },
});

describe('defaults', () => {
  it('applies BR-06, BR-07, BR-08 and leaves gender and visitor type empty', () => {
    const s = createInitialState();
    expect(s.values.visitType).toBe('prayer');
    expect(s.values.luggageCenter).toBe('madinah');
    expect(s.values.phoneDialCode).toBe('966');
    expect(s.values.gender).toBe('');
    expect(s.values.visitorType).toBe('');
    expect(s.values.luggageSize).toBe('');
    expect(Object.values(s.values.luggage).every((n) => n === 0)).toBe(true);
  });
});

describe('nationality rules', () => {
  it('classifies GCC nationalities as خليجي and others as دولي (BR-05)', () => {
    expect(run({ type: 'edit', field: 'nationality', value: 'KW' }).values.visitorType).toBe('gcc');
    expect(run({ type: 'edit', field: 'nationality', value: 'SA' }).values.visitorType).toBe('gcc');
    expect(run({ type: 'edit', field: 'nationality', value: 'EG' }).values.visitorType).toBe('international');
  });

  it('recalculates when nationality changes, but keeps a manual override and suggests the rule value', () => {
    const s = run(
      { type: 'edit', field: 'nationality', value: 'EG' },
      { type: 'edit', field: 'visitorType', value: 'gcc' },
      { type: 'edit', field: 'nationality', value: 'IN' },
    );
    expect(s.values.visitorType).toBe('gcc');
    expect(s.meta.visitorType.suggestions[0]?.value).toBe('international');
  });

  it('selects the nationality calling code for passports (BR-09)', () => {
    const s = run({ type: 'edit', field: 'docType', value: 'passport' }, { type: 'edit', field: 'nationality', value: 'EG' });
    expect(s.values.phoneDialCode).toBe('20');
  });

  it('keeps +966 for residence permits and offers the nationality code (configurable)', () => {
    const s = run({ type: 'edit', field: 'docType', value: 'residence' }, { type: 'edit', field: 'nationality', value: 'EG' });
    expect(s.values.phoneDialCode).toBe('966');
    expect(s.meta.phone.suggestions[0]?.value).toBe('20');
  });

  it('does not change the calling code once a number is entered; suggests instead (BR-13)', () => {
    const s = run(
      { type: 'edit', field: 'docType', value: 'passport' },
      { type: 'editPhone', number: '501234567' },
      { type: 'edit', field: 'nationality', value: 'EG' },
    );
    expect(s.values.phoneDialCode).toBe('966');
    expect(s.values.phoneNumber).toBe('501234567');
    expect(s.meta.phone.suggestions[0]?.value).toBe('20');
  });

  it('does not change a calling code the user picked', () => {
    const s = run(
      { type: 'edit', field: 'docType', value: 'passport' },
      { type: 'editPhone', dialCode: '92' },
      { type: 'edit', field: 'nationality', value: 'EG' },
    );
    expect(s.values.phoneDialCode).toBe('92');
  });
});

describe('nationality typed as text', () => {
  it('matches adjectives and English names to the country list', () => {
    const s = run({ type: 'editNationalityText', text: 'سوداني' });
    expect(s.values.nationality).toBe('SD');
    expect(s.values.visitorType).toBe('international');
    expect(run({ type: 'editNationalityText', text: 'KUWAITI' }).values.visitorType).toBe('gcc');
  });

  it('keeps unmatched text without inventing a country or visitor type', () => {
    const s = run({ type: 'editNationalityText', text: 'xyz' });
    expect(s.values.nationalityText).toBe('xyz');
    expect(s.values.nationality).toBe('');
    expect(s.values.visitorType).toBe('');
  });
});

describe('luggage', () => {
  it('counts pieces per type, clamped to 0..20', () => {
    const s = run(
      { type: 'setLuggageCount', kind: 'suitcase', count: 2 },
      { type: 'setLuggageCount', kind: 'bag', count: -1 },
      { type: 'setLuggageCount', kind: 'other', count: 99 },
      { type: 'setLuggageSize', size: 'M+' },
    );
    expect(s.values.luggage).toMatchObject({ suitcase: 2, bag: 0, other: 20 });
    expect(totalPieces(s.values)).toBe(22);
    expect(s.values.luggageSize).toBe('M+');
  });
});

describe('applying OCR results', () => {
  it('fills fields, flags uncertain ones and marks missing ones', () => {
    const s = run(
      extraction({
        docType: { value: 'passport', confidence: 'high', source: 'mrz' },
        fullName: { value: 'MOHAMMED AHMED', confidence: 'medium', source: 'ocr', note: 'تحقق' },
        nationality: { value: 'EG', confidence: 'high', source: 'mrz' },
      }),
    );
    expect(s.values.fullName).toBe('MOHAMMED AHMED');
    expect(s.meta.fullName.flag?.level).toBe('review');
    expect(s.meta.docType.flag).toBeNull();
    expect(s.values.visitorType).toBe('international');
    expect(s.values.nationalityText).toBe('مصر');
    expect(s.values.phoneDialCode).toBe('20');
    expect(s.values.gender).toBe('');
    expect(s.meta.gender.flag?.level).toBe('review');
    expect(s.meta.birthDate.flag?.message).toContain('لم يتم استخراج');
  });

  it('never overwrites manual edits (BR-14) and offers the new value as a suggestion', () => {
    const s = run(
      { type: 'edit', field: 'fullName', value: 'محمد أحمد علي' },
      extraction({ fullName: { value: 'MOHAMMED AHMED ALI', confidence: 'high', source: 'mrz' } }),
    );
    expect(s.values.fullName).toBe('محمد أحمد علي');
    expect(s.meta.fullName.suggestions[0]?.value).toBe('MOHAMMED AHMED ALI');
    expect(s.notices[0]).toContain('الاسم الثلاثي');
  });

  it('clears OCR values from a previous document that the new document lacks', () => {
    const s = run(
      extraction({ gender: { value: 'female', confidence: 'high', source: 'mrz' } }),
      extraction({ fullName: { value: 'X Y', confidence: 'high', source: 'mrz' } }),
    );
    expect(s.values.gender).toBe('');
  });

  it('marks conflicts', () => {
    const s = run(extraction({ birthDate: { value: '1990-01-01', confidence: 'low', source: 'mrz', conflict: true, note: 'x' } }));
    expect(s.meta.birthDate.flag?.level).toBe('conflict');
  });
});

describe('suggestions and confirmation', () => {
  it('applies an alternative and keeps the previous value one click away', () => {
    const s = run(
      extraction({
        fullName: {
          value: 'MOHAMMED AHMED',
          confidence: 'high',
          source: 'mrz',
          alternatives: [{ value: 'محمد أحمد', display: 'محمد أحمد', reason: 'عربي' }],
        },
      }),
      { type: 'applySuggestion', field: 'fullName', index: 0 },
    );
    expect(s.values.fullName).toBe('محمد أحمد');
    expect(s.meta.fullName.suggestions.map((x) => x.value)).toEqual(['MOHAMMED AHMED']);
  });

  it('invalidates confirmation after any edit', () => {
    const s = run({ type: 'edit', field: 'fullName', value: 'A B' }, { type: 'confirm' }, { type: 'edit', field: 'fullName', value: 'A C' });
    expect(s.confirmed).toBe(false);
    expect(s.notices).toHaveLength(1);
  });

  it('reset restores the initial state', () => {
    const s = run({ type: 'edit', field: 'fullName', value: 'A B' }, { type: 'reset' });
    expect(s).toEqual(createInitialState());
  });
});
