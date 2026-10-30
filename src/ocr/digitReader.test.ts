import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { hijriToGregorian } from '../extraction/dates';
import { bandGeometry, binarize, classify, decodeDate, features, glyphs, readDate, type Gray } from './digitReader';
import fixtures from './__fixtures__/digit-bands.json';

// Synthetic dates rendered in fonts the model never saw in training (tools/digit-model/make_fixture.py),
// with the Python reference implementation's results on the same pixels.
const cases = fixtures.cases.map((c) => ({
  ...c,
  band: { width: c.width, height: c.height, data: Float32Array.from(inflateSync(Buffer.from(c.gray, 'base64'))) } satisfies Gray,
}));
const NOW = new Date(2026, 9, 30);

/** One probability row: `p` for class `k`, the rest spread evenly. */
const row = (k: number, p = 0.97) => Float32Array.from({ length: 12 }, (_, i) => (i === k ? p : (1 - p) / 11));
const SLASH = 10;
const JUNK = 11;
const digitsRow = (s: string) => [...s].map((ch) => (ch === '/' ? row(SLASH) : ch === 'x' ? row(JUNK) : row(Number(ch))));

describe('digit reader (same results as the Python reference)', () => {
  for (const c of cases) {
    it(`reads ${c.name}`, () => {
      const reading = readDate(c.band, c.labelX, NOW);
      expect(reading).not.toBeNull();
      const [y, m, d] = c.decoded!.split('-').map(Number) as [number, number, number];
      if (y < 1900) {
        expect(reading!.calendar).toBe('hijri');
        expect(reading!.hijri).toEqual({ year: y, month: m, day: d });
        expect(reading!.iso).toBe(hijriToGregorian(y, m, d));
      } else {
        expect(reading!.iso).toBe(c.decoded);
      }
      expect(reading!.confident).toBe(c.confident);
    });

    it(`matches the reference glyphs, features and probabilities for ${c.name}`, () => {
      const gs = glyphs(binarize(c.band), c.band.width, c.band.height).filter((g) => g.x1 <= c.labelX + 2);
      const date = gs.slice(-c.glyphCount);
      expect(date.length).toBe(c.glyphCount);
      const hs = date.map((g) => g.y1 - g.y0);
      const tall = date.filter((g) => g.y1 - g.y0 >= 0.6 * Math.max(...hs));
      const median = (v: number[]) => {
        const s = [...v].sort((a, b) => a - b);
        return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
      };
      const H = median(tall.map((g) => g.y1 - g.y0));
      const cy = median(tall.map((g) => (g.y0 + g.y1) / 2));
      const f = features(date[0]!, H, cy);
      c.firstGlyphFeatures.forEach((v, i) => expect(f[i]).toBeCloseTo(v, 3));
      date.forEach((g, i) => {
        const p = classify(features(g, H, cy));
        c.probabilities[i]!.forEach((v, k) => expect(p[k]).toBeCloseTo(v, 2));
      });
    });
  }
});

describe('date decoding', () => {
  it('reads year/month/day in printed order', () => {
    expect(decodeDate(digitsRow('2000/08/14'), NOW)[0]).toMatchObject({ iso: '2000-08-14', calendar: 'gregorian', printed: '٢٠٠٠/٠٨/١٤', confident: true });
  });

  it('reads day/month/year as well', () => {
    expect(decodeDate(digitsRow('03/11/1985'), NOW)[0]).toMatchObject({ iso: '1985-11-03' });
  });

  it('converts Hijri dates (Umm al-Qura)', () => {
    const [r] = decodeDate(digitsRow('1410/10/17'), NOW);
    expect(r).toMatchObject({ calendar: 'hijri', hijri: { year: 1410, month: 10, day: 17 }, iso: hijriToGregorian(1410, 10, 17) });
  });

  it('skips a noise glyph (e.g. a speck or the colon)', () => {
    expect(decodeDate(digitsRow('2000/08/14x'), NOW)[0]?.iso).toBe('2000-08-14');
  });

  it('never returns an impossible or future date', () => {
    expect(decodeDate(digitsRow('2000/13/14'), NOW).every((r) => r.iso !== '2000-13-14')).toBe(true);
    expect(decodeDate(digitsRow('2027/01/01'), NOW).some((r) => r.iso.startsWith('2027'))).toBe(false);
    expect(decodeDate(digitsRow('1999/02/30'), NOW).some((r) => r.iso === '1999-02-30')).toBe(false);
  });

  it('is not confident when a digit is unclear', () => {
    const P = digitsRow('2000/08/14');
    // The last digit could be ١ or ٧ with equal probability: two valid dates, no clear winner.
    P[9] = Float32Array.from({ length: 12 }, (_, i) => (i === 1 || i === 7 ? 0.48 : 0.004));
    const [r] = decodeDate(P, NOW);
    expect(r?.confident).toBe(false);
    expect(r?.alternatives.length).toBeGreaterThan(0);
  });

  it('is never confident about a number without separators', () => {
    expect(decodeDate(digitsRow('2191736731'), NOW).some((r) => r.confident)).toBe(false);
  });
});

describe('band geometry', () => {
  it('looks to the left of the label and scales the label to the training height', () => {
    const g = bandGeometry({ x0: 1000, y0: 400, x1: 1100, y1: 424 }, 1300, 900);
    expect(g.scale).toBe(2);
    expect(g.src.x1).toBeGreaterThan(1000);
    expect(g.src.x0).toBe(1000 - 11 * 24);
    expect(g.labelX).toBeCloseTo((1000 - g.src.x0) * 2);
  });
});
