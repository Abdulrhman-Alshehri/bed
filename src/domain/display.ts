import { countryName } from '../data/countries';
import {
  DOC_TYPE_LABELS,
  GENDER_LABELS,
  LUGGAGE_CENTER_LABELS,
  VISIT_TYPE_LABELS,
  VISITOR_TYPE_LABELS,
} from './labels';
import { countriesForDialCode } from './phone';
import type { FieldKey } from './types';

const lookup = (table: Record<string, string>, value: string) => table[value] ?? value;

/** "+966 (المملكة العربية السعودية)" */
export function dialCodeLabel(dial: string): string {
  const name = countriesForDialCode(dial)[0];
  return name ? `+${dial} (${name})` : `+${dial}`;
}

/** Human-readable Arabic display of a stored field value. For 'phone' the value is a calling code. */
export function displayValue(field: FieldKey, value: string): string {
  if (!value) return '';
  switch (field) {
    case 'docType':
      return lookup(DOC_TYPE_LABELS, value);
    case 'visitorType':
      return lookup(VISITOR_TYPE_LABELS, value);
    case 'visitType':
      return lookup(VISIT_TYPE_LABELS, value);
    case 'luggageCenter':
      return lookup(LUGGAGE_CENTER_LABELS, value);
    case 'gender':
      return lookup(GENDER_LABELS, value);
    case 'nationality':
      return countryName(value) || value;
    case 'phone':
      return dialCodeLabel(value);
    default:
      return value;
  }
}
