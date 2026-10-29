import type { OcrLine, OcrPage } from '../ocr/types';

/** Builds an OCR page from plain text lines (for tests). */
export function page(lines: string[], confidence = 90): OcrPage {
  const ocrLines: OcrLine[] = lines.map((text, i) => ({
    text,
    confidence,
    bbox: { x0: 0, y0: i * 40, x1: 1000, y1: i * 40 + 30 },
    words: [],
  }));
  return { lines: ocrLines, confidence };
}

/** Completes a 9-digit prefix (starting with 1 or 2) into a Luhn-valid Saudi ID number. Synthetic only. */
export function saudiId(prefix9: string): string {
  for (let d = 0; d <= 9; d++) {
    const id = prefix9 + d;
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const digit = Number(id[i]);
      if (i % 2 === 0) {
        const doubled = digit * 2;
        sum += doubled > 9 ? doubled - 9 : doubled;
      } else sum += digit;
    }
    if (sum % 10 === 0) return id;
  }
  throw new Error('unreachable');
}

export const FIXED_NOW = new Date('2026-10-29T12:00:00Z');
