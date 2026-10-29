import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Camera, FileImage, RotateCcw, RotateCw, Trash2, Upload } from 'lucide-react';
import type { LoadedDocument } from '../hooks/useDocumentOcr';
import { CameraDialog } from './CameraDialog';

interface Props {
  doc: LoadedDocument | null;
  busy: boolean;
  onFile: (file: File) => void;
  onRotate: (direction: 1 | -1) => void;
  onRemove: () => void;
}

const PREVIEW_MAX = 900;

/** Draws the image exactly as OCR will see it (EXIF orientation and manual rotation applied). */
function Preview({ doc }: { doc: LoadedDocument }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { bitmap, rotation } = doc;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height));
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    const swap = rotation === 90 || rotation === 270;
    canvas.width = Math.round(swap ? h : w);
    canvas.height = Math.round(swap ? w : h);
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    return () => {
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [doc]);
  return <canvas ref={ref} className="preview-canvas" role="img" aria-label="معاينة صورة المستند" />;
}

const prefersNativeCamera = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

export function DocumentInput({ doc, busy, onFile, onRotate, onRemove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const takeFile = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) takeFile(e.dataTransfer.files);
  };

  const openCamera = () => {
    // Phones: the native camera app gives sharper, focused photos than a video frame.
    if (prefersNativeCamera() || !navigator.mediaDevices?.getUserMedia) captureRef.current?.click();
    else setCameraOpen(true);
  };

  return (
    <div className="document-input">
      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}${doc ? ' has-image' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {doc ? (
          <Preview doc={doc} />
        ) : (
          <div className="dropzone-empty">
            <Upload aria-hidden="true" size={40} strokeWidth={1.5} />
            <p className="dropzone-title">ارفع صورة الهوية أو جواز السفر</p>
            <p className="dropzone-sub">اسحب الصورة وأفلتها هنا، أو استخدم الأزرار أدناه</p>
          </div>
        )}
      </div>

      <div className="button-row">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileImage aria-hidden="true" size={18} />
          {doc ? 'استبدال الصورة' : 'اختيار صورة'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={openCamera}>
          <Camera aria-hidden="true" size={18} />
          التقاط بالكاميرا
        </button>
        {doc && (
          <>
            <button type="button" className="btn btn-ghost btn-icon-only" disabled={busy} onClick={() => onRotate(1)} aria-label="تدوير الصورة باتجاه عقارب الساعة">
              <RotateCw aria-hidden="true" size={18} />
            </button>
            <button type="button" className="btn btn-ghost btn-icon-only" disabled={busy} onClick={() => onRotate(-1)} aria-label="تدوير الصورة عكس عقارب الساعة">
              <RotateCcw aria-hidden="true" size={18} />
            </button>
            <button type="button" className="btn btn-ghost btn-danger-text" disabled={busy} onClick={onRemove}>
              <Trash2 aria-hidden="true" size={18} />
              إزالة الصورة
            </button>
          </>
        )}
      </div>

      <p className="supported">
        المستندات المدعومة: جواز السفر، الهوية الوطنية، الإقامة، وإثباتات الهوية الأخرى. الصيغ: JPG و PNG و WebP.
        <br />
        لأفضل نتيجة: صوّر المستند كاملًا وبشكل مستقيم، بإضاءة جيدة ودون انعكاسات. لجواز السفر صوّر صفحة البيانات بما فيها السطرين السفليين (MRZ).
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          takeFile(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={captureRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hidden
        onChange={(e) => {
          takeFile(e.target.files);
          e.target.value = '';
        }}
      />

      {cameraOpen && (
        <CameraDialog
          onCapture={(file) => {
            setCameraOpen(false);
            onFile(file);
          }}
          onClose={() => setCameraOpen(false)}
          onUnavailable={() => {
            setCameraOpen(false);
            captureRef.current?.click();
          }}
        />
      )}
    </div>
  );
}
