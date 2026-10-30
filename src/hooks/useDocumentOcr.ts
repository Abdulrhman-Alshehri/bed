import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '../config/rules';
import { MESSAGES } from '../domain/labels';
import type { ExtractionResult } from '../extraction/result';
import { decodeImage, type Rotation } from '../ocr/preprocess';
import type { PipelineStage } from '../ocr/stages';
import { OcrLoadError, type OcrEngine } from '../ocr/types';

// The OCR engine and extraction rules are loaded on first use, not with the page.
const loadOcr = () => Promise.all([import('../ocr/pipeline'), import('../ocr/tesseractEngine')]);

export interface LoadedDocument {
  bitmap: ImageBitmap;
  rotation: Rotation;
  name: string;
}

export type OcrStatus =
  | { phase: 'idle' }
  | { phase: 'running'; stage: PipelineStage; progress: number }
  | { phase: 'done'; warnings: string[]; fieldsFound: number }
  | { phase: 'error'; message: string };

/**
 * Holds the current document image and runs OCR on it. The image lives only in memory (an
 * ImageBitmap); it is closed when replaced, removed or reset.
 */
export function useDocumentOcr() {
  const [doc, setDoc] = useState<LoadedDocument | null>(null);
  const [status, setStatus] = useState<OcrStatus>({ phase: 'idle' });
  /** A new image is being decoded (large phone photos take a moment). */
  const [decoding, setDecoding] = useState(false);
  const engineRef = useRef<OcrEngine | null>(null);
  const runRef = useRef(0);
  const docRef = useRef<LoadedDocument | null>(null);
  docRef.current = doc;

  const replaceDoc = useCallback((next: LoadedDocument | null) => {
    runRef.current++; // cancels any extraction still running for the previous image
    docRef.current?.bitmap.close();
    setDoc(next);
    setStatus({ phase: 'idle' });
  }, []);

  /** Returns an Arabic error message, or null on success. */
  const load = useCallback(
    async (file: File): Promise<string | null> => {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return MESSAGES.unsupportedFile;
      if (file.size > MAX_UPLOAD_BYTES) return MESSAGES.fileTooLarge;
      let bitmap: ImageBitmap;
      setDecoding(true);
      try {
        bitmap = await decodeImage(file);
      } catch {
        return MESSAGES.imageUnreadable;
      } finally {
        setDecoding(false);
      }
      replaceDoc({ bitmap, rotation: 0, name: file.name });
      return null;
    },
    [replaceDoc],
  );

  const rotate = useCallback((direction: 1 | -1) => {
    setDoc((d) => (d ? { ...d, rotation: (((d.rotation + direction * 90) % 360) + 360) % 360 as Rotation } : d));
    setStatus({ phase: 'idle' });
  }, []);

  const remove = useCallback(() => replaceDoc(null), [replaceDoc]);

  const extract = useCallback(async (): Promise<ExtractionResult | null> => {
    const current = docRef.current;
    if (!current) return null;
    const run = ++runRef.current;
    setStatus({ phase: 'running', stage: 'loading', progress: 0 });
    try {
      let modules: Awaited<ReturnType<typeof loadOcr>>;
      try {
        modules = await loadOcr();
      } catch {
        throw new OcrLoadError('failed to load OCR code');
      }
      const [{ runExtraction }, { TesseractEngine }] = modules;
      if (runRef.current !== run) return null;
      engineRef.current ??= new TesseractEngine();
      const result = await runExtraction(current.bitmap, current.rotation, engineRef.current, (p) => {
        if (runRef.current === run) setStatus({ phase: 'running', ...p });
      });
      if (runRef.current !== run) return null;
      setStatus({ phase: 'done', warnings: result.warnings, fieldsFound: Object.keys(result.fields).length });
      return result;
    } catch (error) {
      if (runRef.current !== run) return null;
      setStatus({ phase: 'error', message: error instanceof OcrLoadError ? MESSAGES.ocrLoadFailed : MESSAGES.ocrFailed });
      return null;
    }
  }, []);

  /** Clears the image and terminates the OCR workers (which hold copies of the image). */
  const reset = useCallback(async () => {
    replaceDoc(null);
    const engine = engineRef.current;
    engineRef.current = null;
    await engine?.dispose();
  }, [replaceDoc]);

  useEffect(
    () => () => {
      void engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  return { doc, status, decoding, load, rotate, remove, extract, reset };
}
