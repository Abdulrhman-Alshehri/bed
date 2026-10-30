import { CircleCheck } from 'lucide-react';
import { countryName } from '../data/countries';

interface Props {
  id: string;
  text: string;
  /** ISO code matched from the text ('' when the text matches no country). */
  code: string;
  onChange: (text: string) => void;
  aria: { 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean };
}

/**
 * Free-text nationality (no drop-down list). The text is matched to the standard country list in
 * the background, so visitor type and calling code still follow the rules.
 */
export function NationalityInput({ id, text, code, onChange, aria }: Props) {
  const name = countryName(code);
  return (
    <>
      <input
        id={id}
        type="text"
        dir="auto"
        autoComplete="off"
        spellCheck={false}
        placeholder="مثال: مصر، باكستاني، INDIA"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        {...aria}
      />
      {code && name && name !== text.trim() && (
        <p className="field-readout field-readout--match">
          <CircleCheck aria-hidden="true" size={14} /> تم التعرف عليها: {name}
        </p>
      )}
    </>
  );
}
