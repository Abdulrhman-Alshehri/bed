export type DocType = 'passport' | 'national_id' | 'residence' | 'other';
export type VisitorType = 'gcc' | 'international';
export type VisitType = 'hajj' | 'umrah' | 'prayer';
export type LuggageCenter = 'makkah' | 'madinah';
export type Gender = 'male' | 'female';

/** Luggage types, in the order shown to staff. */
export const LUGGAGE_KINDS = ['backpack', 'suitcase', 'bag', 'stroller', 'wheelchair', 'other'] as const;
export type LuggageKind = (typeof LUGGAGE_KINDS)[number];

/** Size of all the luggage together, matching the bands painted on the measuring wall. */
export const LUGGAGE_SIZES = ['S', 'S+', 'M', 'M+', 'L'] as const;
export type LuggageSize = (typeof LUGGAGE_SIZES)[number];

/** All values are strings so document numbers keep leading zeros (BR-04). Empty string = not set. */
export interface FormValues {
  docType: DocType | '';
  fullName: string;
  docNumber: string;
  visitorType: VisitorType | '';
  visitType: VisitType | '';
  /** ISO 3166-1 alpha-2 code matched from `nationalityText`; empty when the text matches no country. */
  nationality: string;
  /** Nationality as shown in the text field (typed by staff or filled from the document). */
  nationalityText: string;
  /** ISO 8601 date (YYYY-MM-DD), Gregorian. */
  birthDate: string;
  /** Country calling code, digits only (e.g. "966"). */
  phoneDialCode: string;
  /** Mobile number as typed by the user (national format or with +code). */
  phoneNumber: string;
  luggageCenter: LuggageCenter | '';
  gender: Gender | '';
  /** Number of pieces per luggage type. */
  luggage: Record<LuggageKind, number>;
  luggageSize: LuggageSize | '';
}

/** The ten form fields, in the order required by the BRD and the CSV export. */
export const FIELD_ORDER = [
  'docType',
  'fullName',
  'docNumber',
  'visitorType',
  'visitType',
  'nationality',
  'birthDate',
  'phone',
  'luggageCenter',
  'gender',
] as const;

export type FieldKey = (typeof FIELD_ORDER)[number];

/** Fields that OCR can populate. */
export type ExtractableKey = 'docType' | 'fullName' | 'docNumber' | 'nationality' | 'birthDate' | 'gender';

/** Where the current value of a field came from. */
export type ValueSource = 'empty' | 'default' | 'ocr' | 'mrz' | 'barcode' | 'rule' | 'user';

export interface Flag {
  /** review: uncertain value, conflict: the document contains contradicting values. */
  level: 'review' | 'conflict';
  message: string;
}

export interface Suggestion {
  value: string;
  /** Human-readable value. */
  display: string;
  reason: string;
}

export interface FieldMeta {
  source: ValueSource;
  flag: Flag | null;
  suggestions: Suggestion[];
}

export interface FormState {
  values: FormValues;
  meta: Record<FieldKey, FieldMeta>;
  /** Separate from meta.phone.source, which describes the number itself. */
  phoneCodeSource: 'default' | 'rule' | 'user';
  /** At least one OCR extraction has been applied. */
  extracted: boolean;
  /** The user reviewed and confirmed the current values (required before copy/export). */
  confirmed: boolean;
  /** Arabic notices produced by the last state change (e.g. which manual edits were kept). */
  notices: string[];
}
