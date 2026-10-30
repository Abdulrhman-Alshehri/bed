// Rebuilds the visual layout of a card from OCR output: rows of cells, with positions.
//
// OCR engines often split one printed row («الجنسية:   افغانستان») into separate lines, or order
// text by column, so "the next line" is not a reliable way to find a label's value. Labels are
// paired with values by position instead: in the same cell, then the next cell of the same row,
// then the cell directly below.
import type { BBox, OcrLine, OcrWord } from '../ocr/types';
import { findLabels, type LabelGroup } from './fieldLabels';

export interface Cell {
  text: string;
  confidence: number;
  bbox: BBox;
  words: OcrWord[];
}

export interface Row {
  /** Cells in reading order (right to left for Arabic). */
  cells: Cell[];
}

export interface Layout {
  rows: Row[];
  direction: 'rtl' | 'ltr';
}

const height = (b: BBox) => Math.max(1, b.y1 - b.y0);
const centerY = (b: BBox) => (b.y0 + b.y1) / 2;

function union(boxes: BBox[]): BBox {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

function toCell(words: OcrWord[]): Cell {
  return {
    text: words.map((w) => w.text).join(' '),
    confidence: words.reduce((sum, w) => sum + w.confidence, 0) / words.length,
    bbox: union(words.map((w) => w.bbox)),
    words,
  };
}

/** Removes low-confidence words from the ends of a cell (noise from patterns or other scripts). */
function trimEdges(words: OcrWord[], minConfidence: number): OcrWord[] {
  let start = 0;
  let end = words.length;
  while (start < end && words[start]!.confidence < minConfidence) start++;
  while (end > start && words[end - 1]!.confidence < minConfidence) end--;
  return words.slice(start, end);
}

/**
 * Groups words into rows (by vertical position) and splits rows into cells where words are far
 * apart (column gaps are several times the text height; word spacing is a fraction of it).
 */
export function buildLayout(
  lines: OcrLine[],
  direction: 'rtl' | 'ltr',
  { gapFactor = 2.5, trimConfidence = 0 }: { gapFactor?: number; trimConfidence?: number } = {},
): Layout {
  const tokens = lines
    .flatMap((l) => (l.words.length ? l.words : [{ text: l.text, confidence: l.confidence, bbox: l.bbox }]))
    .filter((t) => t.text.trim());
  const sorted = [...tokens].sort((a, b) => centerY(a.bbox) - centerY(b.bbox));
  const bands: { words: OcrWord[]; y0: number; y1: number }[] = [];
  for (const token of sorted) {
    const cy = centerY(token.bbox);
    const band = bands.find((b) => cy >= b.y0 && cy <= b.y1);
    if (band) band.words.push(token);
    else bands.push({ words: [token], y0: token.bbox.y0, y1: token.bbox.y1 });
  }

  const rows: Row[] = [];
  for (const band of bands.sort((a, b) => a.y0 - b.y0)) {
    const words = band.words.sort((a, b) => (direction === 'rtl' ? b.bbox.x1 - a.bbox.x1 : a.bbox.x0 - b.bbox.x0));
    const typical = [...words.map((w) => height(w.bbox))].sort((a, b) => a - b)[Math.floor(words.length / 2)]!;
    const groups: OcrWord[][] = [[words[0]!]];
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1]!.bbox;
      const cur = words[i]!.bbox;
      const gap = direction === 'rtl' ? prev.x0 - cur.x1 : cur.x0 - prev.x1;
      if (gap > typical * gapFactor) groups.push([words[i]!]);
      else groups[groups.length - 1]!.push(words[i]!);
    }
    const cells = groups
      .map((g) => (trimConfidence ? trimEdges(g, trimConfidence) : g))
      .filter((g) => g.length > 0)
      .map(toCell);
    if (cells.length) rows.push({ cells });
  }
  return { rows, direction };
}

/** All cells in reading order. */
export function cellsOf(layout: Layout): Cell[] {
  return layout.rows.flatMap((r) => r.cells);
}

/** The cell directly below `cell` (overlapping horizontally, within about two text heights). */
export function cellBelow(layout: Layout, rowIndex: number, cell: Cell): Cell | null {
  const maxGap = height(cell.bbox) * 2;
  for (let r = rowIndex + 1; r < layout.rows.length; r++) {
    const row = layout.rows[r]!;
    const top = Math.min(...row.cells.map((c) => c.bbox.y0));
    if (top - cell.bbox.y1 > maxGap) break;
    const below = row.cells.find((c) => c.bbox.x0 < cell.bbox.x1 && cell.bbox.x0 < c.bbox.x1 && c.bbox.y0 >= cell.bbox.y1 - height(cell.bbox) / 2);
    if (below) return below;
  }
  return null;
}

/** The cell directly above `cell`. */
export function cellAbove(layout: Layout, rowIndex: number, cell: Cell): Cell | null {
  const maxGap = height(cell.bbox) * 2;
  for (let r = rowIndex - 1; r >= 0; r--) {
    const row = layout.rows[r]!;
    const bottom = Math.max(...row.cells.map((c) => c.bbox.y1));
    if (cell.bbox.y0 - bottom > maxGap) break;
    const above = row.cells.find((c) => c.bbox.x0 < cell.bbox.x1 && cell.bbox.x0 < c.bbox.x1 && c.bbox.y1 <= cell.bbox.y0 + height(cell.bbox) / 2);
    if (above) return above;
  }
  return null;
}

/** Text of a cell up to its first label (the part that can be a value). */
function leadingValue(cell: Cell): string {
  const first = findLabels(cell.text)[0];
  return (first ? cell.text.slice(0, first.start) : cell.text).trim();
}

export interface LabeledValue<T> {
  value: T;
  confidence: number;
  cell: Cell;
}

const stripPunctuation = (s: string) => s.replace(/^[\s:：\-–|/.،,]+/, '').replace(/[\s:：|،,]+$/, '');

/**
 * Finds values printed next to labels of `group`, in every layout. A value is the text after the
 * label in the same cell (up to the next label); if the label stands alone, the next cell in the
 * same row; then the cell directly below. Returns every accepted value in reading order.
 */
export function valuesForLabel<T>(layouts: Layout[], group: LabelGroup, accept: (segment: string) => T | null): LabeledValue<T>[] {
  const found: LabeledValue<T>[] = [];
  for (const layout of layouts) {
    layout.rows.forEach((row, r) => {
      row.cells.forEach((cell, c) => {
        const hits = findLabels(cell.text);
        hits.forEach((hit, h) => {
          if (hit.group !== group) return;
          const next = hits[h + 1];
          const segment = stripPunctuation(cell.text.slice(hit.end, next?.start ?? cell.text.length));
          if (segment) {
            const value = accept(segment);
            if (value !== null) found.push({ value, confidence: cell.confidence, cell });
            return;
          }
          // Another label follows immediately: this field's value is missing in the image.
          if (next) return;
          for (const neighbour of [row.cells[c + 1], cellBelow(layout, r, cell)]) {
            if (!neighbour) continue;
            const text = stripPunctuation(leadingValue(neighbour));
            if (!text) continue;
            const value = accept(text);
            if (value !== null) {
              found.push({ value, confidence: neighbour.confidence, cell: neighbour });
              return;
            }
          }
        });
      });
    });
  }
  return found;
}

/**
 * The label that a piece of text at `position` in a cell belongs to: the nearest label before it
 * in the same cell, else the last label of the previous cell in the row (a label cell followed by
 * its value cell), else the label in the cell directly above.
 */
export function labelFor(layout: Layout, rowIndex: number, cellIndex: number, position: number): LabelGroup | null {
  const row = layout.rows[rowIndex]!;
  const cell = row.cells[cellIndex]!;
  const before = findLabels(cell.text).filter((h) => h.end <= position);
  if (before.length) return before[before.length - 1]!.group;
  const previous = row.cells[cellIndex - 1];
  if (previous) {
    const hits = findLabels(previous.text);
    const last = hits[hits.length - 1];
    // Only when the label ends the previous cell (its value is in this cell).
    if (last && !stripPunctuation(previous.text.slice(last.end))) return last.group;
  }
  if (!previous || findLabels(previous.text).length === 0) {
    const above = cellAbove(layout, rowIndex, cell);
    if (above) {
      const hits = findLabels(above.text);
      const last = hits[hits.length - 1];
      if (last && !stripPunctuation(above.text.slice(last.end))) return last.group;
    }
  }
  return null;
}
