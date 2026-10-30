// End-to-end test of the production build with real in-browser OCR (Playwright + Chromium).
// Usage: npm run build && npm run test:e2e
// Serves dist/ under /bed/ (like GitHub Pages), renders synthetic documents, uploads them and
// walks through the three steps (luggage, visitor data, review) and checks extracted fields,
// privacy guarantees, review/export/copy and reset.
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
  '.wasm': 'application/wasm',
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

const readForm = (p = page) =>
  p.evaluate(() => {
    const val = (id) => document.getElementById(id)?.value ?? null;
    const choice = (name) => document.querySelector(`input[name=${name}]:checked`)?.value ?? '';
    return {
      docType: choice('docType'),
      fullName: val('field-fullName'),
      docNumber: val('field-docNumber'),
      visitorType: choice('visitorType'),
      visitType: choice('visitType'),
      nationality: val('field-nationality'),
      birthDate: document.getElementById('field-birthDate')?.dataset.value ?? null,
      phoneDialCode: val('field-phone-code'),
      luggageCenter: choice('luggageCenter'),
      gender: choice('gender'),
    };
  });

/** Jump with the step navigation (1 الأمتعة, 2 بيانات الزائر, 3 المراجعة والتأكيد). */
const goToStep = (n, p = page) => p.locator('.stepper button').nth(n - 1).click();

async function addLuggage(counts, size, p = page) {
  for (const [label, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) await p.getByRole('button', { name: `زيادة ${label}` }).click();
  }
  await p.locator('.choice', { hasText: size }).first().click();
}

async function extract(imagePath) {
  await page.locator('input[type=file]').first().setInputFiles(imagePath);
  await page.getByRole('button', { name: 'استخراج البيانات' }).click();
  const started = Date.now();
  await page.waitForSelector('.ocr-status .alert', { timeout: 240_000 });
  return Date.now() - started;
}

async function resetForm(button = 'مسح النموذج') {
  let question = '';
  page.once('dialog', (d) => {
    question = d.message();
    d.accept();
  });
  await page.getByRole('button', { name: button }).first().click();
  await page.getByText('تم مسح البيانات من النموذج').waitFor({ timeout: 5000 });
  return question;
}

function checkExpected(form, expected) {
  for (const [key, want] of Object.entries(expected)) {
    if (key === 'nationality') ok(form.nationality === arabicName(want), `nationality = ${arabicName(want)}`, `got "${form.nationality}"`);
    else ok(form[key] === want, `${key} = "${want}"`, `got "${form[key]}"`);
  }
}

const noOverflow = async (p, what) => {
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, `no horizontal scrolling at 390px (${what})`, `overflow ${overflow}px`);
};

// --- Run ---
console.log(`App: ${appUrl}`);
await page.goto(appUrl);
ok((await page.title()) === 'تسجيل الزوار', 'page loads under a subpath');
ok((await page.getAttribute('html', 'dir')) === 'rtl', 'document is RTL');
ok((await page.locator('#step-title').textContent()) === 'الأمتعة', 'the first step is the luggage');
ok((await page.locator('select').count()) === 0, 'no drop-down lists (luggage step)');

console.log('\nLuggage step');
await page.getByRole('button', { name: 'التالي: بيانات الزائر' }).click();
ok(await page.getByText('أدخل عدد قطع الأمتعة').isVisible(), 'cannot continue without pieces');
ok(await page.getByText('اختر حجم الأمتعة').isVisible(), 'cannot continue without a size');
ok(await page.locator('#field-luggage').evaluate((e) => e === document.activeElement), 'focus moves to the first missing luggage input');
await page.getByRole('button', { name: 'زيادة حقيبة ظهر' }).click();
await page.getByRole('button', { name: 'زيادة حقيبة ظهر' }).click();
await page.getByRole('button', { name: 'زيادة حقيبة سفر' }).click();
await page.getByRole('button', { name: 'إنقاص حقيبة سفر' }).click();
ok((await page.locator('.luggage-total strong').textContent()) === '2', 'counters add up', await page.locator('.luggage-total strong').textContent());
await page.locator('.choice', { hasText: 'متوسط' }).first().click();
ok((await page.locator('input[name=luggageSize]:checked').getAttribute('value')) === 'M', 'size chosen with one tap');
await page.screenshot({ path: join(out, 'desktop-luggage.png'), fullPage: true });
await page.getByRole('button', { name: 'التالي: بيانات الزائر' }).click();
await page.locator('#field-fullName').waitFor();
ok((await page.locator('select').count()) === 0, 'no drop-down lists (visitor step)');
let form = await readForm();
ok(
  form.visitType === 'prayer' && form.luggageCenter === 'madinah' && form.phoneDialCode === '966' && form.gender === '',
  'defaults: صلاة, المدينة, +966, gender empty',
  JSON.stringify(form),
);

console.log('\nUnsupported file');
await page.locator('input[type=file]').first().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
ok(await page.getByText('صيغة الملف غير مدعومة').isVisible(), 'shows an Arabic error for unsupported files');

console.log('\nReview before the visitor data');
await page.getByRole('button', { name: 'التالي: المراجعة' }).click();
ok(await page.getByText('يجب تصحيح ما يلي قبل التأكيد').isVisible(), 'missing fields are listed');
ok(await page.getByRole('button', { name: 'أؤكد صحة البيانات' }).isDisabled(), 'cannot confirm with missing fields');
await page.locator('.issues--error .btn-link', { hasText: 'الاسم الثلاثي' }).click();
ok(await page.locator('#field-fullName').evaluate((e) => e === document.activeElement), 'an issue link opens the field');

console.log('\nPassport (MRZ)');
let ms = await extract(await renderFixture(PASSPORT.html, 'passport'));
console.log(`  (OCR took ${(ms / 1000).toFixed(1)} s, including engine download)`);
form = await readForm();
checkExpected(form, PASSPORT.expected);
ok(await page.getByText('تم استخراج البيانات، يرجى التأكد من صحتها').isVisible(), 'success message shown');
const altNames = await page.locator('#field-fullName ~ .suggestions .suggestion-value').allTextContents();
// The Arabic alternative must be the name only: no label and no words from other columns.
ok(altNames.some((n) => /^محمد أحمد \S*تجربة$/.test(n)), 'Arabic name offered as an alternative, without the label or other text', JSON.stringify(altNames));
await page.screenshot({ path: join(out, 'desktop-passport.png'), fullPage: true });

console.log('\nNationality and phone as text');
await page.locator('#field-nationality').fill('باكستاني');
ok((await page.locator('#field-nationality ~ .field-readout--match').textContent())?.includes('باكستان'), 'typed nationality matched to the country list');
await page.locator('#field-nationality').fill('مصري');
await page.locator('#field-phone').fill('01001234567');
ok((await page.locator('#field-phone-code').inputValue()) === '20', 'calling code follows the nationality');
const phoneReadout = (await page.locator('.phone-row ~ .field-readout').textContent()) ?? '';
ok(phoneReadout.replace(/\s/g, '').includes('+201001234567'), 'local number shown in international format', phoneReadout);

console.log('\nReview, export and copy');
await page.getByRole('button', { name: 'التالي: المراجعة' }).click();
const confirmButton = page.getByRole('button', { name: 'أؤكد صحة البيانات' });
ok(await confirmButton.isEnabled(), 'confirmation allowed when there are no errors', await page.locator('.issues--error').textContent().catch(() => ''));
ok((await page.getByRole('button', { name: 'تصدير البيانات' }).count()) === 0, 'export only after confirmation');
await page.screenshot({ path: join(out, 'desktop-review.png'), fullPage: true });
await confirmButton.click();
ok(await page.getByText('تم تأكيد البيانات', { exact: true }).isVisible(), 'summary shows the confirmation');
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير البيانات' }).click()]);
const csvBytes = await readFile(await download.path());
const csv = csvBytes.toString('utf8');
ok(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, 'CSV starts with a UTF-8 BOM');
ok(
  csv.includes(
    '"نوع الهوية","الاسم الثلاثي","رقم الهوية / الإقامة / الجواز","نوع الزائر","نوع الزيارة","الجنسية","تاريخ الميلاد","رقم الجوال","مركز حفظ الأمتعة","الجنس","حقيبة ظهر","حقيبة سفر","كيس","عربة أطفال","كرسي متحرك","أخرى","إجمالي القطع","حجم الأمتعة"',
  ),
  'CSV headers: BRD order, then luggage',
);
ok(csv.includes('"=""A12345678"""') && csv.includes('"=""+201001234567"""'), 'CSV keeps identifiers as text');
ok(csv.includes('"2","0","0","0","0","0","2","متوسط (M)"'), 'CSV contains the luggage');
ok(/^visitor-registration-\d{8}-\d{6}\.csv$/.test(download.suggestedFilename()), 'file name contains no personal data', download.suggestedFilename());
await page.getByRole('button', { name: 'نسخ البيانات' }).click();
await page.getByText('تم نسخ البيانات بنجاح').waitFor({ timeout: 5000 }).catch(() => {});
const clipboard = await page.evaluate(() => navigator.clipboard.readText());
ok(clipboard.startsWith('نوع الهوية: جواز سفر') && clipboard.includes('A12345678'), 'clipboard contains the confirmed data');
ok(clipboard.includes('حقيبة ظهر: 2') && !clipboard.includes('كيس: 0') && clipboard.includes('حجم الأمتعة: متوسط (M)'), 'clipboard lists only the luggage present', clipboard);
await page.screenshot({ path: join(out, 'desktop-confirmed.png'), fullPage: true });

console.log('\nManual edits survive re-extraction (BR-14)');
await page.getByRole('button', { name: 'تعديل البيانات' }).click();
await page.locator('#field-fullName').fill('محمد أحمد');
ok(await page.getByText('تم تعديل البيانات بعد تأكيدها').isVisible(), 'editing after confirmation requires a new confirmation');
await page.getByRole('button', { name: 'استخراج البيانات' }).click();
await page.waitForSelector('.ocr-status .alert', { timeout: 240_000 });
form = await readForm();
ok(form.fullName === 'محمد أحمد', 'manual name kept', form.fullName);
ok(await page.getByText('قيمة مستخرجة من المستند').first().isVisible(), 'new OCR value offered as a suggestion');

console.log('\nReset between visitors');
const question = await resetForm();
ok(question.includes('مسح'), 'reset asks for confirmation first');
ok((await page.locator('#step-title').textContent()) === 'الأمتعة', 'back to the luggage step');
ok((await page.locator('.luggage-total strong').textContent()) === '0' && (await page.locator('input[name=luggageSize]:checked').count()) === 0, 'luggage cleared');
await goToStep(2);
form = await readForm();
ok(!form.fullName && !form.docNumber && !form.nationality && !form.birthDate && !form.docType && form.phoneDialCode === '966', 'form cleared and defaults restored', JSON.stringify(form));
ok((await page.locator('.preview-canvas').count()) === 0, 'document preview removed');

console.log('\nResidence permit (Iqama-style)');
ms = await extract(await renderFixture(IQAMA.html, 'iqama'));
console.log(`  (OCR took ${(ms / 1000).toFixed(1)} s)`);
form = await readForm();
checkExpected(form, IQAMA.expected);
ok(['فاطمة علي التجربة', 'FATIMA ALI ALTEST'].includes(form.fullName), 'labeled name found', form.fullName);
ok(await page.locator('.date-evidence img').isVisible(), 'birth date shown as printed, for comparison');
ok((await page.locator('#field-birthDate').inputValue()) === '03/11/1985', 'birth date shown day first', await page.locator('#field-birthDate').inputValue());
await page.screenshot({ path: join(out, 'desktop-iqama.png'), fullPage: true });

console.log('\nNational ID (Hijri birth date)');
await resetForm();
await goToStep(2);
ms = await extract(await renderFixture(NATIONAL_ID.html, 'national-id'));
console.log(`  (OCR took ${(ms / 1000).toFixed(1)} s)`);
form = await readForm();
checkExpected(form, NATIONAL_ID.expected);
const readout = await page.locator('#field-birthDate ~ .field-readout').textContent().catch(() => '');
ok(readout.includes('1410') && readout.includes('شوال'), 'birth date converted from Hijri ١٤١٠/١٠/١٧', readout);
ok((await page.locator('#field-birthDate').inputValue()) === '17/10/1410', 'national ID birth date shown in Hijri', await page.locator('#field-birthDate').inputValue());
ok(await page.getByText('مقترح من الاسم').isVisible(), 'gender not on the card: suggested from the name and flagged for review');
ok(form.fullName === 'سعد عبدالله التجربة', 'unlabeled Arabic name found', form.fullName);
await page.screenshot({ path: join(out, 'desktop-national-id.png'), fullPage: true });

console.log('\nNew visitor after confirmation');
await goToStep(1);
await addLuggage({ 'حقيبة سفر': 1, 'عربة أطفال': 1 }, 'كبير');
await goToStep(3);
await page.getByRole('button', { name: 'أؤكد صحة البيانات' }).click();
const newVisitorQuestion = await resetForm('زائر جديد');
ok(newVisitorQuestion.includes('زائر جديد'), 'new visitor asks to copy or export first', newVisitorQuestion);
ok((await page.locator('.luggage-total strong').textContent()) === '0', 'next visitor starts empty on the luggage step');

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
ok(consoleErrors.length === 0, 'no console errors', consoleErrors.join(' | '));

console.log('\nModel download failure and retry');
const flaky = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const fp = await flaky.newPage();
await fp.route('**/ocr/lang/**', (route) => route.abort('internetdisconnected'));
await fp.goto(appUrl);
await goToStep(2, fp);
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
await goToStep(2, cp);
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
await addLuggage({ 'حقيبة ظهر': 1, 'كرسي متحرك': 1 }, 'صغير+', mp);
await noOverflow(mp, 'luggage');
await mp.screenshot({ path: join(out, 'mobile-luggage.png'), fullPage: true });
await mp.getByRole('button', { name: 'التالي: بيانات الزائر' }).click();
await mp.locator('input[type=file]').first().setInputFiles(join(out, 'iqama.png'));
await mp.getByRole('button', { name: 'استخراج البيانات' }).click();
await mp.waitForSelector('.ocr-status .alert', { timeout: 240_000 });
await noOverflow(mp, 'visitor data');
await mp.screenshot({ path: join(out, 'mobile-iqama.png'), fullPage: true });
await mp.getByRole('button', { name: 'التالي: المراجعة' }).click();
await noOverflow(mp, 'review');
await mp.screenshot({ path: join(out, 'mobile-review.png'), fullPage: true });

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll end-to-end checks passed');
console.log(`Screenshots and synthetic documents: ${out}`);
process.exit(failures ? 1 : 0);
