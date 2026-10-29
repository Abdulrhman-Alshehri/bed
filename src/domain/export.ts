// CSV and clipboard export. Only the ten form values are exported: no image, no OCR metadata.
import { CSV_EXCEL_TEXT_GUARD } from '../config/rules';
import { displayValue } from './display';
import { FIELD_LABELS } from './labels';
import { phoneForExport } from './phone';
import { FIELD_ORDER, type FieldKey, type FormValues } from './types';

export interface ExportCell {
  field: FieldKey;
  header: string;
  value: string;
}

/** The ten values in BRD order, as Arabic display text (dates ISO, phone E.164). */
export function buildExportCells(values: FormValues): ExportCell[] {
  return FIELD_ORDER.map((field) => {
    let value: string;
    if (field === 'phone') value = phoneForExport(values.phoneCountry, values.phoneNumber);
    else value = displayValue(field, (values as unknown as Record<string, string>)[field] ?? '');
    return { field, header: FIELD_LABELS[field], value };
  });
}

/** Columns whose values are identifiers Excel would otherwise mangle (leading zeros, 1.2E+11). */
const TEXT_COLUMNS: ReadonlySet<FieldKey> = new Set(['docNumber', 'phone']);

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

/** "نوع الهوية: جواز سفر" lines for pasting into other systems. */
export function toClipboardText(cells: ExportCell[]): string {
  return cells.map((c) => `${c.header}: ${c.value}`).join('\n');
}

/** Contains no personal data: only the export time. */
export function exportFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `visitor-registration-${stamp}.csv`;
}
