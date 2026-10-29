import { parsePhoneNumberFromString, type CountryCode, type PhoneNumber } from 'libphonenumber-js/max';
import { normalizeDigits } from '../extraction/text';
import { getCountry } from '../data/countries';

/** Keeps digits and a leading "+" ("00" international prefix becomes "+"). */
function cleanPhoneInput(number: string): string {
  const cleaned = normalizeDigits(number).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
}

export function parsePhone(country: string, number: string): PhoneNumber | undefined {
  const cleaned = cleanPhoneInput(number);
  if (!cleaned) return undefined;
  return parsePhoneNumberFromString(cleaned, country as CountryCode);
}

export type PhoneCheck =
  | { ok: true; e164: string; international: string; fixedLine: boolean }
  | { ok: false; message: string };

/** Validates a mobile number against the selected calling code (libphonenumber "max" metadata). */
export function checkPhone(country: string, number: string): PhoneCheck {
  const phone = parsePhone(country, number);
  if (!phone || !phone.isValid()) {
    return { ok: false, message: 'رقم الجوال غير صالح لرمز الدولة المختار' };
  }
  const selectedDial = getCountry(country)?.dial;
  if (selectedDial && phone.countryCallingCode !== selectedDial) {
    return { ok: false, message: `الرقم المدخل يتبع رمز الدولة +${phone.countryCallingCode}. غيّر رمز الدولة أو أدخل الرقم المحلي` };
  }
  const type = phone.getType();
  return { ok: true, e164: phone.number, international: phone.formatInternational(), fixedLine: type === 'FIXED_LINE' };
}

/** E.164 for export; falls back to +<code><digits> when the number cannot be parsed. */
export function phoneForExport(country: string, number: string): string {
  if (!number) return '';
  const check = checkPhone(country, number);
  if (check.ok) return check.e164;
  const dial = getCountry(country)?.dial ?? '';
  return `+${dial}${normalizeDigits(number).replace(/\D/g, '').replace(/^0+/, '')}`;
}
