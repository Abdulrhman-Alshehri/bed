// Kept separate from pipeline.ts so the UI can show stage names without loading the OCR code.
export type PipelineStage = 'preparing' | 'loading' | 'latin' | 'mrz' | 'arabic' | 'analyzing';

export interface PipelineProgress {
  stage: PipelineStage;
  /** Overall progress 0-1. */
  progress: number;
}

export const STAGE_LABELS: Record<PipelineStage, string> = {
  preparing: 'تجهيز الصورة',
  loading: 'تحميل محرك التعرف على النص (مرة واحدة لكل جلسة)',
  latin: 'قراءة النص اللاتيني والأرقام',
  mrz: 'قراءة منطقة MRZ',
  arabic: 'قراءة النص العربي',
  analyzing: 'تحليل البيانات المستخرجة',
};
