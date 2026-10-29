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

export interface CallingCodeSuggestion {
  /** Country whose calling code should be selected. */
  selected: string;
  /** Countries to list first in the calling-code selector. */
  preferred: string[];
}

/**
 * BR-08 / BR-09: +966 by default; the nationality's calling code when it is known.
 * For Saudi national IDs and residence permits +966 stays selected unless configured otherwise,
 * because those holders live in Saudi Arabia (see SELECT_NATIONALITY_CODE_FOR_RESIDENT_DOCS).
 */
export function suggestCallingCountry(nationality: string, docType: DocType | ''): CallingCodeSuggestion {
  const nationalityHasCode = !!getCountry(nationality)?.dial;
  if (!nationalityHasCode) return { selected: DEFAULT_PHONE_COUNTRY, preferred: [DEFAULT_PHONE_COUNTRY] };
  const preferred = [...new Set([nationality, DEFAULT_PHONE_COUNTRY])];
  const residentDoc = docType !== '' && RESIDENT_DOC_TYPES.includes(docType);
  if (residentDoc && !SELECT_NATIONALITY_CODE_FOR_RESIDENT_DOCS) {
    return { selected: DEFAULT_PHONE_COUNTRY, preferred: [...new Set([DEFAULT_PHONE_COUNTRY, nationality])] };
  }
  return { selected: nationality, preferred };
}
