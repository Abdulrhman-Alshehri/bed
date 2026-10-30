// Orchestrates the OCR passes for one document image and returns the extracted fields.
import { MESSAGES } from '../domain/labels';
import { chooseMrz, extractFields, mrzLikeLines, shouldRunArabicPass } from '../extraction/extract';
import type { ExtractionResult } from '../extraction/result';
import { readBarcodeTexts } from './barcodes';
import { cropRegion, cropToCard, orient, prepareForOcr, releaseCanvas, unionBox, type Rotation } from './preprocess';
import { readPrintedDigits } from './printedDigits';
import type { PipelineProgress, PipelineStage } from './stages';
import type { OcrEngine, OcrPage, OcrProgress } from './types';

const MRZ_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

export async function runExtraction(
  bitmap: ImageBitmap,
  rotation: Rotation,
  engine: OcrEngine,
  onProgress: (p: PipelineProgress) => void,
): Promise<ExtractionResult> {
  const report = (stage: Exclude<PipelineStage, 'loading'>, from: number, to: number) => (p: OcrProgress) =>
    onProgress({ stage: p.stage === 'loading' ? 'loading' : stage, progress: from + (to - from) * (p.stage === 'loading' ? 0 : p.progress) });

  onProgress({ stage: 'preparing', progress: 0.02 });
  const oriented = orient(bitmap, rotation);
  const card = cropToCard(oriented);
  const canvas = prepareForOcr(card);
  let mrzCanvas: HTMLCanvasElement | null = null;
  try {
    const barcodes = await readBarcodeTexts(card);
    if (card !== oriented) releaseCanvas(oriented);
    const latin = await engine.recognize(canvas, { language: 'eng', layout: 'auto' }, report('latin', 0.05, 0.45));

    // Second pass over the MRZ only, restricted to MRZ characters. If the first pass did not spot
    // MRZ-like lines, try the bottom of the image, where passports and ID cards print it.
    const mrzLines = mrzLikeLines(latin);
    mrzCanvas =
      mrzLines.length >= 2
        ? cropRegion(canvas, unionBox(mrzLines.map((l) => l.bbox)), mrzLines.length)
        : cropRegion(canvas, { x0: 0, y0: canvas.height * 0.65, x1: canvas.width, y1: canvas.height }, 3);
    let mrzPage: OcrPage | null = await engine.recognize(
      mrzCanvas,
      { language: 'eng', layout: 'block', charWhitelist: MRZ_CHARSET },
      report('mrz', 0.45, 0.55),
    );
    const mrz = chooseMrz(latin, mrzPage);
    if (!mrz) mrzPage = null;

    let arabic: OcrPage | null = null;
    if (shouldRunArabicPass(mrz)) {
      // Sparse mode read Iqama fields better than page layout analysis in testing (16 vs 14 of 24).
      arabic = await engine.recognize(canvas, { language: 'ara', layout: 'sparse' }, report('arabic', 0.55, 0.95));
    }

    onProgress({ stage: 'analyzing', progress: 0.97 });
    // Arabic-Indic digits next to Arabic labels (birth date, ID number), read by the digit reader.
    let printed: ReturnType<typeof readPrintedDigits> | null = null;
    try {
      printed = arabic && !mrz ? readPrintedDigits(canvas, arabic) : null;
    } catch {
      // The digit reader only adds evidence: the other fields are still extracted without it.
    }
    // Development builds only (removed from production): raw OCR output for tuning the rules.
    if (import.meta.env.DEV) Object.assign(window, { __ocrDebug: { latin, mrz: mrzPage, arabic, printed } });
    const result = extractFields({ latin, mrz: mrzPage, arabic, barcodes, printedDigits: printed });
    if (printed?.birthImage) result.evidence = { birthDate: printed.birthImage };
    if (Math.max(bitmap.width, bitmap.height) < 1000) result.warnings.unshift(MESSAGES.lowResolution);
    // A decoded barcode or a valid MRZ shows the image is sharp, whatever the OCR's mean confidence
    // (which drops on screenshots with phone interface around the card).
    const sharp = result.stats.mrz === 'valid' || result.fields.docNumber?.source === 'barcode';
    if (!sharp && result.stats.meanConfidence < 55) result.warnings.unshift(MESSAGES.lowConfidence);
    onProgress({ stage: 'analyzing', progress: 1 });
    return result;
  } finally {
    releaseCanvas(oriented);
    releaseCanvas(card);
    releaseCanvas(canvas);
    releaseCanvas(mrzCanvas);
  }
}
