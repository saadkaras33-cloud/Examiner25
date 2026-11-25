import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Exam, ExamType, LessonItem } from '../types.ts';

export interface ExamTypeConfig {
  key: ExamType;
  label: string;
  color: string;
}

export const EXAM_TYPES: ExamTypeConfig[] = [
  { key: 'monthly', label: 'Monthly', color: '#D97706' },
  { key: 'midterm', label: 'Midterm', color: '#3F6C8F' },
  { key: 'final', label: 'Final', color: '#E25838' },
  { key: 'quiz', label: 'Quiz', color: '#7A6BC4' },
  { key: 'practical', label: 'Practical', color: '#2F8F72' },
  { key: 'oral', label: 'Oral', color: '#C08A2E' },
  { key: 'other', label: 'Other', color: '#6B7280' },
];

export const MAJOR_EXAM_TYPES: ExamType[] = ['monthly', 'midterm', 'final'];

export function isMajorExamType(type: string | undefined): boolean {
  return type === 'monthly' || type === 'midterm' || type === 'final';
}

export function getExamTypeConfig(type: string | undefined): ExamTypeConfig {
  return EXAM_TYPES.find((t) => t.key === type) || EXAM_TYPES[EXAM_TYPES.length - 1];
}

export function formatIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function formatTime12h(timeStr: string | undefined): string {
  if (!timeStr) return '';
  const parts = String(timeStr).split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (!Number.isFinite(h)) return String(timeStr);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${period}`;
}

export function formatTimeRange(startTime?: string, endTime?: string): string {
  const start = formatTime12h(startTime);
  const end = formatTime12h(endTime);
  if (start && end) return `${start} – ${end}`;
  return start || end || '';
}

export function sortExams(exams: Exam[]): Exam[] {
  return [...(exams || [])].sort((a, b) => {
    const keyA = `${a.date || '9999-99-99'} ${a.startTime || '99:99'}`;
    const keyB = `${b.date || '9999-99-99'} ${b.startTime || '99:99'}`;
    return keyA.localeCompare(keyB);
  });
}

export function groupExamsByDate(exams: Exam[]): Record<string, Exam[]> {
  const grouped: Record<string, Exam[]> = {};
  for (const exam of exams || []) {
    if (!exam.date) continue;
    if (!grouped[exam.date]) grouped[exam.date] = [];
    grouped[exam.date].push(exam);
  }
  return grouped;
}

export function formatRelativeExamDay(dateStr: string | undefined): string {
  if (!dateStr) return '';
  let parsed: Date;
  try {
    parsed = parseISO(dateStr);
  } catch {
    return dateStr;
  }
  if (Number.isNaN(parsed.getTime())) return dateStr;
  const diff = differenceInCalendarDays(parsed, new Date());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  if (diff < 7) return `In ${diff} days`;
  if (diff < 14) return `In ${Math.round(diff / 7)} week`;
  return `In ${Math.round(diff / 7)} weeks`;
}

export function formatDisplayDate(dateStr: string | undefined, pattern = 'EEE d MMM'): string {
  if (!dateStr) return '';
  try {
    const parsed = parseISO(dateStr);
    if (Number.isNaN(parsed.getTime())) return dateStr;
    return format(parsed, pattern);
  } catch {
    return dateStr;
  }
}

export function isValidIsoDate(val: unknown): val is string {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

export function isExamFinished(
  exam: Pick<Exam, 'date'> | null | undefined,
  todayIso: string = formatIsoDate(new Date())
): boolean {
  if (!exam || !isValidIsoDate(exam.date)) return false;
  return exam.date < todayIso;
}

const MULTILINGUAL_NOISE_WORDS = [
  'exam', 'exams', 'final', 'finals', 'midterm', 'midterms', 'mid-term',
  'test', 'tests', 'paper', 'papers', 'quiz', 'quizzes', 'assessment',
  'examen', 'examens', 'partiel', 'partiels', 'contrôle', 'épreuve',
  'prüfung', 'klausur', 'arbeit', 'sınav', 'vize', 'prova', 'verifica',
  'امتحان', 'امتحانات', 'اختبار', 'اختبارات', 'نهائي', 'نصفي', 'مادة', 'مقرر',
  'экзамен', 'зачет', 'тест',
  '試験', 'テスト', '期末', '中間', '시험', '考试', '测验',
];

function foldNativeDigits(str: string): string {
  return String(str || '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
}

function canonicalizeLevelAliases(raw: string): string {
  return foldNativeDigits(raw)
    .toLowerCase()
    .replace(/\badvanced\s+level\b/gi, ' al ')
    .replace(/\bordinary\s+level\b/gi, ' ol ')
    .replace(/\ba\s*[./-]\s*l\b/gi, ' al ')
    .replace(/\bo\s*[./-]\s*l\b/gi, ' ol ')
    .replace(/\ba\s+l\b/gi, ' al ')
    .replace(/\bo\s+l\b/gi, ' ol ');
}

function collapseLevelSectionTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i];
    const next = tokens[i + 1];
    if ((cur === 'al' || cur === 'ol') && next === 'a') {
      out.push(cur);
      i++; // Treat "AL A" / "OL A" as equivalent to "AL" / "OL"
      continue;
    }
    out.push(cur);
  }
  return out;
}

export function normalizeSubject(subject: string): string {
  const cleaned = canonicalizeLevelAliases(subject)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!cleaned) return '';
  const noiseSet = new Set(MULTILINGUAL_NOISE_WORDS);
  const filtered = cleaned
    .split(/\s+/)
    .filter((token) => token && !noiseSet.has(token));
  return collapseLevelSectionTokens(filtered).join(' ');
}

export function normalizeText(str: string): string {
  return foldNativeDigits(str)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function hasSubjectTrackConflict(tokensA: string[], tokensB: string[]): boolean {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if ((setA.has('al') && setB.has('ol')) || (setA.has('ol') && setB.has('al'))) {
    return true;
  }
  const getLevelSection = (tokens: string[]): string | null => {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === 'al' || tokens[i] === 'ol') {
        const next = tokens[i + 1];
        if (next && /^[b-z2-9]$/.test(next)) return `${tokens[i]}:${next}`;
        return `${tokens[i]}:a`;
      }
    }
    return null;
  };
  const secA = getLevelSection(tokensA);
  const secB = getLevelSection(tokensB);
  if (secA && secB && secA !== secB) {
    return true;
  }
  const numsA = tokensA.filter((t) => /^\d+$/.test(t));
  const numsB = tokensB.filter((t) => /^\d+$/.test(t));
  if (numsA.length > 0 && numsB.length > 0 && numsA.join(',') !== numsB.join(',')) {
    return true;
  }
  return false;
}

export function isLikelyDuplicateSubject(a: string, b: string): boolean {
  const normA = normalizeSubject(a);
  const normB = normalizeSubject(b);
  if (!normA || !normB) return normA === normB;
  if (normA === normB) return true;

  const tokensA = normA.split(' ').filter(Boolean);
  const tokensB = normB.split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  if (hasSubjectTrackConflict(tokensA, tokensB)) return false;

  const paddedA = ` ${normA} `;
  const paddedB = ` ${normB} `;
  if (paddedA.includes(paddedB) || paddedB.includes(paddedA)) return true;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap++;
  }
  return overlap / Math.min(setA.size, setB.size) >= 0.7;
}

const LESSON_STOPWORDS = new Set([
  'the', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'a', 'an',
  'unit', 'lesson', 'chapter', 'ch', 'part', 'section', 'module', 'topic', 'week',
  'درس', 'الدرس', 'وحدة', 'الوحدة', 'فصل', 'الفصل', 'باب', 'الباب', 'في', 'من', 'على', 'و',
]);

export function isSameLessonTopic(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const tokensA = na.split(' ').filter(Boolean);
  const tokensB = nb.split(' ').filter(Boolean);
  const numsA = tokensA.filter((t) => /^\d+$/.test(t));
  const numsB = tokensB.filter((t) => /^\d+$/.test(t));
  if (numsA.length > 0 && numsB.length > 0 && numsA.join(',') !== numsB.join(',')) {
    return false;
  }

  const paddedA = ` ${na} `;
  const paddedB = ` ${nb} `;
  if (paddedA.includes(paddedB) || paddedB.includes(paddedA)) return true;

  const coreA = tokensA.filter((t) => !LESSON_STOPWORDS.has(t));
  const coreB = tokensB.filter((t) => !LESSON_STOPWORDS.has(t));
  const setA = new Set(coreA.length > 0 ? coreA : tokensA);
  const setB = new Set(coreB.length > 0 ? coreB : tokensB);
  if (setA.size === 0 || setB.size === 0) return false;

  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap++;
  }
  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize > 0 && overlap / unionSize >= 0.7;
}

const LESSON_PREFIX_RE =
  /^(?:lesson|lessons|unit|units|chapter|chapters|ch\.?|part|parts|section|sections|module|modules|topic|topics|week|weeks|lecture|lectures|lec\.?|درس|دروس|الدرس|وحدة|وحدات|فصل|فصول|باب|محاضرة|محاضرات)\b/i;

function looksLikeStandaloneLessonSegment(segment: string): boolean {
  const s = segment.trim();
  if (!s) return false;
  return LESSON_PREFIX_RE.test(s) || /\d+$/.test(s);
}

export function splitMultiLessonText(raw: string): string[] {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return [];

  // Convert inline numbered lists like "1. Grammar 2. Vocabulary 3. Reading" into lines
  let prepped = cleaned;
  const numberedMatches = prepped.match(/(?:^|\s)\d{1,2}\s*[.)]\s+/g);
  if (numberedMatches && numberedMatches.length >= 2) {
    prepped = prepped.replace(/(?:^|\s)\d{1,2}\s*[.)]\s+/g, '\n');
  }

  // Split on primary list delimiters (newlines, semicolons, bullets, pipes, non-numeric commas)
  const primaryChunks = prepped
    .split(/\r?\n+|[;؛•▪▫●◦|]+|(?<!\d),|,(?!\d{3}(?!\d))|[،]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Handle shorthand number lists like "Lessons 1, 2, 3" -> ["Lesson 1", "Lesson 2", "Lesson 3"]
  const expandedNumbers: string[] = [];
  if (primaryChunks.length >= 2) {
    const firstMatch = primaryChunks[0].match(
      /^(lessons?|units?|chapters?|ch\.?|parts?|sections?|modules?|topics?|lectures?|دروس|درس|وحدات|وحدة|فصول|فصل)\s+(\d+)$/i
    );
    const restAreNumbers = primaryChunks.slice(1).every((c) => /^\d+$/.test(c));
    if (firstMatch && restAreNumbers) {
      const singularPrefix = firstMatch[1].replace(/s$/i, '');
      for (let i = 0; i < primaryChunks.length; i++) {
        const num = i === 0 ? firstMatch[2] : primaryChunks[i];
        expandedNumbers.push(`${singularPrefix} ${num}`);
      }
    }
  }

  const baseChunks = expandedNumbers.length > 0 ? expandedNumbers : primaryChunks;
  const finalParts: string[] = [];

  for (const chunk of baseChunks) {
    // Only split on secondary separators (&, +, /, -) when there are 3+ items or clearly separate lesson refs
    const secondary = chunk
      .split(/\s+(?:&|\+|\/|-|–|—)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      secondary.length >= 3 ||
      (secondary.length === 2 && secondary.every(looksLikeStandaloneLessonSegment))
    ) {
      finalParts.push(...secondary);
    } else {
      finalParts.push(chunk);
    }
  }

  const deduped: string[] = [];
  for (const part of finalParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!deduped.some((existing) => isSameLessonTopic(existing, trimmed))) {
      deduped.push(trimmed);
    }
  }
  return deduped;
}

export function dedupeTopicList(items: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const item of items || []) {
    for (const part of splitMultiLessonText(String(item || ''))) {
      if (!out.some((existing) => isSameLessonTopic(existing, part))) {
        out.push(part);
      }
    }
  }
  return out;
}

export function lessonMatchesTopicOrSplit(a: string, b: string): boolean {
  if (isSameLessonTopic(a, b)) return true;
  const partsA = splitMultiLessonText(a);
  const partsB = splitMultiLessonText(b);
  for (const pa of partsA) {
    for (const pb of partsB) {
      if (isSameLessonTopic(pa, pb)) return true;
    }
  }
  return false;
}

export function getExamsForLesson(
  lesson: Pick<LessonItem, 'subject' | 'title' | 'examId'>,
  exams: Exam[]
): Exam[] {
  const matched: Exam[] = [];
  const seen = new Set<string>();
  const lessonParts = splitMultiLessonText(lesson.title);
  const effectiveParts = lessonParts.length > 0 ? lessonParts : [lesson.title];

  for (const ex of exams || []) {
    const topics = Array.isArray(ex.topics)
      ? dedupeTopicList(ex.topics)
      : [];
    const subjectMatches = Boolean(
      ex.subject && lesson.subject && isLikelyDuplicateSubject(ex.subject, lesson.subject)
    );
    const directLink = Boolean(lesson.examId && lesson.examId === ex.id);

    let included = false;
    if (topics.length > 0) {
      included =
        (subjectMatches || directLink) &&
        topics.some((tp) =>
          effectiveParts.some((lp) => isSameLessonTopic(tp, lp))
        );
    } else {
      included = directLink || subjectMatches;
    }

    if (included && !seen.has(ex.id)) {
      seen.add(ex.id);
      matched.push(ex);
    }
  }

  return sortExams(matched);
}

export interface ExamTopicChecklistMatch {
  topic: string;
  lesson: LessonItem | null;
  completed: boolean;
}

export interface ExamReadinessSummary {
  topicMatches: ExamTopicChecklistMatch[];
  subjectLessons: LessonItem[];
  finishedLessons: LessonItem[];
  remainingLessons: LessonItem[];
  untrackedTopics: string[];
  totalCount: number;
  finishedCount: number;
  remainingCount: number;
  isReady: boolean;
}

export function getExamReadiness(
  exam: Pick<Exam, 'id' | 'subject' | 'topics'>,
  lessons: LessonItem[]
): ExamReadinessSummary {
  const safeLessons = lessons || [];
  const subjectLessons = safeLessons.filter((l) => {
    if (exam.id && l.examId === exam.id) return true;
    if (!exam.subject || !l.subject) return false;
    return isLikelyDuplicateSubject(l.subject, exam.subject);
  });

  const topics = Array.isArray(exam.topics) ? dedupeTopicList(exam.topics) : [];
  const topicMatches: ExamTopicChecklistMatch[] = [];
  const untrackedTopics: string[] = [];

  for (const topic of topics) {
    const matched =
      (exam.id
        ? subjectLessons.find(
            (l) => l.examId === exam.id && lessonMatchesTopicOrSplit(l.title, topic)
          )
        : undefined) ||
      subjectLessons.find((l) => lessonMatchesTopicOrSplit(l.title, topic)) ||
      safeLessons.find(
        (l) =>
          (!l.subject || normalizeSubject(l.subject) === 'general') &&
          lessonMatchesTopicOrSplit(l.title, topic)
      ) ||
      null;
    if (matched) {
      topicMatches.push({ topic, lesson: matched, completed: matched.completed });
    } else {
      untrackedTopics.push(topic);
      topicMatches.push({ topic, lesson: null, completed: false });
    }
  }

  const relatedLessons: LessonItem[] = [];
  const seenIds = new Set<string>();

  if (topics.length > 0) {
    // When this exam lists included topics/lessons, evaluate readiness STRICTLY against those included items
    for (const m of topicMatches) {
      if (m.lesson && !seenIds.has(m.lesson.id)) {
        seenIds.add(m.lesson.id);
        relatedLessons.push(m.lesson);
      }
    }
  } else {
    // Fallback when no specific included topics were set on the exam
    const explicitlyLinked = exam.id
      ? subjectLessons.filter((l) => l.examId === exam.id)
      : [];
    const fallbackPool = explicitlyLinked.length > 0 ? explicitlyLinked : subjectLessons;
    for (const l of fallbackPool) {
      if (!seenIds.has(l.id)) {
        seenIds.add(l.id);
        relatedLessons.push(l);
      }
    }
  }

  const finishedLessons = relatedLessons.filter((l) => l.completed);
  const remainingLessons = relatedLessons.filter((l) => !l.completed);

  const totalCount = relatedLessons.length + untrackedTopics.length;
  const finishedCount = finishedLessons.length;
  const remainingCount = remainingLessons.length + untrackedTopics.length;
  const isReady = totalCount > 0 && remainingCount === 0;

  return {
    topicMatches,
    subjectLessons: relatedLessons,
    finishedLessons,
    remainingLessons,
    untrackedTopics,
    totalCount,
    finishedCount,
    remainingCount,
    isReady,
  };
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
