import { useEffect, useRef } from 'react';
import { CircleAlert, ClipboardCheck, TriangleAlert } from 'lucide-react';
import { buildExportCells } from '../domain/export';
import { isFormEmpty } from '../domain/formState';
import { FIELD_LABELS, MESSAGES } from '../domain/labels';
import type { FieldKey, FormState } from '../domain/types';
import type { Issue } from '../domain/validation';

interface Props {
  state: FormState;
  issues: Issue[];
  /** Why the dialog was opened, e.g. the user tried to export before confirming. */
  reason: string | null;
  onConfirm: () => void;
  onClose: () => void;
  onGoToField: (field: FieldKey) => void;
}

export function ReviewDialog({ state, issues, reason, onConfirm, onClose, onGoToField }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const empty = isFormEmpty(state.values);
  const cells = buildExportCells(state.values);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const fieldsWithError = new Set(errors.map((i) => i.field));
  const fieldsWithWarning = new Set(warnings.map((i) => i.field));
  const canConfirm = !empty && errors.length === 0;

  const issueList = (list: Issue[]) => (
    <ul>
      {list.map((issue) => (
        <li key={`${issue.field}-${issue.message}`}>
          <button type="button" className="btn-link" onClick={() => onGoToField(issue.field)}>
            {FIELD_LABELS[issue.field]}
          </button>
          : {issue.message}
        </li>
      ))}
    </ul>
  );

  return (
    <dialog ref={ref} className="dialog review-dialog" aria-labelledby="review-title" onClose={onClose} onCancel={onClose}>
      <h2 id="review-title">مراجعة البيانات</h2>
      {reason && <p className="alert alert--info">{reason}</p>}
      <p className="field-hint">قارن كل قيمة بالمستند الأصلي. نتائج التعرف الضوئي قد تحتوي على أخطاء.</p>

      {empty ? (
        <p className="alert alert--error" role="alert">
          {MESSAGES.emptyForm}
        </p>
      ) : (
        <table className="review-table">
          <tbody>
            {cells.map((c) => (
              <tr key={c.field} className={fieldsWithError.has(c.field) ? 'has-error' : fieldsWithWarning.has(c.field) ? 'has-warning' : ''}>
                <th scope="row">{c.header}</th>
                <td>
                  {c.value ? <bdi>{c.value}</bdi> : <span className="muted">—</span>}
                  {fieldsWithError.has(c.field) && <CircleAlert aria-label="خطأ" size={16} className="icon-error" />}
                  {!fieldsWithError.has(c.field) && fieldsWithWarning.has(c.field) && (
                    <TriangleAlert aria-label="تنبيه" size={16} className="icon-warning" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!empty && errors.length > 0 && (
        <section className="issues issues--error" aria-labelledby="review-errors">
          <h3 id="review-errors">يجب تصحيح ما يلي قبل التأكيد</h3>
          {issueList(errors)}
        </section>
      )}
      {!empty && warnings.length > 0 && (
        <section className="issues issues--warning" aria-labelledby="review-warnings">
          <h3 id="review-warnings">تنبيهات للمراجعة (لا تمنع التأكيد)</h3>
          {issueList(warnings)}
        </section>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" disabled={!canConfirm} onClick={onConfirm}>
          <ClipboardCheck aria-hidden="true" size={18} />
          أؤكد صحة البيانات
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          العودة للتعديل
        </button>
      </div>
    </dialog>
  );
}
