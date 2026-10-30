// Finds the document within a photo or screenshot so OCR runs on the card only. Cropping matters:
// in testing, OCR on a cropped Iqama read the labels and nationality that it missed on the full
// screenshot. The detection is deliberately conservative: when the card does not stand out from
// its background (e.g. a white card on a white desk), the whole image is used.
import type { BBox } from './types';

/** Longest contiguous run of `true`, tolerating gaps of up to `maxGap` entries. */
function longestRun(flags: boolean[], maxGap: number): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  let lastTrue = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (start === -1 || i - lastTrue > maxGap + 1) start = i;
      lastTrue = i;
      if (!best || lastTrue - start > best[1] - best[0]) best = [start, lastTrue];
    }
  }
  return best;
}

/**
 * @param gray luminance values (0-255), row by row
 * @returns the card's bounding box in the same pixel coordinates, or null
 */
export function findCardRegion(gray: ArrayLike<number>, width: number, height: number): BBox | null {
  const border: number[] = [];
  const bw = Math.max(1, Math.round(width * 0.03));
  const bh = Math.max(1, Math.round(height * 0.03));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < bw || x >= width - bw || y < bh || y >= height - bh) border.push(gray[y * width + x]!);
    }
  }
  border.sort((a, b) => a - b);
  const background = border[Math.floor(border.length / 2)]!;
  const differs = (v: number) => Math.abs(v - background) > 45;

  const rowFlags: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) if (differs(gray[y * width + x]!)) count++;
    rowFlags.push(count / width > 0.5);
  }
  const rows = longestRun(rowFlags, Math.round(height * 0.02));
  if (!rows) return null;

  const colFlags: boolean[] = [];
  const bandHeight = rows[1] - rows[0] + 1;
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = rows[0]; y <= rows[1]; y++) if (differs(gray[y * width + x]!)) count++;
    colFlags.push(count / bandHeight > 0.5);
  }
  const cols = longestRun(colFlags, Math.round(width * 0.02));
  if (!cols) return null;

  const w = cols[1] - cols[0] + 1;
  const h = bandHeight;
  const areaRatio = (w * h) / (width * height);
  const aspect = Math.max(w, h) / Math.min(w, h);
  // ID-1 cards are 1.59:1 and passport data pages about 1.42:1.
  if (areaRatio < 0.12 || areaRatio > 0.9 || aspect < 1.2 || aspect > 2.1) return null;

  const padX = w * 0.02;
  const padY = h * 0.02;
  return {
    x0: Math.max(0, cols[0] - padX),
    y0: Math.max(0, rows[0] - padY),
    x1: Math.min(width, cols[1] + 1 + padX),
    y1: Math.min(height, rows[1] + 1 + padY),
  };
}
