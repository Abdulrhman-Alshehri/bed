import type { ExtractableKey, Suggestion } from '../domain/types';

export type Confidence = 'high' | 'medium' | 'low';

export interface Candidate {
  value: string;
  confidence: Confidence;
  source: 'mrz' | 'barcode' | 'ocr' | 'rule';
  /** Arabic explanation shown next to the field when it needs review. */
  note?: string;
  /** The document contains contradicting values for this field. */
  conflict?: boolean;
  /** Other plausible values the user can pick with one click. */
  alternatives?: Suggestion[];
}

export interface ExtractionResult {
  /** A candidate with an empty value carries only suggestions (an uncertain reading). */
  fields: Partial<Record<ExtractableKey, Candidate>>;
  /** Pictures of parts of the document for staff to compare with (PNG data URLs). Never exported. */
  evidence?: { birthDate?: string };
  /** Arabic warnings about the document as a whole. */
  warnings: string[];
  stats: {
    meanConfidence: number;
    mrz: 'none' | 'valid' | 'partial';
  };
}
