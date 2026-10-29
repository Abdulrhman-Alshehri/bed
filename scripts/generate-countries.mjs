// Generates src/data/countries.json: the standardized nationality / calling-code list.
//
// Sources:
//   - Arabic and English names: Unicode CLDR via Node's built-in Intl.DisplayNames
//   - ISO 3166-1 alpha-3 codes (used by passport MRZ): i18n-iso-countries
//   - Country calling codes: libphonenumber-js metadata
//
// The output is committed so it can be reviewed. Re-run with `npm run generate:countries`
// after upgrading dependencies, then review the diff. Hand-maintained name overrides live
// in NAME_OVERRIDES below.
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import countries from 'i18n-iso-countries';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Names preferred over the CLDR defaults for this application's audience.
const NAME_OVERRIDES = {
  PS: { ar: 'فلسطين', en: 'Palestine' },
  HK: { ar: 'هونغ كونغ', en: 'Hong Kong' },
  MO: { ar: 'ماكاو', en: 'Macao' },
  MM: { ar: 'ميانمار', en: 'Myanmar' },
  CD: { ar: 'الكونغو الديمقراطية', en: 'Congo (DRC)' },
  CG: { ar: 'الكونغو', en: 'Congo' },
};

// Not ISO 3166-1, but issued on passports and supported by libphonenumber (added if missing).
const EXTRA = [{ code: 'XK', alpha3: 'RKS' }];

const arNames = new Intl.DisplayNames('ar', { type: 'region' });
const enNames = new Intl.DisplayNames('en', { type: 'region' });
const phoneCountries = new Set(getCountries());

const entries = Object.keys(countries.getAlpha2Codes())
  .map((code) => ({ code, alpha3: countries.alpha2ToAlpha3(code) }))
  .concat(EXTRA.filter((e) => !countries.isValid(e.code)))
  .map(({ code, alpha3 }) => ({
    code,
    alpha3,
    ar: NAME_OVERRIDES[code]?.ar ?? arNames.of(code),
    en: NAME_OVERRIDES[code]?.en ?? enNames.of(code),
    dial: phoneCountries.has(code) ? getCountryCallingCode(code) : null,
  }))
  .sort((a, b) => a.ar.localeCompare(b.ar, 'ar'));

for (const e of entries) {
  if (!e.ar || e.ar === e.code) throw new Error(`Missing Arabic name for ${e.code}`);
}

const outFile = join(root, 'src', 'data', 'countries.json');
// One country per line keeps diffs readable.
writeFileSync(outFile, '[\n' + entries.map((e) => JSON.stringify(e)).join(',\n') + '\n]\n');
console.log(`Wrote ${entries.length} countries to ${outFile}`);
