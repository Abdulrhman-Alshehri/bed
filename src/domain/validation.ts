import { RECOMMENDED_FIELDS, REQUIRED_FIELDS } from '../config/rules';
import { ageOn, isValidIsoDate, todayIso } from '../extraction/dates';
import { isValidSaudiIdNumber } from '../extraction/saudiId';
import { normalizeDigits } from '../extraction/text';
import { classifyVisitor } from './classification';
import { VISITOR_TYPE_LABELS } from './labels';
import { checkPhone } from './phone';
import { FIELD_ORDER, type DocType, type FieldKey, type FormState, type FormValues } from './types';

export interface Issue {
  field: FieldKey;
  /** Errors block confirmation and export; warnings do not. */
  severity: 'error' | 'warning';
  message: string;
  /** required/recommended: empty field; flag: an unresolved OCR review flag; rule: any other check. */
  kind: 'required' | 'flag' | 'rule';
}

function isEmpty(values: FormValues, field: FieldKey): boolean {
  if (field === 'phone') return !values.phoneNumber;
  return !(values as unknown as Record<string, string>)[field];
}

/** Document-number rules per document type (BR-04: the number is always handled as a string). */
export function validateDocNumber(docType: DocType | '', nationality: string, value: string): Pick<Issue, 'severity' | 'message'> | null {
  if (!/^[A-Z0-9]+$/.test(value)) {
    return { severity: 'error', message: 'يجب أن يتكون الرقم من أرقام وأحرف إنجليزية فقط' };
  }
  if (docType === 'national_id' && nationality === 'SA') {
    if (!/^1\d{9}$/.test(value)) {
      return { severity: 'error', message: 'رقم الهوية الوطنية السعودية يتكون من 10 أرقام ويبدأ بالرقم 1' };
    }
    if (!isValidSaudiIdNumber(value)) {
      return { severity: 'error', message: 'رقم الهوية غير صحيح (لا يجتاز خوارزمية التحقق). راجع الأرقام' };
    }
    return null;
  }
  if (docType === 'residence') {
    if (/^2\d{9}$/.test(value)) {
      return isValidSaudiIdNumber(value)
        ? null
        : { severity: 'error', message: 'رقم الإقامة غير صحيح (لا يجتاز خوارزمية التحقق). راجع الأرقام' };
    }
    return { severity: 'warning', message: 'رقم الإقامة السعودية يتكون عادةً من 10 أرقام ويبدأ بالرقم 2' };
  }
  if (docType === 'passport') {
    return value.length >= 5 && value.length <= 20
      ? null
      : { severity: 'error', message: 'رقم الجواز يجب أن يتكون من 5 إلى 20 حرفًا أو رقمًا' };
  }
  return value.length >= 3 && value.length <= 30
    ? null
    : { severity: 'error', message: 'رقم المستند يجب أن يتكون من 3 إلى 30 حرفًا أو رقمًا' };
}

export function validateForm(state: FormState, now = new Date()): Issue[] {
  const v = state.values;
  const issues: Issue[] = [];
  const add = (field: FieldKey, severity: Issue['severity'], message: string, kind: Issue['kind'] = 'rule') =>
    issues.push({ field, severity, message, kind });

  for (const field of REQUIRED_FIELDS) if (isEmpty(v, field)) add(field, 'error', 'هذا الحقل مطلوب', 'required');
  for (const field of RECOMMENDED_FIELDS) {
    if (isEmpty(v, field)) {
      add(field, 'warning', field === 'phone' ? 'لم يتم إدخال رقم الجوال' : 'لم يتم تحديد الجنس', 'required');
    }
  }

  if (v.fullName) {
    const name = v.fullName.trim();
    if (/\d/.test(normalizeDigits(name))) add('fullName', 'error', 'الاسم يجب ألا يحتوي على أرقام');
    else if (name.length > 120) add('fullName', 'error', 'الاسم أطول من المسموح (120 حرفًا)');
    else if (name.split(/\s+/).length < 2) add('fullName', 'warning', 'الاسم يتكون من كلمة واحدة. تأكد من اكتماله');
  }

  if (v.docNumber) {
    const issue = validateDocNumber(v.docType, v.nationality, v.docNumber);
    if (issue) add('docNumber', issue.severity, issue.message);
  }

  if (v.birthDate) {
    if (!isValidIsoDate(v.birthDate)) add('birthDate', 'error', 'التاريخ غير صالح');
    else if (v.birthDate > todayIso(now)) add('birthDate', 'error', 'تاريخ الميلاد لا يمكن أن يكون في المستقبل');
    else if (ageOn(v.birthDate, now) > 120) add('birthDate', 'error', 'تاريخ الميلاد غير منطقي (العمر أكبر من 120 سنة)');
  }

  if (v.phoneNumber) {
    const phone = checkPhone(v.phoneCountry, v.phoneNumber);
    if (!phone.ok) add('phone', 'error', phone.message);
    else if (phone.fixedLine) add('phone', 'warning', 'يبدو أن الرقم رقم هاتف ثابت وليس رقم جوال');
  }

  const rule = classifyVisitor(v.nationality);
  if (rule && v.visitorType && rule !== v.visitorType) {
    add('visitorType', 'warning', `نوع الزائر لا يطابق قاعدة التصنيف حسب الجنسية (${VISITOR_TYPE_LABELS[rule]})`);
  }

  for (const field of FIELD_ORDER) {
    const flag = state.meta[field].flag;
    if (!flag || isEmpty(v, field)) continue;
    if (flag.level === 'conflict') add(field, 'error', `يرجى حسم التعارض: ${flag.message}`, 'flag');
    else add(field, 'warning', flag.message, 'flag');
  }

  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');
