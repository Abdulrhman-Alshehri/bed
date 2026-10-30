import { CircleAlert, CircleCheckBig, ClipboardCheck, Copy, Download, Pencil, TriangleAlert, UserRound } from 'lucide-react';
import { buildExportCells, type ExportCell } from '../domain/export';
import { isFormEmpty } from '../domain/formState';
import { FIELD_LABELS, LUGGAGE_SIZE_LABELS, MESSAGES } from '../domain/labels';
import type { FormState } from '../domain/types';
import type { Issue, IssueField } from '../domain/validation';

interface Props {
  state: FormState;
  issues: Issue[];
  onConfirm: () => void;
  onEdit: (field: IssueField) => void;
  onCopy: () => void;
  onExport: () => void;
  onNewVisitor: () => void;
}

export const ISSUE_LABELS: Record<IssueField, string> = { ...FIELD_LABELS, luggage: 'عدد الأمتعة', luggageSize: 'حجم الأمتعة' };

/** The validation field an export cell belongs to (luggage cells map to the luggage step). */
const issueFieldOf = (cell: ExportCell): IssueField =>
  cell.field.startsWith('luggage.') || cell.field === 'luggageTotal' ? 'luggage' : (cell.field as IssueField);

/** Step 3: everything on one page, issues to fix, confirmation, then copy/export. */
export function ReviewStep({ state, issues, onConfirm, onEdit, onCopy, onExport, onNewVisitor }: Props) {
  const empty = isFormEmpty(state.values);
  const cells = buildExportCells(state.values);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const withError = new Set(errors.map((i) => i.field));
  const withWarning = new Set(warnings.map((i) => i.field));
  const canConfirm = !empty && errors.length === 0;

  const table = (title: string, rows: ExportCell[]) => (
    <section className="review-section">
      <h3>{title}</h3>
      <table className="review-table">
        <tbody>
          {rows.map((c) => {
            const field = issueFieldOf(c);
            return (
              <tr key={c.field} className={withError.has(field) ? 'has-error' : withWarning.has(field) ? 'has-warning' : ''}>
                <th scope="row">{c.header}</th>
                <td>
                  {c.field === 'luggageSize' && size ? (
                    // The size code is LTR («S+»): kept in its own isolate so RTL does not show «+S».
                    <>
                      <bdi>{LUGGAGE_SIZE_LABELS[size]}</bdi> <bdi dir="ltr">({size})</bdi>
                    </>
                  ) : c.value ? (
                    <bdi>{c.value}</bdi>
                  ) : (
                    <span className="muted">—</span>
                  )}
                  {withError.has(field) && <CircleAlert aria-label="خطأ" size={16} className="icon-error" />}
                  {!withError.has(field) && withWarning.has(field) && <TriangleAlert aria-label="تنبيه" size={16} className="icon-warning" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );

  const issueList = (list: Issue[]) => (
    <ul>
      {list.map((issue) => (
        <li key={`${issue.field}-${issue.message}`}>
          <button type="button" className="btn-link" onClick={() => onEdit(issue.field)}>
            {ISSUE_LABELS[issue.field]}
          </button>
          : {issue.message}
        </li>
      ))}
    </ul>
  );

  const isLuggageCell = (c: ExportCell) => c.field.startsWith('luggage.') || c.field === 'luggageTotal' || c.field === 'luggageSize';
  const luggageRows = cells.filter((c) => isLuggageCell(c) && !(c.field.startsWith('luggage.') && c.value === '0'));
  const visitorRows = cells.filter((c) => !isLuggageCell(c));
  const size = state.values.luggageSize;

  return (
    <div className="review">
      {state.confirmed ? (
        <div className="confirmed" role="status">
          <CircleCheckBig aria-hidden="true" size={28} />
          <div>
            <p className="confirmed-title">تم تأكيد البيانات</p>
            <p>انسخ البيانات أو صدّرها، ثم ابدأ تسجيل زائر جديد. لا يُحفظ شيء في هذا النموذج الأولي.</p>
          </div>
        </div>
      ) : (
        <p className="field-hint">قارن كل قيمة بالمستند الأصلي وبالأمتعة. نتائج التعرف الضوئي قد تحتوي على أخطاء.</p>
      )}

      {empty ? (
        <p className="alert alert--error" role="alert">
          {MESSAGES.emptyForm}
        </p>
      ) : (
        <div className="review-tables">
          {table('الأمتعة', luggageRows)}
          {table('بيانات الزائر', visitorRows)}
        </div>
      )}

      {!state.confirmed && !empty && errors.length > 0 && (
        <section className="issues issues--error" aria-labelledby="review-errors">
          <h3 id="review-errors">يجب تصحيح ما يلي قبل التأكيد</h3>
          {issueList(errors)}
        </section>
      )}
      {!state.confirmed && !empty && warnings.length > 0 && (
        <section className="issues issues--warning" aria-labelledby="review-warnings">
          <h3 id="review-warnings">تنبيهات للمراجعة (لا تمنع التأكيد)</h3>
          {issueList(warnings)}
        </section>
      )}

      <div className="step-actions">
        {state.confirmed ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onCopy}>
              <Copy aria-hidden="true" size={18} />
              نسخ البيانات
            </button>
            <button type="button" className="btn btn-primary" onClick={onExport}>
              <Download aria-hidden="true" size={18} />
              تصدير البيانات
            </button>
            <button type="button" className="btn btn-secondary" onClick={onNewVisitor}>
              <UserRound aria-hidden="true" size={18} />
              زائر جديد
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onEdit('docType')}>
              <Pencil aria-hidden="true" size={18} />
              تعديل البيانات
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" disabled={!canConfirm} onClick={onConfirm}>
            <ClipboardCheck aria-hidden="true" size={20} />
            أؤكد صحة البيانات
          </button>
        )}
      </div>
    </div>
  );
}
