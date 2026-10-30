// Suggests gender from an Arabic name when the document does not state it (e.g. Saudi national
// IDs). This is a suggestion for staff to confirm, never a fact: ambiguous names return null.
import type { Gender } from '../domain/types';
import { foldArabic } from './text';

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean).map(foldArabic));

const MALE = words(`
محمد أحمد محمود مصطفى علي عمر عثمان خالد سعد سعيد سعود فهد فيصل فارس فواز فايز فالح نايف نواف بندر تركي
سلطان سلمان سليمان صالح صلاح طلال طارق عادل عيسى موسى يحيى يوسف يونس يعقوب إبراهيم إسماعيل إسحاق أيوب داود
زكريا ناصر نصر منصور ماجد مازن مالك مشعل متعب مساعد مبارك مرزوق مهند معاذ مراد مروان منير هاني هشام هيثم وليد
وائل ياسر ياسين زياد زيد زكي رامي رائد راشد رشيد ريان رياض حسن حسين حسان حمد حامد حمود حمدان حازم حاتم حارث
حبيب جمال جابر جاسم جعفر جلال جواد باسل بدر بشير بشار بلال تامر توفيق ثامر ثابت شادي شريف شاكر شهاب صابر صادق
طه ظافر عامر عاصم عبيد عدنان عزيز عصام علاء عماد عمار عمرو عوض عيد غازي غانم فتحي فراس فؤاد فريد فوزي قاسم قيس
كريم كمال لؤي ماهر مجدي محسن مختار معتز منذر مهدي نبيل نادر نزار نعيم هادي همام وحيد أنس أمين أنور أيمن أكرم
أشرف إياد أديب أسعد أمجد أوس بكر تميم جبريل خليل دخيل راكان رضا زاهر سامي سامر سالم سفيان سهيل سيف صهيب عتيق
عقيل غسان فادي لقمان مأمون مؤمن مصعب مقبل ممدوح مهنا ناجي نجيب نوح هارون هلال يزيد إدريس إلياس آدم أدهم
مشاري مشعان عايض عوضه عبيدالله ضيف حمدي رجب شعبان رمضان عرفات نصار جراح فرج منيف هزاع نهار
`);

const FEMALE = words(`
فاطمة عائشة خديجة زينب مريم آمنة حفصة أسماء سارة سلمى ليلى هند هدى منى نورة نوال نجلاء نجود نجوى نادية نسرين
نهى هالة هيا هيفاء وفاء وعد ولاء ياسمين رنا ريم رهف روان رزان رغد رشا رانيا رحاب رقية رباب ربى زهرة زهراء سعاد
سماح سمر سمية سهام سهى سوسن شهد شيماء صفاء صفية عبير عفاف علياء غادة غدير فاتن فدوى فرح فوزية لمى لينا لبنى
مها ميساء ميس منيرة مي ملاك مرام مروة مشاعل موضي نوف جميلة حنان حياة حليمة حصة خلود دانة دعاء دلال أمل أمينة
أميرة إيمان إسراء أريج أروى أفنان آلاء بشرى بتول تهاني تغريد جنى جواهر حسناء حلا رؤى ريما ريهام سلوى سميرة
شذى شروق عزة عهود غالية لطيفة لولوة ندى نجاة نعيمة هيام وجدان يارا يسرا لجين
`);

/** Names ending in ة that are male. */
const MALE_WITH_TA_MARBUTA = words('حمزة أسامة طلحة عبيدة معاوية عروة عكرمة حذيفة قتادة جبلة ربيعة مسلمة عنترة خليفة أمية عبادة سلامة عطية');

/** Used for both genders. */
const AMBIGUOUS = words('نور جود صباح وئام سلام إحسان');

export interface GenderGuess {
  gender: Gender;
  /** Arabic explanation shown to staff. */
  reason: string;
}

export function genderFromArabicName(name: string, { endingRule = true }: { endingRule?: boolean } = {}): GenderGuess | null {
  const rawTokens = name
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[^ء-ي\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const tokens = rawTokens.map(foldArabic);
  if (tokens.length === 0) return null;
  if (tokens.includes('بنت')) return { gender: 'female', reason: 'الاسم يحتوي «بنت»' };
  if (tokens.slice(1).some((t) => t === 'بن' || t === 'ابن')) return { gender: 'male', reason: 'الاسم يحتوي «بن»' };

  const given = tokens[0]!;
  if (AMBIGUOUS.has(given)) return null;
  if (given.startsWith('عبد') || given === 'ابو') return { gender: 'male', reason: `الاسم الأول «${given}» اسم مذكر` };
  if (MALE.has(given) || MALE_WITH_TA_MARBUTA.has(given)) return { gender: 'male', reason: `الاسم الأول اسم مذكر شائع` };
  if (FEMALE.has(given)) return { gender: 'female', reason: `الاسم الأول اسم مؤنث شائع` };
  // Checked on the original spelling: folding turns ة into ه (وجيه is male).
  if (endingRule && rawTokens[0]!.endsWith('ة') && given.length > 2) return { gender: 'female', reason: 'الاسم الأول ينتهي بتاء مربوطة' };
  return null;
}
