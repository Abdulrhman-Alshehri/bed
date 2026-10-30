// Reads the Arabic-Indic digits printed next to Arabic labels («تاريخ الميلاد», «رقم الهوية») with
// the dedicated digit reader, using the label positions found by the Arabic OCR pass.
import { findLabels, type LabelGroup } from '../extraction/fieldLabels';
import { bandGeometry, readDate, readNumber, type DateReading, type Gray } from './digitReader';
import { createCanvas, releaseCanvas, unionBox } from './preprocess';
import type { BBox, OcrPage } from './types';

export interface PrintedDigits {
  birth: DateReading | null;
  /** The holder's ID number read by the same reader, to check it against the barcode/Luhn number. */
  idNumber: string | null;
  /** The birth date as printed on the document (PNG data URL), for staff to compare. */
  birthImage: string | null;
}

const ARABIC = /[؀-ۿ]/;

/** Boxes of the Arabic labels of a group, from the words of the OCR output. */
export function labelBoxes(page: OcrPage, group: LabelGroup): BBox[] {
  const out: BBox[] = [];
  for (const line of page.lines) {
    let text = '';
    const spans = line.words.map((w) => {
      if (text) text += ' ';
      const start = text.length;
      text += w.text;
      return [start, text.length] as const;
    });
    for (const hit of findLabels(text, [group])) {
      if (!ARABIC.test(text.slice(hit.start, hit.end))) continue;
      const words = line.words.filter((_, i) => spans[i]![0] < hit.end && hit.start < spans[i]![1]);
      if (words.length) out.push(unionBox(words.map((w) => w.bbox)));
    }
  }
  return out;
}

/** The band to the left of a label, scaled and converted to grayscale for the reader. */
function grayBand(canvas: HTMLCanvasElement, label: BBox, widths: number): { gray: Gray; labelX: number; scale: number; src: BBox } | null {
  if (label.y1 - label.y0 < 6) return null;
  const g = bandGeometry(label, canvas.width, canvas.height, widths);
  const band = createCanvas(g.width, g.height);
  try {
    const ctx = band.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, g.src.x0, g.src.y0, g.src.x1 - g.src.x0, g.src.y1 - g.src.y0, 0, 0, band.width, band.height);
    const px = ctx.getImageData(0, 0, band.width, band.height).data;
    const data = new Float32Array(band.width * band.height);
    for (let i = 0; i < data.length; i++) data[i] = 0.299 * px[4 * i]! + 0.587 * px[4 * i + 1]! + 0.114 * px[4 * i + 2]!;
    return { gray: { width: band.width, height: band.height, data }, labelX: g.labelX, scale: g.scale, src: g.src };
  } finally {
    releaseCanvas(band);
  }
}

/** A picture of part of the document, at most 640 px wide. */
function snapshot(canvas: HTMLCanvasElement, box: BBox): string | null {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (w < 4 || h < 4) return null;
  const scale = Math.min(3, 640 / w);
  const out = createCanvas(w * scale, h * scale);
  try {
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, box.x0, box.y0, w, h, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  } finally {
    releaseCanvas(out);
  }
}

export function readPrintedDigits(canvas: HTMLCanvasElement, arabic: OcrPage, now = new Date()): PrintedDigits {
  let birth: DateReading | null = null;
  let birthImage: string | null = null;
  for (const label of labelBoxes(arabic, 'birth')) {
    const band = grayBand(canvas, label, 11);
    if (!band) continue;
    const reading = readDate(band.gray, band.labelX, now);
    const lh = label.y1 - label.y0;
    // Show the label and its value; without a reading, the area where the value should be.
    const left = reading ? band.src.x0 + reading.x0 / band.scale - 0.5 * lh : label.x0 - 7 * lh;
    const image = snapshot(canvas, { x0: Math.max(0, Math.round(left)), y0: band.src.y0, x1: Math.min(canvas.width, label.x1 + 4), y1: band.src.y1 });
    birthImage ??= image;
    if (reading) {
      birth = reading;
      birthImage = image;
      break;
    }
  }
  let idNumber: string | null = null;
  for (const label of labelBoxes(arabic, 'docNumber')) {
    const band = grayBand(canvas, label, 12);
    const number = band && readNumber(band.gray, band.labelX);
    if (number && number.digits.length >= 8) {
      idNumber = number.digits;
      break;
    }
  }
  return { birth, idNumber, birthImage };
}
