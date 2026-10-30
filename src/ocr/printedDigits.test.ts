import { describe, expect, it } from 'vitest';
import { labelBoxes } from './printedDigits';
import type { OcrLine, OcrWord } from './types';

const word = (text: string, x0: number, x1: number, y0 = 100): OcrWord => ({ text, confidence: 90, bbox: { x0, y0, x1, y1: y0 + 24 } });
const line = (words: OcrWord[]): OcrLine => ({
  text: words.map((w) => w.text).join(' '),
  confidence: 90,
  words,
  bbox: { x0: Math.min(...words.map((w) => w.bbox.x0)), y0: words[0]!.bbox.y0, x1: Math.max(...words.map((w) => w.bbox.x1)), y1: words[0]!.bbox.y1 },
});

describe('label positions for the digit reader', () => {
  it('finds the birth-date label from its words, without the value next to it', () => {
    const page = { confidence: 80, lines: [line([word('٠٠٠١/١/١6', 700, 900), word('تاريخ', 1100, 1160), word('الميلاد:', 1000, 1090)])] };
    expect(labelBoxes(page, 'birth')).toEqual([{ x0: 1000, y0: 100, x1: 1160, y1: 124 }]);
  });

  it('does not take the place of birth for the birth date', () => {
    const page = { confidence: 80, lines: [line([word('مكان', 600, 660), word('الميلاد:', 500, 590)])] };
    expect(labelBoxes(page, 'birth')).toEqual([]);
  });

  it('finds the ID number label but not the employer’s ID', () => {
    const page = {
      confidence: 80,
      lines: [line([word('رقم', 1110, 1160), word('الهوية:', 1000, 1100)]), line([word('هوية', 1100, 1160, 300), word('صاحب', 1020, 1090, 300), word('العمل:', 940, 1010, 300)])],
    };
    expect(labelBoxes(page, 'docNumber')).toEqual([{ x0: 1000, y0: 100, x1: 1160, y1: 124 }]);
  });
});
