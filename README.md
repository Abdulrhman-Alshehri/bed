# تسجيل الزوار — Visitor Registration with in-browser OCR

تطبيق ويب عربي يقرأ جواز السفر أو الهوية الوطنية أو الإقامة من صورة، ويملأ نموذج تسجيل الزائر تلقائيًا. تتم المعالجة بالكامل داخل المتصفح، ولا تُرسل الصورة أو البيانات إلى أي خادم. جميع القيم قابلة للتعديل، ويجب مراجعتها وتأكيدها قبل نسخها أو تصديرها.

An Arabic-first (RTL) static web app that reads identity documents with OCR, fills a ten-field visitor registration form, applies the business rules, and exports the confirmed record as an Excel-compatible CSV or to the clipboard. It runs entirely in the browser and is deployed to GitHub Pages.

---

## Contents

1. [How it works](#how-it-works)
2. [Feasibility and limitations](#feasibility-and-limitations)
3. [Business rules and design decisions](#business-rules-and-design-decisions)
4. [Privacy and security](#privacy-and-security)
5. [Getting started](#getting-started)
6. [Configuration](#configuration)
7. [Deployment to GitHub Pages](#deployment-to-github-pages)
8. [Testing](#testing)
9. [Project structure](#project-structure)
10. [Replacing the OCR engine](#replacing-the-ocr-engine)

---

## How it works

1. The user uploads a photo (JPG, PNG, WebP) or captures one with the camera. The image is decoded with its EXIF orientation applied, and can be rotated manually.
2. **استخراج البيانات** runs up to three OCR passes with [Tesseract.js](https://github.com/naptha/tesseract.js) in a Web Worker:
   - English pass over the whole image (Latin text, digits, MRZ).
   - MRZ pass over the machine-readable zone only, restricted to `A–Z 0–9 <`.
   - Arabic pass over the whole image. It is skipped for passports with a verified MRZ from countries that do not print names in Arabic, to save time.
3. Extraction rules turn the OCR text into candidate values, from most to least reliable:
   1. **MRZ** (ICAO 9303 TD1/TD2/TD3) with check-digit verification and correction of O/0 and S/5-style confusions.
   2. **Saudi ID / Iqama numbers**: 10 digits, first digit 1 (citizen) or 2 (resident), Luhn check digit. The prefix also implies the document type and, for citizens, the Saudi nationality.
   3. **Printed labels** in Arabic and English (`الاسم`, `Nationality`, `تاريخ الميلاد`, …).
   4. **Unlabeled heuristics**, always low confidence.
4. Each candidate carries a confidence level, an explanation, alternatives (for example the Arabic name next to the MRZ's Latin name), and a conflict flag when the document contradicts itself (for example when the MRZ and printed birth dates differ).
5. The form shows where every value came from (`مستخرج من MRZ`, `مستخرج من النص`, `حسب القاعدة`, `قيمة افتراضية`, `معدّل يدويًا`). Uncertain values are highlighted in amber and conflicts in red.
6. **مراجعة البيانات** opens a summary with blocking errors and non-blocking warnings. Copy and export are enabled only after **أؤكد صحة البيانات**, and any later edit invalidates that confirmation.

## Feasibility and limitations

This app was built to the BRD's requirement that OCR runs without a mandatory backend. That is feasible, but with real limits that operations staff should know about.

| Area | Reliability | Notes |
|---|---|---|
| Passport MRZ (number, nationality, birth date, sex, Latin name) | **High** when the MRZ is sharp | Check digits detect misreads, so a failed check is flagged instead of trusted. Names have no check digit. |
| Saudi ID / Iqama number | **High** | Luhn validation catches almost all single-digit misreads. |
| GCC ID cards (back side with MRZ) | Medium–high | TD1 MRZ. Some cards (e.g. UAE) store the personal ID number in the optional data; it is suggested, with the card number as an alternative. |
| Dates next to a label | Medium | Day/month order is assumed day-first and flagged when ambiguous (05/06/1990). |
| Hijri birth dates | Medium | Converted with the browser's built-in Umm al-Qura calendar. Older dates can differ by one day from the calendar in use at the time (1 Muharram 1400 is 21 Nov 1979 in the table but was observed on 20 Nov), so converted dates are always flagged. |
| Arabic names on real cards | **Low–medium** | Tesseract's Arabic model struggles with security backgrounds, small fonts and glare. Expect manual correction. |
| Nationality text, gender text | Medium | Matched against the standardized list, Arabic adjectives (`مصري` → مصر) and English demonyms (`EGYPTIAN`). |

Other limitations:

- **Tested with synthetic documents only.** The end-to-end tests render clearly fictional documents. Accuracy on real IDs, residence permits and passports (layouts, security printing, photo quality) has **not** been measured. Run the accuracy section of [docs/TESTING.md](docs/TESTING.md) with consented sample documents before go-live.
- **Exact card layouts are not hard-coded.** Rules are label-based and layout-independent because the official layouts were not available. Adding layout-specific rules for the most common documents would improve accuracy.
- **Performance.** The first extraction in a session downloads about 8.5 MB (WASM core about 3.9 MB, English model 3.0 MB, Arabic model 1.7 MB). Later extractions reuse them. In testing (headless Chromium on a server, synthetic documents) one document took 3–5 seconds. Phones will be slower and have not been measured; time it on the devices staff will use (see the checklist).
- **No automatic cropping or perspective correction.** Photograph the document filling the frame, straight, without glare.
- **Rotation** is manual (90° buttons). Orientation detection would need the legacy Tesseract model (about 10 MB more).
- **HEIC** files are not accepted directly. iPhones convert photos to JPEG when uploading through the browser.

## Business rules and design decisions

All BRD rules (BR-01 to BR-14) are implemented in `src/domain/` and covered by unit tests. Where the BRD was ambiguous or would have produced wrong data, the decision below was taken. Each is configurable in `src/config/rules.ts`, and **each should be confirmed by the business owner**.

| Topic | Decision | Why |
|---|---|---|
| Hijri dates | Detected (years 1300–1500) and converted to Gregorian; the form shows both calendars and has a Hijri entry helper. | The BRD does not mention Hijri, but Saudi IDs commonly print Hijri birth dates. Reading `1410/10/17` as a Gregorian date would be badly wrong. |
| Calling code for Iqama / national ID holders | `+966` stays selected; the nationality's code is listed first as a suggestion (`SELECT_NATIONALITY_CODE_FOR_RESIDENT_DOCS = false`). | Residents of Saudi Arabia almost always have Saudi numbers. Passport holders get their nationality's code (BR-09). |
| Visitor type with unknown nationality | Left empty and required, not `دولي`. | Defaulting to دولي would fabricate a classification. |
| Saudi nationals | Classified as `خليجي`. | Saudi Arabia is a GCC member, so this follows BR-05 as written. If Saudis need a separate category, add it in `classification.ts`. |
| Required fields | All except phone and gender. Missing phone/gender is a warning only. | Requiring gender would push staff to guess it (BR-10). |
| Manual edits vs. new OCR (BR-14) | Never overwritten. The new reading appears as a one-click suggestion and the user is told which fields were kept. Values from a previous document that the new one lacks are cleared. | Prevents mixing two visitors' data. |
| Conflicts | Block confirmation until the user edits the field or presses `القيمة صحيحة`. | BRD: conflicts must be manually reviewed. |
| CSV identifiers | Document number and phone are written as `="..."`. | Otherwise Excel drops leading zeros (BR-04) and shows `9.66501E+11` for phone numbers. Set `CSV_EXCEL_TEXT_GUARD = false` if another system reads the CSV. |
| CSV phone and dates | E.164 (`+966501234567`) and ISO dates (`1990-05-12`). | Unambiguous for any downstream system. |
| Export scope | One visitor per file. | Batch export would keep many people's data in memory. Possible later if needed. |

## Privacy and security

- **Client-side only.** Images and extracted data never leave the browser. There is no backend, analytics, tracking or error reporting.
- **No third-party requests.** The OCR worker, WASM core, language models and font are served from the site itself, not from a CDN.
- **Enforced by Content Security Policy.** The production build sets `connect-src 'self'`, `default-src 'self'` and so on. Even a bug or a compromised dependency cannot send data to another origin. The end-to-end test verifies that no request leaves the site and that there are no CSP violations.
- **No persistent storage.** Nothing is written to localStorage, sessionStorage, IndexedDB or cookies; the test verifies this. Tesseract's IndexedDB model cache is disabled (`cacheMethod: 'none'`), and models are cached only by the browser's normal HTTP cache.
- **Reset (`مسح النموذج`)** clears the form, closes the image bitmap, releases canvases and terminates the OCR workers, which hold copies of the image. JavaScript cannot guarantee when the garbage collector frees memory, so closing the tab is the strongest clear.
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

`npm run dev` and `npm run build` run `scripts/copy-ocr-assets.mjs` automatically. It copies the Tesseract worker, WASM core and English/Arabic models from `node_modules` into `public/ocr/`, which is git-ignored.

The end-to-end test needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium` if it is not already available). It writes the synthetic documents and screenshots to `tests/e2e/output/`.

## Configuration

| What | Where |
|---|---|
| GCC country list, defaults (visit type, luggage center, calling code), required/recommended fields, confidence threshold, CSV Excel guard, upload limits | `src/config/rules.ts` |
| Arabic UI text and messages | `src/domain/labels.ts` |
| Nationality list (Arabic/English names, ISO codes, calling codes) | `src/data/countries.json`, generated by `npm run generate:countries` from CLDR, ISO 3166 and libphonenumber. Name overrides are in `scripts/generate-countries.mjs`. Review the diff after regenerating. |
| Nationality adjectives and alternative spellings (`مصري`, `EGYPTIAN`, `بنجلاديشي`) | `src/data/nationalityAliases.ts` |
| Labels the extractor looks for (`الاسم`, `Nationality`, …) and words excluded from names | `src/extraction/extract.ts` (`LABELS`, `*_STOPWORDS`) |
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

- **Unit tests** (`npm test`, 95 tests): MRZ parsing against the ICAO 9303 specimens, check digits and OCR-noise correction, Saudi ID validation, Umm al-Qura conversion, date parsing and ambiguity, nationality matching, extraction rules per document type (including conflicts and "nothing found"), every business rule in the form reducer, validation, CSV/clipboard export.
- **End-to-end test** (`npm run test:e2e`): real OCR in Chromium on synthetic passport, Iqama-style and national-ID-style documents. It also checks review/confirm/export/copy, BR-14, reset, network failure with retry, rotation, camera capture (fake device), CSP, no external requests, no storage, and mobile layout at 390 px.
- **Manual checklist**: [docs/TESTING.md](docs/TESTING.md) covers OCR accuracy with real documents, defaults, validation, devices, accessibility, privacy and Excel.

## Project structure

```
src/
  config/rules.ts          Business configuration
  data/                    Countries dataset and nationality aliases
  domain/                  Form state and business rules, validation, phone, export (pure, unit-tested)
  extraction/              MRZ, Saudi ID, dates/Hijri, nationality, extraction rules (engine-agnostic)
  ocr/                     Engine interface, Tesseract adapter, image preprocessing, OCR pipeline
  hooks/useDocumentOcr.ts  Image state and OCR runs (loads the OCR code on first use)
  components/              React UI (form fields, nationality combobox, phone, dates, dialogs)
scripts/                   OCR asset copy, country dataset generator
tests/e2e/                 Synthetic documents and Playwright end-to-end test
docs/TESTING.md            Manual testing checklist
```

## Replacing the OCR engine

Extraction rules never import Tesseract. They operate on `OcrPage` objects (lines with text, confidence and bounding boxes) defined in `src/ocr/types.ts`. To use another engine (for example a commercial on-device SDK, or a server API after a privacy assessment), implement the `OcrEngine` interface and construct it in `src/hooks/useDocumentOcr.ts`. Note that a server-side engine would send identity documents off the device, which the BRD forbids without explicit approval. It would also require relaxing `connect-src` in the CSP.
