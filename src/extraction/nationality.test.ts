import { describe, expect, it } from 'vitest';
import { findNationalityFuzzy, findNationalityInText, matchNationality } from './nationality';
import { countryFromMrzCode, searchCountries } from '../data/countries';

describe('matchNationality', () => {
  it.each([
    ['مصر', 'EG'],
    ['مصري', 'EG'],
    ['مصرية', 'EG'],
    ['سوري', 'SY'],
    ['باكستاني', 'PK'],
    ['هندية', 'IN'],
    ['يمني', 'YE'],
    ['أفغاني', 'AF'],
    ['إندونيسي', 'ID'],
    ['سعودي', 'SA'],
    ['إماراتي', 'AE'],
    ['الإمارات العربية المتحدة', 'AE'],
    ['بنجلاديشي', 'BD'],
    ['عُمان', 'OM'],
    ['EGYPTIAN', 'EG'],
    ['Egypt', 'EG'],
    ['INDONESIAN', 'ID'],
    ['Filipino', 'PH'],
    ['JORDANIAN', 'JO'],
    ['SAUDI', 'SA'],
    ['Turkey', 'TR'],
    ['South African', 'ZA'],
  ])('%s → %s', (text, code) => {
    expect(matchNationality(text)?.code).toBe(code);
  });

  it('returns null for unrelated words', () => {
    expect(matchNationality('المهنة')).toBeNull();
    expect(matchNationality('OCCUPATION')).toBeNull();
  });
});

describe('findNationalityInText', () => {
  it('ignores noise around the nationality', () => {
    expect(findNationalityInText(': PAKISTAN .')?.code).toBe('PK');
    expect(findNationalityInText('SOUTH AFRICA')?.code).toBe('ZA');
  });

  it('returns null when two different countries appear', () => {
    expect(findNationalityInText('EGYPT INDIA')).toBeNull();
  });
});

describe('countryFromMrzCode', () => {
  it('maps ISO alpha-3 and ICAO special codes', () => {
    expect(countryFromMrzCode('SAU')).toBe('SA');
    expect(countryFromMrzCode('D<<')).toBe('DE');
    expect(countryFromMrzCode('GBD')).toBe('GB');
    expect(countryFromMrzCode('XXA')).toBeNull();
    expect(countryFromMrzCode('UTO')).toBeNull();
  });
});

describe('searchCountries', () => {
  it('finds countries by Arabic name without the article, English name or code', () => {
    expect(searchCountries('هند')[0]?.code).toBe('IN');
    expect(searchCountries('egy')[0]?.code).toBe('EG');
    expect(searchCountries('السعو')[0]?.code).toBe('SA');
    expect(searchCountries('pak')[0]?.code).toBe('PK');
  });
});

describe('findNationalityFuzzy', () => {
  it('tolerates one misread letter', () => {
    expect(findNationalityFuzzy('افغاتستان')?.code).toBe('AF');
    expect(findNationalityFuzzy('باكستاف')?.code).toBe('PK');
  });

  it('rejects short or ambiguous text', () => {
    expect(findNationalityFuzzy('الاسلام')).toBeNull();
    expect(findNationalityFuzzy('مص')).toBeNull();
  });
});
