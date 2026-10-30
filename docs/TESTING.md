# Testing checklist

Automated tests cover the rules and the pipeline (`npm test`, `npm run test:e2e`). This checklist covers what automation cannot: real documents, real devices, Excel and people. Run it before go-live and after any change to the extraction rules or OCR engine.

Record results in a copy of this file or a spreadsheet: date, tester, device/browser, result, notes.

## 1. OCR accuracy with real documents

> Use only documents whose holders have consented, on a test device. Do not commit document images to the repository.

Prepare at least 10 samples of each type that staff will actually see: Saudi national ID, Iqama, passports from the most common visitor nationalities, GCC ID cards (front and back). Include realistic photo conditions: photos taken with the staff's Android phones, on a desk, slight angle, indoor lighting, some glare.

For each sample, record per field: **correct / wrong / missing**, and whether a wrong value was **flagged** (amber/red).

| Check | Pass criteria |
|---|---|
| Document type suggested | Correct for each sample, or left empty (never a confident wrong type) |
| Passport MRZ: number, nationality, birth date, sex | Correct whenever the MRZ is sharp; any wrong value is flagged |
| Passport name (MRZ) | Matches the MRZ; a truncated name is flagged |
| Arabic name (alternative or primary) | Note the accuracy rate; every name was reviewable and editable |
| Saudi ID / Iqama number | Correct (source «مقروء من الباركود» when the barcode is in the photo), or flagged when it fails the check digit |
| Iqama: employer ID and place of birth | Never used as the holder's number or nationality |
| Hijri birth date | Converted date matches the Gregorian date on the document (or is within 1 day and flagged) |
| Day/month ambiguity | Ambiguous dates (e.g. 05/06/1990) are flagged |
| Nationality | Correct or empty; conflicts are flagged |
| Gender | Filled from the document when stated; on Saudi IDs suggested from the name with «مقترح من الاسم» and flagged; otherwise empty |
| Unreadable photo (blurred, dark) | Shows `تعذر استخراج البيانات بوضوح…` or flags fields; never fills confident wrong values |
| Rotated photo | Readable after using the rotate buttons |
| Time per document | Record seconds for first and later extractions on each device |

**Go/no-go:** decide with the business owner which accuracy is acceptable per field. The key safety property is that wrong values are flagged, not silent.

## 2. Defaults and business rules

| # | Check | Expected |
|---|---|---|
| D0 | Open the app | The luggage step opens first; «التالي» without pieces or size shows both errors |
| D1 | Open «بيانات الزائر» | نوع الزيارة = صلاة, مركز حفظ الأمتعة = المدينة, رمز الدولة = 966, الجنس empty, نوع الزائر empty |
| D2 | Type nationality «كويتي» | «تم التعرف عليها: الكويت»; نوع الزائر = خليجي |
| D3 | Change nationality to «مصري» or «EGYPTIAN» | نوع الزائر = دولي |
| D3b | Type a nationality that is not a country, e.g. «xyz» | Warning in the review; نوع الزائر not set automatically |
| D4 | Set نوع الزائر manually, then change nationality | Manual value kept; rule value offered as a suggestion |
| D5 | Passport + nationality مصر, phone empty | Calling code becomes 20 |
| D6 | إقامة + nationality مصر | Calling code stays 966; 20 offered as a suggestion |
| D7 | Type a phone number, then change nationality | Calling code unchanged; suggestion shown |
| D8 | Edit the name, then extract again | Edited name kept; extracted name offered as a suggestion; notice lists kept fields |
| D9 | Extract document A, then document B that lacks a field A had | That field is cleared, not carried over from A |
| D10 | Visit type and luggage center | Changeable at any time; never changed by OCR |
| D11 | Luggage: 2 × حقيبة ظهر, 1 × عربة أطفال, size متوسط+ | Total 3; review and CSV show the same counts and «متوسط+ (M+)» |

## 3. Validation and errors

| # | Check | Expected |
|---|---|---|
| V1 | Open the review with an empty form | `النموذج فارغ…`; confirm disabled |
| V2 | Leave a required field empty | Listed as an error in the review; confirm disabled |
| V3 | National ID (Saudi) with a wrong digit | `رقم الهوية غير صحيح…` |
| V4 | Document number with leading zeros, e.g. 00123456 | Kept exactly in the form, review, clipboard and CSV |
| V5 | Future birth date / birth year 1880 | Error |
| V6 | Invalid phone for the selected code / landline | Error / warning |
| V7 | Unresolved conflict (red) | Blocks confirmation until the field is edited or `القيمة صحيحة` is pressed |
| V8 | Upload a PDF or HEIC file, or a file over 20 MB | Arabic error message; the app keeps working |
| V9 | Disconnect the network before the first extraction | `تعذر تحميل ملفات التعرف الضوئي…`; after reconnecting, `إعادة المحاولة` works without reloading |
| V10 | Edit a value after confirming | Copy/export require confirming again |
| V11 | Success messages | Shown only after the action succeeded (copy failure shows an error) |

## 4. Export

| # | Check | Expected |
|---|---|---|
| E1 | Open the CSV in Excel (Windows) with your organization's regional settings | Arabic readable; the 10 BRD columns in BRD order, then the luggage columns (types, total, size); one row |
| E2 | Same in Excel for Mac and in Google Sheets / LibreOffice if used | Arabic readable |
| E3 | Document number and phone in Excel | Shown as text (leading zeros kept, no scientific notation) |
| E4 | List separator | If Excel shows everything in one column (some locales use `;`), use Data → From Text/CSV, or report it so the delimiter can be made configurable |
| E5 | File name | `visitor-registration-YYYYMMDD-HHMMSS.csv`, no personal data |
| E6 | Clipboard | Pasting into the target system gives `label: value` lines in Arabic; luggage types with zero pieces are omitted |
| E7 | Gender not stated | Empty cell (not "غير محدد") |

## 5. Devices and layout

Test on the devices staff will use (currently Android phones with Chrome). Add an iPhone, tablet or desktop only if they will be used.

| # | Check | Expected |
|---|---|---|
| M1 | Layout at phone width, on all three steps | Everything readable, no horizontal scrolling, buttons and +/− counters easy to tap, the five sizes in one row |
| M2 | «التقاط بالكاميرا» on a phone | Opens the native camera; the photo is used |
| M3 | «التقاط بالكاميرا» on a desktop with a webcam | Live preview dialog; capture works; the camera light turns off after closing |
| M4 | Portrait photo of a landscape card | Rotate buttons fix the orientation |
| M5 | Date picker | Usable; the Arabic Gregorian and Hijri readout is correct |
| M6 | Nationality and calling code typed with the phone keyboard | Arabic (with or without ال, adjective or country name) and English both match; Arabic-Indic digits are accepted in the calling code and number |

## 6. Accessibility

| # | Check | Expected |
|---|---|---|
| A1 | Keyboard only | Every control reachable with Tab, visible focus ring, choice buttons switch with the arrow keys |
| A2 | Screen reader (VoiceOver / TalkBack / NVDA) | Field labels, required state, review flags and errors are announced; extraction progress and results are announced |
| A3 | Zoom to 200% | No overlap or loss of content |
| A4 | Step changes | Focus moves to the new step's title; links in the review's error list open the step and focus the field |

## 7. Privacy

| # | Check | Expected |
|---|---|---|
| P1 | DevTools → Network during upload and extraction | Requests only to the site's own origin; no upload of the image |
| P2 | DevTools → Application → Storage after extraction | localStorage, sessionStorage, IndexedDB and cookies are empty |
| P3 | DevTools → Console | No personal data logged |
| P4 | Press مسح النموذج, or زائر جديد after confirming | The confirmation prompt appears first; then image, preview, luggage and all fields are cleared and the luggage step opens |
| P5 | Reload the page after entering data | Nothing restored |
| P6 | Address bar | No personal data in the URL at any point |
| P7 | Privacy notice | Visible before uploading a document |

## 8. Deployment

| # | Check | Expected |
|---|---|---|
| G1 | Push to `main` | The «Build and deploy to GitHub Pages» workflow passes and deploys |
| G2 | Open `https://<user>.github.io/<repo>/` | App loads over HTTPS; OCR works (models load from the same site) |
| G3 | Hard refresh after a deployment | New version served; no broken asset paths |
