import { useState } from 'react';
import {
  formatGregorianArabic,
  formatHijriArabic,
  gregorianToHijri,
  hijriToGregorian,
  isHijriConversionSupported,
  isValidIsoDate,
  todayIso,
} from '../extraction/dates';
import { normalizeDigits } from '../extraction/text';

interface Props {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  aria: { 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean };
}

const HIJRI_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];

/** Gregorian date picker with an Arabic Gregorian/Hijri readout and a Hijri entry helper. */
export function BirthDateField({ id, value, onChange, aria }: Props) {
  const hijriSupported = isHijriConversionSupported();
  const hijri = value && hijriSupported ? gregorianToHijri(value) : null;
  const [h, setH] = useState({ day: '', month: '1', year: '' });
  const [hijriError, setHijriError] = useState('');

  const convert = () => {
    const iso = hijriToGregorian(Number(normalizeDigits(h.year)), Number(h.month), Number(normalizeDigits(h.day)));
    if (!iso) {
      setHijriError('التاريخ الهجري غير صحيح. تحقق من اليوم والشهر والسنة');
      return;
    }
    setHijriError('');
    onChange(iso);
  };

  return (
    <>
      <input
        id={id}
        type="date"
        dir="ltr"
        min="1900-01-01"
        max={todayIso()}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...aria}
      />
      {value && isValidIsoDate(value) && (
        <p className="field-readout">
          {formatGregorianArabic(value)} م{hijri && <> · الموافق {formatHijriArabic(hijri)}</>}
        </p>
      )}
      {hijriSupported && (
        <details className="hijri-helper">
          <summary>إدخال التاريخ بالتقويم الهجري</summary>
          <div className="hijri-inputs">
            <label>
              اليوم
              <input inputMode="numeric" maxLength={2} value={h.day} onChange={(e) => setH({ ...h, day: e.target.value })} />
            </label>
            <label>
              الشهر
              <select value={h.month} onChange={(e) => setH({ ...h, month: e.target.value })}>
                {HIJRI_MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              السنة
              <input inputMode="numeric" maxLength={4} placeholder="1410" value={h.year} onChange={(e) => setH({ ...h, year: e.target.value })} />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={convert}>
              تحويل وإدراج
            </button>
          </div>
          {hijriError && (
            <p className="field-issue field-issue--error" role="alert">
              {hijriError}
            </p>
          )}
          <p className="field-hint">يُحوَّل وفق تقويم أم القرى. قد يختلف يومًا واحدًا عن بعض التواريخ القديمة.</p>
        </details>
      )}
    </>
  );
}
