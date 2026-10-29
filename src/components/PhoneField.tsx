import { useMemo } from 'react';
import { COUNTRIES, getCountry } from '../data/countries';
import { suggestCallingCountry } from '../domain/classification';
import { checkPhone } from '../domain/phone';
import type { DocType } from '../domain/types';

interface Props {
  id: string;
  country: string;
  number: string;
  nationality: string;
  docType: DocType | '';
  onCountryChange: (country: string) => void;
  onNumberChange: (number: string) => void;
  aria: { 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean };
}

const WITH_DIAL = COUNTRIES.filter((c) => c.dial);
const optionLabel = (code: string) => {
  const c = getCountry(code);
  return c ? `+${c.dial} ${c.ar}` : code;
};

/** Calling-code selector (suggested codes first) and mobile number. */
export function PhoneField({ id, country, number, nationality, docType, onCountryChange, onNumberChange, aria }: Props) {
  const preferred = useMemo(() => suggestCallingCountry(nationality, docType).preferred, [nationality, docType]);
  const check = number ? checkPhone(country, number) : null;

  return (
    <>
      <div className="phone-row" dir="ltr">
        <select
          className="phone-code"
          aria-label="رمز الدولة"
          value={country}
          onChange={(e) => onCountryChange(e.target.value)}
        >
          <optgroup label="مقترح">
            {preferred.map((code) => (
              <option key={`p-${code}`} value={code}>
                {optionLabel(code)}
              </option>
            ))}
          </optgroup>
          <optgroup label="جميع الدول">
            {WITH_DIAL.map((c) => (
              <option key={c.code} value={c.code}>
                {optionLabel(c.code)}
              </option>
            ))}
          </optgroup>
        </select>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          dir="ltr"
          autoComplete="off"
          placeholder={country === 'SA' ? '5XXXXXXXX' : 'رقم الجوال'}
          value={number}
          onChange={(e) => onNumberChange(e.target.value)}
          {...aria}
        />
      </div>
      {check?.ok && (
        <p className="field-readout">
          يُحفظ بالصيغة الدولية: <bdi dir="ltr">{check.international}</bdi>
        </p>
      )}
    </>
  );
}
