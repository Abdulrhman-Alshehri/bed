import type { DocType, FieldKey, Gender, LuggageCenter, ValueSource, VisitType, VisitorType } from './types';

export const FIELD_LABELS: Record<FieldKey, string> = {
  docType: 'نوع الهوية',
  fullName: 'الاسم الثلاثي',
  docNumber: 'رقم الهوية / الإقامة / الجواز',
  visitorType: 'نوع الزائر',
  visitType: 'نوع الزيارة',
  nationality: 'الجنسية',
  birthDate: 'تاريخ الميلاد',
  phone: 'رقم الجوال',
  luggageCenter: 'مركز حفظ الأمتعة',
  gender: 'الجنس',
};

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  passport: 'جواز سفر',
  national_id: 'هوية وطنية',
  residence: 'إقامة',
  other: 'إثبات آخر',
};

export const VISITOR_TYPE_LABELS: Record<VisitorType, string> = {
  gcc: 'خليجي',
  international: 'دولي',
};

export const VISIT_TYPE_LABELS: Record<VisitType, string> = {
  hajj: 'حج',
  umrah: 'عمرة',
  prayer: 'صلاة',
};

export const LUGGAGE_CENTER_LABELS: Record<LuggageCenter, string> = {
  makkah: 'مكة',
  madinah: 'المدينة',
};

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'ذكر',
  female: 'أنثى',
};

export const SOURCE_LABELS: Record<ValueSource, string> = {
  empty: '',
  default: 'قيمة افتراضية',
  ocr: 'مستخرج من النص',
  mrz: 'مستخرج من MRZ',
  barcode: 'مقروء من الباركود',
  rule: 'حسب القاعدة',
  user: 'معدّل يدويًا',
};

export const MESSAGES = {
  uploadFirst: 'يرجى رفع صورة الهوية أو جواز السفر',
  extracting: 'جاري استخراج البيانات',
  extractionFailed: 'تعذر استخراج البيانات بوضوح، يرجى مراجعة الصورة',
  reviewFlagged: 'يرجى مراجعة الحقول المحددة قبل المتابعة',
  extracted: 'تم استخراج البيانات، يرجى التأكد من صحتها',
  copied: 'تم نسخ البيانات بنجاح',
  cleared: 'تم مسح البيانات من النموذج',
  exported: 'تم تصدير البيانات إلى ملف CSV',
  confirmed: 'تم تأكيد البيانات. يمكنك الآن نسخها أو تصديرها',
  confirmFirst: 'يرجى مراجعة البيانات وتأكيدها قبل النسخ أو التصدير',
  copyFailed: 'تعذر نسخ البيانات. يرجى المحاولة مرة أخرى',
  exportFailed: 'تعذر تصدير البيانات. يرجى المحاولة مرة أخرى',
  emptyForm: 'النموذج فارغ. يرجى رفع مستند أو إدخال البيانات أولًا',
  unsupportedFile: 'صيغة الملف غير مدعومة. الصيغ المدعومة: JPG و PNG و WebP',
  fileTooLarge: 'حجم الصورة كبير جدًا. الحد الأقصى 20 ميجابايت',
  imageUnreadable: 'تعذر قراءة الصورة. يرجى اختيار صورة أخرى',
  ocrLoadFailed: 'تعذر تحميل ملفات التعرف الضوئي على النص. تحقق من الاتصال بالإنترنت ثم أعد المحاولة',
  ocrFailed: 'حدث خطأ أثناء معالجة الصورة. يرجى إعادة المحاولة',
  lowResolution: 'دقة الصورة منخفضة وقد تقل دقة الاستخراج. يُفضّل تصوير المستند عن قرب وبإضاءة جيدة',
  lowConfidence: 'وضوح النص في الصورة منخفض. يرجى مراجعة جميع الحقول بعناية',
  editsKept: 'تم الإبقاء على القيم التي عدّلتها يدويًا في الحقول التالية، وعُرضت القيم المستخرجة الجديدة كاقتراحات:',
  confirmationReset: 'تم تعديل البيانات بعد تأكيدها، يرجى مراجعتها وتأكيدها مرة أخرى',
  resetConfirm: 'هل تريد مسح صورة المستند وجميع البيانات المدخلة؟',
  cameraUnavailable: 'تعذر الوصول إلى الكاميرا. تحقق من صلاحيات المتصفح أو استخدم رفع صورة',
} as const;
