// Image loading and preparation for OCR. Runs entirely in the browser on a <canvas>.
import { findCardRegion } from './cardRegion';
import type { BBox } from './types';

export type Rotation = 0 | 90 | 180 | 270;

/** Decodes an uploaded image, applying its EXIF orientation. */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Converts to grayscale and stretches contrast between the 1st and 99th percentile. */
function enhance(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const gray = (px[i]! * 299 + px[i + 1]! * 587 + px[i + 2]! * 114) / 1000;
    px[i] = gray;
    histogram[Math.round(gray)]!++;
  }
  const count = px.length / 4;
  let low = 0;
  let high = 255;
  for (let acc = 0; low < 255 && (acc += histogram[low]!) < count * 0.01; ) low++;
  for (let acc = 0; high > 0 && (acc += histogram[high]!) < count * 0.01; ) high--;
  const range = Math.max(1, high - low);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i]! - low) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
}

/** Applies the manual rotation. Very large photos are reduced to 3200 px to bound memory use. */
export function orient(bitmap: ImageBitmap, rotation: Rotation): HTMLCanvasElement {
  const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const swap = rotation === 90 || rotation === 270;
  const canvas = createCanvas(swap ? h : w, swap ? w : h);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  return canvas;
}

/** Crops to the document when it stands out from the background; otherwise returns the input. */
export function cropToCard(source: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.min(1, 400 / Math.max(source.width, source.height));
  const small = createCanvas(source.width * scale, source.height * scale);
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(source, 0, 0, small.width, small.height);
  const px = sctx.getImageData(0, 0, small.width, small.height).data;
  const gray = new Uint8ClampedArray(small.width * small.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4]! * 299 + px[i * 4 + 1]! * 587 + px[i * 4 + 2]! * 114) / 1000;
  const region = findCardRegion(gray, small.width, small.height);
  releaseCanvas(small);
  if (!region) return source;
  const x0 = region.x0 / scale;
  const y0 = region.y0 / scale;
  const w = (region.x1 - region.x0) / scale;
  const h = (region.y1 - region.y0) / scale;
  const canvas = createCanvas(w, h);
  canvas.getContext('2d')!.drawImage(source, x0, y0, w, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Scales and enhances contrast for OCR. Native resolution is kept where possible: small images are
 * enlarged by an integer factor and very large ones reduced, because fractional resampling
 * measurably degraded Arabic recognition in testing.
 */
export function prepareForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const longest = Math.max(source.width, source.height);
  const scale = longest > 2600 ? 2600 / longest : longest < 1000 ? 2 : 1;
  const canvas = createCanvas(source.width * scale, source.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  enhance(canvas);
  return canvas;
}

/** Crops a region (with padding) and upscales it so text lines are roughly `lineHeight` px tall. */
export function cropRegion(source: HTMLCanvasElement, box: BBox, lineCount: number, lineHeight = 48): HTMLCanvasElement {
  const padX = (box.x1 - box.x0) * 0.04;
  const padY = ((box.y1 - box.y0) / Math.max(1, lineCount)) * 0.6;
  const x0 = Math.max(0, box.x0 - padX);
  const y0 = Math.max(0, box.y0 - padY);
  const x1 = Math.min(source.width, box.x1 + padX);
  const y1 = Math.min(source.height, box.y1 + padY);
  const currentLineHeight = (box.y1 - box.y0) / Math.max(1, lineCount);
  const scale = Math.min(3, Math.max(1, lineHeight / Math.max(1, currentLineHeight)));
  const canvas = createCanvas((x1 - x0) * scale, (y1 - y0) * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function unionBox(boxes: BBox[]): BBox {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Releases a canvas' pixel memory. */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
