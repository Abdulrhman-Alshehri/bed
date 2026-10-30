import { describe, expect, it } from 'vitest';
import { createInitialState, formReducer, type FormAction } from './formState';
import { hasErrors, validateDocNumber, validateForm } from './validation';
import { checkPhone } from './phone';
import { FIXED_NOW, saudiId } from '../test/helpers';

const state = (...actions: FormAction[]) => actions.reduce(formReducer, createInitialState());

describe('validateForm', () => {
  it('reports required fields as errors and recommended ones as warnings', () => {
    const issues = validateForm(createInitialState(), FIXED_NOW);
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.field)).toEqual([
      'luggage', 'luggageSize', 'docType', 'fullName', 'docNumber', 'visitorType', 'nationality', 'birthDate',
    ]);
    expect(issues.filter((i) => i.severity === 'warning').map((i) => i.field)).toEqual(['phone', 'gender']);
  });

  it('accepts a complete form', () => {
    const s = state(
      { type: 'setLuggageCount', kind: 'suitcase', count: 1 },
      { type: 'setLuggageSize', size: 'M' },
      { type: 'edit', field: 'docType', value: 'national_id' },
      { type: 'edit', field: 'fullName', value: 'سعد عبدالله التجربة' },
      { type: 'edit', field: 'docNumber', value: saudiId('105678901') },
      { type: 'edit', field: 'nationality', value: 'SA' },
      { type: 'edit', field: 'birthDate', value: '1990-05-12' },
      { type: 'editPhone', number: '0501234567' },
      { type: 'edit', field: 'gender', value: 'male' },
    );
    expect(validateForm(s, FIXED_NOW)).toEqual([]);
  });

  it('warns when the typed nationality matches no country', () => {
    const issues = validateForm(state({ type: 'editNationalityText', text: 'xyz' }), FIXED_NOW);
    expect(issues.find((i) => i.field === 'nationality')).toMatchObject({ severity: 'warning' });
  });

  it('rejects future and implausible birth dates', () => {
    const future = validateForm(state({ type: 'edit', field: 'birthDate', value: '2030-01-01' }), FIXED_NOW);
    expect(future.some((i) => i.field === 'birthDate' && i.severity === 'error')).toBe(true);
    const old = validateForm(state({ type: 'edit', field: 'birthDate', value: '1880-01-01' }), FIXED_NOW);
    expect(old.some((i) => i.field === 'birthDate' && i.severity === 'error')).toBe(true);
  });

  it('blocks unresolved conflicts', () => {
    const s = state({
      type: 'applyExtraction',
      result: {
        fields: { birthDate: { value: '1990-01-01', confidence: 'low', source: 'mrz', conflict: true, note: 'x' } },
        warnings: [],
        stats: { meanConfidence: 90, mrz: 'valid' },
      },
    });
    expect(hasErrors(validateForm(s, FIXED_NOW).filter((i) => i.field === 'birthDate'))).toBe(true);
    const acknowledged = formReducer(s, { type: 'acknowledgeFlag', field: 'birthDate' });
    expect(validateForm(acknowledged, FIXED_NOW).some((i) => i.field === 'birthDate')).toBe(false);
  });
});

describe('validateDocNumber', () => {
  it('enforces the Saudi national ID format and check digit', () => {
    expect(validateDocNumber('national_id', 'SA', saudiId('105678901'))).toBeNull();
    expect(validateDocNumber('national_id', 'SA', '2056789012')?.severity).toBe('error');
    expect(validateDocNumber('national_id', 'SA', '1056789010')?.severity).toBe('error');
  });

  it('validates Iqama numbers and only warns on other residence formats', () => {
    expect(validateDocNumber('residence', 'EG', saudiId('234567890'))).toBeNull();
    expect(validateDocNumber('residence', 'EG', '2345678901')?.severity).toBe('error');
    expect(validateDocNumber('residence', 'EG', 'AB12345')?.severity).toBe('warning');
  });

  it('accepts other countries’ national IDs with leading zeros', () => {
    expect(validateDocNumber('national_id', 'KW', '000123456789')).toBeNull();
  });

  it('rejects non-alphanumeric characters', () => {
    expect(validateDocNumber('passport', 'EG', 'A12 345')?.severity).toBe('error');
  });
});

describe('checkPhone', () => {
  it('validates Saudi mobiles with or without the trunk 0', () => {
    expect(checkPhone('966', '0501234567')).toMatchObject({ ok: true, e164: '+966501234567' });
    expect(checkPhone('966', '٥٠١٢٣٤٥٦٧')).toMatchObject({ ok: true, e164: '+966501234567' });
  });

  it('rejects numbers that do not fit the selected country', () => {
    expect(checkPhone('966', '12345').ok).toBe(false);
    expect(checkPhone('966', '+201001234567').ok).toBe(false);
    expect(checkPhone('999', '501234567')).toMatchObject({ ok: false, message: 'رمز الدولة غير صحيح' });
  });

  it('warns about landlines', () => {
    expect(checkPhone('966', '0112345678')).toMatchObject({ ok: true, fixedLine: true });
  });
});
