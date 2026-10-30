import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eraser, IdCard, ScanText, X } from 'lucide-react';
import { DocumentInput } from './components/DocumentInput';
import { inputId } from './components/FieldShell';
import { LuggageStep } from './components/LuggageStep';
import { OcrStatusPanel } from './components/OcrStatusPanel';
import { PrivacyNotice } from './components/PrivacyNotice';
import { RegistrationForm } from './components/RegistrationForm';
import { ReviewStep } from './components/ReviewStep';
import { buildExportCells, exportFileName, toClipboardText, toCsv } from './domain/export';
import { createInitialState, formReducer } from './domain/formState';
import { MESSAGES } from './domain/labels';
import { FIELD_ORDER, type FieldKey } from './domain/types';
import { hasErrors, validateForm, type IssueField } from './domain/validation';
import { useDocumentOcr } from './hooks/useDocumentOcr';
import { copyText, downloadTextFile } from './lib/browser';

type Message = { kind: 'success' | 'error' | 'info'; text: string };
type Step = 1 | 2 | 3;

const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: 'الأمتعة' },
  { step: 2, label: 'بيانات الزائر' },
  { step: 3, label: 'المراجعة والتأكيد' },
];

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

const elementIdFor = (field: IssueField) =>
  field === 'luggage' ? 'field-luggage' : field === 'luggageSize' ? 'field-luggageSize' : inputId(field);

export function App() {
  const [state, dispatch] = useReducer(formReducer, undefined, createInitialState);
  const ocr = useDocumentOcr();
  const [step, setStep] = useState<Step>(1);
  const [docMessage, setDocMessage] = useState<Message | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [luggageAttempted, setLuggageAttempted] = useState(false);
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<FieldKey>>(new Set());
  const pendingFocus = useRef<string | null>(null);
  const firstRender = useRef(true);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const issues = useMemo(() => validateForm(state), [state]);
  const luggageIssues = issues.filter((i) => i.field === 'luggage' || i.field === 'luggageSize');
  const visibleFields = useMemo<ReadonlySet<FieldKey>>(
    () => (state.extracted || reviewAttempted ? new Set(FIELD_ORDER) : touched),
    [state.extracted, reviewAttempted, touched],
  );
  const busy = ocr.status.phase === 'running' || ocr.decoding;

  const show = useCallback((next: Message) => {
    clearTimeout(messageTimer.current);
    setMessage(next);
    if (next.kind === 'success') messageTimer.current = setTimeout(() => setMessage(null), 6000);
  }, []);

  // Notices produced by the form logic (kept manual edits, invalidated confirmation).
  useEffect(() => {
    if (state.notices.length) show({ kind: 'info', text: state.notices.join(' ') });
  }, [state.notices, show]);

  // After a step change, move focus to the requested field or to the step title, so screen readers
  // announce the new step and keyboard users continue from there.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const target = document.getElementById(pendingFocus.current ?? 'step-title');
    target?.scrollIntoView({ block: pendingFocus.current ? 'center' : 'start' });
    target?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [step]);

  const goTo = (next: Step, focusId: string | null = null) => {
    if (next === step) {
      if (focusId) document.getElementById(focusId)?.focus();
      return;
    }
    pendingFocus.current = focusId;
    setStep(next);
  };

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

  const nextFromLuggage = () => {
    setLuggageAttempted(true);
    const first = luggageIssues[0];
    if (first) document.getElementById(elementIdFor(first.field))?.focus();
    else goTo(2);
  };

  const toReview = () => {
    setReviewAttempted(true);
    goTo(3);
  };

  const editField = (field: IssueField) => {
    goTo(field === 'luggage' || field === 'luggageSize' ? 1 : 2, elementIdFor(field));
  };

  const onConfirm = () => {
    if (hasErrors(issues)) return;
    dispatch({ type: 'confirm' });
    show({ kind: 'success', text: MESSAGES.confirmed });
  };

  const onCopy = async () => {
    const ok = await copyText(toClipboardText(buildExportCells(state.values)));
    show(ok ? { kind: 'success', text: MESSAGES.copied } : { kind: 'error', text: MESSAGES.copyFailed });
  };

  const onExport = () => {
    try {
      downloadTextFile(toCsv(buildExportCells(state.values)), exportFileName(), 'text/csv;charset=utf-8');
      show({ kind: 'success', text: MESSAGES.exported });
    } catch {
      show({ kind: 'error', text: MESSAGES.exportFailed });
    }
  };

  const onReset = async (question: string = MESSAGES.resetConfirm) => {
    if (!window.confirm(question)) return;
    dispatch({ type: 'reset' });
    setLuggageAttempted(false);
    setReviewAttempted(false);
    setTouched(new Set());
    setDocMessage(null);
    await ocr.reset();
    goTo(1);
    show({ kind: 'success', text: MESSAGES.cleared });
  };

  const resetButton = (
    <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => void onReset()}>
      <Eraser aria-hidden="true" size={18} />
      مسح النموذج
    </button>
  );

  return (
    <>
      <a className="skip-link" href="#step-title">
        الانتقال إلى المحتوى
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

      <nav className="container stepper-nav" aria-label="خطوات التسجيل">
        <ol className="stepper">
          {STEPS.map((s) => (
            <li key={s.step} className={s.step === step ? 'is-current' : s.step < step ? 'is-done' : ''}>
              <button
                type="button"
                aria-current={s.step === step ? 'step' : undefined}
                onClick={() => (s.step === 3 ? toReview() : goTo(s.step))}
              >
                <span className="stepper-number">{s.step}</span>
                <span className="stepper-label">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <main className="container">
        <StatusMessage message={message} onDismiss={() => setMessage(null)} />

        {step === 1 && (
          <section className="panel step-panel" aria-labelledby="step-title">
            <h2 id="step-title" className="panel-title" tabIndex={-1}>
              الأمتعة
            </h2>
            <p className="panel-intro">اطلب من الزائر إخراج هويته، وفي الأثناء سجّل أمتعته: النوع والعدد، ثم الحجم حسب جدار المقاسات.</p>
            <LuggageStep values={state.values} dispatch={dispatch} issues={luggageAttempted ? luggageIssues : []} />
            <div className="step-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={nextFromLuggage}>
                التالي: بيانات الزائر
                <ChevronLeft aria-hidden="true" size={20} />
              </button>
              {resetButton}
            </div>
          </section>
        )}

        {step === 2 && (
          <>
            <h2 id="step-title" className="visually-hidden" tabIndex={-1}>
              بيانات الزائر
            </h2>
            <div className="layout">
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
                  {ocr.decoding ? 'جاري تجهيز الصورة…' : 'استخراج البيانات'}
                </button>
                <OcrStatusPanel status={ocr.status} onRetry={onExtract} />
              </section>

              <section className="panel" aria-labelledby="form-title">
                <h2 id="form-title" className="panel-title" tabIndex={-1}>
                  بيانات الزائر
                </h2>
                <p className="panel-intro">
                  جميع الحقول قابلة للتعديل. الحقول المميزة باللون البرتقالي تحتاج مراجعة، والحقول المعلَّمة بـ
                  <span aria-hidden="true"> * </span>
                  مطلوبة.
                </p>
                <RegistrationForm
                  state={state}
                  dispatch={dispatch}
                  issues={issues}
                  visibleFields={visibleFields}
                  onFieldBlur={(field) => setTouched((t) => (t.has(field) ? t : new Set(t).add(field)))}
                />
              </section>
            </div>
            <div className="step-actions step-actions--bar">
              <button type="button" className="btn btn-primary btn-lg" onClick={toReview}>
                التالي: المراجعة
                <ChevronLeft aria-hidden="true" size={20} />
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => goTo(1)}>
                <ChevronRight aria-hidden="true" size={18} />
                السابق: الأمتعة
              </button>
              {resetButton}
            </div>
          </>
        )}

        {step === 3 && (
          <section className="panel step-panel" aria-labelledby="step-title">
            <h2 id="step-title" className="panel-title" tabIndex={-1}>
              المراجعة والتأكيد
            </h2>
            <ReviewStep
              state={state}
              issues={issues}
              onConfirm={onConfirm}
              onEdit={editField}
              onCopy={() => void onCopy()}
              onExport={onExport}
              onNewVisitor={() => void onReset(MESSAGES.newVisitorConfirm)}
            />
            {!state.confirmed && (
              <div className="step-actions">
                <button type="button" className="btn btn-secondary" onClick={() => goTo(2)}>
                  <ChevronRight aria-hidden="true" size={18} />
                  السابق: بيانات الزائر
                </button>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="app-footer container">
        <p>يعمل التطبيق بالكامل داخل المتصفح. تحقق دائمًا من البيانات المستخرجة مقابل المستند الأصلي.</p>
      </footer>
    </>
  );
}
