import { describe, expect, it } from 'vitest';
import { buildExportCells, exportFileName, toClipboardText, toCsv } from './export';
import { createInitialState } from './formState';
import type { FormValues } from './types';

const values: FormValues = {
  ...createInitialState().values,
  docType: 'passport',
  fullName: 'MOHAMMED "MO" AHMED',
  docNumber: '012345678',
  visitorType: 'international',
  nationality: 'EG',
  nationalityText: 'مصري',
  birthDate: '1990-01-15',
  phoneDialCode: '20',
  phoneNumber: '01001234567',
  gender: 'male',
  luggage: { backpack: 1, suitcase: 2, bag: 0, stroller: 0, wheelchair: 0, other: 0 },
  luggageSize: 'M+',
};

describe('buildExportCells', () => {
  it('produces the ten BRD columns in order, then the luggage columns', () => {
    const cells = buildExportCells(values).slice(0, 10);
    expect(cells.map((c) => c.header)).toEqual([
      'نوع الهوية',
      'الاسم الثلاثي',
      'رقم الهوية / الإقامة / الجواز',
      'نوع الزائر',
      'نوع الزيارة',
      'الجنسية',
      'تاريخ الميلاد',
      'رقم الجوال',
      'مركز حفظ الأمتعة',
      'الجنس',
    ]);
    expect(cells.map((c) => c.value)).toEqual([
      'جواز سفر',
      'MOHAMMED "MO" AHMED',
      '012345678',
      'دولي',
      'صلاة',
      'مصر',
      '1990-01-15',
      '+201001234567',
      'المدينة',
      'ذكر',
    ]);
  });

  it('appends pieces per luggage type, the total and the size', () => {
    const luggage = buildExportCells(values).slice(10);
    expect(luggage.map((c) => `${c.header}=${c.value}`)).toEqual([
      'حقيبة ظهر=1', 'حقيبة سفر=2', 'كيس=0', 'عربة أطفال=0', 'كرسي متحرك=0', 'أخرى=0', 'إجمالي القطع=3', 'حجم الأمتعة=متوسط+ (M+)',
    ]);
  });

  it('exports the typed nationality when it matches no country', () => {
    const cells = buildExportCells({ ...values, nationality: '', nationalityText: 'Atlantis' });
    expect(cells.find((c) => c.field === 'nationality')?.value).toBe('Atlantis');
  });

  it('exports an empty gender as an empty cell', () => {
    const cells = buildExportCells({ ...values, gender: '' });
    expect(cells.find((c) => c.field === 'gender')?.value).toBe('');
  });
});

describe('toCsv', () => {
  it('starts with a UTF-8 BOM, escapes quotes and keeps identifiers as text for Excel', () => {
    const csv = toCsv(buildExportCells(values));
    expect(csv.startsWith('﻿')).toBe(true);
    const [, row] = csv.slice(1).split('\r\n');
    expect(row).toContain('"MOHAMMED ""MO"" AHMED"');
    expect(row).toContain('"=""012345678"""');
    expect(row).toContain('"=""+201001234567"""');
  });

  it('can export identifiers as plain values', () => {
    const csv = toCsv(buildExportCells(values), false);
    expect(csv).toContain('"012345678"');
    // A plain "+..." cell would be read as a formula, so it is prefixed.
    expect(csv).toContain(`"'+201001234567"`);
  });

  it('neutralizes formula injection in free text', () => {
    const csv = toCsv(buildExportCells({ ...values, fullName: '=HYPERLINK("x")' }));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('toClipboardText and file name', () => {
  it('formats label: value lines', () => {
    const text = toClipboardText(buildExportCells(values));
    expect(text.split('\n')[0]).toBe('نوع الهوية: جواز سفر');
    expect(text).toContain('حقيبة سفر: 2');
    expect(text).not.toContain('كيس: 0');
  });

  it('does not put personal data in the file name', () => {
    expect(exportFileName(new Date(2026, 9, 29, 8, 5, 3))).toBe('visitor-registration-20261029-080503.csv');
  });
});
