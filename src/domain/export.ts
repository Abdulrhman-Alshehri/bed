// CSV and clipboard export. Only form values are exported: no image, no OCR metadata.
import { CSV_EXCEL_TEXT_GUARD } from '../config/rules';
import { countryName } from '../data/countries';
import { displayValue } from './display';
import { totalPieces } from './formState';
import { FIELD_LABELS, LUGGAGE_KIND_LABELS, LUGGAGE_SIZE_LABELS } from './labels';
import { phoneForExport } from './phone';
import { FIELD_ORDER, LUGGAGE_KINDS, type FieldKey, type FormValues, type LuggageKind } from './types';

export type ExportField = FieldKey | `luggage.${LuggageKind}` | 'luggageTotal' | 'luggageSize';

export interface ExportCell {
  field: ExportField;
  header: string;
  value: string;
}

export const luggageSizeDisplay = (size: string) =>
  size ? `${LUGGAGE_SIZE_LABELS[size as keyof typeof LUGGAGE_SIZE_LABELS] ?? size} (${size})` : '';

/**
 * The ten BRD values in BRD order (dates ISO, phone E.164), followed by the luggage: pieces per
 * type, total and size.
 */
export function buildExportCells(values: FormValues): ExportCell[] {
  const form: ExportCell[] = FIELD_ORDER.map((field) => {
    let value: string;
    if (field === 'phone') value = phoneForExport(values.phoneDialCode, values.phoneNumber);
    else if (field === 'nationality') value = countryName(values.nationality) || values.nationalityText.trim();
    else value = displayValue(field, (values as unknown as Record<string, string>)[field] ?? '');
    return { field, header: FIELD_LABELS[field], value };
  });
  const luggage: ExportCell[] = LUGGAGE_KINDS.map((kind) => ({
    field: `luggage.${kind}` as const,
    header: LUGGAGE_KIND_LABELS[kind],
    value: String(values.luggage[kind]),
  }));
  return [
    ...form,
    ...luggage,
    { field: 'luggageTotal', header: 'إجمالي القطع', value: String(totalPieces(values)) },
    { field: 'luggageSize', header: 'حجم الأمتعة', value: luggageSizeDisplay(values.luggageSize) },
  ];
}

/** Columns whose values are identifiers Excel would otherwise mangle (leading zeros, 1.2E+11). */
const TEXT_COLUMNS: ReadonlySet<ExportField> = new Set<ExportField>(['docNumber', 'phone']);

function csvCell(value: string, asExcelText: boolean): string {
  let v = value.replace(/[\r\n]+/g, ' ');
  if (asExcelText && v) v = `="${v.replace(/"/g, '""')}"`;
  // Neutralize spreadsheet formula injection in free-text values.
  else if (/^[=+\-@\t]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

/** UTF-8 CSV with BOM (so Excel shows Arabic correctly) and CRLF line endings. */
export function toCsv(cells: ExportCell[], excelTextGuard = CSV_EXCEL_TEXT_GUARD): string {
  const header = cells.map((c) => csvCell(c.header, false)).join(',');
  const row = cells.map((c) => csvCell(c.value, excelTextGuard && TEXT_COLUMNS.has(c.field))).join(',');
  return `﻿${header}\r\n${row}\r\n`;
}

/** "نوع الهوية: جواز سفر" lines for pasting into other systems (luggage types with 0 pieces omitted). */
export function toClipboardText(cells: ExportCell[]): string {
  return cells
    .filter((c) => !(c.field.startsWith('luggage.') && c.value === '0'))
    .map((c) => `${c.header}: ${c.value}`)
    .join('\n');
}

/** Contains no personal data: only the export time. */
export function exportFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `visitor-registration-${stamp}.csv`;
}
