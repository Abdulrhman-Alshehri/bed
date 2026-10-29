// Engine-agnostic OCR output. Any OCR engine adapter must produce these structures, so the
// extraction rules never depend on a specific engine.

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  /** 0-100 */
  confidence: number;
  bbox: BBox;
}

export interface OcrLine {
  text: string;
  /** 0-100 */
  confidence: number;
  bbox: BBox;
  words: OcrWord[];
}

export interface OcrPage {
  /** Lines in reading order. */
  lines: OcrLine[];
  /** Mean confidence 0-100. */
  confidence: number;
}

export interface RecognizeOptions {
  language: 'eng' | 'ara';
  /** Restrict recognized characters (used for the MRZ). */
  charWhitelist?: string;
  /** 'auto' for full pages, 'block' for a single uniform block of text such as an MRZ. */
  layout?: 'auto' | 'block';
}

export interface OcrProgress {
  stage: 'loading' | 'recognizing';
  /** 0-1 within the current stage. */
  progress: number;
}

export interface OcrEngine {
  recognize(image: HTMLCanvasElement, options: RecognizeOptions, onProgress?: (p: OcrProgress) => void): Promise<OcrPage>;
  /** Releases workers and any image data they hold. */
  dispose(): Promise<void>;
}

export class OcrLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrLoadError';
  }
}
