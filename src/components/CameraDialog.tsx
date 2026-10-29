import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { MESSAGES } from '../domain/labels';

interface Props {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** No camera API at all: fall back to the file picker with capture. */
  onUnavailable: () => void;
}

/** Live camera preview (desktop and devices without a native capture UI). */
export function CameraDialog({ onCapture, onClose, onUnavailable }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    if (!navigator.mediaDevices?.getUserMedia) {
      onUnavailableRef.current();
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        void video.play().then(() => setReady(true), () => setReady(true));
      })
      .catch(() => setError(MESSAGES.cameraUnavailable));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (blob) onCapture(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <dialog ref={dialogRef} className="dialog camera-dialog" aria-labelledby="camera-title" onClose={onClose} onCancel={onClose}>
      <h2 id="camera-title">التقاط صورة المستند</h2>
      <div className="camera-frame">
        <video ref={videoRef} playsInline muted aria-label="معاينة الكاميرا" />
      </div>
      <p className="field-hint">ضع المستند كاملًا داخل الإطار بإضاءة جيدة ودون انعكاسات، ثم اضغط التقاط.</p>
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={capture}>
          <Camera aria-hidden="true" size={18} />
          التقاط
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </dialog>
  );
}
