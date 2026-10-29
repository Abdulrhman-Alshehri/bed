// Machine Readable Zone parsing (ICAO Doc 9303) for passports (TD3), ID cards (TD1) and TD2 documents.
// Check digits are verified so OCR errors in the most important fields are detected, not guessed.

export type MrzFormat = 'TD1' | 'TD2' | 'TD3';

const LINE_LENGTH: Record<MrzFormat, number> = { TD1: 30, TD2: 36, TD3: 44 };
const LINE_COUNT: Record<MrzFormat, number> = { TD1: 3, TD2: 2, TD3: 2 };

export interface MrzChecks {
  documentNumber: boolean;
  birthDate: boolean;
  expiryDate: boolean;
  composite: boolean;
}

export interface MrzResult {
  format: MrzFormat;
  /** "P", "PP", "I", "ID", "AC", ... (filler removed). */
  documentCode: string;
  /** Raw MRZ country codes, e.g. "EGY", "D". */
  issuingState: string;
  nationality: string;
  documentNumber: string;
  /** Optional data fields, filler removed (may contain a national ID number). */
  optionalData: string[];
  /** ISO date or null when unreadable. */
  birthDate: string | null;
  expiryDate: string | null;
  sex: 'M' | 'F' | null;
  surname: string;
  givenNames: string;
  /** The name filled the whole MRZ name field, so it may have been truncated. */
  nameMayBeTruncated: boolean;
  checks: MrzChecks;
  /** Cleaned MRZ lines used for parsing. */
  lines: string[];
}

const CHAR_VALUES: Record<string, number> = { '<': 0 };
for (let i = 0; i < 10; i++) CHAR_VALUES[String(i)] = i;
for (let i = 0; i < 26; i++) CHAR_VALUES[String.fromCharCode(65 + i)] = 10 + i;

/** ICAO 9303 check digit (weights 7, 3, 1). */
export function computeCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    sum += (CHAR_VALUES[field[i]!] ?? 0) * weights[i % 3]!;
  }
  return sum % 10;
}

function checkPasses(field: string, checkChar: string, fillerMeansZero = false): boolean {
  if (checkChar === '<') return fillerMeansZero && computeCheckDigit(field) === 0;
  return /^\d$/.test(checkChar) && computeCheckDigit(field) === Number(checkChar);
}

// Characters OCR commonly confuses in the OCR-B font.
const TO_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '4': 'A', '7': 'T' };

const asDigits = (s: string) => s.replace(/[A-Z]/g, (ch) => TO_DIGIT[ch] ?? ch);
const asLetters = (s: string) => s.replace(/[0-9]/g, (ch) => TO_LETTER[ch] ?? ch);

/** Upper-cases an OCR line and maps lookalike characters to the MRZ alphabet (A-Z, 0-9, <). */
export function cleanMrzLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/«/g, '<<')
    .replace(/[‹〈＜(\[{¢€£]/g, '<')
    .replace(/[^A-Z0-9<]/g, '');
}

/** Heuristic: does this cleaned OCR line look like an MRZ line? */
export function looksLikeMrzLine(cleaned: string): boolean {
  if (cleaned.length < 26 || cleaned.length > 48) return false;
  const fillers = cleaned.split('<').length - 1;
  if (fillers >= 2) return true;
  // Data line of a passport with a fully used personal-number field may contain no filler at all.
  return /^[A-Z0-9<]{9}[0-9OQDIL][A-Z<]{3}[0-9OQDILSZBG]{7}[MFX<]/.test(cleaned);
}

function fitLength(line: string, length: number): string {
  if (line.length === length) return line;
  if (line.length < length) return line + '<'.repeat(length - line.length);
  // Too long: drop surplus filler at the end first, then cut.
  let trimmed = line;
  while (trimmed.length > length && trimmed.endsWith('<')) trimmed = trimmed.slice(0, -1);
  return trimmed.slice(0, length);
}

function parseMrzDate(raw: string, kind: 'birth' | 'expiry', now: Date): string | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const yy = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(2, 4));
  const dd = Number(raw.slice(4, 6));
  const currentYY = now.getUTCFullYear() % 100;
  const century = kind === 'birth' ? (yy > currentYY ? 1900 : 2000) : yy >= 70 ? 1900 : 2000;
  const year = century + yy;
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function parseName(field: string): { surname: string; givenNames: string; mayBeTruncated: boolean } {
  // Digits never appear in names; long runs of K are a common misreading of the < filler.
  const letters = asLetters(field).replace(/K{3,}/g, (m) => '<'.repeat(m.length));
  const mayBeTruncated = !field.endsWith('<');
  const [surnamePart = '', ...rest] = letters.split('<<');
  const words = (s: string) => s.split('<').filter(Boolean);
  const given = words(rest.join('<<'));
  // Drop trailing fragments that are misread filler.
  while (given.length > 0 && /^[KC]+$/.test(given[given.length - 1]!)) given.pop();
  return { surname: words(surnamePart).join(' '), givenNames: given.join(' '), mayBeTruncated };
}

function sexFrom(ch: string): 'M' | 'F' | null {
  if (ch === 'M') return 'M';
  if (ch === 'F') return 'F';
  return null;
}

const strip = (s: string) => s.replace(/<+$/g, '').replace(/^<+/, '');

function parseTD3(lines: string[], now: Date): MrzResult {
  const [l1, l2] = lines as [string, string];
  const documentNumber = l2.slice(0, 9);
  const docCheck = asDigits(l2[9]!);
  const birth = asDigits(l2.slice(13, 19));
  const birthCheck = asDigits(l2[19]!);
  const expiry = asDigits(l2.slice(21, 27));
  const expiryCheck = asDigits(l2[27]!);
  const personal = l2.slice(28, 42);
  const personalCheck = asDigits(l2[42]!);
  const compositeCheck = asDigits(l2[43]!);
  const composite = documentNumber + docCheck + birth + birthCheck + expiry + expiryCheck + personal + personalCheck;
  const name = parseName(l1.slice(5, 44));
  return {
    format: 'TD3',
    documentCode: strip(asLetters(l1.slice(0, 2))),
    issuingState: strip(asLetters(l1.slice(2, 5))),
    nationality: strip(asLetters(l2.slice(10, 13))),
    documentNumber: strip(documentNumber),
    optionalData: [strip(personal)].filter(Boolean),
    birthDate: parseMrzDate(birth, 'birth', now),
    expiryDate: parseMrzDate(expiry, 'expiry', now),
    sex: sexFrom(l2[20]!),
    surname: name.surname,
    givenNames: name.givenNames,
    nameMayBeTruncated: name.mayBeTruncated,
    checks: {
      documentNumber: checkPasses(documentNumber, docCheck),
      birthDate: checkPasses(birth, birthCheck),
      expiryDate: checkPasses(expiry, expiryCheck),
      composite: checkPasses(composite, compositeCheck),
    },
    lines,
  };
}

function parseTD2(lines: string[], now: Date): MrzResult {
  const [l1, l2] = lines as [string, string];
  const documentNumber = l2.slice(0, 9);
  const docCheck = asDigits(l2[9]!);
  const birth = asDigits(l2.slice(13, 19));
  const birthCheck = asDigits(l2[19]!);
  const expiry = asDigits(l2.slice(21, 27));
  const expiryCheck = asDigits(l2[27]!);
  const optional = l2.slice(28, 35);
  const compositeCheck = asDigits(l2[35]!);
  const composite = documentNumber + docCheck + birth + birthCheck + expiry + expiryCheck + optional;
  const name = parseName(l1.slice(5, 36));
  return {
    format: 'TD2',
    documentCode: strip(asLetters(l1.slice(0, 2))),
    issuingState: strip(asLetters(l1.slice(2, 5))),
    nationality: strip(asLetters(l2.slice(10, 13))),
    documentNumber: strip(documentNumber),
    optionalData: [strip(optional)].filter(Boolean),
    birthDate: parseMrzDate(birth, 'birth', now),
    expiryDate: parseMrzDate(expiry, 'expiry', now),
    sex: sexFrom(l2[20]!),
    surname: name.surname,
    givenNames: name.givenNames,
    nameMayBeTruncated: name.mayBeTruncated,
    checks: {
      documentNumber: checkPasses(documentNumber, docCheck),
      birthDate: checkPasses(birth, birthCheck),
      expiryDate: checkPasses(expiry, expiryCheck),
      composite: checkPasses(composite, compositeCheck),
    },
    lines,
  };
}

function parseTD1(lines: string[], now: Date): MrzResult {
  const [l1, l2, l3] = lines as [string, string, string];
  let documentNumber = l1.slice(5, 14);
  let docCheck = asDigits(l1[14]!);
  const optional1 = l1.slice(15, 30);
  let optional1Clean = strip(optional1);
  // Extended document number: check-digit position holds "<" and the number continues in optional data.
  if (l1[14] === '<' && optional1Clean.length > 1) {
    const extension = optional1.split('<')[0]!;
    documentNumber = documentNumber + extension.slice(0, -1);
    docCheck = asDigits(extension.slice(-1));
    optional1Clean = strip(optional1.slice(extension.length));
  }
  const birth = asDigits(l2.slice(0, 6));
  const birthCheck = asDigits(l2[6]!);
  const expiry = asDigits(l2.slice(8, 14));
  const expiryCheck = asDigits(l2[14]!);
  const optional2 = l2.slice(18, 29);
  const compositeCheck = asDigits(l2[29]!);
  const composite = l1.slice(5, 30) + birth + birthCheck + expiry + expiryCheck + optional2;
  const name = parseName(l3);
  return {
    format: 'TD1',
    documentCode: strip(asLetters(l1.slice(0, 2))),
    issuingState: strip(asLetters(l1.slice(2, 5))),
    nationality: strip(asLetters(l2.slice(15, 18))),
    documentNumber: strip(documentNumber),
    optionalData: [optional1Clean, strip(optional2)].filter(Boolean),
    birthDate: parseMrzDate(birth, 'birth', now),
    expiryDate: parseMrzDate(expiry, 'expiry', now),
    sex: sexFrom(l2[7]!),
    surname: name.surname,
    givenNames: name.givenNames,
    nameMayBeTruncated: name.mayBeTruncated,
    checks: {
      documentNumber: checkPasses(documentNumber, docCheck),
      birthDate: checkPasses(birth, birthCheck),
      expiryDate: checkPasses(expiry, expiryCheck),
      composite: checkPasses(composite, compositeCheck),
    },
    lines,
  };
}

/** Parses already-grouped MRZ lines in a known format. Lines are cleaned and padded/trimmed. */
export function parseMrz(rawLines: string[], format: MrzFormat, now = new Date()): MrzResult {
  const lines = rawLines.map((l) => fitLength(cleanMrzLine(l), LINE_LENGTH[format]));
  if (format === 'TD3') return parseTD3(lines, now);
  if (format === 'TD2') return parseTD2(lines, now);
  return parseTD1(lines, now);
}

export function passedCheckCount(result: MrzResult): number {
  return Object.values(result.checks).filter(Boolean).length;
}

function plausible(result: MrzResult): boolean {
  // Two independent check digits rarely pass by chance on garbage text.
  return passedCheckCount(result) >= 2 || (result.birthDate !== null && result.checks.birthDate);
}

/**
 * Finds and parses the MRZ among OCR lines (in reading order). Returns the most consistent
 * parse, or null when no plausible MRZ is present.
 */
export function findMrz(ocrLines: string[], now = new Date()): MrzResult | null {
  const cleaned = ocrLines.map(cleanMrzLine);
  const candidateIdx = cleaned.map((l, i) => (looksLikeMrzLine(l) ? i : -1)).filter((i) => i >= 0);
  if (candidateIdx.length < 2) return null;

  // Build runs of consecutive candidate lines.
  const runs: number[][] = [];
  for (const idx of candidateIdx) {
    const last = runs[runs.length - 1];
    if (last && idx === last[last.length - 1]! + 1) last.push(idx);
    else runs.push([idx]);
  }

  let best: MrzResult | null = null;
  for (const run of runs) {
    for (const format of ['TD3', 'TD1', 'TD2'] as MrzFormat[]) {
      const count = LINE_COUNT[format];
      for (let start = 0; start + count <= run.length; start++) {
        const group = run.slice(start, start + count).map((i) => cleaned[i]!);
        const avg = group.reduce((s, l) => s + l.length, 0) / group.length;
        if (Math.abs(avg - LINE_LENGTH[format]) > 5) continue;
        const parsed = parseMrz(group, format, now);
        if (!plausible(parsed)) continue;
        if (!best || passedCheckCount(parsed) > passedCheckCount(best)) best = parsed;
      }
    }
  }
  return best;
}
