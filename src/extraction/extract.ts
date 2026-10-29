// Turns OCR output into per-field candidates. Rules, in order of reliability:
//   1. MRZ with verified check digits (passports, GCC ID cards).
//   2. Saudi ID / Iqama numbers that pass the Luhn check, and the citizen/resident prefix rule.
//   3. Values found next to printed labels ("الاسم", "Nationality", "تاريخ الميلاد", ...).
//   4. Unlabeled heuristics (always low confidence).
// Nothing is invented: a field without evidence is left out of the result.
import { ARABIC_NAME_NATIONALITIES, OCR_CONFIDENCE_THRESHOLD } from '../config/rules';
import { countryFromMrzCode, countryName } from '../data/countries';
import type { DocType, Gender, Suggestion } from '../domain/types';
import type { OcrLine, OcrPage } from '../ocr/types';
import { ageOn, findDates, formatHijriArabic, todayIso, type FoundDate } from './dates';
import { cleanMrzLine, findMrz, looksLikeMrzLine, passedCheckCount, type MrzResult } from './mrz';
import { findNationalityInText } from './nationality';
import type { Candidate, Confidence, ExtractionResult } from './result';
import { findSaudiIdNumbers, isValidSaudiIdNumber, type SaudiIdCandidate } from './saudiId';
import { cleanSpaces, countArabicLetters, countLatinLetters, foldArabic, normalizeDigits } from './text';

export interface ExtractionInput {
  /** English OCR pass over the whole document. */
  latin: OcrPage;
  /** OCR pass over the MRZ region with a restricted character set, if one was run. */
  mrz?: OcrPage | null;
  /** Arabic OCR pass over the whole document, if one was run. */
  arabic?: OcrPage | null;
  now?: Date;
}

// ---------------------------------------------------------------------------------------------
// Labels

/** Folding that keeps the string length, so label positions map back to the original text. */
function foldSameLength(s: string): string {
  return normalizeDigits(s).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

const LABELS = {
  name: ['الاسم', 'name'],
  nationality: ['الجنسية', 'nationality', 'nationalite'],
  birth: ['تاريخ الميلاد', 'الميلاد', 'تاريخ الولادة', 'date of birth', 'birth date', 'birthdate', 'birth', 'dob', 'd.o.b'],
  otherDate: ['الانتهاء', 'انتهاء', 'الإصدار', 'إصدار', 'expiry', 'expiration', 'expires', 'issue', 'issued', 'valid'],
  sex: ['الجنس', 'sex', 'gender'],
  docNumber: [
    'رقم الهوية', 'رقم الإقامة', 'السجل المدني', 'رقم السجل', 'رقم الجواز', 'رقم جواز', 'رقم البطاقة', 'الرقم المدني',
    'id no', 'id number', 'id. no', 'identity no', 'identity number', 'iqama no', 'iqama number', 'passport no',
    'passport number', 'document no', 'document number', 'civil id', 'civil no', 'card no',
  ],
};
const PARENT_NAME_LABELS = ['اسم الاب', 'اسم الام', "father", "mother", 'employer', 'sponsor', 'صاحب العمل', 'الكفيل'];
const ALL_LABELS = Object.values(LABELS).flat();

interface LabelHit {
  start: number;
  end: number;
}

function findLabels(text: string, labels: readonly string[]): LabelHit[] {
  const t = foldSameLength(text);
  const hits: LabelHit[] = [];
  for (const raw of labels) {
    const label = foldSameLength(raw);
    const latinLabel = /[a-z]$/.test(label);
    let from = 0;
    for (let idx = t.indexOf(label, from); idx !== -1; idx = t.indexOf(label, from)) {
      const before = t[idx - 1] ?? ' ';
      const after = t[idx + label.length] ?? ' ';
      const boundaryBefore = !/[a-zء-ي]/.test(before);
      const boundaryAfter = !latinLabel || !/[a-z]/.test(after);
      if (boundaryBefore && boundaryAfter) hits.push({ start: idx, end: idx + label.length });
      from = idx + 1;
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

const hasAnyLabel = (text: string) => findLabels(text, ALL_LABELS).length > 0;

interface LabeledValue<T> {
  value: T;
  confidence: number;
}

/**
 * Looks for `labels` in each line and passes the text after the label (up to the next label) to
 * `accept`. When the label stands alone, the following line is tried instead. Returns every
 * accepted value in reading order (one per label occurrence).
 */
function valuesAfterLabel<T>(
  lines: OcrLine[],
  labels: readonly string[],
  accept: (segment: string) => T | null,
  excludeLabels: readonly string[] = [],
): LabeledValue<T>[] {
  const found: LabeledValue<T>[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const hits = findLabels(line.text, labels);
    if (hits.length === 0) continue;
    if (excludeLabels.length && findLabels(line.text, excludeLabels).length) continue;
    const allHits = findLabels(line.text, ALL_LABELS);
    let accepted = false;
    for (const hit of hits) {
      const nextHit = allHits.find((h) => h.start >= hit.end);
      const segment = line.text.slice(hit.end, nextHit?.start ?? line.text.length).replace(/^[\s:：\-–|/.]+/, '');
      const value = accept(segment);
      if (value !== null) {
        found.push({ value, confidence: line.confidence });
        accepted = true;
      }
    }
    const next = lines[i + 1];
    if (!accepted && next && !hasAnyLabel(next.text)) {
      const value = accept(next.text);
      if (value !== null) found.push({ value, confidence: next.confidence });
    }
  }
  return found;
}

function valueAfterLabel<T>(
  lines: OcrLine[],
  labels: readonly string[],
  accept: (segment: string) => T | null,
  excludeLabels: readonly string[] = [],
): LabeledValue<T> | null {
  return valuesAfterLabel(lines, labels, accept, excludeLabels)[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Names

const LATIN_STOPWORDS = new Set(
  ('KINGDOM SAUDI ARABIA MINISTRY INTERIOR NATIONAL IDENTITY ID CARD RESIDENT RESIDENCE RESIDENCY PERMIT IQAMA ' +
    'PASSPORT PASSEPORT REPUBLIC STATE STATES DATE BIRTH EXPIRY EXPIRATION ISSUE ISSUING PLACE NATIONALITY SEX NAME ' +
    'NAMES SURNAME GIVEN NO NUMBER OCCUPATION PROFESSION EMPLOYER SPONSOR RELIGION TYPE CODE AUTHORITY SIGNATURE ' +
    'HOLDER GOVERNMENT VERSION VALID UNTIL OF THE MALE FEMALE UNITED EMIRATES KUWAIT QATAR BAHRAIN OMAN SULTANATE ' +
    'CIVIL PERSONAL DOCUMENT COUNTRY ADDRESS BLOOD GROUP HEIGHT NOM PRENOMS').split(' '),
);

const ARABIC_STOPWORDS = new Set(
  [
    'المملكة', 'العربية', 'السعودية', 'وزارة', 'الداخلية', 'بطاقة', 'هوية', 'الهوية', 'الوطنية', 'وطنية', 'إقامة',
    'الإقامة', 'مقيم', 'تاريخ', 'الميلاد', 'الانتهاء', 'الإصدار', 'مكان', 'رقم', 'الجنسية', 'المهنة', 'صاحب', 'العمل',
    'الديانة', 'الأحوال', 'المدنية', 'جواز', 'سفر', 'الجوازات', 'المديرية', 'العامة', 'للجوازات', 'دولة', 'جمهورية',
    'الاسم', 'الجنس', 'ذكر', 'أنثى', 'النسخة', 'السجل', 'المدني', 'حامل', 'البطاقة', 'توقيع', 'الإمارات', 'المتحدة',
    'الكويت', 'سلطنة', 'عمان', 'قطر', 'البحرين', 'مملكة', 'الحدود', 'صادرة', 'من', 'إلى', 'صالحة', 'الكفيل', 'الجواز',
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
  if (words.some((w) => ARABIC_STOPWORDS.has(foldArabic(w)))) return null;
  return words.join(' ');
}

/** Best line that looks like a name when no "Name" label was found. */
function bestUnlabeledName(lines: OcrLine[], script: 'arabic' | 'latin'): LabeledValue<string> | null {
  let best: LabeledValue<string> | null = null;
  for (const line of lines) {
    const text = line.text.trim();
    if (line.confidence < 60 || hasAnyLabel(text) || /\d/.test(normalizeDigits(text))) continue;
    const letters = text.replace(/\s/g, '').length || 1;
    if (script === 'arabic') {
      if (countArabicLetters(text) / letters < 0.85) continue;
    } else if (!/^[A-Z' -]+$/.test(text) || countLatinLetters(text) / letters < 0.85) {
      continue;
    }
    if (findNationalityInText(text)?.exact) continue; // a country name, e.g. "REPUBLIC OF INDIA"
    const value = script === 'arabic' ? acceptArabicName(text) : acceptLatinName(text);
    if (value && (!best || line.confidence > best.confidence)) best = { value, confidence: line.confidence };
  }
  return best;
}

function decideName(mrz: MrzResult | null, mrzReliable: boolean, latin: OcrLine[], arabic: OcrLine[]): Candidate | null {
  const arabicLabeled = valueAfterLabel(arabic, LABELS.name, acceptArabicName, PARENT_NAME_LABELS);
  const arabicName = arabicLabeled ?? bestUnlabeledName(arabic, 'arabic');
  const latinLabeled = valueAfterLabel(latin, LABELS.name, acceptLatinName, PARENT_NAME_LABELS);

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
    return { value: cleanSpaces(`${mrz.givenNames} ${mrz.surname}`), confidence, source: 'mrz', note, alternatives };
  }

  const latinName = latinLabeled ?? bestUnlabeledName(latin, 'latin');
  const options = [
    arabicName && { ...arabicName, labeled: !!arabicLabeled, reason: 'الاسم بالعربية كما قُرئ من المستند' },
    latinName && { ...latinName, labeled: !!latinLabeled, reason: 'الاسم بالإنجليزية كما قُرئ من المستند' },
  ].filter((o): o is NonNullable<typeof o> => !!o);
  if (options.length === 0) return null;
  // Labeled readings first; Arabic first among equally reliable readings (Arabic-first interface).
  const rank = (o: (typeof options)[number]) =>
    (o.labeled ? 2 : 0) + (o.confidence >= OCR_CONFIDENCE_THRESHOLD ? 1 : 0);
  options.sort((a, b) => rank(b) - rank(a));
  const [primary, ...rest] = options as [(typeof options)[number], ...typeof options];
  return {
    value: primary.value,
    confidence: primary.labeled && primary.confidence >= OCR_CONFIDENCE_THRESHOLD ? 'medium' : 'low',
    source: 'ocr',
    note: primary.labeled
      ? 'تحقق من الاسم مقارنة بالمستند'
      : 'لم يُعثر على عنوان "الاسم"؛ تم اختيار السطر الأرجح. تحقق منه',
    alternatives: rest.map((o) => ({ value: o.value, display: o.value, reason: o.reason })),
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

function decideDocNumber(
  mrz: MrzResult | null,
  saudiIds: SaudiIdCandidate[],
  docType: DocType | null,
  lines: OcrLine[],
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

  const labeled = valueAfterLabel(lines, LABELS.docNumber, acceptDocNumber);
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

function decideNationality(mrz: MrzResult | null, docNumber: Candidate | null, lines: OcrLine[]): Candidate | null {
  const readings: { code: string; source: Candidate['source']; confidence: Confidence; reason: string }[] = [];
  const mrzCode = mrz ? countryFromMrzCode(mrz.nationality) : null;
  if (mrzCode) readings.push({ code: mrzCode, source: 'mrz', confidence: 'high', reason: 'من منطقة MRZ' });

  const idNumber = docNumber?.value ?? '';
  if (!mrz && isValidSaudiIdNumber(idNumber) && idNumber.startsWith('1')) {
    readings.push({ code: 'SA', source: 'rule', confidence: 'high', reason: 'رقم الهوية الوطنية السعودية يبدأ بالرقم 1' });
  }

  for (const labeled of valuesAfterLabel(lines, LABELS.nationality, (s) => findNationalityInText(s)?.code ?? null)) {
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

function collectDates(lines: OcrLine[], now: Date): DatedEntry[] {
  const out: DatedEntry[] = [];
  lines.forEach((line, i) => {
    const dates = findDates(line.text, now);
    if (dates.length === 0) return;
    const birthHits = findLabels(line.text, LABELS.birth);
    const otherHits = findLabels(line.text, LABELS.otherDate);
    for (const date of dates) {
      const lastBefore = (hits: LabelHit[]) => Math.max(-1, ...hits.filter((h) => h.end <= date.index).map((h) => h.end));
      const birthPos = lastBefore(birthHits);
      const otherPos = lastBefore(otherHits);
      let kind: DatedEntry['kind'] = 'unknown';
      if (birthPos >= 0 || otherPos >= 0) kind = birthPos > otherPos ? 'birth' : 'other';
      else if (birthHits.length && !otherHits.length) kind = 'birth';
      else if (otherHits.length && !birthHits.length) kind = 'other';
      else {
        const prev = lines[i - 1];
        if (prev && findDates(prev.text, now).length === 0) {
          const prevBirth = findLabels(prev.text, LABELS.birth).length > 0;
          const prevOther = findLabels(prev.text, LABELS.otherDate).length > 0;
          if (prevBirth && !prevOther) kind = 'birth';
          else if (prevOther && !prevBirth) kind = 'other';
        }
      }
      out.push({ date, kind, lineConfidence: line.confidence });
    }
  });
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

function gendersFromText(lines: OcrLine[]): Set<Gender> {
  const found = new Set<Gender>();
  for (const line of lines) {
    const folded = foldSameLength(line.text);
    const tokens = folded.split(/[^a-zء-ي]+/).filter(Boolean);
    if (tokens.includes('ذكر') || tokens.includes('male')) found.add('male');
    if (tokens.includes('انثي') || tokens.includes('female')) found.add('female');
    for (const hit of findLabels(line.text, LABELS.sex)) {
      const next = folded.slice(hit.end).split(/[^a-zء-ي]+/).filter(Boolean)[0];
      if (next === 'm') found.add('male');
      if (next === 'f') found.add('female');
    }
  }
  return found;
}

function decideGender(mrz: MrzResult | null, mrzReliable: boolean, lines: OcrLine[]): Candidate | null {
  const fromText = gendersFromText(lines);
  const fromMrz: Gender | null = mrz?.sex === 'M' ? 'male' : mrz?.sex === 'F' ? 'female' : null;
  const all = new Set<Gender>([...fromText, ...(fromMrz ? [fromMrz] : [])]);
  if (all.size === 0) return null;
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
  return { value: [...fromText][0]!, confidence: 'medium', source: 'ocr', note: 'تحقق من الجنس مقارنة بالمستند' };
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

/**
 * The Arabic model turns Latin text and background patterns next to Arabic text into garbage words
 * with very low confidence. Trims such words from the ends of each line.
 */
function trimNoisyEdges(lines: OcrLine[], minConfidence = 40): OcrLine[] {
  return lines.flatMap((line) => {
    if (line.words.length === 0) return [line];
    let start = 0;
    let end = line.words.length;
    while (start < end && line.words[start]!.confidence < minConfidence) start++;
    while (end > start && line.words[end - 1]!.confidence < minConfidence) end--;
    if (start === end) return [];
    if (start === 0 && end === line.words.length) return [line];
    const words = line.words.slice(start, end);
    return [{ ...line, words, text: words.map((w) => w.text).join(' ') }];
  });
}

/**
 * Splits OCR lines where consecutive words are far apart. Tesseract sometimes joins text from two
 * columns of a card into one line (e.g. an Arabic name on the right and an English field on the
 * left); word spacing is a fraction of the line height while column gaps are several times it.
 */
function splitAtColumnGaps(lines: OcrLine[], gapFactor = 2.5): OcrLine[] {
  return lines.flatMap((line) => {
    if (line.words.length < 2) return [line];
    const height = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const groups: OcrLine['words'][] = [[line.words[0]!]];
    for (let i = 1; i < line.words.length; i++) {
      const prev = line.words[i - 1]!.bbox;
      const cur = line.words[i]!.bbox;
      // Works for both reading directions (Arabic words run right to left).
      const gap = Math.max(cur.x0 - prev.x1, prev.x0 - cur.x1);
      if (gap > height * gapFactor) groups.push([line.words[i]!]);
      else groups[groups.length - 1]!.push(line.words[i]!);
    }
    if (groups.length === 1) return [line];
    return groups.map((words) => ({
      text: words.map((w) => w.text).join(' '),
      confidence: words.reduce((sum, w) => sum + w.confidence, 0) / words.length,
      bbox: {
        x0: Math.min(...words.map((w) => w.bbox.x0)),
        y0: Math.min(...words.map((w) => w.bbox.y0)),
        x1: Math.max(...words.map((w) => w.bbox.x1)),
        y1: Math.max(...words.map((w) => w.bbox.y1)),
      },
      words,
    }));
  });
}

export function extractFields(input: ExtractionInput): ExtractionResult {
  const now = input.now ?? new Date();
  const latin = splitAtColumnGaps(input.latin.lines);
  const arabic = trimNoisyEdges(splitAtColumnGaps(input.arabic?.lines ?? []));
  const all = [...latin, ...arabic];
  const fullText = all.map((l) => l.text).join('\n');
  const warnings: string[] = [];

  const mrz = chooseMrz(input.latin, input.mrz, now);
  const mrzReliable = mrz ? isMrzReliable(mrz) : false;
  const saudiIds = mrz ? [] : findSaudiIdNumbers(fullText);

  const docType = decideDocType(mrz, mrzReliable, saudiIds, docTypeFromKeywords(foldSameLength(fullText)));
  const docNumber = decideDocNumber(mrz, saudiIds, (docType?.value as DocType | undefined) ?? null, all);
  const nationality = decideNationality(mrz, docNumber, all);
  const fullName = decideName(mrz, mrzReliable, latin, arabic);
  const visualBirth = decideVisualBirthDate(collectDates(all, now), now);
  warnings.push(...visualBirth.warnings);
  const birthDate = decideBirthDate(mrz, visualBirth);
  const gender = decideGender(mrz, mrzReliable, all);

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
