import type { Dispatch, ReactElement } from 'react';
import { REQUIRED_FIELDS } from '../config/rules';
import type { EditableField, FormAction } from '../domain/formState';
import {
  DOC_TYPE_LABELS,
  GENDER_LABELS,
  LUGGAGE_CENTER_LABELS,
  VISIT_TYPE_LABELS,
  VISITOR_TYPE_LABELS,
} from '../domain/labels';
import { FIELD_ORDER, type FieldKey, type FormState } from '../domain/types';
import type { Issue } from '../domain/validation';
import { normalizeDocNumber } from '../extraction/text';
import { BirthDateField } from './BirthDateField';
import { ChoiceGroup, optionsFrom } from './ChoiceGroup';
import { FieldShell, inputId } from './FieldShell';
import { NationalityInput } from './NationalityInput';
import { PhoneField } from './PhoneField';

interface Props {
  state: FormState;
  dispatch: Dispatch<FormAction>;
  issues: Issue[];
  /** Fields whose validation messages are visible. */
  visibleFields: ReadonlySet<FieldKey>;
  onFieldBlur: (field: FieldKey) => void;
  /** Pictures from the document for comparison (birth date as printed). */
  evidence?: { birthDate?: string };
}

const DOC_TYPE_OPTIONS = optionsFrom(DOC_TYPE_LABELS);
const VISITOR_TYPE_OPTIONS = optionsFrom(VISITOR_TYPE_LABELS);
const VISIT_TYPE_OPTIONS = optionsFrom(VISIT_TYPE_LABELS);
const LUGGAGE_CENTER_OPTIONS = optionsFrom(LUGGAGE_CENTER_LABELS);
const GENDER_OPTIONS = optionsFrom(GENDER_LABELS);

export function RegistrationForm({ state, dispatch, issues, visibleFields, onFieldBlur, evidence }: Props) {
  const v = state.values;
  const edit = (field: EditableField) => (value: string) => dispatch({ type: 'edit', field, value });

  const shell = (
    field: FieldKey,
    hasValue: boolean,
    render: Parameters<typeof FieldShell>[0]['children'],
    extra?: { hint?: string; wide?: boolean; group?: boolean },
  ) => (
    <FieldShell
      key={field}
      field={field}
      meta={state.meta[field]}
      issues={visibleFields.has(field) ? issues.filter((i) => i.field === field) : []}
      required={REQUIRED_FIELDS.includes(field)}
      hasValue={hasValue}
      hint={extra?.hint}
      wide={extra?.wide}
      group={extra?.group}
      onApplySuggestion={(index) => dispatch({ type: 'applySuggestion', field, index })}
      onDismissSuggestion={(index) => dispatch({ type: 'dismissSuggestion', field, index })}
      onAcknowledge={() => dispatch({ type: 'acknowledgeFlag', field })}
      onBlur={() => onFieldBlur(field)}
    >
      {render}
    </FieldShell>
  );

  const choice = <T extends string>(field: EditableField, options: readonly { value: T; label: string }[], hint?: string) =>
    shell(
      field,
      !!(v as unknown as Record<string, string>)[field],
      (aria) => (
        <ChoiceGroup
          id={inputId(field)}
          name={field}
          options={options}
          value={(v as unknown as Record<string, T | ''>)[field] ?? ''}
          onChange={edit(field)}
          aria={aria}
        />
      ),
      { group: true, wide: true, hint },
    );

  const fields: Record<FieldKey, () => ReactElement> = {
    docType: () => choice('docType', DOC_TYPE_OPTIONS),
    fullName: () =>
      shell(
        'fullName',
        !!v.fullName,
        (aria) => (
          <input
            id={inputId('fullName')}
            type="text"
            dir="auto"
            autoComplete="off"
            spellCheck={false}
            value={v.fullName}
            onChange={(e) => edit('fullName')(e.target.value)}
            {...aria}
          />
        ),
        { wide: true, hint: 'يُكتب الاسم كما في المستند دون إضافة أو حذف أجزاء منه' },
      ),
    docNumber: () =>
      shell(
        'docNumber',
        !!v.docNumber,
        (aria) => (
          <input
            id={inputId('docNumber')}
            type="text"
            dir="ltr"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            value={v.docNumber}
            onChange={(e) => edit('docNumber')(normalizeDocNumber(e.target.value))}
            {...aria}
          />
        ),
        { hint: 'تُحفظ الأصفار في بداية الرقم كما هي' },
      ),
    visitorType: () => choice('visitorType', VISITOR_TYPE_OPTIONS, 'يُحدَّد تلقائيًا من الجنسية: خليجي لمواطني دول مجلس التعاون، ودولي لغيرهم'),
    visitType: () => choice('visitType', VISIT_TYPE_OPTIONS),
    nationality: () =>
      shell('nationality', !!v.nationalityText, (aria) => (
        <NationalityInput
          id={inputId('nationality')}
          text={v.nationalityText}
          code={v.nationality}
          onChange={(text) => dispatch({ type: 'editNationalityText', text })}
          aria={aria}
        />
      )),
    birthDate: () =>
      shell('birthDate', !!v.birthDate, (aria) => (
        <BirthDateField
          id={inputId('birthDate')}
          value={v.birthDate}
          onChange={edit('birthDate')}
          defaultCalendar={v.docType === 'national_id' ? 'hijri' : 'gregorian'}
          evidence={evidence?.birthDate}
          aria={aria}
        />
      )),
    phone: () =>
      shell('phone', !!v.phoneNumber, (aria) => (
        <PhoneField
          id={inputId('phone')}
          dialCode={v.phoneDialCode}
          number={v.phoneNumber}
          onDialCodeChange={(dialCode) => dispatch({ type: 'editPhone', dialCode })}
          onNumberChange={(number) => dispatch({ type: 'editPhone', number })}
          aria={aria}
        />
      )),
    luggageCenter: () => choice('luggageCenter', LUGGAGE_CENTER_OPTIONS),
    gender: () => choice('gender', GENDER_OPTIONS),
  };

  return (
    <form className="form-grid" noValidate autoComplete="off" onSubmit={(e) => e.preventDefault()}>
      {FIELD_ORDER.map((field) => fields[field]())}
    </form>
  );
}
