import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js/max';
import { normalizeDigits } from '../extraction/text';
import { COUNTRIES } from '../data/countries';

const KNOWN_DIAL_CODES = new Set(COUNTRIES.map((c) => c.dial).filter((d): d is string => !!d));

/** Digits of a calling code as typed («+966», «00966», «٩٦٦» → «966»). */
export function normalizeDialCode(input: string): string {
  return normalizeDigits(input).replace(/\D/g, '').replace(/^00/, '').slice(0, 4);
}

export const isKnownDialCode = (dial: string) => KNOWN_DIAL_CODES.has(dial);

/** Arabic names of the countries using a calling code, e.g. «مصر» for 20. */
export function countriesForDialCode(dial: string): string[] {
  return COUNTRIES.filter((c) => c.dial === dial).map((c) => c.ar);
}

/** Keeps digits and a leading "+" ("00" international prefix becomes "+"). */
function cleanPhoneInput(number: string): string {
  const cleaned = normalizeDigits(number).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
}

export function parsePhone(dial: string, number: string): PhoneNumber | undefined {
  const cleaned = cleanPhoneInput(number);
  if (!cleaned || !dial) return undefined;
  return parsePhoneNumberFromString(cleaned, { defaultCallingCode: dial });
}

export type PhoneCheck =
  | { ok: true; e164: string; international: string; fixedLine: boolean }
  | { ok: false; message: string };

/** Validates a mobile number against the calling code (libphonenumber "max" metadata). */
export function checkPhone(dial: string, number: string): PhoneCheck {
  if (!isKnownDialCode(dial)) return { ok: false, message: 'رمز الدولة غير صحيح' };
  const phone = parsePhone(dial, number);
  if (!phone || !phone.isValid()) {
    return { ok: false, message: 'رقم الجوال غير صالح لرمز الدولة المكتوب' };
  }
  if (phone.countryCallingCode !== dial) {
    return { ok: false, message: `الرقم المدخل يتبع رمز الدولة +${phone.countryCallingCode}. غيّر رمز الدولة أو أدخل الرقم المحلي` };
  }
  return { ok: true, e164: phone.number, international: phone.formatInternational(), fixedLine: phone.getType() === 'FIXED_LINE' };
}

/** E.164 for export; falls back to +<code><digits> when the number cannot be parsed. */
export function phoneForExport(dial: string, number: string): string {
  if (!number) return '';
  const check = checkPhone(dial, number);
  if (check.ok) return check.e164;
  return `+${dial}${normalizeDigits(number).replace(/\D/g, '').replace(/^0+/, '')}`;
}
