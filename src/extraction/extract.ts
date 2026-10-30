// Turns OCR output into per-field candidates. Rules, in order of reliability:
//   1. MRZ with verified check digits (passports, GCC ID cards) and ID numbers read from barcodes.
//   2. Saudi ID / Iqama numbers that pass the Luhn check, and the citizen/resident prefix rule.
//   3. Values printed next to labels («الاسم», «Nationality», «تاريخ الميلاد», ...), paired by
//      position on the card (see layout.ts).
//   4. Unlabeled heuristics and suggestions (always flagged for review).
// Nothing is invented: a field without evidence is left out of the result.
import { ARABIC_NAME_NATIONALITIES, OCR_CONFIDENCE_THRESHOLD } from '../config/rules';
import { countryFromMrzCode, countryName } from '../data/countries';
import type { DocType, Gender, Suggestion } from '../domain/types';
import type { OcrLine, OcrPage } from '../ocr/types';
import { ageOn, findDates, formatHijriArabic, todayIso, type FoundDate } from './dates';
import { findLabels, foldSameLength, hasAnyLabel } from './fieldLabels';
import { genderFromArabicName } from './genderFromName';
import { buildLayout, cellsOf, labelFor, valuesForLabel, type Cell, type Layout } from './layout';
import { cleanMrzLine, findMrz, looksLikeMrzLine, passedCheckCount, type MrzResult } from './mrz';
import { findNationalityFuzzy, findNationalityInText } from './nationality';
import type { Candidate, Confidence, ExtractionResult } from './result';
import { findSaudiIdNumbers, isValidSaudiIdNumber, type SaudiIdCandidate } from './saudiId';
import { cleanSpaces, countArabicLetters, countLatinLetters, editDistance, foldArabic, normalizeDigits } from './text';

export interface ExtractionInput {
  /** English OCR pass over the whole document. */
  latin: OcrPage;
  /** OCR pass over the MRZ region with a restricted character set, if one was run. */
  mrz?: OcrPage | null;
  /** Arabic OCR pass over the whole document, if one was run. */
  arabic?: OcrPage | null;
  /** Texts decoded from barcodes/QR codes on the document. */
  barcodes?: string[];
  now?: Date;
}

// ---------------------------------------------------------------------------------------------
// Names

const LATIN_STOPWORDS = new Set(
  ('KINGDOM SAUDI ARABIA MINISTRY INTERIOR NATIONAL IDENTITY ID CARD RESIDENT RESIDENCE RESIDENCY PERMIT IQAMA ' +
    'PASSPORT PASSEPORT REPUBLIC STATE STATES DATE BIRTH EXPIRY EXPIRATION ISSUE ISSUING PLACE NATIONALITY SEX NAME ' +
    'NAMES SURNAME GIVEN NO NUMBER OCCUPATION PROFESSION EMPLOYER SPONSOR RELIGION TYPE CODE AUTHORITY SIGNATURE ' +
    'HOLDER GOVERNMENT VERSION VALID UNTIL OF THE MALE FEMALE UNITED EMIRATES KUWAIT QATAR BAHRAIN OMAN SULTANATE ' +
    'CIVIL PERSONAL DOCUMENT COUNTRY ADDRESS BLOOD GROUP HEIGHT NOM PRENOMS SPECIMEN').split(' '),
);

const ARABIC_STOPWORDS = new Set(
  [
    'المملكة', 'العربية', 'السعودية', 'وزارة', 'الداخلية', 'بطاقة', 'هوية', 'الهوية', 'الوطنية', 'وطنية', 'إقامة',
    'الإقامة', 'مقيم', 'تاريخ', 'الميلاد', 'الانتهاء', 'الإصدار', 'مكان', 'رقم', 'الجنسية', 'المهنة', 'صاحب', 'العمل',
    'الديانة', 'الأحوال', 'المدنية', 'جواز', 'سفر', 'الجوازات', 'المديرية', 'العامة', 'للجوازات', 'دولة', 'جمهورية',
    'الاسم', 'الجنس', 'ذكر', 'أنثى', 'النسخة', 'السجل', 'المدني', 'حامل', 'البطاقة', 'توقيع', 'الإمارات', 'المتحدة',
    'الكويت', 'سلطنة', 'عمان', 'قطر', 'البحرين', 'مملكة', 'الحدود', 'صادرة', 'من', 'إلى', 'صالحة', 'الكفيل', 'الجواز',
    // Verification note printed next to the QR code on Saudi cards.
    'يجب', 'التحقق', 'الرمز', 'السريع', 'قبل', 'اعتماد', 'التعامل', 'مع',
    'شركة', 'مؤسسة', 'للتجارة', 'المحدودة', 'منطقة', 'جوازات', 'الاسلام', 'الإسلام',
  ].map(foldArabic),
);

function acceptLatinName(segment: string): string | null {
  const words = cleanSpaces(segment.replace(/[^A-Za-z' -]/g, ' '))
    .split(' ')
    .filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 2);
  if (words.length < 2 || words.length > 7) return null;
  if (words.some((w) => LATIN_STOPWORDS.has(w.toUpperCase()))) return null;
  return words.join(' ');
}

function acceptArabicName(segment: string): string | null {
  const words = cleanSpaces(segment.replace(/ـ/g, '').replace(/[^ء-ي\s]/g, ' '))
    .split(' ')
    .filter((w) => w.length >= 2);
  if (words.length < 2 || words.length > 8) return null;
  if (words.some(isCardWord)) return null;
  return words.join(' ');
}

/** A word printed on the card itself, possibly misread by one letter («زارة» for «وزارة»). */
function isCardWord(word: string): boolean {
  const folded = foldArabic(word);
  if (ARABIC_STOPWORDS.has(folded)) return true;
  if (folded.length < 4) return false;
  for (const stop of ARABIC_STOPWORDS) {
    if (stop.length >= 4 && Math.abs(stop.length - folded.length) <= 1 && editDistance(stop, folded) <= 1) return true;
  }
  return false;
}

interface NameReading {
  value: string;
  confidence: number;
  cell: Cell;
  /** Found next to a «الاسم»/«Name» label, or right above the English name. */
  anchored: boolean;
}

function looksLikeName(cell: Cell, script: 'arabic' | 'latin'): string | null {
  const text = cell.text.trim();
  if (cell.confidence < 60 || hasAnyLabel(text) || /\d/.test(normalizeDigits(text))) return null;
  const letters = text.replace(/[\s-]/g, '').length || 1;
  if (script === 'arabic') {
    if (countArabicLetters(text) / letters < 0.85) return null;
  } else if (!/^[A-Z' -]+$/.test(text) || countLatinLetters(text) / letters < 0.85) {
    return null;
  }
  if (findNationalityInText(text)?.exact) return null; // a country name, e.g. "REPUBLIC OF INDIA"
  return script === 'arabic' ? acceptArabicName(text) : acceptLatinName(text);
}

/** Cells that are not the value of another printed field (occupation, employer, place of birth...). */
function freeCells(layout: Layout | null): Cell[] {
  if (!layout) return [];
  return layout.rows.flatMap((row, r) => row.cells.filter((_, c) => labelFor(layout, r, c, 0) === null));
}

/** Best cell that looks like a name when no «Name» label was found. */
function bestUnlabeledName(layout: Layout | null, script: 'arabic' | 'latin'): NameReading | null {
  let best: NameReading | null = null;
  for (const cell of freeCells(layout)) {
    const value = looksLikeName(cell, script);
    if (value && (!best || cell.confidence > best.confidence)) best = { value, confidence: cell.confidence, cell, anchored: false };
  }
  return best;
}

/**
 * Saudi IDs and residence permits print the Arabic name directly above the English name, without a
 * label. Finds the Arabic cell right above the given English name cell.
 */
function arabicNameAbove(arabic: Layout | null, latinCell: Cell): NameReading | null {
  if (!arabic) return null;
  const h = latinCell.bbox.y1 - latinCell.bbox.y0;
  let best: NameReading | null = null;
  for (const cell of freeCells(arabic)) {
    const above = cell.bbox.y1 <= latinCell.bbox.y0 + h / 2 && latinCell.bbox.y0 - cell.bbox.y1 < h * 2.5;
    const overlaps = cell.bbox.x0 < latinCell.bbox.x1 && latinCell.bbox.x0 < cell.bbox.x1;
    if (!above || !overlaps) continue;
    const value = looksLikeName(cell, 'arabic');
    if (value && (!best || cell.bbox.y1 > best.cell.bbox.y1)) best = { value, confidence: cell.confidence, cell, anchored: true };
  }
  return best;
}

interface NameDecision {
  candidate: Candidate | null;
  /** The Arabic name reading, if any, and whether it was anchored to a label or the English name. */
  arabic: { value: string; anchored: boolean } | null;
}

function decideName(mrz: MrzResult | null, mrzReliable: boolean, latin: Layout, arabic: Layout | null): NameDecision {
  const result = decideNameCandidate(mrz, mrzReliable, latin, arabic);
  return { candidate: result.candidate, arabic: result.arabicName ? { value: result.arabicName.value, anchored: result.arabicName.anchored } : null };
}

function decideNameCandidate(
  mrz: MrzResult | null,
  mrzReliable: boolean,
  latin: Layout,
  arabic: Layout | null,
): { candidate: Candidate | null; arabicName: NameReading | null } {
  const labeled = (layout: Layout | null, accept: (s: string) => string | null): NameReading | null => {
    const hit = layout ? valuesForLabel([layout], 'name', accept)[0] : undefined;
    return hit ? { ...hit, anchored: true } : null;
  };
  const latinName = labeled(latin, acceptLatinName) ?? bestUnlabeledName(latin, 'latin');
  const arabicName =
    labeled(arabic, acceptArabicName) ??
    (latinName ? arabicNameAbove(arabic, latinName.cell) : null) ??
    bestUnlabeledName(arabic, 'arabic');

  if (mrz && (mrz.surname || mrz.givenNames)) {
    const alternatives: Suggestion[] = arabicName
      ? [{ value: arabicName.value, display: arabicName.value, reason: 'الاسم بالعربية كما قُرئ من المستند' }]
      : [];
    let confidence: Confidence = mrzReliable ? 'high' : 'medium';
    let note: string | undefined;
    if (mrz.nameMayBeTruncated) {
      confidence = 'medium';
      note = 'الاسم يملأ حقل MRZ بالكامل وقد يكون مختصرًا. قارنه بالاسم المطبوع في المستند';
    } else if (!mrzReliable) {
      note = 'تحقق من الاسم مقارنة بالمستند';
    }
    return {
      candidate: { value: cleanSpaces(`${mrz.givenNames} ${mrz.surname}`), confidence, source: 'mrz', note, alternatives },
      arabicName,
    };
  }

  const options = [
    arabicName && { ...arabicName, reason: 'الاسم بالعربية كما قُرئ من المستند' },
    latinName && { ...latinName, reason: 'الاسم بالإنجليزية كما قُرئ من المستند' },
  ].filter((o): o is NonNullable<typeof o> => !!o);
  if (options.length === 0) return { candidate: null, arabicName };
  // Anchored readings first; Arabic first among equally reliable readings (Arabic-first interface).
  const rank = (o: (typeof options)[number]) => (o.anchored ? 2 : 0) + (o.confidence >= OCR_CONFIDENCE_THRESHOLD ? 1 : 0);
  options.sort((a, b) => rank(b) - rank(a));
  const [primary, ...rest] = options as [(typeof options)[number], ...typeof options];
  return {
    candidate: {
      value: primary.value,
      confidence: primary.anchored && primary.confidence >= OCR_CONFIDENCE_THRESHOLD ? 'medium' : 'low',
      source: 'ocr',
      note: primary.anchored ? 'تحقق من الاسم مقارنة بالمستند' : 'لم يُعثر على عنوان "الاسم"؛ تم اختيار السطر الأرجح. تحقق منه',
      alternatives: rest.map((o) => ({ value: o.value, display: o.value, reason: o.reason })),
    },
    arabicName,
  };
}

// ---------------------------------------------------------------------------------------------
// Document type

function docTypeFromKeywords(foldedText: string): DocType | null {
  const has = (words: string[]) => words.some((w) => foldedText.includes(foldSameLength(w)));
  const passport = has(['passport', 'passeport', 'جواز سفر', 'جواز السفر']);
  const residence = has(['إقامة', 'مقيم', 'resident', 'residence', 'residency', 'iqama']);
  const nationalId = has(['الهوية الوطنية', 'هوية وطنية', 'national id', 'national identity', 'identity card', 'civil id', 'البطاقة المدنية', 'بطاقة الهوية']);
  const found = [passport && 'passport', residence && 'residence', nationalId && 'national_id'].filter(Boolean) as DocType[];
  return found.length === 1 ? found[0]! : null;
}

function decideDocType(
  mrz: MrzResult | null,
  mrzReliable: boolean,
  saudiIds: SaudiIdCandidate[],
  keywordType: DocType | null,
): Candidate | null {
  if (mrz) {
    const code = mrz.documentCode[0];
    if (code === 'P') return { value: 'passport', confidence: mrzReliable ? 'high' : 'medium', source: 'mrz' };
    if (code === 'I' || code === 'A' || code === 'C') {
      const nationality = countryFromMrzCode(mrz.nationality);
      const issuer = countryFromMrzCode(mrz.issuingState);
      if (nationality && issuer && nationality !== issuer) {
        return {
          value: 'residence',
          confidence: 'medium',
          source: 'mrz',
          note: 'البطاقة صادرة من دولة تختلف عن جنسية حاملها، لذلك اقتُرح نوع "إقامة". تحقق منه',
        };
      }
      return { value: 'national_id', confidence: mrzReliable ? 'high' : 'medium', source: 'mrz' };
    }
  }
  const valid = saudiIds.filter((s) => s.valid);
  if (valid.length) {
    const prefixes = new Set(valid.map((s) => s.value[0]));
    let type: DocType | null = null;
    if (prefixes.size === 1) type = prefixes.has('1') ? 'national_id' : 'residence';
    // Both prefixes present (e.g. a sponsor's ID printed on an Iqama): fall back to the printed title.
    else if (keywordType === 'residence' || keywordType === 'national_id') type = keywordType;
    if (type) {
      const agrees = keywordType === type;
      return {
        value: type,
        confidence: agrees ? 'high' : 'medium',
        source: 'rule',
        note: agrees ? undefined : 'تم تحديد النوع من بادئة رقم الهوية (1 للمواطن، 2 للمقيم). تحقق منه',
      };
    }
  }
  if (keywordType) {
    return { value: keywordType, confidence: 'medium', source: 'ocr', note: 'تم تحديد النوع من النص المطبوع على المستند. تحقق منه' };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Document number

function acceptDocNumber(segment: string): string | null {
  const tokens = normalizeDigits(segment).toUpperCase().match(/[A-Z0-9]{5,20}/g) ?? [];
  return tokens.find((t) => (t.match(/\d/g)?.length ?? 0) >= 4) ?? null;
}

/** Saudi ID numbers on the card, excluding numbers printed next to employer/sponsor labels. */
function holderIdNumbers(layouts: Layout[]): SaudiIdCandidate[] {
  const found = new Map<string, SaudiIdCandidate>();
  for (const layout of layouts) {
    layout.rows.forEach((row, r) => {
      row.cells.forEach((cell, c) => {
        for (const id of findSaudiIdNumbers(cell.text)) {
          const position = normalizeDigits(cell.text).replace(/ (?=\d)/g, '').indexOf(id.value);
          if (labelFor(layout, r, c, Math.max(0, position)) === 'employer') continue;
          if (!found.has(id.value)) found.set(id.value, id);
        }
      });
    });
  }
  return [...found.values()];
}

/** Saudi ID numbers encoded in barcodes (the Code 128 barcode on Saudi cards holds the ID number). */
function barcodeIdNumbers(barcodes: string[]): string[] {
  const ids = barcodes.flatMap((text) => findSaudiIdNumbers(text)).filter((c) => c.valid).map((c) => c.value);
  return [...new Set(ids)];
}

function decideDocNumber(
  mrz: MrzResult | null,
  barcodeIds: string[],
  saudiIds: SaudiIdCandidate[],
  docType: DocType | null,
  layouts: Layout[],
): Candidate | null {
  if (mrz && mrz.documentNumber) {
    // ID cards (TD1/TD2) often carry the holder's personal ID number (e.g. 784... in the UAE) in the
    // optional data, while the document number is the card serial number.
    const personalId = mrz.format !== 'TD3' ? mrz.optionalData.find((o) => /^\d{10,}$/.test(o)) : undefined;
    if (personalId) {
      return {
        value: personalId,
        confidence: 'medium',
        source: 'mrz',
        note: 'رقم الهوية الشخصي من منطقة MRZ. رقم البطاقة متاح كبديل. تحقق من الرقم المطلوب',
        alternatives: [{ value: mrz.documentNumber, display: mrz.documentNumber, reason: 'رقم البطاقة' }],
      };
    }
    if (mrz.checks.documentNumber) return { value: mrz.documentNumber, confidence: 'high', source: 'mrz' };
    return {
      value: mrz.documentNumber,
      confidence: 'low',
      source: 'mrz',
      note: 'رقم المستند لم يجتز رمز التحقق في MRZ. طابقه مع المستند',
    };
  }

  if (barcodeIds.length === 1) {
    const value = barcodeIds[0]!;
    const printed = saudiIds.filter((s) => s.valid && s.value !== value);
    return {
      value,
      confidence: 'high',
      source: 'barcode',
      alternatives: printed.map((s) => ({ value: s.value, display: s.value, reason: 'رقم آخر مطبوع على المستند' })),
    };
  }

  const valid = saudiIds.filter((s) => s.valid);
  if (valid.length) {
    let pool = valid;
    const prefix = docType === 'residence' ? '2' : docType === 'national_id' ? '1' : null;
    if (valid.length > 1 && prefix) {
      const matching = valid.filter((v) => v.value.startsWith(prefix));
      if (matching.length) pool = matching;
    }
    if (pool.length === 1) return { value: pool[0]!.value, confidence: 'high', source: 'ocr' };
    return {
      value: pool[0]!.value,
      confidence: 'low',
      source: 'ocr',
      conflict: true,
      note: `وُجد أكثر من رقم هوية صالح في المستند: ${pool.map((v) => v.value).join('، ')}`,
      alternatives: pool.slice(1).map((v) => ({ value: v.value, display: v.value, reason: 'رقم آخر في المستند' })),
    };
  }

  const labeled = valuesForLabel(layouts, 'docNumber', acceptDocNumber)[0];
  if (labeled && !saudiIds.some((s) => s.value === labeled.value)) {
    return {
      value: labeled.value,
      confidence: labeled.confidence >= OCR_CONFIDENCE_THRESHOLD ? 'medium' : 'low',
      source: 'ocr',
      note: 'تحقق من الرقم مقارنة بالمستند',
    };
  }

  const invalid = saudiIds.filter((s) => !s.valid);
  if (invalid.length) {
    return {
      value: invalid[0]!.value,
      confidence: 'low',
      source: 'ocr',
      note: 'الرقم المستخرج لا يجتاز خوارزمية التحقق من رقم الهوية/الإقامة، وغالبًا أُخطئ في قراءة أحد أرقامه. طابقه مع المستند',
      alternatives: invalid.slice(1).map((v) => ({ value: v.value, display: v.value, reason: 'رقم آخر في المستند' })),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Nationality

function decideNationality(mrz: MrzResult | null, docNumber: Candidate | null, layouts: Layout[]): Candidate | null {
  const readings: { code: string; source: Candidate['source']; confidence: Confidence; reason: string }[] = [];
  const mrzCode = mrz ? countryFromMrzCode(mrz.nationality) : null;
  if (mrzCode) readings.push({ code: mrzCode, source: 'mrz', confidence: 'high', reason: 'من منطقة MRZ' });

  const idNumber = docNumber?.value ?? '';
  if (!mrz && isValidSaudiIdNumber(idNumber) && idNumber.startsWith('1')) {
    readings.push({ code: 'SA', source: 'rule', confidence: 'high', reason: 'رقم الهوية الوطنية السعودية يبدأ بالرقم 1' });
  }

  const nationalityOf = (s: string) => (findNationalityInText(s) ?? findNationalityFuzzy(s))?.code ?? null;
  for (const labeled of valuesForLabel(layouts, 'nationality', nationalityOf)) {
    readings.push({ code: labeled.value, source: 'ocr', confidence: 'medium', reason: 'من النص المطبوع على المستند' });
  }

  if (readings.length === 0) return null;
  const distinct = [...new Set(readings.map((r) => r.code))];
  const primary = readings[0]!;
  if (distinct.length > 1) {
    return {
      value: primary.code,
      confidence: 'low',
      source: primary.source,
      conflict: true,
      note: `وُجدت جنسيات مختلفة في المستند: ${distinct.map(countryName).join('، ')}`,
      alternatives: readings
        .filter((r) => r.code !== primary.code)
        .map((r) => ({ value: r.code, display: countryName(r.code), reason: r.reason })),
    };
  }
  if (isValidSaudiIdNumber(idNumber) && idNumber.startsWith('2') && primary.code === 'SA') {
    return {
      value: primary.code,
      confidence: 'low',
      source: primary.source,
      conflict: true,
      note: 'رقم الإقامة يبدأ بالرقم 2 (مقيم) بينما الجنسية المقروءة سعودية',
    };
  }
  const best = readings.find((r) => r.confidence === 'high') ?? primary;
  return {
    value: best.code,
    confidence: best.confidence,
    source: best.source,
    note: best.confidence === 'high' ? undefined : 'تحقق من الجنسية مقارنة بالمستند',
  };
}

// ---------------------------------------------------------------------------------------------
// Birth date

interface DatedEntry {
  date: FoundDate;
  kind: 'birth' | 'other' | 'unknown';
  lineConfidence: number;
}

function collectDates(layouts: Layout[], now: Date): DatedEntry[] {
  const out: DatedEntry[] = [];
  for (const layout of layouts) {
    layout.rows.forEach((row, r) => {
      row.cells.forEach((cell, c) => {
        for (const date of findDates(cell.text, now)) {
          let group = labelFor(layout, r, c, date.index);
          if (!group) {
            // A label printed after the value in the same cell («12/05/1990 تاريخ الميلاد»).
            const groups = new Set(findLabels(cell.text).map((h) => h.group));
            if (groups.size === 1) group = [...groups][0]!;
          }
          const kind: DatedEntry['kind'] = group === 'birth' ? 'birth' : group ? 'other' : 'unknown';
          out.push({ date, kind, lineConfidence: cell.confidence });
        }
      });
    });
  }
  return out;
}

const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
const unique = <T,>(xs: T[]) => [...new Set(xs)];

interface BirthDecision {
  candidate: Candidate | null;
  labeled: boolean;
  warnings: string[];
}

function decideVisualBirthDate(entries: DatedEntry[], now: Date): BirthDecision {
  const today = todayIso(now);
  const plausible = (iso: string) => iso <= today && ageOn(iso, now) <= 120;
  const labeled = entries.filter((e) => e.kind === 'birth');
  const warnings: string[] = [];

  for (const e of labeled) {
    if (e.date.calendar === 'hijri' && !e.date.iso) {
      warnings.push(`تعذر تحويل تاريخ الميلاد الهجري (${e.date.raw}) إلى التاريخ الميلادي. يرجى إدخاله يدويًا`);
    }
  }

  if (labeled.length === 0) {
    const pool = entries
      .filter((e) => e.kind === 'unknown' && e.date.iso && plausible(e.date.iso) && ageOn(e.date.iso, now) >= 1)
      .sort((a, b) => a.date.iso!.localeCompare(b.date.iso!));
    const pick = pool[0];
    if (!pick) return { candidate: null, labeled: false, warnings };
    return {
      candidate: {
        value: pick.date.iso!,
        confidence: 'low',
        source: 'ocr',
        note: `لم يُعثر على عنوان "تاريخ الميلاد"؛ تم اختيار أقدم تاريخ في المستند (${pick.date.raw}). تحقق منه`,
      },
      labeled: false,
      warnings,
    };
  }

  const gregorian = labeled.filter((e) => e.date.calendar === 'gregorian');
  const hijri = labeled.filter((e) => e.date.calendar === 'hijri' && e.date.iso);
  const gregIsos = unique(gregorian.map((e) => e.date.iso!));
  const hijriIsos = unique(hijri.map((e) => e.date.iso!));

  if (gregIsos.length > 1 || (gregIsos.length === 0 && hijriIsos.length > 1)) {
    const values = gregIsos.length ? gregIsos : hijriIsos;
    return {
      candidate: {
        value: values[0]!,
        confidence: 'low',
        source: 'ocr',
        conflict: true,
        note: `وُجدت تواريخ ميلاد مختلفة في المستند: ${values.join('، ')}`,
        alternatives: values.slice(1).map((v) => ({ value: v, display: v, reason: 'تاريخ آخر في المستند' })),
      },
      labeled: true,
      warnings,
    };
  }

  if (gregIsos.length === 1) {
    const value = gregIsos[0]!;
    const entry = gregorian[0]!;
    if (hijriIsos.length) {
      if (hijriIsos.some((h) => daysBetween(h, value) <= 1)) {
        return { candidate: { value, confidence: 'high', source: 'ocr' }, labeled: true, warnings };
      }
      return {
        candidate: {
          value,
          confidence: 'low',
          source: 'ocr',
          conflict: true,
          note: `التاريخ الميلادي المطبوع (${entry.date.raw}) لا يطابق التاريخ الهجري المطبوع (${hijri[0]!.date.raw})`,
          alternatives: [{ value: hijriIsos[0]!, display: hijriIsos[0]!, reason: 'محوّل من التاريخ الهجري' }],
        },
        labeled: true,
        warnings,
      };
    }
    if (entry.date.reconstructed) {
      return {
        candidate: {
          value,
          confidence: 'low',
          source: 'ocr',
          note: `قُرئ التاريخ ناقص الأصفار (${entry.date.raw}) فأُكمل حسب صيغة التاريخ. طابقه مع المستند`,
        },
        labeled: true,
        warnings,
      };
    }
    if (entry.date.ambiguous) {
      return {
        candidate: {
          value,
          confidence: 'low',
          source: 'ocr',
          note: `قد يكون اليوم والشهر معكوسين في التاريخ المطبوع (${entry.date.raw}). تم اعتماد ترتيب يوم/شهر/سنة`,
        },
        labeled: true,
        warnings,
      };
    }
    if (entry.date.monthFirst) {
      return {
        candidate: { value, confidence: 'low', source: 'ocr', note: `التاريخ مطبوع بترتيب شهر/يوم/سنة (${entry.date.raw}). تحقق منه` },
        labeled: true,
        warnings,
      };
    }
    const confident = entry.lineConfidence >= OCR_CONFIDENCE_THRESHOLD;
    return {
      candidate: { value, confidence: confident ? 'high' : 'medium', source: 'ocr', note: confident ? undefined : 'تحقق من التاريخ مقارنة بالمستند' },
      labeled: true,
      warnings,
    };
  }

  if (hijriIsos.length === 1) {
    const h = hijri[0]!.date.hijri!;
    return {
      candidate: {
        value: hijriIsos[0]!,
        confidence: 'medium',
        source: 'ocr',
        note: `تم التحويل من التاريخ الهجري المطبوع (${formatHijriArabic(h)}) وفق تقويم أم القرى. تحقق منه`,
      },
      labeled: true,
      warnings,
    };
  }
  return { candidate: null, labeled: true, warnings };
}

function decideBirthDate(mrz: MrzResult | null, visual: BirthDecision): Candidate | null {
  const viz = visual.candidate;
  if (!mrz?.birthDate) return viz;
  const mrzDate = mrz.birthDate;
  if (mrz.checks.birthDate) {
    if (viz && visual.labeled && !viz.conflict && viz.value !== mrzDate) {
      return {
        value: mrzDate,
        confidence: 'low',
        source: 'mrz',
        conflict: true,
        note: `تاريخ الميلاد في MRZ (${mrzDate}) يختلف عن التاريخ المطبوع (${viz.value})`,
        alternatives: [{ value: viz.value, display: viz.value, reason: 'التاريخ المطبوع في المستند' }],
      };
    }
    return { value: mrzDate, confidence: 'high', source: 'mrz' };
  }
  if (viz && viz.value === mrzDate) return { value: mrzDate, confidence: 'high', source: 'mrz' };
  return {
    value: mrzDate,
    confidence: 'low',
    source: 'mrz',
    note: 'تاريخ الميلاد لم يجتز رمز التحقق في MRZ. طابقه مع المستند',
    alternatives: viz ? [{ value: viz.value, display: viz.value, reason: 'التاريخ المطبوع في المستند' }] : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Gender

function gendersFromText(cells: Cell[]): Set<Gender> {
  const found = new Set<Gender>();
  for (const cell of cells) {
    const folded = foldSameLength(cell.text);
    const tokens = folded.split(/[^a-zء-ي]+/).filter(Boolean);
    if (tokens.includes('ذكر') || tokens.includes('male')) found.add('male');
    if (tokens.includes('انثي') || tokens.includes('female')) found.add('female');
    for (const hit of findLabels(cell.text, ['sex'])) {
      const next = folded.slice(hit.end).split(/[^a-zء-ي]+/).filter(Boolean)[0];
      if (next === 'm') found.add('male');
      if (next === 'f') found.add('female');
    }
  }
  return found;
}

function decideGender(
  mrz: MrzResult | null,
  mrzReliable: boolean,
  cells: Cell[],
  arabicName: { value: string; anchored: boolean } | null,
): Candidate | null {
  const fromText = gendersFromText(cells);
  const fromMrz: Gender | null = mrz?.sex === 'M' ? 'male' : mrz?.sex === 'F' ? 'female' : null;
  const all = new Set<Gender>([...fromText, ...(fromMrz ? [fromMrz] : [])]);
  if (all.size > 1) {
    return {
      value: fromMrz ?? [...fromText][0]!,
      confidence: 'low',
      source: fromMrz ? 'mrz' : 'ocr',
      conflict: true,
      note: 'وُجدت قيم متعارضة للجنس في المستند',
    };
  }
  if (fromMrz) return { value: fromMrz, confidence: mrzReliable || fromText.size ? 'high' : 'medium', source: 'mrz' };
  if (fromText.size) return { value: [...fromText][0]!, confidence: 'medium', source: 'ocr', note: 'تحقق من الجنس مقارنة بالمستند' };

  // Not stated on the document (e.g. Saudi national ID): suggest from the Arabic name. The weak
  // «ends with ة» rule is only used for a name anchored to its label or to the English name.
  const guess = arabicName ? genderFromArabicName(arabicName.value, { endingRule: arabicName.anchored }) : null;
  if (!guess) return null;
  return {
    value: guess.gender,
    confidence: 'low',
    source: 'rule',
    note: `مقترح من الاسم (${guess.reason}) لأن المستند لا يذكر الجنس. تأكد منه`,
  };
}

// ---------------------------------------------------------------------------------------------

/** MRZ whose check digits mostly pass: document number, birth date, expiry and composite. */
export function isMrzReliable(mrz: MrzResult): boolean {
  return passedCheckCount(mrz) >= 3 && mrz.checks.birthDate;
}

export function chooseMrz(latin: OcrPage, mrzPass: OcrPage | null | undefined, now = new Date()): MrzResult | null {
  const fromPass = mrzPass ? findMrz(mrzPass.lines.map((l) => l.text), now) : null;
  const fromLatin = findMrz(latin.lines.map((l) => l.text), now);
  if (fromPass && fromLatin) return passedCheckCount(fromLatin) > passedCheckCount(fromPass) ? fromLatin : fromPass;
  return fromPass ?? fromLatin;
}

/** Lines of a page that look like MRZ lines (used to crop the MRZ for a second, restricted pass). */
export function mrzLikeLines(page: OcrPage): OcrLine[] {
  return page.lines.filter((l) => looksLikeMrzLine(cleanMrzLine(l.text)));
}

/**
 * The Arabic pass is slow, so it is skipped for passports whose MRZ is reliable and whose
 * nationality does not normally print the name in Arabic.
 */
export function shouldRunArabicPass(mrz: MrzResult | null): boolean {
  if (!mrz || !isMrzReliable(mrz) || mrz.format !== 'TD3') return true;
  return ARABIC_NAME_NATIONALITIES.includes(countryFromMrzCode(mrz.nationality) ?? '');
}

export function extractFields(input: ExtractionInput): ExtractionResult {
  const now = input.now ?? new Date();
  const latin = buildLayout(input.latin.lines, 'ltr');
  // The Arabic model turns Latin text and background patterns into low-confidence garbage words.
  const arabic = input.arabic ? buildLayout(input.arabic.lines, 'rtl', { trimConfidence: 40 }) : null;
  const layouts = arabic ? [latin, arabic] : [latin];
  const allCells = layouts.flatMap(cellsOf);
  const fullText = allCells.map((c) => c.text).join('\n');
  const warnings: string[] = [];

  const mrz = chooseMrz(input.latin, input.mrz, now);
  const mrzReliable = mrz ? isMrzReliable(mrz) : false;
  const barcodeIds = mrz ? [] : barcodeIdNumbers(input.barcodes ?? []);
  const saudiIds = mrz ? [] : holderIdNumbers(layouts);
  const allIds = [...new Set([...barcodeIds, ...saudiIds.filter((s) => s.valid).map((s) => s.value)])].map((value) => ({ value, valid: true }));

  const docType = decideDocType(mrz, mrzReliable, allIds, docTypeFromKeywords(foldSameLength(fullText)));
  const docNumber = decideDocNumber(mrz, barcodeIds, saudiIds, (docType?.value as DocType | undefined) ?? null, layouts);
  const nationality = decideNationality(mrz, docNumber, layouts);
  const names = decideName(mrz, mrzReliable, latin, arabic);
  const fullName = names.candidate;
  const visualBirth = decideVisualBirthDate(collectDates(layouts, now), now);
  warnings.push(...visualBirth.warnings);
  const birthDate = decideBirthDate(mrz, visualBirth);
  const gender = decideGender(mrz, mrzReliable, allCells, names.arabic);

  const meanConfidence = Math.max(input.latin.confidence, input.arabic?.confidence ?? 0);
  if (mrz && !mrzReliable) {
    warnings.push('تعذر التحقق من جميع رموز التحقق في منطقة MRZ، لذلك قد تحتوي بعض الحقول على أخطاء قراءة');
  }

  const fields: ExtractionResult['fields'] = {};
  if (docType) fields.docType = docType;
  if (fullName) fields.fullName = fullName;
  if (docNumber) fields.docNumber = docNumber;
  if (nationality) fields.nationality = nationality;
  if (birthDate) fields.birthDate = birthDate;
  if (gender) fields.gender = gender;

  return {
    fields,
    warnings,
    stats: { meanConfidence, mrz: mrz ? (mrzReliable ? 'valid' : 'partial') : 'none' },
  };
}
