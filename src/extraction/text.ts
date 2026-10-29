// Text normalization helpers shared by the extraction rules and the UI.

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to ASCII digits. */
export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - base);
  });
}

/** Removes Unicode bidi control characters that OCR output and pasted text sometimes contain. */
export function stripBidiControls(input: string): string {
  return input.replace(/[‎‏‪-‮⁦-⁩؜]/g, '');
}

/**
 * Folds Arabic spelling variants so that text can be compared loosely:
 * removes diacritics and tatweel, unifies alef/hamza forms, ya/alef maqsura and ta marbuta.
 * Latin letters are lower-cased. Use only for comparison, never for display.
 */
export function foldArabic(input: string): string {
  return stripBidiControls(normalizeDigits(input))
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const ARABIC_LETTER = /[ء-ي]/;
export const ARABIC_LETTERS_GLOBAL = /[ء-ي]/g;
export const LATIN_LETTERS_GLOBAL = /[A-Za-z]/g;

export function countArabicLetters(input: string): number {
  return input.match(ARABIC_LETTERS_GLOBAL)?.length ?? 0;
}

export function countLatinLetters(input: string): number {
  return input.match(LATIN_LETTERS_GLOBAL)?.length ?? 0;
}

/** Collapses whitespace and trims. */
export function cleanSpaces(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Normalizes a document number typed or read by OCR: ASCII digits, upper case, no spaces/dashes. */
export function normalizeDocNumber(input: string): string {
  return stripBidiControls(normalizeDigits(input)).toUpperCase().replace(/[\s\-_.\/]/g, '');
}

/** Normalizes a phone number typed by the user to digits only (a leading + is dropped). */
export function normalizePhoneDigits(input: string): string {
  return normalizeDigits(input).replace(/\D/g, '');
}
