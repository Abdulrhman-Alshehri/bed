import { COUNTRIES } from '../data/countries';
import { NATIONALITY_ALIASES } from '../data/nationalityAliases';
import { editDistance, foldArabic } from './text';

export interface NationalityMatch {
  code: string;
  /** true when the text equals a known name/alias; false when matched through adjective rules. */
  exact: boolean;
}

function foldKey(input: string): string {
  return foldArabic(input)
    .replace(/[.,'’`´\-()/:؛،]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const stripArticle = (s: string) => s.replace(/^ال/, '');

const index = new Map<string, string>();
const ambiguous = new Set<string>();

function addKey(raw: string, code: string) {
  const key = foldKey(raw);
  if (key.length < 2 || ambiguous.has(key)) return;
  const existing = index.get(key);
  if (existing && existing !== code) {
    index.delete(key);
    ambiguous.add(key);
  } else {
    index.set(key, code);
  }
}

for (const c of COUNTRIES) {
  addKey(c.ar, c.code);
  addKey(stripArticle(foldKey(c.ar)), c.code);
  addKey(c.en, c.code);
}
for (const [code, aliases] of Object.entries(NATIONALITY_ALIASES)) {
  for (const alias of aliases) {
    addKey(alias, code);
    addKey(stripArticle(foldKey(alias)), code);
  }
}

const englishNames = COUNTRIES.map((c) => ({ code: c.code, name: foldKey(c.en) }));

function matchArabicAdjective(key: string): string | null {
  const base = stripArticle(key);
  // After folding, the feminine ending ية becomes يه.
  for (const suffix of ['يه', 'ي']) {
    if (!base.endsWith(suffix) || base.length - suffix.length < 2) continue;
    const stem = base.slice(0, -suffix.length);
    // مصري→مصر, سوري→سوريا, أوغندي→أوغندا, أفغاني→أفغانستان, هندي→الهند
    for (const candidate of [stem, `${stem}ا`, `${stem}يا`, `${stem}ستان`, `ال${stem}`]) {
      const code = index.get(candidate);
      if (code) return code;
    }
  }
  return null;
}

function matchEnglishDemonym(key: string): string | null {
  if (!/^[a-z ]+$/.test(key) || key.length < 4) return null;
  let best: { code: string; length: number } | null = null;
  let tie = false;
  for (const { code, name } of englishNames) {
    // INDONESIAN → Indonesia, JORDANIAN → Jordan, SAUDI → Saudi Arabia
    const matches =
      (key.startsWith(name) && key.length - name.length <= 4 && name.length >= 4) ||
      (name.startsWith(key) && key.length >= 5);
    if (!matches) continue;
    if (!best || name.length > best.length) {
      best = { code, length: name.length };
      tie = false;
    } else if (name.length === best.length && code !== best.code) {
      tie = true;
    }
  }
  return best && !tie ? best.code : null;
}

/** Matches a single nationality phrase ("مصري", "EGYPTIAN", "Egypt", "الجنسية الهندية" is NOT handled here). */
export function matchNationality(text: string): NationalityMatch | null {
  const key = foldKey(text);
  if (key.length < 2) return null;
  const direct = index.get(key);
  if (direct) return { code: direct, exact: true };
  const viaArabic = matchArabicAdjective(key);
  if (viaArabic) return { code: viaArabic, exact: false };
  const viaEnglish = matchEnglishDemonym(key);
  if (viaEnglish) return { code: viaEnglish, exact: false };
  return null;
}

/**
 * Finds a nationality inside a longer OCR fragment (e.g. the text after a "الجنسية" label, which may
 * contain noise). Tries the longest word sequences first so "South Africa" wins over "Africa".
 * Returns null when nothing matches or when different words match different countries.
 */
export function findNationalityInText(text: string): NationalityMatch | null {
  const words = foldKey(text).split(' ').filter(Boolean);
  for (let size = Math.min(4, words.length); size >= 1; size--) {
    const found = new Map<string, NationalityMatch>();
    for (let i = 0; i + size <= words.length; i++) {
      const match = matchNationality(words.slice(i, i + size).join(' '));
      if (match && !found.has(match.code)) found.set(match.code, match);
    }
    if (found.size === 1) return [...found.values()][0]!;
    if (found.size > 1) return null;
  }
  return null;
}

/**
 * Tolerates one misread letter (two in long names), e.g. «افغاتستان». Only for text printed right
 * next to a nationality label, where the context makes a loose match safe. Null when ambiguous.
 */
export function findNationalityFuzzy(text: string): NationalityMatch | null {
  const words = foldKey(text).split(' ').filter(Boolean);
  const found = new Set<string>();
  for (let size = Math.min(3, words.length); size >= 1 && found.size === 0; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const phrase = stripArticle(words.slice(i, i + size).join(' '));
      if (phrase.length < 5) continue;
      const tolerance = phrase.length >= 8 ? 2 : 1;
      for (const [key, code] of index) {
        const candidate = stripArticle(key);
        if (Math.abs(candidate.length - phrase.length) <= tolerance && editDistance(candidate, phrase) <= tolerance) found.add(code);
      }
    }
  }
  return found.size === 1 ? { code: [...found][0]!, exact: false } : null;
}
