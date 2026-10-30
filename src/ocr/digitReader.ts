// Reads printed Arabic-Indic digits (٠–٩) and «/» to the left of a label, for birth dates and ID
// numbers on Saudi cards.
//
// Tesseract's Arabic model misreads these small digits (٢٠٠٠/٠٨/١٤ comes out as «٠٠٠١/١/١6»), so
// this small dedicated reader does the job instead: it cuts the value into glyphs, classifies each
// glyph with a tiny neural network trained on many Arabic fonts (tools/digit-model), and then picks
// the most probable reading that is a valid date. Pure functions on grayscale arrays, so it is
// unit-tested without a browser; the pipeline supplies the image band.
import { gregorianToHijri, hijriToGregorian, toIsoDate } from '../extraction/dates';
import { DIGIT_MODEL } from './digitModel';
import type { BBox } from './types';

/** Grayscale image, 0 (black) to 255 (white), row by row. */
export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

/** The band is scaled so the label's height becomes this many pixels (as in training). */
export const NORM_H = 48;
const GRID = 16;
const SLASH = 10;
const JUNK = 11;
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

interface Glyph {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Pixel coordinates, interleaved x, y. */
  pts: Int32Array;
}

// ---------------------------------------------------------------------------------------------
// Geometry of the value next to a label

/**
 * Where to look for the value of a label on an Arabic card: the band to its left (values follow
 * labels from right to left), about `widths` label-heights wide.
 */
export function bandGeometry(label: BBox, imageWidth: number, imageHeight: number, widths = 11) {
  const lh = Math.max(1, label.y1 - label.y0);
  const cy = (label.y0 + label.y1) / 2;
  const src = {
    x0: Math.max(0, Math.floor(label.x0 - widths * lh)),
    x1: Math.min(imageWidth, Math.ceil(label.x0 + 0.15 * lh)),
    y0: Math.max(0, Math.floor(cy - 0.95 * lh)),
    y1: Math.min(imageHeight, Math.ceil(cy + 0.95 * lh)),
  };
  const scale = NORM_H / lh;
  return {
    src,
    scale,
    width: Math.max(1, Math.round((src.x1 - src.x0) * scale)),
    height: Math.max(1, Math.round((src.y1 - src.y0) * scale)),
    /** The label's left edge in band coordinates: the value is to the left of it. */
    labelX: (label.x0 - src.x0) * scale,
  };
}

// ---------------------------------------------------------------------------------------------
// Segmentation

function otsu(data: Float32Array): number {
  const hist = new Float64Array(256);
  for (const v of data) hist[Math.max(0, Math.min(255, Math.floor(v)))]!++;
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i]!;
    sumAll += i * hist[i]!;
  }
  let w0 = 0;
  let s0 = 0;
  let best = 0;
  let t = 127;
  for (let i = 0; i < 256; i++) {
    w0 += hist[i]!;
    if (w0 === 0) continue;
    const w1 = total - w0;
    if (w1 === 0) break;
    s0 += i * hist[i]!;
    const between = w0 * w1 * (s0 / w0 - (sumAll - s0) / w1) ** 2;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return t;
}

/** Dark text → 1. */
export function binarize(img: Gray): Uint8Array {
  const t = otsu(img.data);
  return Uint8Array.from(img.data, (v) => (v <= t ? 1 : 0));
}

function glyphFromPts(pts: Int32Array): Glyph {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]!);
    x1 = Math.max(x1, pts[i]! + 1);
    y0 = Math.min(y0, pts[i + 1]!);
    y1 = Math.max(y1, pts[i + 1]! + 1);
  }
  return { x0, y0, x1, y1, pts };
}

const area = (g: Glyph) => g.pts.length / 2;
const gw = (g: Glyph) => g.x1 - g.x0;
const gh = (g: Glyph) => g.y1 - g.y0;

/** 8-connected components. */
function components(mask: Uint8Array, width: number, height: number): Glyph[] {
  const seen = new Uint8Array(mask.length);
  const out: Glyph[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const pts: number[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      pts.push(x, y);
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    out.push(glyphFromPts(Int32Array.from(pts)));
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function concat(a: Int32Array, b: Int32Array): Int32Array {
  const out = new Int32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Cuts a glyph at the column with the least ink between `lo` and `hi` (fractions of its width). */
function cutAtThinnest(g: Glyph, lo: number, hi: number): [Glyph, Glyph] | null {
  const w = gw(g);
  const cols = new Float64Array(w);
  for (let i = 0; i < g.pts.length; i += 2) cols[g.pts[i]! - g.x0]!++;
  const from = Math.floor(lo * w);
  const to = Math.floor(hi * w);
  let cut = from;
  for (let c = from; c <= to && c < w; c++) if (cols[c]! < cols[cut]!) cut = c;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < g.pts.length; i += 2) (g.pts[i]! - g.x0 < cut ? left : right).push(g.pts[i]!, g.pts[i + 1]!);
  if (!left.length || !right.length) return null;
  return [glyphFromPts(Int32Array.from(left)), glyphFromPts(Int32Array.from(right))];
}

/** Touching digits: a glyph much wider than the digit height is cut at its thinnest column. */
function splitWide(gs: Glyph[], maxRatio = 1.2): Glyph[] {
  if (!gs.length) return gs;
  const hs = gs.map(gh);
  const top = Math.max(...hs);
  const H = median(hs.filter((h) => h >= 0.6 * top));
  const out: Glyph[] = [];
  const todo = [...gs];
  while (todo.length) {
    const g = todo.shift()!;
    if (gw(g) <= maxRatio * H || gh(g) < 0.6 * H) {
      out.push(g);
      continue;
    }
    const parts = cutAtThinnest(g, 0.3, 0.7);
    if (parts) todo.unshift(...parts);
    else out.push(g);
  }
  return out.sort((a, b) => a.x0 - b.x0);
}

/** Components joined into glyphs (stacked parts such as «:»), noise dropped, touching digits split. */
export function glyphs(mask: Uint8Array, width: number, height: number): Glyph[] {
  // Components touching the top or bottom edge belong to neighbouring lines.
  let comps = components(mask, width, height).filter((c) => area(c) >= 3 && c.y0 > 0 && c.y1 < height);
  if (!comps.length) return [];
  // Noise threshold relative to the text height, so the small «٠» dot is kept.
  const hs = comps.map(gh);
  const top = Math.max(...hs);
  const Hd = median(hs.filter((h) => h >= 0.5 * top));
  comps = comps.filter((c) => area(c) >= Math.max(3, 0.01 * Hd * Hd)).sort((a, b) => a.x0 - b.x0);
  const merged: Glyph[] = [];
  for (const c of comps) {
    const m = merged[merged.length - 1];
    if (m) {
      const overlap = Math.min(m.x1, c.x1) - Math.max(m.x0, c.x0);
      const narrow = Math.min(gw(m), gw(c));
      const vOverlap = Math.min(m.y1, c.y1) - Math.max(m.y0, c.y0);
      const short = Math.min(gh(m), gh(c));
      // Stacked parts (colon, broken stroke) are joined; neighbours side by side are not.
      if (overlap > 0.5 * narrow && vOverlap < 0.3 * short) {
        merged[merged.length - 1] = { ...glyphFromPts(concat(m.pts, c.pts)) };
        continue;
      }
    }
    merged.push(c);
  }
  return splitWide(merged);
}

/** Digit height and vertical centre, from the taller glyphs. */
function lineMetrics(gs: Glyph[]): { H: number; cy: number } {
  const hs = gs.map(gh);
  const top = Math.max(...hs);
  const tall = gs.filter((g) => gh(g) >= 0.6 * top);
  return { H: median(tall.map(gh)), cy: median(tall.map((g) => (g.y0 + g.y1) / 2)) };
}

// ---------------------------------------------------------------------------------------------
// Features and classification

/** Box-filter resampling weights: row o mixes input cells by their exact coverage. */
function areaWeights(nIn: number, nOut: number): Float64Array[] {
  const scale = nIn / nOut;
  const rows: Float64Array[] = [];
  for (let o = 0; o < nOut; o++) {
    const row = new Float64Array(nIn);
    const a = o * scale;
    const b = (o + 1) * scale;
    let sum = 0;
    for (let i = Math.floor(a); i < Math.min(nIn, Math.ceil(b)); i++) {
      row[i] = Math.max(0, Math.min(b, i + 1) - Math.max(a, i));
      sum += row[i]!;
    }
    for (let i = 0; i < nIn; i++) row[i]! /= sum;
    rows.push(row);
  }
  return rows;
}

/** 16×16 glyph bitmap (aspect kept, centred) followed by its size and position on the line. */
export function features(g: Glyph, H: number, cy: number): Float32Array {
  const w = gw(g);
  const h = gh(g);
  const side = Math.max(w, h);
  const ox = Math.floor((side - w) / 2);
  const oy = Math.floor((side - h) / 2);
  const box = new Float64Array(side * side);
  for (let i = 0; i < g.pts.length; i += 2) box[(g.pts[i + 1]! - g.y0 + oy) * side + (g.pts[i]! - g.x0 + ox)] = 1;
  const W = areaWeights(side, GRID);
  // tmp = W · box (GRID × side), out = tmp · Wᵀ (GRID × GRID)
  const tmp = new Float64Array(GRID * side);
  for (let r = 0; r < GRID; r++) {
    const wr = W[r]!;
    for (let i = 0; i < side; i++) {
      const wi = wr[i]!;
      if (!wi) continue;
      for (let c = 0; c < side; c++) tmp[r * side + c]! += wi * box[i * side + c]!;
    }
  }
  const out = new Float32Array(GRID * GRID + 4);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const wc = W[c]!;
      let s = 0;
      for (let i = 0; i < side; i++) s += tmp[r * side + i]! * wc[i]!;
      out[r * GRID + c] = s;
    }
  }
  const clip = (v: number) => Math.max(-3, Math.min(3, v));
  out[GRID * GRID] = clip(h / H);
  out[GRID * GRID + 1] = clip(w / H);
  out[GRID * GRID + 2] = clip(((g.y0 + g.y1) / 2 - cy) / H);
  out[GRID * GRID + 3] = clip(w / Math.max(h, 1));
  return out;
}

interface Weights {
  inputs: number;
  hidden: number;
  classes: number;
  w1: Float32Array;
  b1: Float32Array;
  w2: Float32Array;
  b2: Float32Array;
}

let weights: Weights | null = null;

function dequantize({ scale, data }: { scale: number; data: string }): Float32Array {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return Float32Array.from(new Int8Array(bytes.buffer), (v) => v * scale);
}

function model(): Weights {
  weights ??= {
    inputs: DIGIT_MODEL.inputs,
    hidden: DIGIT_MODEL.hidden,
    classes: DIGIT_MODEL.classes,
    w1: dequantize(DIGIT_MODEL.w1),
    b1: Float32Array.from(DIGIT_MODEL.b1),
    w2: dequantize(DIGIT_MODEL.w2),
    b2: Float32Array.from(DIGIT_MODEL.b2),
  };
  return weights;
}

/** Class probabilities: ٠–٩, «/», other (letters, noise). */
export function classify(x: Float32Array): Float32Array {
  const m = model();
  const h = new Float32Array(m.hidden);
  for (let j = 0; j < m.hidden; j++) h[j] = m.b1[j]!;
  for (let i = 0; i < m.inputs; i++) {
    const xi = x[i]!;
    if (!xi) continue;
    const row = i * m.hidden;
    for (let j = 0; j < m.hidden; j++) h[j]! += xi * m.w1[row + j]!;
  }
  const z = new Float32Array(m.classes);
  for (let k = 0; k < m.classes; k++) z[k] = m.b2[k]!;
  for (let j = 0; j < m.hidden; j++) {
    const hj = Math.max(0, h[j]!);
    if (!hj) continue;
    const row = j * m.classes;
    for (let k = 0; k < m.classes; k++) z[k]! += hj * m.w2[row + k]!;
  }
  const max = Math.max(...z);
  let sum = 0;
  for (let k = 0; k < m.classes; k++) sum += z[k] = Math.exp(z[k]! - max);
  for (let k = 0; k < m.classes; k++) z[k]! /= sum;
  return z;
}

function classifyGroup(gs: Glyph[]): Float32Array[] {
  const { H, cy } = lineMetrics(gs);
  return gs.map((g) => classify(features(g, H, cy)));
}

const bestNonJunk = (p: Float32Array) => Math.max(...p.subarray(0, JUNK));

/** A glyph that looks like neither a digit nor «/» may be two touching glyphs (e.g. «٨/»): try cutting it. */
function splitUnclear(gs: Glyph[]): Glyph[] {
  const { H, cy } = lineMetrics(gs);
  const out: Glyph[] = [];
  for (const g of gs) {
    if (gw(g) >= 0.6 * H && bestNonJunk(classify(features(g, H, cy))) < 0.5) {
      const parts = cutAtThinnest(g, 0.25, 0.75);
      if (parts && parts.every((p) => bestNonJunk(classify(features(p, H, cy))) >= 0.5)) {
        out.push(...parts);
        continue;
      }
    }
    out.push(g);
  }
  return out;
}

function groups(gs: Glyph[], gap: number): Glyph[][] {
  const out: Glyph[][] = [];
  for (const g of gs) {
    const last = out[out.length - 1];
    if (last && g.x0 - last[last.length - 1]!.x1 <= gap) last.push(g);
    else out.push([g]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Date decoding

export interface DigitDate {
  /** Gregorian ISO date. */
  iso: string;
  calendar: 'gregorian' | 'hijri';
  hijri?: { year: number; month: number; day: number };
  /** The date as printed, in Arabic-Indic digits («٢٠٠٠/٠٨/١٤»). */
  printed: string;
  /** Log-probability of this reading. */
  score: number;
  /** How much more probable it is than the next valid date (log scale). */
  margin: number;
  /** Probable enough, and clearly ahead of any other valid date. */
  confident: boolean;
  /** Other valid readings, most probable first. */
  alternatives: string[];
}

// Year/month/day lengths, in printed order (Saudi cards print year first).
const PATTERNS: [number, number, number][] = [
  [4, 2, 2], [4, 1, 2], [4, 2, 1], [4, 1, 1], [2, 2, 4], [1, 2, 4], [2, 1, 4], [1, 1, 4],
];
/** Calibrated on synthetic dates in unseen fonts: no wrong reading passed both thresholds. */
const MIN_SCORE = -3;
const MIN_MARGIN = 2;
const MAX_SKIPPED = 3;
/** Longer groups are words, not dates (and would make the search slow). */
const MAX_GLYPHS = 14;
/** Positions where «/» is this improbable are not tried (keeps the search small on phones). */
const MIN_SLASH = 0.02;

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of combinations(items.slice(i + 1), k - 1)) out.push([item, ...rest]);
  });
  return out;
}

/** All digit choices for a segment of glyphs (top 3 per glyph), with their log-probabilities. */
function segmentReadings(ix: number[], top: number[][], logP: Float64Array[]): { lp: number; digits: number[] }[] {
  let acc = [{ lp: 0, digits: [] as number[] }];
  for (const i of ix) {
    const next: typeof acc = [];
    for (const a of acc) for (const d of top[i]!) next.push({ lp: a.lp + logP[i]![d]!, digits: [...a.digits, d] });
    acc = next;
  }
  return acc;
}

const toNumber = (digits: number[]) => digits.reduce((n, d) => n * 10 + d, 0);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The most probable valid dates for a sequence of glyph probabilities. Glyphs that look like
 * noise may be skipped; the two «/» separate year, month and day in either order.
 */
export function decodeDate(P: Float32Array[], now = new Date()): DigitDate[] {
  const n = P.length;
  if (n > MAX_GLYPHS) return [];
  const logP = P.map((p) => Float64Array.from(p, (v) => Math.log(v + 1e-6)));
  const skippable = P.flatMap((p, i) => (p[JUNK]! >= 0.2 ? [i] : []));
  const top = P.map((p) => [...p.subarray(0, 10)].map((v, d) => [v, d] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, d]) => d));
  const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  const hijriNow = gregorianToHijri(toIsoDate(today.y, today.m, today.d)!)?.year ?? 1460;
  const best = new Map<string, { score: number; y: number; m: number; d: number; printed: string }>();

  for (const pat of PATTERNS) {
    const k = n - (pat[0] + pat[1] + pat[2] + 2);
    if (k < 0 || k > MAX_SKIPPED || k > skippable.length) continue;
    for (const skip of combinations(skippable, k)) {
      const keep = [...Array(n).keys()].filter((i) => !skip.includes(i));
      const s1 = keep[pat[0]]!;
      const s2 = keep[pat[0] + 1 + pat[1]]!;
      if (P[s1]![SLASH]! < MIN_SLASH || P[s2]![SLASH]! < MIN_SLASH) continue;
      const base = skip.reduce((s, i) => s + logP[i]![JUNK]!, 0) + logP[s1]![SLASH]! + logP[s2]![SLASH]!;
      const segs = [keep.slice(0, pat[0]), keep.slice(pat[0] + 1, pat[0] + 1 + pat[1]), keep.slice(pat[0] + 2 + pat[1])];
      const [A, B, C] = segs.map((ix) => segmentReadings(ix, top, logP)) as [ReturnType<typeof segmentReadings>, ReturnType<typeof segmentReadings>, ReturnType<typeof segmentReadings>];
      for (const a of A) {
        for (const b of B) {
          for (const c of C) {
            const [y, m, d] = pat[0] === 4 ? [toNumber(a.digits), toNumber(b.digits), toNumber(c.digits)] : [toNumber(c.digits), toNumber(b.digits), toNumber(a.digits)];
            if (m < 1 || m > 12 || d < 1) continue;
            const hijri = y >= 1318 && y <= hijriNow;
            if (hijri ? d > 30 : y < 1900 || y > today.y || d > daysInMonth(y, m)) continue;
            if (!hijri && (y === today.y && (m > today.m || (m === today.m && d > today.d)))) continue;
            const score = base + a.lp + b.lp + c.lp;
            const key = `${y}-${m}-${d}`;
            if (score > (best.get(key)?.score ?? -Infinity)) {
              const printed = [a.digits, b.digits, c.digits].map((ds) => ds.map((x) => AR_DIGITS[x]).join('')).join('/');
              best.set(key, { score, y, m, d, printed });
            }
          }
        }
      }
    }
  }

  const ranked: Omit<DigitDate, 'margin' | 'confident' | 'alternatives'>[] = [];
  for (const r of [...best.values()].sort((a, b) => b.score - a.score)) {
    if (ranked.length >= 5) break;
    const hijri = r.y < 1900;
    const iso = hijri ? hijriToGregorian(r.y, r.m, r.d) : toIsoDate(r.y, r.m, r.d);
    if (!iso || iso > toIsoDate(today.y, today.m, today.d)!) continue;
    ranked.push({ iso, calendar: hijri ? 'hijri' : 'gregorian', hijri: hijri ? { year: r.y, month: r.m, day: r.d } : undefined, printed: r.printed, score: r.score });
  }
  return ranked.map((r, i) => {
    const margin = r.score - (ranked[i + 1]?.score ?? -30);
    return { ...r, margin, confident: i === 0 && r.score >= MIN_SCORE && margin >= MIN_MARGIN, alternatives: ranked.filter((x) => x !== r).map((x) => x.iso) };
  });
}

// ---------------------------------------------------------------------------------------------
// Entry points

/** Glyph groups to the left of the label, nearest first. */
function valueGroups(band: Gray, labelX: number, minGlyphs: number): Glyph[][] {
  const gs = glyphs(binarize(band), band.width, band.height);
  if (!gs.length) return [];
  const { H } = lineMetrics(gs);
  return groups(gs.filter((g) => g.x1 <= labelX + 2), H)
    .filter((g) => g.length >= minGlyphs)
    .reverse();
}

export interface DateReading extends DigitDate {
  /** Horizontal extent of the value in band coordinates (for showing it to the user). */
  x0: number;
  x1: number;
}

/** Reads the date printed to the left of a label (band from {@link bandGeometry}). */
export function readDate(band: Gray, labelX: number, now = new Date()): DateReading | null {
  for (const group of valueGroups(band, labelX, 5)) {
    const gs = splitUnclear(group);
    const [first] = decodeDate(classifyGroup(gs), now);
    if (first) return { ...first, x0: gs[0]!.x0, x1: gs[gs.length - 1]!.x1 };
  }
  return null;
}

/** Reads a number printed to the left of a label, e.g. the ID number (used to check the reader). */
export function readNumber(band: Gray, labelX: number): { digits: string; minProbability: number } | null {
  const [group] = valueGroups(band, labelX, 6);
  if (!group) return null;
  const P = classifyGroup(splitUnclear(group)).filter((p) => p[JUNK]! < 0.5);
  if (!P.length) return null;
  const digits = P.map((p) => {
    const d = p.subarray(0, 10);
    return d.indexOf(Math.max(...d));
  });
  return { digits: digits.join(''), minProbability: Math.min(...P.map((p) => Math.max(...p.subarray(0, 10)))) };
}
