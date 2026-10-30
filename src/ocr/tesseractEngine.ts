// Tesseract.js adapter. All files (worker, WASM core, language models) are served from this
// site under ./ocr/ (copied by scripts/copy-ocr-assets.mjs), so no request leaves the origin and
// the document image never leaves the browser.
import Tesseract from 'tesseract.js';
import { OcrLoadError, type OcrEngine, type OcrLine, type OcrPage, type OcrProgress, type RecognizeOptions } from './types';

const CREATE_TIMEOUT_MS = 120_000;
const RECOGNIZE_TIMEOUT_MS = 180_000;

const assetUrl = (path: string) => new URL(path, document.baseURI).href;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Checks that a language model is reachable before starting a worker. tesseract.js 7 never settles
 * createWorker() when the worker's own model download fails, so network errors are detected here.
 */
async function checkModelAvailable(language: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(assetUrl(`ocr/lang/${language}.traineddata.gz`), { method: 'HEAD', cache: 'no-store' });
  } catch {
    throw new OcrLoadError(`network error while checking ${language} model`);
  }
  if (!response.ok) throw new OcrLoadError(`HTTP ${response.status} for ${language} model`);
}

function toOcrPage(data: Tesseract.Page): OcrPage {
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        // Tesseract's Arabic line text sometimes drops the space between words that its word list
        // keeps separate ("عليالتجربة"), so the line is rebuilt from its words.
        const text = line.words.length ? line.words.map((w) => w.text).join(' ') : line.text.replace(/\s+$/, '');
        if (!text.trim()) continue;
        lines.push({
          text,
          confidence: line.confidence,
          bbox: line.bbox,
          words: line.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
        });
      }
    }
  }
  return { lines, confidence: data.confidence };
}

export class TesseractEngine implements OcrEngine {
  private workers = new Map<string, Promise<Tesseract.Worker>>();
  private listener: ((p: OcrProgress) => void) | null = null;
  private disposed = false;

  private emit(p: OcrProgress) {
    this.listener?.(p);
  }

  private createWorker(language: 'eng' | 'ara'): Promise<Tesseract.Worker> {
    const creation = (async () => {
      this.emit({ stage: 'loading', progress: 0 });
      await checkModelAvailable(language);
      return new Promise<Tesseract.Worker>((resolve, reject) => {
        let settled = false;
        const fail = (reason: unknown) => {
          if (settled) return; // Errors after creation surface through the rejected recognize() call.
          settled = true;
          reject(new OcrLoadError(String(reason)));
        };
        // Passing models as { code, data } objects is broken in tesseract.js 7.0.0 (the worker uses
        // the bytes as the language name), so the worker downloads them from this site instead.
        Tesseract.createWorker(language, Tesseract.OEM.LSTM_ONLY, {
          workerPath: assetUrl('ocr/worker.min.js'),
          corePath: assetUrl('ocr/core/'),
          langPath: assetUrl('ocr/lang'),
          gzip: true,
          // Nothing is read from or written to IndexedDB; the browser's HTTP cache still applies.
          cacheMethod: 'none',
          workerBlobURL: false,
          logger: (m) => {
            if (m.status === 'recognizing text') this.emit({ stage: 'recognizing', progress: m.progress });
            else this.emit({ stage: 'loading', progress: m.progress });
          },
          errorHandler: fail,
        }).then((worker) => {
          if (settled) {
            void worker.terminate();
            return;
          }
          settled = true;
          resolve(worker);
        }, fail);
      });
    })();
    return withTimeout(creation, CREATE_TIMEOUT_MS, () => new OcrLoadError('timed out while starting OCR'));
  }

  private getWorker(language: 'eng' | 'ara'): Promise<Tesseract.Worker> {
    let worker = this.workers.get(language);
    if (!worker) {
      worker = this.createWorker(language);
      this.workers.set(language, worker);
      // A failed start must not be cached, so a retry downloads again.
      worker.catch(() => this.workers.delete(language));
    }
    return worker;
  }

  async recognize(image: HTMLCanvasElement, options: RecognizeOptions, onProgress?: (p: OcrProgress) => void): Promise<OcrPage> {
    if (this.disposed) throw new Error('engine disposed');
    this.listener = onProgress ?? null;
    try {
      const worker = await this.getWorker(options.language);
      await worker.setParameters({
        tessedit_pageseg_mode:
          options.layout === 'block' ? Tesseract.PSM.SINGLE_BLOCK : options.layout === 'sparse' ? Tesseract.PSM.SPARSE_TEXT : Tesseract.PSM.AUTO,
        tessedit_char_whitelist: options.charWhitelist ?? '',
        preserve_interword_spaces: '1',
        // Images are normalized to a known size, so the resolution estimate (and its log line) is not needed.
        user_defined_dpi: '300',
      });
      const result = await withTimeout(
        worker.recognize(image, {}, { text: true, blocks: true }),
        RECOGNIZE_TIMEOUT_MS,
        () => {
          // A crashed worker never answers; drop it so the next attempt starts a fresh one.
          this.workers.delete(options.language);
          void worker.terminate();
          return new Error('OCR timed out');
        },
      );
      return toOcrPage(result.data);
    } finally {
      this.listener = null;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const workers = [...this.workers.values()];
    this.workers.clear();
    await Promise.allSettled(workers.map(async (w) => (await w).terminate()));
  }
}
