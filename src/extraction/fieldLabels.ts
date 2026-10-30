// Printed field labels on identity documents, in Arabic and English.
import { normalizeDigits } from './text';

/** Folding that keeps the string length, so label positions map back to the original text. */
export function foldSameLength(s: string): string {
  return normalizeDigits(s).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

export type LabelGroup = 'name' | 'nationality' | 'birth' | 'otherDate' | 'sex' | 'docNumber' | 'employer' | 'other';

/**
 * Labels by meaning. Labels that are not extracted ('employer', 'other') still matter: they end
 * the value of the previous label, and their own values must never be taken for another field
 * (e.g. place of birth «العربية السعودية» is not the nationality).
 */
export const LABELS: Record<LabelGroup, readonly string[]> = {
  name: ['الاسم', 'name'],
  nationality: ['الجنسية', 'nationality', 'nationalite'],
  birth: ['تاريخ الميلاد', 'الميلاد', 'تاريخ الولادة', 'date of birth', 'birth date', 'birthdate', 'birth', 'dob', 'd.o.b'],
  otherDate: ['تاريخ الانتهاء', 'الانتهاء', 'انتهاء', 'تاريخ الإصدار', 'الإصدار', 'إصدار', 'expiry', 'expiration', 'expires', 'date of issue', 'issue', 'issued', 'valid'],
  sex: ['الجنس', 'sex', 'gender'],
  docNumber: [
    'رقم الهوية', 'رقم الإقامة', 'السجل المدني', 'رقم السجل', 'رقم الجواز', 'رقم جواز', 'رقم البطاقة', 'الرقم المدني',
    'id no', 'id number', 'id. no', 'identity no', 'identity number', 'iqama no', 'iqama number', 'passport no',
    'passport number', 'document no', 'document number', 'civil id', 'civil no', 'card no',
  ],
  employer: [
    'هوية صاحب العمل', 'اسم صاحب العمل', 'صاحب العمل', 'رقم صاحب العمل', 'الكفيل', 'رقم الكفيل', 'اسم الكفيل',
    'employer', "employer's name", 'employer name', 'employer id', 'sponsor', 'sponsor id', 'sponsor name',
  ],
  other: [
    'مكان الميلاد', 'محل الميلاد', 'الديانة', 'المهنة', 'مكان الإصدار', 'جهة الإصدار', 'مكان العمل', 'رقم النسخة',
    'اسم الاب', 'اسم الأب', 'اسم الام', 'اسم الأم', 'الحالة الاجتماعية', 'فصيلة الدم', 'العنوان',
    'place of birth', 'birth place', 'religion', 'occupation', 'profession', 'place of issue', 'issuing authority',
    'authority', "father's name", 'father name', "mother's name", 'mother name', 'address', 'version',
  ],
};

export interface LabelHit {
  start: number;
  end: number;
  group: LabelGroup;
}

// OCR often drops the alef of a leading «ال» («الاسم» read as «لاسم»), so that variant is accepted too.
const FOLDED = (Object.entries(LABELS) as [LabelGroup, readonly string[]][]).flatMap(([group, labels]) =>
  labels.flatMap((raw) => {
    const label = foldSameLength(raw);
    return label.startsWith('ال') ? [{ group, label }, { group, label: label.slice(1) }] : [{ group, label }];
  }),
);

/**
 * Finds labels in a piece of text. Overlapping matches resolve to the longest label, so
 * «مكان الميلاد» (place of birth) is not mistaken for «الميلاد» (birth date).
 */
export function findLabels(text: string, groups?: readonly LabelGroup[]): LabelHit[] {
  const t = foldSameLength(text);
  const raw: LabelHit[] = [];
  for (const { group, label } of FOLDED) {
    const latinLabel = /[a-z]$/.test(label);
    for (let idx = t.indexOf(label); idx !== -1; idx = t.indexOf(label, idx + 1)) {
      const before = t[idx - 1] ?? ' ';
      const after = t[idx + label.length] ?? ' ';
      const boundaryBefore = !/[a-zء-ي]/.test(before);
      const boundaryAfter = !latinLabel || !/[a-z]/.test(after);
      if (boundaryBefore && boundaryAfter) raw.push({ start: idx, end: idx + label.length, group });
    }
  }
  raw.sort((a, b) => b.end - b.start - (a.end - a.start));
  const kept: LabelHit[] = [];
  for (const hit of raw) {
    if (!kept.some((k) => hit.start < k.end && k.start < hit.end)) kept.push(hit);
  }
  return kept.filter((h) => !groups || groups.includes(h.group)).sort((a, b) => a.start - b.start);
}

export const hasAnyLabel = (text: string) => findLabels(text).length > 0;
