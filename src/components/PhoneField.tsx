import { checkPhone, countriesForDialCode, normalizeDialCode } from '../domain/phone';

interface Props {
  id: string;
  dialCode: string;
  number: string;
  onDialCodeChange: (dial: string) => void;
  onNumberChange: (number: string) => void;
  aria: { 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean };
}

/** Calling code typed as text (no drop-down list) and the mobile number. */
export function PhoneField({ id, dialCode, number, onDialCodeChange, onNumberChange, aria }: Props) {
  const check = number ? checkPhone(dialCode, number) : null;
  const countries = countriesForDialCode(dialCode);
  return (
    <>
      <div className="phone-row" dir="ltr">
        <span className="phone-code">
          <span className="phone-plus" aria-hidden="true">
            +
          </span>
          <input
            id={`${id}-code`}
            type="text"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            aria-label="رمز الدولة"
            maxLength={4}
            value={dialCode}
            onChange={(e) => onDialCodeChange(normalizeDialCode(e.target.value))}
          />
        </span>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          dir="ltr"
          autoComplete="off"
          placeholder={dialCode === '966' ? '5XXXXXXXX' : 'رقم الجوال'}
          value={number}
          onChange={(e) => onNumberChange(e.target.value)}
          {...aria}
        />
      </div>
      <p className="field-readout">
        {countries.length ? (
          <>
            رمز الدولة <bdi dir="ltr">+{dialCode}</bdi>: {countries.slice(0, 2).join('، ')}
            {countries.length > 2 ? ' وغيرها' : ''}
          </>
        ) : (
          'اكتب رمز الدولة بالأرقام، مثل 966'
        )}
        {check?.ok && (
          <>
            {' · '}يُحفظ بالصيغة الدولية: <bdi dir="ltr">{check.international}</bdi>
          </>
        )}
      </p>
    </>
  );
}
