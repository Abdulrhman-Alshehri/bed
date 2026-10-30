// Copies the Tesseract.js worker, WASM core and language models from node_modules
// into public/ocr so the app serves them from its own origin (no third-party CDN).
// Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const out = join(root, 'public', 'ocr');

const pkgVersion = (name) => JSON.parse(readFileSync(nm(name, 'package.json'), 'utf8')).version;

// Only the LSTM-only core builds are needed: the app always uses OEM.LSTM_ONLY.
// The worker picks one of these at runtime depending on WASM SIMD support.
const coreFiles = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];
const languages = ['eng', 'ara'];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });
mkdirSync(join(out, 'licenses'), { recursive: true });

copyFileSync(nm('tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'));
for (const file of coreFiles) {
  copyFileSync(nm('tesseract.js-core', file), join(out, 'core', file));
}
for (const lang of languages) {
  const src = nm('@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`);
  if (!existsSync(src)) throw new Error(`Missing language model: ${src}`);
  copyFileSync(src, join(out, 'lang', `${lang}.traineddata.gz`));
}
// Barcode reader (zxing-cpp compiled to WebAssembly), used for the ID number barcode on Saudi cards.
copyFileSync(nm('zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm'), join(out, 'zxing_reader.wasm'));
copyFileSync(nm('tesseract.js', 'LICENSE.md'), join(out, 'licenses', 'tesseract.js-LICENSE.md'));
copyFileSync(nm('zxing-wasm', 'LICENSE'), join(out, 'licenses', 'zxing-wasm-LICENSE'));
copyFileSync(nm('tesseract.js-core', 'LICENSE'), join(out, 'licenses', 'tesseract.js-core-LICENSE'));

const manifest = {
  tesseract: pkgVersion('tesseract.js'),
  core: pkgVersion('tesseract.js-core'),
  languages: Object.fromEntries(languages.map((l) => [l, pkgVersion(`@tesseract.js-data/${l}`)])),
  zxing: pkgVersion('zxing-wasm'),
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('OCR assets copied to public/ocr', manifest);
