// Form state and business rules. Pure functions: no DOM, no storage, no network.
import { DEFAULT_LUGGAGE_CENTER, DEFAULT_PHONE_COUNTRY, DEFAULT_VISIT_TYPE } from '../config/rules';
import type { Candidate, ExtractionResult } from '../extraction/result';
import { classifyVisitor, suggestCallingCountry } from './classification';
import { displayValue } from './display';
import { FIELD_LABELS, MESSAGES, VISITOR_TYPE_LABELS } from './labels';
import type { ExtractableKey, FieldKey, FieldMeta, Flag, FormState, FormValues, Suggestion, ValueSource } from './types';

const EXTRACTABLE: ExtractableKey[] = ['docType', 'fullName', 'docNumber', 'nationality', 'birthDate', 'gender'];

const meta = (source: ValueSource = 'empty'): FieldMeta => ({ source, flag: null, suggestions: [] });

export function createInitialState(): FormState {
  return {
    values: {
      docType: '',
      fullName: '',
      docNumber: '',
      visitorType: '',
      visitType: DEFAULT_VISIT_TYPE,
      nationality: '',
      birthDate: '',
      phoneCountry: DEFAULT_PHONE_COUNTRY,
      phoneNumber: '',
      luggageCenter: DEFAULT_LUGGAGE_CENTER,
      gender: '',
    },
    meta: {
      docType: meta(),
      fullName: meta(),
      docNumber: meta(),
      visitorType: meta(),
      visitType: meta('default'),
      nationality: meta(),
      birthDate: meta(),
      phone: meta(),
      luggageCenter: meta('default'),
      gender: meta(),
    },
    phoneCountrySource: 'default',
    extracted: false,
    confirmed: false,
    notices: [],
  };
}

export type EditableField = Exclude<FieldKey, 'phone'>;

export type FormAction =
  | { type: 'edit'; field: EditableField; value: string }
  | { type: 'editPhone'; country?: string; number?: string }
  | { type: 'applyExtraction'; result: ExtractionResult }
  | { type: 'applySuggestion'; field: FieldKey; index: number }
  | { type: 'dismissSuggestion'; field: FieldKey; index: number }
  | { type: 'acknowledgeFlag'; field: FieldKey }
  | { type: 'confirm' }
  | { type: 'reset' };

function clone(state: FormState): FormState {
  const metaCopy = {} as FormState['meta'];
  for (const [k, m] of Object.entries(state.meta)) {
    metaCopy[k as FieldKey] = { ...m, suggestions: [...m.suggestions] };
  }
  return { ...state, values: { ...state.values }, meta: metaCopy, notices: [] };
}

function setValue(s: FormState, field: EditableField, value: string) {
  (s.values as unknown as Record<EditableField, string>)[field] = value;
}

function getValue(s: FormState, field: EditableField): string {
  return (s.values as unknown as Record<EditableField, string>)[field];
}

/** Any edit invalidates a previous confirmation (export requires confirming the current data). */
function afterEdit(next: FormState, prev: FormState): FormState {
  next.confirmed = false;
  if (prev.confirmed) next.notices = [MESSAGES.confirmationReset];
  return next;
}

function uniqueSuggestions(list: Suggestion[], current: string): Suggestion[] {
  const seen = new Set<string>([current]);
  return list.filter((s) => (seen.has(s.value) ? false : (seen.add(s.value), true)));
}

/**
 * BR-05 / BR-13: visitor type follows nationality unless the user overrode it; the calling code
 * follows nationality (and document type) unless the user chose one or already typed a number.
 * Rule results that are not applied are offered as suggestions instead.
 */
function applyDerivedRules(s: FormState) {
  const rule = classifyVisitor(s.values.nationality);
  if (s.meta.visitorType.source !== 'user') {
    s.values.visitorType = rule;
    s.meta.visitorType = meta(rule ? 'rule' : 'empty');
  } else {
    s.meta.visitorType.suggestions =
      rule && rule !== s.values.visitorType
        ? [{ value: rule, display: VISITOR_TYPE_LABELS[rule], reason: 'حسب قاعدة التصنيف للجنسية المختارة' }]
        : [];
  }

  const { selected } = suggestCallingCountry(s.values.nationality, s.values.docType);
  const codeIsFree = s.phoneCountrySource !== 'user' && s.values.phoneNumber === '';
  if (codeIsFree) {
    s.values.phoneCountry = selected;
    s.phoneCountrySource = s.values.nationality ? 'rule' : 'default';
    s.meta.phone.suggestions = [];
  } else {
    s.meta.phone.suggestions =
      selected !== s.values.phoneCountry
        ? [{ value: selected, display: displayValue('phone', selected), reason: 'رمز الدولة المقترح حسب الجنسية' }]
        : [];
  }
}

function flagFor(candidate: Candidate): Flag | null {
  if (candidate.conflict) return { level: 'conflict', message: candidate.note ?? 'وُجدت قيم متعارضة في المستند' };
  if (candidate.confidence !== 'high') return { level: 'review', message: candidate.note ?? 'قيمة غير مؤكدة، يرجى التحقق منها' };
  return null;
}

function missingFlag(field: ExtractableKey): Flag {
  return {
    level: 'review',
    message:
      field === 'gender'
        ? 'لم يُذكر الجنس بوضوح في المستند. اختره يدويًا فقط إذا كان معروفًا'
        : 'لم يتم استخراج هذه المعلومة من المستند. يرجى إدخالها يدويًا',
  };
}

function applyExtraction(state: FormState, result: ExtractionResult): FormState {
  const s = clone(state);
  const kept: string[] = [];
  for (const field of EXTRACTABLE) {
    const candidate = result.fields[field];
    const current = getValue(s, field);
    // BR-14: never overwrite a value the user typed; offer the new reading as a suggestion.
    if (s.meta[field].source === 'user' && current !== '') {
      if (candidate && candidate.value !== current) {
        s.meta[field].suggestions = uniqueSuggestions(
          [
            { value: candidate.value, display: displayValue(field, candidate.value), reason: 'قيمة مستخرجة من المستند' },
            ...(candidate.alternatives ?? []),
          ],
          current,
        );
        kept.push(FIELD_LABELS[field]);
      }
      continue;
    }
    if (candidate) {
      setValue(s, field, candidate.value);
      s.meta[field] = {
        source: candidate.source,
        flag: flagFor(candidate),
        suggestions: uniqueSuggestions(candidate.alternatives ?? [], candidate.value),
      };
    } else {
      // Clear values left over from a previous document instead of mixing two documents.
      setValue(s, field, '');
      s.meta[field] = { source: 'empty', flag: missingFlag(field), suggestions: [] };
    }
  }
  applyDerivedRules(s);
  s.extracted = true;
  s.confirmed = false;
  if (kept.length) s.notices = [`${MESSAGES.editsKept} ${kept.join('، ')}`];
  return s;
}

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'edit': {
      const s = clone(state);
      setValue(s, action.field, action.value);
      s.meta[action.field] = {
        source: action.value ? 'user' : 'empty',
        flag: null,
        suggestions: s.meta[action.field].suggestions.filter((x) => x.value !== action.value),
      };
      if (action.field === 'nationality' || action.field === 'docType') applyDerivedRules(s);
      return afterEdit(s, state);
    }
    case 'editPhone': {
      const s = clone(state);
      if (action.country !== undefined) {
        s.values.phoneCountry = action.country;
        s.phoneCountrySource = 'user';
        s.meta.phone.suggestions = s.meta.phone.suggestions.filter((x) => x.value !== action.country);
      }
      if (action.number !== undefined) {
        s.values.phoneNumber = action.number;
        s.meta.phone.source = action.number ? 'user' : 'empty';
      }
      s.meta.phone.flag = null;
      return afterEdit(s, state);
    }
    case 'applyExtraction':
      return applyExtraction(state, action.result);
    case 'applySuggestion': {
      const suggestion = state.meta[action.field].suggestions[action.index];
      if (!suggestion) return state;
      if (action.field === 'phone') return formReducer(state, { type: 'editPhone', country: suggestion.value });
      const previous = getValue(state, action.field);
      const next = formReducer(state, { type: 'edit', field: action.field, value: suggestion.value });
      // Keep the replaced value one click away (e.g. to switch back between Arabic and Latin names).
      if (previous && action.field !== 'visitorType') {
        next.meta[action.field].suggestions = uniqueSuggestions(
          [...next.meta[action.field].suggestions, { value: previous, display: displayValue(action.field, previous), reason: 'القيمة السابقة' }],
          suggestion.value,
        );
      }
      return next;
    }
    case 'dismissSuggestion': {
      const s = clone(state);
      s.meta[action.field].suggestions.splice(action.index, 1);
      s.notices = state.notices;
      return s;
    }
    case 'acknowledgeFlag': {
      const s = clone(state);
      s.meta[action.field].flag = null;
      return s;
    }
    case 'confirm': {
      const s = clone(state);
      s.confirmed = true;
      // The user attested that they reviewed every value.
      for (const m of Object.values(s.meta)) if (m.flag?.level === 'review') m.flag = null;
      return s;
    }
    case 'reset':
      return createInitialState();
  }
}

/** True when nothing beyond the defaults has been entered or extracted. */
export function isFormEmpty(values: FormValues): boolean {
  return !values.docType && !values.fullName && !values.docNumber && !values.nationality && !values.birthDate && !values.phoneNumber && !values.gender;
}
