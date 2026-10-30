import {
  DEFAULT_PHONE_COUNTRY,
  GCC_COUNTRIES,
  RESIDENT_DOC_TYPES,
  SELECT_NATIONALITY_CODE_FOR_RESIDENT_DOCS,
} from '../config/rules';
import { getCountry } from '../data/countries';
import type { DocType, VisitorType } from './types';

/** BR-05: GCC nationalities are خليجي, all other known nationalities are دولي. Unknown → no value. */
export function classifyVisitor(nationality: string): VisitorType | '' {
  if (!nationality) return '';
  return GCC_COUNTRIES.includes(nationality) ? 'gcc' : 'international';
}

export const DEFAULT_DIAL_CODE = getCountry(DEFAULT_PHONE_COUNTRY)!.dial!;

export interface DialCodeSuggestion {
  /** Calling code to fill in (digits). */
  selected: string;
  /** The nationality's calling code when it differs from the selected one, offered as a hint. */
  alternative: string | null;
}

/**
 * BR-08 / BR-09: +966 by default; the nationality's calling code when it is known.
 * For Saudi national IDs and residence permits +966 stays unless configured otherwise, because
 * those holders live in Saudi Arabia (see SELECT_NATIONALITY_CODE_FOR_RESIDENT_DOCS).
 */
export function suggestDialCode(nationality: string, docType: DocType | ''): DialCodeSuggestion {
  const nationalityDial = getCountry(nationality)?.dial ?? null;
  if (!nationalityDial) return { selected: DEFAULT_DIAL_CODE, alternative: null };
  const residentDoc = docType !== '' && RESIDENT_DOC_TYPES.includes(docType);
  if (residentDoc && !SELECT_NATIONALITY_CODE_FOR_RESIDENT_DOCS) {
    return { selected: DEFAULT_DIAL_CODE, alternative: nationalityDial === DEFAULT_DIAL_CODE ? null : nationalityDial };
  }
  return { selected: nationalityDial, alternative: null };
}
