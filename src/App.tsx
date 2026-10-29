import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ClipboardCheck, Copy, Download, Eraser, IdCard, ScanText, X } from 'lucide-react';
import { DocumentInput } from './components/DocumentInput';
import { inputId } from './components/FieldShell';
import { OcrStatusPanel } from './components/OcrStatusPanel';
import { PrivacyNotice } from './components/PrivacyNotice';
import { RegistrationForm } from './components/RegistrationForm';
import { ReviewDialog } from './components/ReviewDialog';
import { buildExportCells, exportFileName, toClipboardText, toCsv } from './domain/export';
import { createInitialState, formReducer } from './domain/formState';
import { MESSAGES } from './domain/labels';
import { FIELD_ORDER, type FieldKey } from './domain/types';
import { hasErrors, validateForm } from './domain/validation';
import { useDocumentOcr } from './hooks/useDocumentOcr';
import { copyText, downloadTextFile } from './lib/browser';

type Message = { kind: 'success' | 'error' | 'info'; text: string };

/** Inline, polite live region (never floats over content). */
function StatusMessage({ message, onDismiss }: { message: Message | null; onDismiss: () => void }) {
  return (
    <div className="status-message" aria-live="polite">
      {message && (
        <div className={`alert alert--${message.kind}`} role={message.kind === 'error' ? 'alert' : undefined}>
          <span className="alert-text">{message.text}</span>
          <button type="button" className="btn-icon" aria-label="إغلاق الرسالة" onClick={onDismiss}>
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const [state, dispatch] = useReducer(formReducer, undefined, createInitialState);
  const ocr = useDocumentOcr();
  const [docMessage, setDocMessage] = useState<Message | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [review, setReview] = useState<{ reason: string | null } | null>(null);
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<FieldKey>>(new Set());
  const messageTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const issues = useMemo(() => validateForm(state), [state]);
  const visibleFields = useMemo<ReadonlySet<FieldKey>>(
    () => (state.extracted || reviewAttempted ? new Set(FIELD_ORDER) : touched),
    [state.extracted, reviewAttempted, touched],
  );
  const busy = ocr.status.phase === 'running';

  const show = useCallback((next: Message) => {
    clearTimeout(messageTimer.current);
    setMessage(next);
    if (next.kind === 'success') messageTimer.current = setTimeout(() => setMessage(null), 6000);
  }, []);

  // Notices produced by the form logic (kept manual edits, invalidated confirmation).
  useEffect(() => {
    if (state.notices.length) show({ kind: 'info', text: state.notices.join(' ') });
  }, [state.notices, show]);

  const onFile = async (file: File) => {
    const error = await ocr.load(file);
    setDocMessage(error ? { kind: 'error', text: error } : null);
  };

  const onExtract = async () => {
    if (!ocr.doc) {
      setDocMessage({ kind: 'error', text: MESSAGES.uploadFirst });
      return;
    }
    setDocMessage(null);
    setMessage(null);
    const result = await ocr.extract();
    if (!result) return;
    dispatch({ type: 'applyExtraction', result });
    document.getElementById('form-title')?.focus();
  };

  const focusField = (field: FieldKey) => {
    setReview(null);
    requestAnimationFrame(() => {
      const el = document.getElementById(inputId(field));
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  };

  const openReview = (reason: string | null = null) => {
    setReviewAttempted(true);
    setReview({ reason });
  };

  const onConfirm = () => {
    if (hasErrors(issues)) return;
    dispatch({ type: 'confirm' });
    setReview(null);
    show({ kind: 'success', text: MESSAGES.confirmed });
  };

  const requireConfirmed = () => {
    if (state.confirmed) return true;
    openReview(MESSAGES.confirmFirst);
    return false;
  };

  const onCopy = async () => {
    if (!requireConfirmed()) return;
    const ok = await copyText(toClipboardText(buildExportCells(state.values)));
    show(ok ? { kind: 'success', text: MESSAGES.copied } : { kind: 'error', text: MESSAGES.copyFailed });
  };

  const onExport = () => {
    if (!requireConfirmed()) return;
    try {
      downloadTextFile(toCsv(buildExportCells(state.values)), exportFileName(), 'text/csv;charset=utf-8');
      show({ kind: 'success', text: MESSAGES.exported });
    } catch {
      show({ kind: 'error', text: MESSAGES.exportFailed });
    }
  };

  const onReset = async () => {
    if (!window.confirm(MESSAGES.resetConfirm)) return;
    dispatch({ type: 'reset' });
    setReview(null);
    setReviewAttempted(false);
    setTouched(new Set());
    setDocMessage(null);
    await ocr.reset();
    show({ kind: 'success', text: MESSAGES.cleared });
  };

  return (
    <>
      <a className="skip-link" href="#form-title">
        الانتقال إلى النموذج
      </a>
      <header className="app-header">
        <div className="container header-inner">
          <span className="app-logo" aria-hidden="true">
            <IdCard size={26} />
          </span>
          <div>
            <h1>تسجيل الزوار</h1>
            <p className="subtitle">استخراج بيانات الهوية تلقائيًا</p>
          </div>
        </div>
      </header>

      <main className="container layout">
        <section className="panel" aria-labelledby="doc-title">
          <h2 id="doc-title" className="panel-title">
            المستند
          </h2>
          <PrivacyNotice />
          <DocumentInput
            doc={ocr.doc}
            busy={busy}
            onFile={onFile}
            onRotate={ocr.rotate}
            onRemove={() => {
              ocr.remove();
              setDocMessage(null);
            }}
          />
          <StatusMessage message={docMessage} onDismiss={() => setDocMessage(null)} />
          <button type="button" className="btn btn-primary btn-block btn-lg" disabled={busy} onClick={onExtract}>
            <ScanText aria-hidden="true" size={20} />
            استخراج البيانات
          </button>
          <OcrStatusPanel status={ocr.status} onRetry={onExtract} />
        </section>

        <section className="panel" aria-labelledby="form-title">
          <h2 id="form-title" className="panel-title" tabIndex={-1}>
            بيانات الزائر
          </h2>
          <p className="panel-intro">
            جميع الحقول قابلة للتعديل. الحقول المميزة باللون البرتقالي تحتاج مراجعة، والحقول المعلَّمة بـ<span aria-hidden="true"> * </span>
            مطلوبة.
          </p>
          <RegistrationForm
            state={state}
            dispatch={dispatch}
            issues={issues}
            visibleFields={visibleFields}
            onFieldBlur={(field) => setTouched((t) => (t.has(field) ? t : new Set(t).add(field)))}
          />

          <StatusMessage message={message} onDismiss={() => setMessage(null)} />
          <div className="action-bar" role="group" aria-label="إجراءات النموذج">
            <button type="button" className="btn btn-primary" onClick={() => openReview()}>
              <ClipboardCheck aria-hidden="true" size={18} />
              مراجعة البيانات
            </button>
            <button type="button" className={`btn ${state.confirmed ? 'btn-secondary' : 'btn-muted'}`} aria-disabled={!state.confirmed} onClick={onCopy}>
              <Copy aria-hidden="true" size={18} />
              نسخ البيانات
            </button>
            <button type="button" className={`btn ${state.confirmed ? 'btn-secondary' : 'btn-muted'}`} aria-disabled={!state.confirmed} onClick={onExport}>
              <Download aria-hidden="true" size={18} />
              تصدير البيانات
            </button>
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={onReset}>
              <Eraser aria-hidden="true" size={18} />
              مسح النموذج
            </button>
          </div>
          <p className="field-hint action-hint">
            {state.confirmed ? 'تم تأكيد البيانات الحالية.' : 'النسخ والتصدير متاحان بعد مراجعة البيانات وتأكيدها.'}
          </p>
        </section>
      </main>

      <footer className="app-footer container">
        <p>يعمل التطبيق بالكامل داخل المتصفح. تحقق دائمًا من البيانات المستخرجة مقابل المستند الأصلي.</p>
      </footer>

      {review && (
        <ReviewDialog
          state={state}
          issues={issues}
          reason={review.reason}
          onConfirm={onConfirm}
          onClose={() => setReview(null)}
          onGoToField={focusField}
        />
      )}
    </>
  );
}
