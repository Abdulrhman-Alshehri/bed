import { CircleCheck, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { MESSAGES } from '../domain/labels';
import type { OcrStatus } from '../hooks/useDocumentOcr';
import { STAGE_LABELS } from '../ocr/stages';

interface Props {
  status: OcrStatus;
  onRetry: () => void;
}

export function OcrStatusPanel({ status, onRetry }: Props) {
  return (
    <div className="ocr-status" role="status" aria-live="polite">
      {status.phase === 'running' && (
        <div className="status-running">
          <div className="status-line">
            <LoaderCircle aria-hidden="true" size={18} className="spin" />
            <span>
              {MESSAGES.extracting}… <span className="status-stage">{STAGE_LABELS[status.stage]}</span>
            </span>
          </div>
          <progress max={1} value={status.progress} aria-label="تقدم استخراج البيانات" />
        </div>
      )}

      {status.phase === 'done' && (
        <div className={`alert ${status.fieldsFound ? 'alert--success' : 'alert--error'}`}>
          {status.fieldsFound ? <CircleCheck aria-hidden="true" size={18} /> : <TriangleAlert aria-hidden="true" size={18} />}
          <div>
            <p>{status.fieldsFound ? MESSAGES.extracted : MESSAGES.extractionFailed}</p>
            {status.warnings.length > 0 && (
              <ul className="status-warnings">
                {status.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {status.phase === 'error' && (
        <div className="alert alert--error" role="alert">
          <TriangleAlert aria-hidden="true" size={18} />
          <div>
            <p>{status.message}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
              <RefreshCw aria-hidden="true" size={16} />
              إعادة المحاولة
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
