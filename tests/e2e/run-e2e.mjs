// End-to-end test of the production build with real in-browser OCR (Playwright + Chromium).
// Usage: npm run build && npm run test:e2e
// Serves dist/ under /bed/ (like GitHub Pages), renders synthetic documents, uploads them and
// checks extracted fields, privacy guarantees, review/export/copy and reset.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IQAMA, NATIONAL_ID, PASSPORT } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  console.error('Playwright is required: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');
const out = join(root, 'tests', 'e2e', 'output');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('Build first: npm run build');
  process.exit(1);
}
await mkdir(out, { recursive: true });
const countries = JSON.parse(await readFile(join(root, 'src', 'data', 'countries.json'), 'utf8'));
const arabicName = (code) => countries.find((c) => c.code === code)?.ar;

// --- Static server mimicking GitHub Pages (project site under /bed/, .gz served as raw bytes) ---
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.gz': 'application/gzip',
};
const BASE = '/bed/';
const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!pathname.startsWith(BASE)) return res.writeHead(404).end();
  let rel = decodeURIComponent(pathname.slice(BASE.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(dist, rel);
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const appUrl = `${origin}${BASE}`;

// --- Helpers ---
let failures = 0;
const ok = (condition, message, detail = '') => {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
  }
};

const browser = await playwright.chromium.launch();

async function renderFixture(html, name) {
  const p = await browser.newPage({ deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const path = join(out, `${name}.png`);
  await p.locator('.doc').screenshot({ path });
  await p.close();
  return path;
}

const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  acceptDownloads: true,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const externalRequests = [];
context.on('request', (r) => {
  const url = r.url();
  if (!url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) externalRequests.push(url);
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});

const readForm = () =>
  page.evaluate(() => {
    const val = (id) => document.getElementById(id)?.value ?? null;
    return {
      docType: val('field-docType'),
      fullName: val('field-fullName'),
      docNumber: val('field-docNumber'),
      visitorType: val('field-visitorType'),
      visitType: val('field-visitType'),
      nationality: val('field-nationality'),
      birthDate: val('field-birthDate'),
      phoneCountry: document.querySelector('.phone-code')?.value ?? null,
      luggageCenter: val('field-luggageCenter'),
      gender: val('field-gender'),
    };
  });

async function extract(imagePath) {
  await page.locator('input[type=file]').first().setInputFiles(imagePath);
  await page.getByRole('button', { name: 'استخراج البيانات' }).click();
  const started = Date.now();
  await page.waitForSelector('.ocr-status .alert', { timeout: 240_000 });
  return Date.now() - started;
}

async function resetForm() {
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'مسح النموذج' }).click();
  await page.getByText('تم مسح البيانات من النموذج').waitFor({ timeout: 5000 });
}

function checkExpected(form, expected) {
  for (const [key, want] of Object.entries(expected)) {
    if (key === 'nationality') ok(form.nationality === arabicName(want), `nationality = ${arabicName(want)}`, `got "${form.nationality}"`);
    else ok(form[key] === want, `${key} = "${want}"`, `got "${form[key]}"`);
  }
}

// --- Run ---
console.log(`App: ${appUrl}`);
await page.goto(appUrl);
ok((await page.title()) === 'تسجيل الزوار', 'page loads under a subpath');
ok((await page.getAttribute('html', 'dir')) === 'rtl', 'document is RTL');
let form = await readForm();
ok(form.visitType === 'prayer' && form.luggageCenter === 'madinah' && form.phoneCountry === 'SA' && form.gender === '', 'defaults: صلاة, المدينة, +966, gender empty');

console.log('\nUnsupported file');
await page.locator('input[type=file]').first().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
ok(await page.getByText('صيغة الملف غير مدعومة').isVisible(), 'shows an Arabic error for unsupported files');

console.log('\nExport before review');
// aria-disabled (not disabled) on purpose: the button stays focusable and explains why it is unavailable.
await page.getByRole('button', { name: 'تصدير البيانات' }).click({ force: true });
ok(await page.getByRole('dialog').isVisible(), 'export without confirmation opens the review dialog');
ok(await page.getByText('النموذج فارغ').isVisible(), 'empty form cannot be confirmed');
await page.getByRole('button', { name: 'العودة للتعديل' }).click();

console.log('\nPassport (MRZ)');
let ms = await extract(await renderFixture(PASSPORT.html, 'passport'));
console.log(`  (OCR took ${(ms / 1000).toFixed(1)} s, including engine download)`);
form = await readForm();
checkExpected(form, PASSPORT.expected);
ok(await page.getByText('تم استخراج البيانات، يرجى التأكد من صحتها').isVisible(), 'success message shown');
const altNames = await page.locator('#field-fullName ~ .suggestions .suggestion-value').allTextContents();
ok(altNames.includes('محمد أحمد التجربة'), 'Arabic name offered as an alternative (exact)', JSON.stringify(altNames));
await page.screenshot({ path: join(out, 'desktop-passport.png'), fullPage: true });

console.log('\nReview, export and copy');
await page.locator('#field-phone').fill('01001234567');
await page.getByRole('button', { name: 'مراجعة البيانات' }).click();
const confirmButton = page.getByRole('button', { name: 'أؤكد صحة البيانات' });
ok(await confirmButton.isEnabled(), 'confirmation allowed when there are no errors', await page.locator('.issues--error').textContent().catch(() => ''));
await page.screenshot({ path: join(out, 'desktop-review.png') });
await confirmButton.click();
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير البيانات' }).click()]);
const csvBytes = await readFile(await download.path());
const csv = csvBytes.toString('utf8');
ok(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, 'CSV starts with a UTF-8 BOM');
ok(csv.includes('"نوع الهوية","الاسم الثلاثي","رقم الهوية / الإقامة / الجواز","نوع الزائر","نوع الزيارة","الجنسية","تاريخ الميلاد","رقم الجوال","مركز حفظ الأمتعة","الجنس"'), 'CSV headers in BRD order');
ok(csv.includes('"=""A12345678"""') && csv.includes('"=""+201001234567"""'), 'CSV keeps identifiers as text');
ok(/^visitor-registration-\d{8}-\d{6}\.csv$/.test(download.suggestedFilename()), 'file name contains no personal data', download.suggestedFilename());
await page.getByRole('button', { name: 'نسخ البيانات' }).click();
await page.getByText('تم نسخ البيانات بنجاح').waitFor({ timeout: 5000 }).catch(() => {});
const clipboard = await page.evaluate(() => navigator.clipboard.readText());
ok(clipboard.startsWith('نوع الهوية: جواز سفر') && clipboard.includes('A12345678'), 'clipboard contains the confirmed data');

console.log('\nManual edits survive re-extraction (BR-14)');
await page.locator('#field-fullName').fill('محمد أحمد');
ok((await page.getByRole('button', { name: 'نسخ البيانات' }).getAttribute('aria-disabled')) === 'true', 'editing after confirmation requires a new confirmation');
await page.getByRole('button', { name: 'استخراج البيانات' }).click();
await page.waitForSelector('.ocr-status .alert', { timeout: 240_000 });
form = await readForm();
ok(form.fullName === 'محمد أحمد', 'manual name kept', form.fullName);
ok(await page.getByText('قيمة مستخرجة من المستند').first().isVisible(), 'new OCR value offered as a suggestion');

console.log('\nReset between visitors');
await resetForm();
form = await readForm();
ok(!form.fullName && !form.docNumber && !form.nationality && !form.birthDate && !form.docType && form.phoneCountry === 'SA', 'form cleared and defaults restored', JSON.stringify(form));
ok((await page.locator('.preview-canvas').count()) === 0, 'document preview removed');

console.log('\nResidence permit (Iqama-style)');
ms = await extract(await renderFixture(IQAMA.html, 'iqama'));
console.log(`  (OCR took ${(ms / 1000).toFixed(1)} s)`);
form = await readForm();
checkExpected(form, IQAMA.expected);
ok(['فاطمة علي التجربة', 'FATIMA ALI ALTEST'].includes(form.fullName), 'labeled name found', form.fullName);
await page.screenshot({ path: join(out, 'desktop-iqama.png'), fullPage: true });

console.log('\nNational ID (Hijri birth date)');
await resetForm();
ms = await extract(await renderFixture(NATIONAL_ID.html, 'national-id'));
console.log(`  (OCR took ${(ms / 1000).toFixed(1)} s)`);
form = await readForm();
checkExpected(form, NATIONAL_ID.expected);
const readout = await page.locator('#field-birthDate ~ .field-readout').textContent().catch(() => '');
ok(readout.includes('1410') && readout.includes('شوال'), 'birth date converted from Hijri 1410/10/17', readout);
ok(await page.getByText('لم يُذكر الجنس بوضوح').isVisible(), 'missing gender is flagged, not invented');
ok(form.fullName === 'سعد عبدالله التجربة', 'unlabeled Arabic name found', form.fullName);
await page.screenshot({ path: join(out, 'desktop-national-id.png'), fullPage: true });

console.log('\nPrivacy');
const storage = await page.evaluate(async () => ({
  local: localStorage.length,
  session: sessionStorage.length,
  idb: (await indexedDB.databases()).length,
  cookie: document.cookie,
}));
ok(storage.local === 0 && storage.session === 0 && storage.idb === 0 && storage.cookie === '', 'nothing stored in browser storage', JSON.stringify(storage));
ok(externalRequests.length === 0, 'no request left the site', externalRequests.join(', '));
ok((await page.evaluate(() => window.__csp)).length === 0, 'no CSP violations', JSON.stringify(await page.evaluate(() => window.__csp)));
ok(!!(await page.locator('meta[http-equiv="Content-Security-Policy"]').count()), 'CSP is present in the build');

console.log('\nFinal reset');
await resetForm();
form = await readForm();
ok(!form.fullName && !form.docNumber && !form.nationality && !form.birthDate && !form.docType, 'form cleared', JSON.stringify(form));
ok(consoleErrors.length === 0, 'no console errors', consoleErrors.join(' | '));

console.log('\nModel download failure and retry');
const flaky = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const fp = await flaky.newPage();
await fp.route('**/ocr/lang/**', (route) => route.abort('internetdisconnected'));
await fp.goto(appUrl);
await fp.locator('input[type=file]').first().setInputFiles(join(out, 'iqama.png'));
await fp.getByRole('button', { name: 'استخراج البيانات' }).click();
await fp.waitForSelector('.ocr-status .alert--error', { timeout: 150_000 });
ok(await fp.getByText('تعذر تحميل ملفات التعرف الضوئي').isVisible(), 'network failure shows an Arabic error instead of hanging');
await fp.unroute('**/ocr/lang/**');
await fp.getByRole('button', { name: 'إعادة المحاولة' }).click();
await fp.waitForSelector('.ocr-status .alert--success', { timeout: 240_000 });
ok((await fp.locator('#field-docNumber').inputValue()) === IQAMA.expected.docNumber, 'retry succeeds without reloading the page');

console.log('\nRotation');
const before = await fp.locator('.preview-canvas').evaluate((c) => [c.width, c.height]);
await fp.getByRole('button', { name: 'تدوير الصورة باتجاه عقارب الساعة' }).click();
const after = await fp.locator('.preview-canvas').evaluate((c) => [c.width, c.height]);
ok(before[0] === after[1] && before[1] === after[0], 'rotating swaps the preview orientation', `${before} → ${after}`);
await flaky.close();

console.log('\nCamera capture (fake device)');
const camBrowser = await playwright.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const camContext = await camBrowser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ['camera'] });
const cp = await camContext.newPage();
const camErrors = [];
cp.on('pageerror', (e) => camErrors.push(String(e)));
await cp.goto(appUrl);
await cp.getByRole('button', { name: 'التقاط بالكاميرا' }).click();
const shutter = cp.getByRole('button', { name: 'التقاط', exact: true });
await shutter.waitFor();
await cp.waitForFunction(() => !document.querySelector('.camera-dialog .btn-primary')?.disabled, null, { timeout: 15_000 });
await shutter.click();
await cp.waitForSelector('.preview-canvas', { timeout: 10_000 });
ok((await cp.locator('.camera-dialog').count()) === 0, 'camera dialog closes after capture');
ok((await cp.locator('.preview-canvas').count()) === 1 && camErrors.length === 0, 'captured frame becomes the document', camErrors.join(' | '));
await camBrowser.close();

console.log('\nMobile layout');
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await mobile.newPage();
await mp.goto(appUrl);
await mp.locator('input[type=file]').first().setInputFiles(join(out, 'iqama.png'));
await mp.getByRole('button', { name: 'استخراج البيانات' }).click();
await mp.waitForSelector('.ocr-status .alert', { timeout: 240_000 });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 0, 'no horizontal scrolling at 390px', `overflow ${overflow}px`);
await mp.screenshot({ path: join(out, 'mobile-iqama.png'), fullPage: true });

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll end-to-end checks passed');
console.log(`Screenshots and synthetic documents: ${out}`);
process.exit(failures ? 1 : 0);
