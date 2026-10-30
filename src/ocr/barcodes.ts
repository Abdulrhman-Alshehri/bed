// Barcode/QR reading with zxing-cpp (WebAssembly), served from this site like the OCR files.
// Saudi IDs and residence permits carry a Code 128 barcode holding the ID number, which is far
// more reliable than reading the printed Arabic-Indic digits with OCR.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

let prepared = false;

function prepare() {
  if (prepared) return;
  prepareZXingModule({
    overrides: {
      // Load the WASM file from this site instead of the library's default CDN.
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? new URL('ocr/zxing_reader.wasm', document.baseURI).href : prefix + path,
    },
  });
  prepared = true;
}

/** Decoded texts of the barcodes found in the image. Never throws: barcodes are an extra signal. */
export async function readBarcodeTexts(canvas: HTMLCanvasElement): Promise<string[]> {
  try {
    prepare();
    const image = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
    const results = await readBarcodes(image, {
      formats: ['Code128', 'Code39', 'QRCode', 'PDF417', 'DataMatrix'],
      tryHarder: true,
      maxNumberOfSymbols: 4,
    });
    return results.filter((r) => r.isValid && r.text).map((r) => r.text);
  } catch {
    return [];
  }
}
