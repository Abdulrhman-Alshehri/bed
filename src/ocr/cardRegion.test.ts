import { describe, expect, it } from 'vitest';
import { findCardRegion } from './cardRegion';

function image(width: number, height: number, background: number, card?: { x0: number; y0: number; x1: number; y1: number; value: number }) {
  const gray = new Uint8ClampedArray(width * height).fill(background);
  if (card) {
    for (let y = card.y0; y < card.y1; y++) for (let x = card.x0; x < card.x1; x++) gray[y * width + x] = card.value;
  }
  return gray;
}

describe('findCardRegion', () => {
  it('finds a light card on a dark background (screenshot or dark desk)', () => {
    const card = { x0: 10, y0: 140, x1: 390, y1: 380, value: 235 };
    const box = findCardRegion(image(400, 860, 10, card), 400, 860);
    expect(box).not.toBeNull();
    expect(box!.x0).toBeLessThanOrEqual(10);
    expect(box!.x1).toBeGreaterThanOrEqual(390);
    expect(box!.y0).toBeLessThanOrEqual(140);
    expect(box!.y1).toBeGreaterThanOrEqual(380);
    expect(box!.y1 - box!.y0).toBeLessThan(260);
  });

  it('returns null when the card does not stand out', () => {
    expect(findCardRegion(image(400, 300, 230), 400, 300)).toBeNull();
  });

  it('returns null for shapes that are not card-like', () => {
    const strip = { x0: 0, y0: 100, x1: 400, y1: 140, value: 235 };
    expect(findCardRegion(image(400, 300, 10, strip), 400, 300)).toBeNull();
  });
});
