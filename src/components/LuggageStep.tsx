import type { Dispatch } from 'react';
import { Accessibility, Baby, Backpack, Ellipsis, Luggage, Minus, Plus, ShoppingBag, type LucideIcon } from 'lucide-react';
import { totalPieces, type FormAction } from '../domain/formState';
import { LUGGAGE_KIND_LABELS, LUGGAGE_SIZE_LABELS } from '../domain/labels';
import { LUGGAGE_KINDS, LUGGAGE_SIZES, type FormValues, type LuggageKind } from '../domain/types';
import type { Issue } from '../domain/validation';
import { ChoiceGroup } from './ChoiceGroup';

const ICONS: Record<LuggageKind, LucideIcon> = {
  backpack: Backpack,
  suitcase: Luggage,
  bag: ShoppingBag,
  stroller: Baby,
  wheelchair: Accessibility,
  other: Ellipsis,
};

const SIZE_OPTIONS = LUGGAGE_SIZES.map((size) => ({ value: size, label: LUGGAGE_SIZE_LABELS[size], detail: size }));

interface Props {
  values: FormValues;
  dispatch: Dispatch<FormAction>;
  /** Luggage issues to show (after the user tried to continue). */
  issues: Issue[];
}

/** Step 1: luggage types and counts (entered by staff) and the size measured against the wall. */
export function LuggageStep({ values, dispatch, issues }: Props) {
  const total = totalPieces(values);
  const countIssue = issues.find((i) => i.field === 'luggage');
  const sizeIssue = issues.find((i) => i.field === 'luggageSize');

  return (
    <div className="luggage">
      <fieldset className={`field field--group field--wide${countIssue ? ' field--error' : ''}`}>
        <legend className="field-head">
          <span className="field-legend-text">
            نوع الأمتعة وعددها<span className="required" aria-hidden="true">*</span>
          </span>
        </legend>
        <ul className="luggage-grid">
          {LUGGAGE_KINDS.map((kind) => {
            const Icon = ICONS[kind];
            const count = values.luggage[kind];
            const label = LUGGAGE_KIND_LABELS[kind];
            return (
              <li key={kind} className={`luggage-item${count ? ' has-count' : ''}`}>
                <Icon aria-hidden="true" size={28} strokeWidth={1.6} />
                <span className="luggage-label" id={`luggage-${kind}`}>
                  {label}
                </span>
                <div className="counter" role="group" aria-labelledby={`luggage-${kind}`}>
                  <button
                    type="button"
                    className="counter-btn"
                    aria-label={`إنقاص ${label}`}
                    disabled={count === 0}
                    onClick={() => dispatch({ type: 'setLuggageCount', kind, count: count - 1 })}
                  >
                    <Minus aria-hidden="true" size={18} />
                  </button>
                  <output className="counter-value" aria-live="polite" aria-label={`عدد ${label}`}>
                    {count}
                  </output>
                  <button
                    type="button"
                    className="counter-btn"
                    id={kind === LUGGAGE_KINDS[0] ? 'field-luggage' : undefined}
                    aria-label={`زيادة ${label}`}
                    onClick={() => dispatch({ type: 'setLuggageCount', kind, count: count + 1 })}
                  >
                    <Plus aria-hidden="true" size={18} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="luggage-total" aria-live="polite">
          إجمالي القطع: <strong>{total}</strong>
        </p>
        {countIssue && <p className="field-issue field-issue--error">{countIssue.message}</p>}
      </fieldset>

      <fieldset className={`field field--group field--wide${sizeIssue ? ' field--error' : ''}`}>
        <legend className="field-head">
          <span className="field-legend-text">
            حجم الأمتعة كاملة<span className="required" aria-hidden="true">*</span>
          </span>
        </legend>
        <ChoiceGroup
          id="field-luggageSize"
          name="luggageSize"
          options={SIZE_OPTIONS}
          value={values.luggageSize}
          onChange={(size) => dispatch({ type: 'setLuggageSize', size })}
          aria={{ 'aria-describedby': 'luggage-size-hint', 'aria-invalid': !!sizeIssue || undefined, 'aria-required': true }}
        />
        <p className="field-hint" id="luggage-size-hint">
          ضع الأمتعة بجانب جدار المقاسات واختر الخط الذي تصل إليه.
        </p>
        {sizeIssue && <p className="field-issue field-issue--error">{sizeIssue.message}</p>}
      </fieldset>
    </div>
  );
}
