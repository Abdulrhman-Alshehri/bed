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
import { FieldShell, inputId } from './FieldShell';
import { NationalityCombobox } from './NationalityCombobox';
import { PhoneField } from './PhoneField';

interface Props {
  state: FormState;
  dispatch: Dispatch<FormAction>;
  issues: Issue[];
  /** Fields whose validation messages are visible. */
  visibleFields: ReadonlySet<FieldKey>;
  onFieldBlur: (field: FieldKey) => void;
}

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));

export function RegistrationForm({ state, dispatch, issues, visibleFields, onFieldBlur }: Props) {
  const v = state.values;
  const edit = (field: EditableField) => (value: string) => dispatch({ type: 'edit', field, value });

  const shell = (field: FieldKey, hasValue: boolean, render: Parameters<typeof FieldShell>[0]['children'], extra?: { hint?: string; wide?: boolean }) => (
    <FieldShell
      key={field}
      field={field}
      meta={state.meta[field]}
      issues={visibleFields.has(field) ? issues.filter((i) => i.field === field) : []}
      required={REQUIRED_FIELDS.includes(field)}
      hasValue={hasValue}
      hint={extra?.hint}
      wide={extra?.wide}
      onApplySuggestion={(index) => dispatch({ type: 'applySuggestion', field, index })}
      onDismissSuggestion={(index) => dispatch({ type: 'dismissSuggestion', field, index })}
      onAcknowledge={() => dispatch({ type: 'acknowledgeFlag', field })}
      onBlur={() => onFieldBlur(field)}
    >
      {render}
    </FieldShell>
  );

  const fields: Record<FieldKey, () => ReactElement> = {
    docType: () =>
      shell('docType', !!v.docType, (aria) => (
        <select id={inputId('docType')} value={v.docType} onChange={(e) => edit('docType')(e.target.value)} {...aria}>
          <option value="">اختر نوع الهوية</option>
          {options(DOC_TYPE_LABELS)}
        </select>
      )),
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
    visitorType: () =>
      shell(
        'visitorType',
        !!v.visitorType,
        (aria) => (
          <select id={inputId('visitorType')} value={v.visitorType} onChange={(e) => edit('visitorType')(e.target.value)} {...aria}>
            <option value="">يُحدَّد حسب الجنسية</option>
            {options(VISITOR_TYPE_LABELS)}
          </select>
        ),
        { hint: 'خليجي لمواطني دول مجلس التعاون، ودولي لغيرهم' },
      ),
    visitType: () =>
      shell('visitType', !!v.visitType, (aria) => (
        <select id={inputId('visitType')} value={v.visitType} onChange={(e) => edit('visitType')(e.target.value)} {...aria}>
          {options(VISIT_TYPE_LABELS)}
        </select>
      )),
    nationality: () =>
      shell('nationality', !!v.nationality, (aria) => (
        <NationalityCombobox id={inputId('nationality')} value={v.nationality} onChange={edit('nationality')} aria={aria} />
      )),
    birthDate: () =>
      shell('birthDate', !!v.birthDate, (aria) => (
        <BirthDateField id={inputId('birthDate')} value={v.birthDate} onChange={edit('birthDate')} aria={aria} />
      )),
    phone: () =>
      shell('phone', !!v.phoneNumber, (aria) => (
        <PhoneField
          id={inputId('phone')}
          country={v.phoneCountry}
          number={v.phoneNumber}
          nationality={v.nationality}
          docType={v.docType}
          onCountryChange={(country) => dispatch({ type: 'editPhone', country })}
          onNumberChange={(number) => dispatch({ type: 'editPhone', number })}
          aria={aria}
        />
      )),
    luggageCenter: () =>
      shell('luggageCenter', !!v.luggageCenter, (aria) => (
        <select id={inputId('luggageCenter')} value={v.luggageCenter} onChange={(e) => edit('luggageCenter')(e.target.value)} {...aria}>
          {options(LUGGAGE_CENTER_LABELS)}
        </select>
      )),
    gender: () =>
      shell('gender', !!v.gender, (aria) => (
        <select id={inputId('gender')} value={v.gender} onChange={(e) => edit('gender')(e.target.value)} {...aria}>
          <option value="">غير محدد</option>
          {options(GENDER_LABELS)}
        </select>
      )),
  };

  return (
    <form className="form-grid" noValidate autoComplete="off" onSubmit={(e) => e.preventDefault()}>
      {FIELD_ORDER.map((field) => fields[field]())}
    </form>
  );
}
