interface Option<T extends string> {
  value: T;
  label: string;
  /** Short secondary text (e.g. the size code on the measuring wall). */
  detail?: string;
}

interface Props<T extends string> {
  /** id of the first option (used to move focus to the field from the review step). */
  id: string;
  name: string;
  options: readonly Option<T>[];
  value: T | '';
  onChange: (value: T) => void;
  aria?: { 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean };
}

/**
 * Large tap targets instead of drop-down lists. Native radio buttons underneath, so keyboard
 * (arrow keys) and screen readers work without extra code. Must sit inside a <fieldset>.
 */
export function ChoiceGroup<T extends string>({ id, name, options, value, onChange, aria }: Props<T>) {
  return (
    <div className={`choices choices--${Math.min(options.length, 5)}`} role="radiogroup" {...aria}>
      {options.map((o, i) => (
        <label key={o.value} className={`choice${value === o.value ? ' is-checked' : ''}`}>
          <input
            type="radio"
            id={i === 0 ? id : `${id}-${o.value}`}
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span className="choice-label">{o.label}</span>
          {o.detail && (
            <span className="choice-detail" dir="ltr">
              {o.detail}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

/** Options from a label table: { value: 'label' } → [{ value, label }]. */
export const optionsFrom = <T extends string>(labels: Record<T, string>) =>
  (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
