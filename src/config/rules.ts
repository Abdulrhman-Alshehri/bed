// Business configuration. Everything an operations team is likely to want to change lives here.
import type { DocType, FieldKey, LuggageCenter, VisitType } from '../domain/types';

/**
 * Gulf Cooperation Council member states (ISO 3166-1 alpha-2).
 * Nationalities in this list are classified as خليجي, all others as دولي (BR-05).
 * Saudi Arabia is a GCC member, so Saudi nationals are classified as خليجي.
 */
export const GCC_COUNTRIES: readonly string[] = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'];

export const DEFAULT_VISIT_TYPE: VisitType = 'prayer'; // BR-06
export const DEFAULT_LUGGAGE_CENTER: LuggageCenter = 'madinah'; // BR-07
export const DEFAULT_PHONE_COUNTRY = 'SA'; // BR-08 (+966)

/**
 * BR-09 refinement. Holders of a Saudi national ID or residence permit (إقامة) live in Saudi Arabia,
 * so their mobile number is far more likely to be Saudi than to match their nationality.
 *   false (default): for these document types +966 stays selected and the nationality's
 *                    calling code is offered at the top of the list as a suggestion.
 *   true:            always select the nationality's calling code when it is known.
 * Passports and other documents always select the nationality's calling code when known.
 */
export const SELECT_NATIONALITY_CODE_FOR_RESIDENT_DOCS = false;
export const RESIDENT_DOC_TYPES: readonly DocType[] = ['national_id', 'residence'];

/** Missing values in these fields block confirmation and export. */
export const REQUIRED_FIELDS: readonly FieldKey[] = [
  'docType',
  'fullName',
  'docNumber',
  'visitorType',
  'visitType',
  'nationality',
  'birthDate',
  'luggageCenter',
];

/**
 * Missing values in these fields produce a warning but do not block export.
 * Gender is deliberately not required: forcing a choice when the document does not state it
 * would push staff to fabricate it (BR-10).
 */
export const RECOMMENDED_FIELDS: readonly FieldKey[] = ['phone', 'gender'];

/** OCR words/lines below this Tesseract confidence (0-100) are flagged for review. */
export const OCR_CONFIDENCE_THRESHOLD = 80;

/**
 * Wrap the document number and phone number as ="..." in the CSV so Excel keeps them as text
 * (otherwise Excel drops leading zeros and shows long numbers in scientific notation).
 * Set to false if the CSV is consumed by a system other than Excel.
 */
export const CSV_EXCEL_TEXT_GUARD = true;

/**
 * Nationalities whose passports normally carry the holder's name in Arabic. For these passports
 * an additional Arabic OCR pass looks for the Arabic name. (Arab League members.)
 */
export const ARABIC_NAME_NATIONALITIES: readonly string[] = [
  'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'YE', 'IQ', 'JO', 'SY', 'LB', 'PS', 'EG', 'SD', 'LY',
  'TN', 'DZ', 'MA', 'MR', 'SO', 'DJ', 'KM',
];

/** Maximum accepted upload size. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
