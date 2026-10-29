// Synthetic, clearly fictional identity documents rendered as images for end-to-end tests.
// They are NOT real document layouts: they exercise the OCR pipeline and extraction rules only.

const v = (c) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
const check = (s) => [...s].reduce((sum, c, i) => sum + v(c) * [7, 3, 1][i % 3], 0) % 10;

/** Completes a 9-digit prefix into a Luhn-valid Saudi ID number. */
export function saudiId(prefix9) {
  for (let d = 0; d <= 9; d++) {
    const id = prefix9 + d;
    const sum = [...id].reduce((s, ch, i) => {
      const n = Number(ch);
      if (i % 2) return s + n;
      const doubled = n * 2;
      return s + (doubled > 9 ? doubled - 9 : doubled);
    }, 0);
    if (sum % 10 === 0) return id;
  }
  throw new Error('unreachable');
}

function td3({ surname, given, nationality, number, birth, sex, expiry }) {
  const line1 = `P<${nationality}${surname}<<${given.replace(/ /g, '<')}`.padEnd(44, '<');
  const personal = '<'.repeat(14);
  const body = `${number}${check(number)}${nationality}${birth}${check(birth)}${sex}${expiry}${check(expiry)}${personal}${check(personal)}`;
  const composite = `${number}${check(number)}${birth}${check(birth)}${expiry}${check(expiry)}${personal}${check(personal)}`;
  return [line1, body + check(composite)];
}

const page = (body, width, height) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; }
  .doc { width: ${width}px; height: ${height}px; box-sizing: border-box; padding: 36px 44px; background: linear-gradient(135deg, #f7f4ea, #ebeff2);
         font-family: 'DejaVu Sans', sans-serif; color: #1a1a1a; position: relative; }
  .row { display: flex; justify-content: space-between; gap: 24px; }
  .t { font-size: 30px; font-weight: bold; }
  .l { font-size: 26px; margin: 10px 0; }
  .ar { direction: rtl; text-align: right; }
  .mrz { position: absolute; left: 44px; right: 44px; bottom: 34px; font-family: 'DejaVu Sans Mono', monospace; font-size: 29px; letter-spacing: 1px; line-height: 1.5; }
  .specimen { position: absolute; top: 14px; left: 44px; font-size: 18px; color: #b00; }
</style></head><body><div class="doc">${body}</div></body></html>`;

export const PASSPORT = {
  expected: {
    docType: 'passport',
    fullName: 'MOHAMMED AHMED ALTEST',
    docNumber: 'A12345678',
    nationality: 'EG',
    birthDate: '1990-01-15',
    gender: 'male',
    visitorType: 'international',
    phoneCountry: 'EG',
  },
  html: (() => {
    const mrz = td3({ surname: 'ALTEST', given: 'MOHAMMED AHMED', nationality: 'EGY', number: 'A12345678', birth: '900115', sex: 'M', expiry: '300501' });
    return page(
      `<div class="specimen">SPECIMEN</div>
       <div class="row"><div class="t">ARAB REPUBLIC OF EGYPT</div><div class="t ar">جمهورية مصر العربية</div></div>
       <div class="t">PASSPORT</div>
       <div class="row"><div>
         <div class="l">Passport No: A12345678</div>
         <div class="l">Surname: ALTEST</div>
         <div class="l">Given Names: MOHAMMED AHMED</div>
         <div class="l">Nationality: EGYPTIAN</div>
         <div class="l">Date of Birth: 15/01/1990</div>
         <div class="l">Sex: M</div>
         <div class="l">Date of Expiry: 01/05/2030</div>
       </div><div class="ar"><div class="l">الاسم: محمد أحمد التجربة</div></div></div>
       <div class="mrz">${mrz.map((l) => l.replace(/</g, '&lt;')).join('<br>')}</div>`,
      1400,
      900,
    );
  })(),
};

const iqamaNumber = saudiId('234567890');
export const IQAMA = {
  expected: {
    docType: 'residence',
    docNumber: iqamaNumber,
    nationality: 'PK',
    birthDate: '1985-11-03',
    gender: 'female',
    visitorType: 'international',
    phoneCountry: 'SA',
  },
  html: page(
    `<div class="specimen">SPECIMEN</div>
     <div class="row"><div class="t">KINGDOM OF SAUDI ARABIA</div><div class="t ar">المملكة العربية السعودية</div></div>
     <div class="row"><div class="l">RESIDENT IDENTITY</div><div class="l ar">هوية مقيم</div></div>
     <div class="ar">
       <div class="l">الاسم: فاطمة علي التجربة</div>
       <div class="l">رقم الهوية: ${iqamaNumber}</div>
       <div class="l">الجنسية: باكستان</div>
       <div class="l">تاريخ الميلاد: 03/11/1985</div>
       <div class="l">الجنس: أنثى</div>
     </div>
     <div class="l">Name: FATIMA ALI ALTEST</div>
     <div class="l">Nationality: PAKISTAN</div>`,
    1200,
    760,
  ),
};

const nationalIdNumber = saudiId('105678901');
export const NATIONAL_ID = {
  expected: {
    docType: 'national_id',
    docNumber: nationalIdNumber,
    nationality: 'SA',
    gender: '',
    visitorType: 'gcc',
    phoneCountry: 'SA',
  },
  html: page(
    `<div class="specimen">SPECIMEN</div>
     <div class="row"><div class="t">KINGDOM OF SAUDI ARABIA</div><div class="t ar">المملكة العربية السعودية</div></div>
     <div class="row"><div class="l">NATIONAL ID CARD</div><div class="l ar">بطاقة الهوية الوطنية</div></div>
     <div class="ar">
       <div class="l">سعد عبدالله التجربة</div>
       <div class="l">رقم الهوية: ${nationalIdNumber}</div>
       <div class="l">تاريخ الميلاد: 1410/10/17</div>
       <div class="l">تاريخ الانتهاء: 1450/01/01</div>
     </div>`,
    1200,
    700,
  ),
};
