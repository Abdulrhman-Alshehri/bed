// Saudi national ID (هوية وطنية) and residence permit (إقامة) numbers: 10 digits, the first digit is
// 1 for citizens and 2 for residents, and the last digit is a Luhn check digit.
import { normalizeDigits } from './text';

export type SaudiIdKind = 'citizen' | 'resident';

export function isValidSaudiIdNumber(id: string): boolean {
  if (!/^[12]\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = Number(id[i]);
    if (i % 2 === 0) {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += digit;
    }
  }
  return sum % 10 === 0;
}

export function saudiIdKind(id: string): SaudiIdKind | null {
  if (id.startsWith('1')) return 'citizen';
  if (id.startsWith('2')) return 'resident';
  return null;
}

export interface SaudiIdCandidate {
  value: string;
  valid: boolean;
}

/**
 * Finds 10-digit numbers starting with 1 or 2 in OCR text (Arabic-Indic digits included).
 * Digits separated by single spaces are joined, since OCR sometimes splits long numbers.
 */
export function findSaudiIdNumbers(text: string): SaudiIdCandidate[] {
  const normalized = normalizeDigits(text);
  const found = new Map<string, SaudiIdCandidate>();
  for (const match of normalized.matchAll(/(?<!\d)[12](?: ?\d){9}(?!\d)/g)) {
    const value = match[0].replace(/ /g, '');
    if (!found.has(value)) found.set(value, { value, valid: isValidSaudiIdNumber(value) });
  }
  return [...found.values()];
}
