# تسجيل الزوار — Visitor Registration with in-browser OCR

تطبيق ويب عربي لتسجيل زوار حفظ الأمتعة في ثلاث خطوات: الأمتعة، ثم بيانات الزائر (تُقرأ من صورة الجواز أو الهوية أو الإقامة)، ثم المراجعة والتأكيد. تتم المعالجة بالكامل داخل المتصفح، ولا تُرسل الصورة أو البيانات إلى أي خادم ولا يُحفظ شيء. جميع القيم قابلة للتعديل، ويجب مراجعتها وتأكيدها قبل نسخها أو تصديرها.

An Arabic-first (RTL) static web app prototype for luggage-storage visitor registration. Staff record the luggage, read the visitor's identity document with in-browser OCR into a ten-field form, review, confirm, and copy or export the record as an Excel-compatible CSV. It runs entirely in the browser and is deployed to GitHub Pages.

---

## Contents

1. [How it works](#how-it-works)
2. [Feasibility and limitations](#feasibility-and-limitations)
3. [OCR engine comparison](#ocr-engine-comparison)
4. [Business rules and design decisions](#business-rules-and-design-decisions)
5. [Privacy and security](#privacy-and-security)
6. [Getting started](#getting-started)
7. [Configuration](#configuration)
8. [Deployment to GitHub Pages](#deployment-to-github-pages)
9. [Testing](#testing)
10. [Project structure](#project-structure)
11. [Replacing the OCR engine](#replacing-the-ocr-engine)

---

## How it works

The app is a three-step wizard. The step bar at the top allows moving between steps at any time; the **التالي** buttons check the current step first.

1. **الأمتعة (luggage).** While the visitor takes out their ID, staff count the pieces per type (حقيبة ظهر، حقيبة سفر، كيس، عربة أطفال، كرسي متحرك، أخرى) with +/− buttons and choose the size against the measuring wall: صغير S، صغير+ S+، متوسط M، متوسط+ M+، كبير L. No camera is used for luggage.
2. **بيانات الزائر (visitor data).** The user uploads or captures a photo of the document (JPG, PNG, WebP; EXIF orientation applied, manual rotation available) and presses **استخراج البيانات**:
   - The card is cropped from the background when its edges are clear, then scaled for OCR.
   - Barcodes are decoded on the device with [zxing-wasm](https://github.com/Sec-ant/zxing-wasm). Saudi ID cards and Iqamas carry the ID number in a Code 128 barcode, which is far more reliable than reading digits.
   - [Tesseract.js](https://github.com/naptha/tesseract.js) runs in a Web Worker: an English pass (Latin text, digits, MRZ), an MRZ pass restricted to `A–Z 0–9 <`, and an Arabic pass in sparse-text mode (better on card layouts). The Arabic pass is skipped for passports with a verified MRZ from countries that do not print names in Arabic.
   - Extraction rules turn the text into candidates, from most to least reliable: **MRZ** with check digits; **barcode** ID number; **Saudi ID/Iqama numbers** (10 digits, prefix 1 or 2, Luhn); **printed labels** paired with their values by position (same row, then the line below), so a label like `مكان الميلاد` or `هوية صاحب العمل` is never mistaken for nationality or the holder's ID; and unlabeled heuristics, always low confidence.
   - Every value shows its source (`مستخرج من MRZ`, `مقروء من الباركود`, `مستخرج من النص`, `حسب القاعدة`, `مقترح من الاسم`, `قيمة افتراضية`, `معدّل يدويًا`). Uncertain values are amber, conflicts red, and alternatives (such as the Arabic name next to the MRZ's Latin name) are one-click suggestions.
   - Short choices are large buttons instead of drop-down lists. Nationality is typed as text and matched to the country list in the background (`مصري`، `EGYPTIAN`، `باكستان`). The calling code is a text box prefilled with `966`.
3. **المراجعة والتأكيد (review).** One page lists the luggage and visitor data, blocking errors and non-blocking warnings, each linked to its field. After **أؤكد صحة البيانات** the page offers **نسخ البيانات**, **تصدير البيانات** (CSV), **زائر جديد** (clears everything after a confirmation) and **تعديل البيانات**. Any later edit invalidates the confirmation.

## Feasibility and limitations

This app was built to the BRD's requirement that OCR runs without a mandatory backend. That is feasible, but with real limits that operations staff should know about.

| Area | Reliability | Notes |
|---|---|---|
| Passport MRZ (number, nationality, birth date, sex, Latin name) | **High** when the MRZ is sharp | Check digits detect misreads, so a failed check is flagged instead of trusted. Names have no check digit. |
| Saudi ID / Iqama number | **High** | Read from the barcode when it is in focus (all four photos of the test Iqama), otherwise from the digits with Luhn validation. |
| GCC ID cards (back side with MRZ) | Medium–high | TD1 MRZ. Some cards (e.g. UAE) store the personal ID number in the optional data; it is suggested, with the card number as an alternative. |
| Nationality next to its label | Medium | Matched against the country list, Arabic adjectives and English demonyms, allowing one or two misread letters (`افغاتستان` → أفغانستان). |
| Dates next to a label | Medium | Day/month order is assumed day-first and flagged when ambiguous (05/06/1990). |
| Dates in Arabic-Indic digits (Iqama) | **Low** | Tesseract misreads small `٠٩٨٧` digits, and other engines drop `٠`. A date rebuilt from missing zeros is offered only when exactly one valid date fits, and always flagged. |
| Hijri birth dates | Medium | Converted with the browser's Umm al-Qura calendar. Older dates can differ by one day from the calendar in use at the time, so converted dates are always flagged. |
| Arabic names on real cards | **Low–medium** | Security backgrounds, small fonts and glare. Expect manual correction. |
| Gender on Saudi IDs | Not printed | Suggested from the name (`بن`/`بنت`, common names) with low confidence and flagged; otherwise left for staff to choose. Never guessed from the photo. |

Other limitations:

- **Tested with one fictional specimen and synthetic documents.** The OCR was measured on four photos of a fictional Iqama specimen and on rendered synthetic documents (see the comparison below). Accuracy on real IDs, residence permits and passports, and on the Android devices staff use, has **not** been measured yet. Run the accuracy section of [docs/TESTING.md](docs/TESTING.md) with consented sample documents before go-live.
- **Performance.** The first extraction in a session downloads about 9 MB (Tesseract WASM core about 3.9 MB, English model 3.0 MB, Arabic model 1.7 MB, barcode reader about 1 MB). In testing (headless Chromium on a server) one document took 3–8 seconds. Phones will be slower and have not been measured.
- **Cropping is basic.** The card is cut out only when its edges contrast with the background. There is no perspective correction: photograph the document filling the frame, straight, without glare.
- **Rotation** is manual (90° buttons). Orientation detection would need the legacy Tesseract model (about 10 MB more).
- **HEIC** files are not accepted directly. iPhones convert photos to JPEG when uploading through the browser.
- **Not yet aligned with the official luggage system's form** (field names, order and codes). This was deferred on purpose and can be added later.

## OCR engine comparison

Three options were tried on the same images: four photos of a fictional Iqama specimen (different crops and sizes) and three synthetic documents (passport, Iqama-style, national-ID-style). Six fields were scored per document: document type, name, number, nationality, birth date, gender.

| Engine | Fictional Iqama (4 photos × 6 = 24) | All 7 documents (42) | Wrong values shown without a warning | Runs where | Download | Time per document |
|---|---|---|---|---|---|---|
| Tesseract.js, before this round | about 0/24 | — | — | Browser | 8.5 MB | 3–5 s |
| Tesseract.js, auto layout | 14/24 | 32 correct, 2 wrong (flagged), 8 empty | 0 | Browser | 8.5 MB | 5–8 s |
| **Tesseract.js, sparse Arabic pass (current)** | 16/24 (17/24 in the browser build) | 34 correct, 1 wrong (flagged), 7 empty | 0 | Browser | 8.5 MB | 5–8 s |
| PaddleOCR (PP-OCR, ONNX) | 22/24 | 36 correct, 3 wrong (flagged), 3 empty | 0 | Tested in Python; browser port measured with onnxruntime-web | about 34 MB | about 2–3× Tesseract |
| Cloud OCR / vision model | Not run | — | — | Sends the image off the device | — | — |

Findings:

- **PaddleOCR reads Arabic card layouts clearly better** (it was the only engine to read the Iqama's birth date, in 2 of 4 photos), but it was worse on the synthetic Latin documents (14/18 vs 18/18), its model is about four times larger, and in the browser (onnxruntime-web, single thread) detection plus recognition took about 7 seconds after a 2.5-second load on a server CPU. A phone will be slower. Its Arabic character set also lacks `٠`.
- **Cloud OCR** was not run: there was no approved service or key, and sending identity documents to a third party needs the authority's approval and a privacy assessment under the BRD. It would likely read everything printed on the card, at the cost of privacy, network dependence and per-image fees. Enabling it would also require changing the CSP.
- The barcode was the most reliable source for the ID/Iqama number in every engine configuration.
- The current build uses Tesseract with the sparse Arabic pass. Switching engines only requires a new `OcrEngine` adapter (see [Replacing the OCR engine](#replacing-the-ocr-engine)); the extraction rules stay the same.

## Business rules and design decisions

All BRD rules (BR-01 to BR-14) are implemented in `src/domain/` and covered by unit tests. Where the BRD was ambiguous or would have produced wrong data, the decision below was taken. Each is configurable in `src/config/rules.ts`, and **each should be confirmed by the business owner**.

| Topic | Decision | Why |
|---|---|---|
| Hijri dates | Detected (years 1300–1500) and converted to Gregorian; the form shows both calendars and has a Hijri entry helper. | The BRD does not mention Hijri, but Saudi IDs commonly print Hijri birth dates. Reading `1410/10/17` as a Gregorian date would be badly wrong. |
| Step order | Luggage → visitor data → review. | Staff record the luggage while the visitor takes out their ID. |
| Luggage | Pieces counted per type; **one size for all the visitor's luggage together**, on the wall's five-level scale. At least one piece and a size are required. | Assumption based on the official system's single size field. If each piece needs its own size, the model in `src/domain/types.ts` must change. |
| Lists | No drop-down lists. Short choices are buttons; nationality and calling code are typed. | Long lists were hard to use on phones. The typed nationality is matched to the country list, so visitor type and calling code still follow the rules; an unmatched nationality is a warning and visitor type is then left for staff. |
| Gender on documents without it | Suggested from the Arabic name (`بن`/`بنت`, lists of common names) with low confidence, flagged for review; otherwise empty. | BR-10 forbids fabricating gender. Face-based guessing was rejected as unreliable and a compliance risk. |
| Labels belonging to someone else | `هوية صاحب العمل`، `اسم صاحب العمل`، `مكان الميلاد`، `المهنة`… are recognized and never used as the holder's number, name or nationality. | On the test Iqama, the place of birth (المملكة العربية السعودية) was being read as the nationality, which also made the visitor type wrong. |
| Calling code for Iqama / national ID holders | `966` stays prefilled; the nationality's code is offered as a suggestion (`SELECT_NATIONALITY_CODE_FOR_RESIDENT_DOCS = false`). | Residents of Saudi Arabia almost always have Saudi numbers. Passport holders get their nationality's code (BR-09). |
| Visitor type with unknown nationality | Left empty and required, not `دولي`. | Defaulting to دولي would fabricate a classification. |
| Saudi nationals | Classified as `خليجي`. | Saudi Arabia is a GCC member, so this follows BR-05 as written. If Saudis need a separate category, add it in `classification.ts`. |
| Required fields | All except phone and gender, plus the luggage count and size. Missing phone/gender is a warning only. | Requiring gender would push staff to guess it (BR-10). |
| Manual edits vs. new OCR (BR-14) | Never overwritten. The new reading appears as a one-click suggestion and the user is told which fields were kept. Values from a previous document that the new one lacks are cleared. | Prevents mixing two visitors' data. |
| Conflicts | Block confirmation until the user edits the field or presses `القيمة صحيحة`. | BRD: conflicts must be manually reviewed. |
| CSV identifiers | Document number and phone are written as `="..."`. | Otherwise Excel drops leading zeros (BR-04) and shows `9.66501E+11` for phone numbers. Set `CSV_EXCEL_TEXT_GUARD = false` if another system reads the CSV. |
| CSV phone and dates | E.164 (`+966501234567`) and ISO dates (`1990-05-12`). | Unambiguous for any downstream system. |
| CSV columns | The ten BRD fields in BRD order, then one column per luggage type, the total and the size (`متوسط (M)`). The clipboard text omits luggage types with zero pieces. | Keeps the BRD columns first for existing consumers. |
| Export scope | One visitor per file. | Batch export would keep many people's data in memory. Possible later if needed. |

## Privacy and security

- **Client-side only.** Images and extracted data never leave the browser. There is no backend, analytics, tracking or error reporting.
- **No third-party requests.** The OCR worker, WASM core, language models and font are served from the site itself, not from a CDN.
- **Enforced by Content Security Policy.** The production build sets `connect-src 'self'`, `default-src 'self'` and so on. Even a bug or a compromised dependency cannot send data to another origin. The end-to-end test verifies that no request leaves the site and that there are no CSP violations.
- **No persistent storage.** Nothing is written to localStorage, sessionStorage, IndexedDB or cookies; the test verifies this. Tesseract's IndexedDB model cache is disabled (`cacheMethod: 'none'`), and models are cached only by the browser's normal HTTP cache.
- **Reset (`مسح النموذج`, or `زائر جديد` after confirmation)** asks for confirmation, then clears the luggage and the form, closes the image bitmap, releases canvases and terminates the OCR workers, which hold copies of the image. JavaScript cannot guarantee when the garbage collector frees memory, so closing the tab is the strongest clear.
- **No personal data in logs, URLs or file names.** Nothing is logged to the console in production. Exported files are named `visitor-registration-YYYYMMDD-HHMMSS.csv`.
- **Outside the app's control:** copied text stays in the clipboard (and in clipboard-history tools), and downloaded CSV files are stored wherever the browser saves them. Handle them under your organization's data policy.
- **GitHub Pages** hosts only the application code. It is not a database and receives no form data. Like any web host, GitHub sees visitors' IP addresses and user agents when the page is loaded.
- **Access.** A GitHub Pages site is public to anyone with the URL (except private Pages on GitHub Enterprise Cloud). The app stores nothing, but if only staff should reach it, host it behind your organization's access controls.
- The CSP is set with a `<meta>` tag because GitHub Pages cannot send custom headers, so `frame-ancestors` (clickjacking protection) is not available. The app has no session or stored data to abuse.

## Getting started

Requirements: Node.js 22 and npm.

```bash
npm ci              # install exact dependency versions
npm run dev         # http://localhost:5173 (copies OCR assets first)
npm test            # unit tests (Vitest)
npm run typecheck   # TypeScript
npm run build       # production build in dist/ (with CSP)
npm run preview     # serve dist/ locally
npm run test:e2e    # end-to-end OCR test, after `npm run build`
```

`npm run dev` and `npm run build` run `scripts/copy-ocr-assets.mjs` automatically. It copies the Tesseract worker, WASM core, English/Arabic models and the barcode reader's WASM from `node_modules` into `public/ocr/`, which is git-ignored.

The end-to-end test needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium` if it is not already available). It writes the synthetic documents and screenshots to `tests/e2e/output/`.

## Configuration

| What | Where |
|---|---|
| GCC country list, defaults (visit type, luggage center, calling code), required/recommended fields, confidence threshold, CSV Excel guard, upload limits | `src/config/rules.ts` |
| Arabic UI text and messages | `src/domain/labels.ts` |
| Nationality list (Arabic/English names, ISO codes, calling codes) | `src/data/countries.json`, generated by `npm run generate:countries` from CLDR, ISO 3166 and libphonenumber. Name overrides are in `scripts/generate-countries.mjs`. Review the diff after regenerating. |
| Nationality adjectives and alternative spellings (`مصري`, `EGYPTIAN`, `بنجلاديشي`) | `src/data/nationalityAliases.ts` |
| Labels the extractor looks for (`الاسم`, `Nationality`, `مكان الميلاد`, `هوية صاحب العمل`, …) | `src/extraction/fieldLabels.ts` |
| Words excluded from names (card titles, QR notes) | `src/extraction/extract.ts` (`*_STOPWORDS`) |
| Names used for the gender suggestion | `src/extraction/genderFromName.ts` |
| Luggage types and sizes | `src/domain/types.ts` (`LUGGAGE_KINDS`, `LUGGAGE_SIZES`) and their Arabic labels in `src/domain/labels.ts` |
| Content Security Policy | `vite.config.ts` |

## Deployment to GitHub Pages

The workflow `.github/workflows/deploy.yml` type-checks, tests and builds on every push and pull request, and deploys `dist/` to GitHub Pages on pushes to `main`.

One-time setup:

1. Push the repository to GitHub. GitHub Pages for private repositories requires a paid plan.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run the workflow manually from the **Actions** tab.
4. The site is published at `https://<user-or-org>.github.io/<repository>/`, for example `https://abdulrhman-alshehri.github.io/bed/`.

The build uses a relative base path (`./`), so it works under any repository subpath, on a custom domain, and locally without changes. The end-to-end test serves the build under `/bed/` to verify this. To force an absolute base, build with `VITE_BASE=/path/ npm run build`.

## Testing

- **Unit tests** (`npm test`, 129 tests): MRZ parsing against the ICAO 9303 specimens, check digits and OCR-noise correction, Saudi ID validation, Umm al-Qura conversion, date parsing, ambiguity and zero reconstruction, nationality matching (including misspellings), label/value pairing by layout (place-of-birth and employer-ID traps, barcode priority), gender from name, card cropping, every business rule in the form reducer, luggage validation, CSV/clipboard export.
- **End-to-end test** (`npm run test:e2e`): walks through the three steps in Chromium with real OCR on synthetic passport, Iqama-style and national-ID-style documents. It also checks luggage validation, typed nationality and calling code, review/confirm/export/copy, BR-14, reset and new visitor, network failure with retry, rotation, camera capture (fake device), CSP, no external requests, no storage, no drop-down lists, and mobile layout at 390 px on every step.
- **Manual checklist**: [docs/TESTING.md](docs/TESTING.md) covers OCR accuracy with real documents, defaults, validation, devices, accessibility, privacy and Excel.

## Project structure

```
src/
  config/rules.ts          Business configuration
  data/                    Countries dataset and nationality aliases
  domain/                  Form state and business rules, validation, phone, export (pure, unit-tested)
  extraction/              MRZ, Saudi ID, dates/Hijri, nationality, labels and layout pairing, gender from name,
                           extraction rules (engine-agnostic)
  ocr/                     Engine interface, Tesseract adapter, card crop, preprocessing, barcodes, OCR pipeline
  hooks/useDocumentOcr.ts  Image state and OCR runs (loads the OCR code on first use)
  components/              React UI (luggage step, choice buttons, nationality, phone, dates, review step)
scripts/                   OCR asset copy, country dataset generator
tests/e2e/                 Synthetic documents and Playwright end-to-end test
docs/TESTING.md            Manual testing checklist
```

## Replacing the OCR engine

Extraction rules never import Tesseract. They operate on `OcrPage` objects (lines with text, confidence and bounding boxes) defined in `src/ocr/types.ts`. To use another engine (for example a commercial on-device SDK, or a server API after a privacy assessment), implement the `OcrEngine` interface and construct it in `src/hooks/useDocumentOcr.ts`. Note that a server-side engine would send identity documents off the device, which the BRD forbids without explicit approval. It would also require relaxing `connect-src` in the CSP.
