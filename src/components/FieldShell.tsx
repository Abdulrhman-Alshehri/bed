import type { ReactNode } from 'react';
import { CircleAlert, Check, TriangleAlert, X } from 'lucide-react';
import { FIELD_LABELS, SOURCE_LABELS } from '../domain/labels';
import type { FieldKey, FieldMeta } from '../domain/types';
import type { Issue } from '../domain/validation';

export const inputId = (field: FieldKey) => `field-${field}`;

interface Props {
  field: FieldKey;
  meta: FieldMeta;
  issues: Issue[];
  required: boolean;
  hasValue: boolean;
  hint?: ReactNode;
  wide?: boolean;
  /** A group of choice buttons: rendered as <fieldset> with a <legend> instead of a <label>. */
  group?: boolean;
  onApplySuggestion: (index: number) => void;
  onDismissSuggestion: (index: number) => void;
  onAcknowledge: () => void;
  onBlur: () => void;
  children: (aria: { 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean }) => ReactNode;
}

/** Label, value-source badge, OCR review flag, suggestions and validation messages around an input. */
export function FieldShell(props: Props) {
  const { field, meta, issues, required, hasValue, hint, wide, group } = props;
  const id = inputId(field);
  const flag = meta.flag;
  // The flag box is shown separately and already explains a missing extracted value.
  const shownIssues = issues.filter((i) => i.kind !== 'flag' && !(flag && i.kind === 'required'));
  const errors = shownIssues.filter((i) => i.severity === 'error');
  const warnings = shownIssues.filter((i) => i.severity === 'warning');
  const describedBy = [hint && `${id}-hint`, flag && `${id}-flag`, shownIssues.length && `${id}-issues`].filter(Boolean).join(' ') || undefined;
  const state = errors.length ? 'error' : flag?.level === 'conflict' ? 'conflict' : flag ? 'review' : warnings.length ? 'warning' : '';
  const badge = hasValue ? SOURCE_LABELS[meta.source] : '';
  const className = `field${group ? ' field--group' : ''}${wide ? ' field--wide' : ''}${state ? ` field--${state}` : ''}`;
  const labelText = (
    <>
      {FIELD_LABELS[field]}
      {required && (
        <span className="required" aria-hidden="true">
          *
        </span>
      )}
    </>
  );
  const badgeElement = badge && <span className={`badge badge--${meta.source}`}>{badge}</span>;
  const Wrapper = group ? 'fieldset' : 'div';

  return (
    <Wrapper className={className} onBlur={props.onBlur}>
      {group ? (
        <legend className="field-head" id={`${id}-label`}>
          <span className="field-legend-text">{labelText}</span>
          {badgeElement}
        </legend>
      ) : (
        <div className="field-head">
          <label htmlFor={id} id={`${id}-label`}>
            {labelText}
          </label>
          {badgeElement}
        </div>
      )}

      {props.children({
        'aria-describedby': describedBy,
        'aria-invalid': errors.length > 0 || undefined,
        'aria-required': required || undefined,
      })}

      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}

      {flag && (
        <div className={`field-flag field-flag--${flag.level}`} id={`${id}-flag`}>
          <TriangleAlert aria-hidden="true" size={16} />
          <span>
            <span className="visually-hidden">{flag.level === 'conflict' ? 'تعارض: ' : 'يحتاج مراجعة: '}</span>
            {flag.message}
          </span>
          {hasValue && (
            <button type="button" className="btn-inline" onClick={props.onAcknowledge}>
              <Check aria-hidden="true" size={14} /> القيمة صحيحة
            </button>
          )}
        </div>
      )}

      {shownIssues.length > 0 && (
        <ul className="field-issues" id={`${id}-issues`}>
          {shownIssues.map((issue) => (
            <li key={issue.message} className={`field-issue field-issue--${issue.severity}`}>
              <CircleAlert aria-hidden="true" size={14} />
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {meta.suggestions.length > 0 && (
        <ul className="suggestions" aria-label={`اقتراحات لحقل ${FIELD_LABELS[field]}`}>
          {meta.suggestions.map((s, i) => (
            <li key={`${s.value}-${i}`} className="suggestion">
              <span className="suggestion-text">
                {s.reason}: <bdi className="suggestion-value">{s.display}</bdi>
              </span>
              <span className="suggestion-actions">
                <button type="button" className="btn-inline" onClick={() => props.onApplySuggestion(i)}>
                  استخدام
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`تجاهل الاقتراح ${s.display}`}
                  onClick={() => props.onDismissSuggestion(i)}
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Wrapper>
  );
}
