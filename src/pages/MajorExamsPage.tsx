import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  CalendarRange,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  FilePlus2,
  Files,
  Layers,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  Exam,
  ExamInput,
  ExamType,
  LessonInput,
  LessonItem,
  ScannedExamDraft,
  ScannedLessonDraft,
} from '../types.ts';
import {
  EXAM_TYPES,
  MAJOR_EXAM_TYPES,
  dedupeTopicList,
  formatTime12h,
  getExamReadiness,
  getExamTypeConfig,
  isLikelyDuplicateSubject,
  isMajorExamType,
  isSameLessonTopic,
  isValidIsoDate,
  randomId,
  splitMultiLessonText,
} from '../utils/exams.ts';
import {
  formatLocalizedDate,
  formatRelativeDayLocalized,
  getExamTypeLabel,
  useTranslation,
} from '../utils/i18n.tsx';
import {
  classifyScanFileKind,
  clearMajorScanDrafts,
  getSavedMajorScanDrafts,
  saveMajorScanDrafts,
  scanCorrelatedFiles,
} from '../services/api.ts';

interface MajorExamsPageProps {
  exams: Exam[];
  lessons: LessonItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onEdit: (exam: Exam) => void;
  onAddMajor: (defaultType?: ExamType) => void;
  onSaveBatch: (payload: { exams: ExamInput[]; lessons: LessonInput[] }) => Promise<void>;
  onGoStudy: () => void;
}

type MajorFilter = 'all' | 'monthly' | 'midterm' | 'final';
type ScannerStage = 'queue' | 'reading' | 'review' | 'saved';

export default function MajorExamsPage({
  exams,
  lessons,
  loading,
  error,
  onRetry,
  onEdit,
  onAddMajor,
  onSaveBatch,
  onGoStudy,
}: MajorExamsPageProps) {
  const { lang, t } = useTranslation();

  const initialDraftsRef = useRef(getSavedMajorScanDrafts());
  const [typeFilter, setTypeFilter] = useState<MajorFilter>('all');
  const [mobilePane, setMobilePane] = useState<'all' | 'dates' | 'scanner'>('all');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<ScannerStage>(() =>
    initialDraftsRef.current ? 'review' : 'queue'
  );
  const [scanDetail, setScanDetail] = useState('');
  const [drafts, setDrafts] = useState<ScannedExamDraft[]>(
    () => initialDraftsRef.current?.drafts || []
  );
  const [lessonDrafts, setLessonDrafts] = useState<ScannedLessonDraft[]>(
    () => initialDraftsRef.current?.lessonDrafts || []
  );
  const [ignoredItems, setIgnoredItems] = useState<string[]>(
    () => initialDraftsRef.current?.ignoredItems || []
  );
  const [showIgnored, setShowIgnored] = useState(false);
  const [scanErrors, setScanErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedCounts, setSavedCounts] = useState({ exams: 0, lessons: 0 });
  const [scannerCollapsed, setScannerCollapsed] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (stage === 'review' && (drafts.length > 0 || lessonDrafts.length > 0)) {
      saveMajorScanDrafts({ drafts, lessonDrafts, ignoredItems });
    }
  }, [stage, drafts, lessonDrafts, ignoredItems]);

  const majorExams = useMemo(
    () => exams.filter((ex) => isMajorExamType(ex.type)),
    [exams]
  );

  const countsByType = useMemo(() => {
    let monthly = 0;
    let midterm = 0;
    let finalCount = 0;
    for (const ex of majorExams) {
      if (ex.type === 'monthly') monthly++;
      else if (ex.type === 'midterm') midterm++;
      else if (ex.type === 'final') finalCount++;
    }
    return { all: majorExams.length, monthly, midterm, final: finalCount };
  }, [majorExams]);

  const filteredMajorExams = useMemo(() => {
    if (typeFilter === 'all') return majorExams;
    return majorExams.filter((ex) => ex.type === typeFilter);
  }, [majorExams, typeFilter]);

  // Vertical chronological dates grouped strictly underneath each other
  const dateGroups = useMemo(() => {
    const groups: Array<{ date: string; exams: Exam[] }> = [];
    const byDate = new Map<string, Exam[]>();
    for (const ex of filteredMajorExams) {
      const key = ex.date || 'undated';
      const arr = byDate.get(key) || [];
      arr.push(ex);
      byDate.set(key, arr);
    }
    const sortedKeys = Array.from(byDate.keys()).sort((a, b) => {
      if (a === 'undated') return 1;
      if (b === 'undated') return -1;
      return a.localeCompare(b);
    });
    for (const date of sortedKeys) {
      groups.push({ date, exams: byDate.get(date) || [] });
    }
    return groups;
  }, [filteredMajorExams]);

  const overallReadiness = useMemo(() => {
    let finished = 0;
    let total = 0;
    for (const ex of majorExams) {
      const r = getExamReadiness(ex, lessons);
      finished += r.finishedCount;
      total += r.totalCount;
    }
    return {
      finished,
      total,
      pct: total > 0 ? Math.round((finished / total) * 100) : 0,
    };
  }, [majorExams, lessons]);

  function addFilesToQueue(list: FileList | null) {
    const incoming = Array.from(list || []);
    if (incoming.length === 0) return;
    const errors: string[] = [];
    const validIncoming: File[] = [];
    for (const file of incoming) {
      if (file.size === 0) {
        errors.push(`${file.name || 'One file'} is empty (0 bytes) and was skipped.`);
        continue;
      }
      try {
        classifyScanFileKind(file);
        validIncoming.push(file);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `${file.name} is not a supported file.`);
      }
    }

    let exceededLimit = false;
    setQueuedFiles((prev) => {
      const next = [...prev];
      for (const file of validIncoming) {
        const dup = next.some(
          (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
        );
        if (dup) continue;
        if (next.length >= 12) {
          exceededLimit = true;
          break;
        }
        next.push(file);
      }
      return next;
    });
    if (exceededLimit) {
      errors.push('Up to 12 files can be connected in one scan — extra files were skipped.');
    }
    setScanErrors(errors);
  }

  function removeQueuedFile(idx: number) {
    setQueuedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  const existingExamKeys = useMemo(
    () =>
      (exams || [])
        .filter((e) => e.date)
        .map((e) => ({
          subject: e.subject || '',
          date: e.date,
          startTime: e.startTime || '',
          type: e.type || 'other',
        })),
    [exams]
  );

  async function handleConnectAndScan() {
    if (queuedFiles.length === 0) return;
    const filesToScan = [...queuedFiles];
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setScannerCollapsed(false);
    setStage('reading');
    setScanErrors([]);
    setScanDetail(`Connecting ${filesToScan.length} file${filesToScan.length === 1 ? '' : 's'}…`);

    try {
      const result = await scanCorrelatedFiles(filesToScan, {
        signal: controller.signal,
        onProgress: (detail) => setScanDetail(detail),
        existingExams: majorExams.map((e) => ({
          subject: e.subject,
          date: e.date,
          type: e.type,
        })),
      });

      // First expand any combined lessons and mirror exam topics into Study Centre lesson candidates
      const candidateLessons: Array<{ subject: string; title: string; notes: string }> = [];
      for (const l of result.lessons) {
        for (const part of splitMultiLessonText(l.title)) {
          const exists = candidateLessons.some(
            (cur) =>
              isLikelyDuplicateSubject(cur.subject, l.subject) &&
              isSameLessonTopic(cur.title, part)
          );
          if (!exists) {
            candidateLessons.push({
              subject: l.subject,
              title: part,
              notes: l.notes || '',
            });
          }
        }
      }
      for (const ex of result.exams) {
        for (const topic of dedupeTopicList(ex.topics || [])) {
          const exists = candidateLessons.some(
            (l) =>
              isLikelyDuplicateSubject(l.subject, ex.subject) &&
              isSameLessonTopic(l.title, topic)
          );
          if (!exists) {
            candidateLessons.push({
              subject: ex.subject,
              title: topic,
              notes: ex.material ? `Material: ${ex.material}` : '',
            });
          }
        }
      }

      const fallbackMajorType: ExamType =
        typeFilter === 'monthly' || typeFilter === 'midterm' || typeFilter === 'final'
          ? typeFilter
          : 'monthly';

      const seenExams = existingExamKeys.map((k) => ({ ...k }));
      const reviewExams: ScannedExamDraft[] = result.exams.map((item) => {
        let normalizedType: ExamType =
          item.type === 'monthly' || item.type === 'midterm' || item.type === 'final'
            ? item.type
            : fallbackMajorType;

        let topics = dedupeTopicList(item.topics || []);
        if (topics.length === 0) {
          const subjectExamsCount = result.exams.filter((other) =>
            isLikelyDuplicateSubject(other.subject, item.subject)
          ).length;
          if (subjectExamsCount === 1) {
            topics = dedupeTopicList(
              candidateLessons
                .filter(
                  (l) => isLikelyDuplicateSubject(l.subject, item.subject) && l.title.trim()
                )
                .map((l) => l.title.trim())
            );
          }
        }

        let resolvedDate = item.date;
        let resolvedStartTime = item.startTime;
        let resolvedEndTime = item.endTime;
        let resolvedRoom = item.room;

        // If a scanned syllabus / lessons sheet omitted the exam date, match against existing major exams
        if (!resolvedDate) {
          const subjectCandidates = majorExams.filter((ex) =>
            isLikelyDuplicateSubject(ex.subject, item.subject)
          );
          const typeFiltered = subjectCandidates.filter((ex) => ex.type === normalizedType);
          const matchedExisting =
            typeFiltered.length === 1
              ? typeFiltered[0]
              : subjectCandidates.length === 1
              ? subjectCandidates[0]
              : null;
          if (matchedExisting) {
            resolvedDate = matchedExisting.date;
            if (!resolvedStartTime) resolvedStartTime = matchedExisting.startTime || '';
            if (!resolvedEndTime) resolvedEndTime = matchedExisting.endTime || '';
            if (!resolvedRoom) resolvedRoom = matchedExisting.room || '';
            if (isMajorExamType(matchedExisting.type)) normalizedType = matchedExisting.type;
          }
        }

        const existingCalendarMatch = resolvedDate
          ? majorExams.find(
              (ex) =>
                ex.date === resolvedDate &&
                isLikelyDuplicateSubject(ex.subject, item.subject) &&
                (ex.type === normalizedType ||
                  (isMajorExamType(ex.type) && isMajorExamType(normalizedType)))
            )
          : undefined;

        const hasNewTopics = Boolean(
          existingCalendarMatch &&
            topics.some(
              (tp) =>
                !(existingCalendarMatch.topics || []).some((etp) => isSameLessonTopic(etp, tp))
            )
        );
        const hasNewMaterial = Boolean(
          existingCalendarMatch &&
            item.material.trim() &&
            !(existingCalendarMatch.material || '')
              .toLowerCase()
              .includes(item.material.trim().toLowerCase())
        );

        const dup = resolvedDate
          ? seenExams.some(
              (k) =>
                k.date === resolvedDate &&
                (k.type === normalizedType ||
                  (isMajorExamType(k.type) && isMajorExamType(normalizedType))) &&
                (!k.startTime || !resolvedStartTime || k.startTime === resolvedStartTime) &&
                isLikelyDuplicateSubject(k.subject, item.subject)
            )
          : false;
        if (!dup && resolvedDate) {
          seenExams.push({
            subject: item.subject,
            date: resolvedDate,
            startTime: resolvedStartTime || '',
            type: normalizedType,
          });
        }
        return {
          ...item,
          date: resolvedDate,
          startTime: resolvedStartTime,
          endTime: resolvedEndTime,
          room: resolvedRoom,
          type: normalizedType,
          topics,
          _id: randomId(),
          _selected: !dup || hasNewTopics || hasNewMaterial,
          _dup: dup,
        };
      });

      const existingLessonPool: Array<{ subject: string; title: string }> = [];
      for (const l of lessons || []) {
        const parts = splitMultiLessonText(l.title);
        for (const part of parts.length > 0 ? parts : [l.title]) {
          existingLessonPool.push({ subject: l.subject, title: part });
        }
      }
      const reviewLessons: ScannedLessonDraft[] = candidateLessons.map((item) => {
        const dup = existingLessonPool.some(
          (k) =>
            isLikelyDuplicateSubject(k.subject, item.subject) &&
            isSameLessonTopic(k.title, item.title)
        );
        if (!dup) {
          existingLessonPool.push({ subject: item.subject, title: item.title });
        }
        return {
          ...item,
          _id: randomId(),
          _selected: !dup,
          _dup: dup,
        };
      });

      setDrafts(reviewExams);
      setLessonDrafts(reviewLessons);
      setIgnoredItems(Array.from(new Set(result.ignored)));

      if (reviewExams.length === 0 && reviewLessons.length === 0) {
        setScanErrors([
          'No exams or study lessons were found across those files. Try clearer schedule or syllabus documents.',
        ]);
        setScannerCollapsed(false);
        setStage('queue');
        return;
      }
      setScannerCollapsed(false);
      setStage('review');
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        setStage('queue');
        return;
      }
      setScanErrors([
        err instanceof Error ? err.message : 'Could not connect and scan those files.',
      ]);
      setScannerCollapsed(false);
      setStage('queue');
    }
  }

  function updateDraft(id: string, patch: Partial<ScannedExamDraft>) {
    setDrafts((prev) => prev.map((d) => (d._id === id ? { ...d, ...patch } : d)));
  }

  function updateLessonDraft(id: string, patch: Partial<ScannedLessonDraft>) {
    setLessonDrafts((prev) => prev.map((d) => (d._id === id ? { ...d, ...patch } : d)));
  }

  const selectedExams = drafts.filter((d) => d._selected);
  const selectedLessons = lessonDrafts.filter((d) => d._selected && d.title.trim().length > 0);
  const missingDates = selectedExams.filter((d) => !isValidIsoDate(d.date));
  const canSave =
    (selectedExams.length > 0 || selectedLessons.length > 0) &&
    missingDates.length === 0 &&
    !saving;

  async function handleSaveScanned() {
    if (!canSave) return;
    setSaving(true);
    setScanErrors([]);
    try {
      // Ensure any topics manually edited on a draft exam also appear in the saved lessons checklist,
      // splitting multi-lesson entries into individual lessons without duplicates.
      const mergedLessons: LessonInput[] = [];
      for (const l of selectedLessons) {
        for (const part of splitMultiLessonText(l.title)) {
          const exists = mergedLessons.some(
            (cur) =>
              isLikelyDuplicateSubject(cur.subject, l.subject || 'General') &&
              isSameLessonTopic(cur.title, part)
          );
          if (!exists) {
            mergedLessons.push({
              subject: l.subject || 'General',
              title: part,
              notes: l.notes.trim(),
            });
          }
        }
      }

      for (const d of selectedExams) {
        for (const cleanTp of dedupeTopicList(d.topics || [])) {
          const exists = mergedLessons.some(
            (l) =>
              isLikelyDuplicateSubject(l.subject, d.subject || 'Untitled exam') &&
              isSameLessonTopic(l.title, cleanTp)
          );
          if (!exists) {
            mergedLessons.push({
              subject: d.subject || 'General',
              title: cleanTp,
              notes: d.material ? `Material: ${d.material}` : '',
            });
          }
        }
      }

      const normalizedExams: ExamInput[] = selectedExams.map((d) => {
        let topics = dedupeTopicList(d.topics || []);
        if (topics.length === 0) {
          const sameSubjectSelected = selectedExams.filter((other) =>
            isLikelyDuplicateSubject(other.subject, d.subject)
          ).length;
          if (sameSubjectSelected === 1) {
            topics = dedupeTopicList(
              mergedLessons
                .filter((l) => isLikelyDuplicateSubject(l.subject, d.subject) && l.title.trim())
                .map((l) => l.title.trim())
            );
          }
        }
        return {
          subject: d.subject || 'Untitled exam',
          date: d.date,
          startTime: d.startTime,
          endTime: d.endTime,
          room: d.room,
          type: d.type,
          material: d.material,
          topics,
          notes: d.notes,
        };
      });

      await onSaveBatch({
        exams: normalizedExams,
        lessons: mergedLessons,
      });
      setSavedCounts({ exams: normalizedExams.length, lessons: mergedLessons.length });
      clearMajorScanDrafts();
      setQueuedFiles([]);
      setDrafts([]);
      setLessonDrafts([]);
      setIgnoredItems([]);
      setStage('saved');
    } catch (err: unknown) {
      setScanErrors([
        err instanceof Error ? err.message : 'Could not save scanned assessments.',
      ]);
    } finally {
      setSaving(false);
    }
  }

  function handleResetScanner() {
    abortControllerRef.current?.abort();
    clearMajorScanDrafts();
    setStage('queue');
    setDrafts([]);
    setLessonDrafts([]);
    setIgnoredItems([]);
    setScanErrors([]);
    setScanDetail('');
  }

  const defaultAddType: ExamType =
    typeFilter === 'monthly' || typeFilter === 'midterm' || typeFilter === 'final'
      ? typeFilter
      : 'midterm';

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-paper grain">
      <header className="sticky top-0 z-20 bg-paper-blur border-b hairline">
        <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-primary/65 flex items-center gap-1.5">
              <CalendarRange size={12} className="shrink-0" />
              <span className="truncate">{t('assessmentsTitle')}</span>
            </div>
            <h1 className="font-display text-[1.22rem] sm:text-[1.45rem] md:text-[1.68rem] font-semibold leading-snug break-words">
              {t('assessmentsSubtitle')}
            </h1>
          </div>

          <div className="w-full sm:w-auto flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onGoStudy}
              className="flex-1 sm:flex-initial justify-center h-9 px-3 sm:px-3.5 rounded-xl btn-secondary text-[0.76rem] sm:text-[0.8rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer min-w-0"
            >
              <BookCheck size={14} className="text-[#2F8F72] shrink-0" />
              <span className="truncate">{t('navStudy')}</span>
              {overallReadiness.total > 0 && (
                <span className="ms-0.5 text-[0.72rem] font-bold text-[#2F8F72] tabular-nums shrink-0">
                  {overallReadiness.pct}%
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onAddMajor(defaultAddType)}
              className="flex-1 sm:flex-initial justify-center h-9 px-3 sm:px-3.5 rounded-xl bg-primary text-on-primary text-[0.76rem] sm:text-[0.8rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer min-w-0"
            >
              <Plus size={15} className="shrink-0" />
              <span className="truncate">{t('addMajorExam')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Compact mobile/tablet section switcher so phone users can jump straight to Dates or Scanner */}
      <div className="lg:hidden max-w-6xl mx-auto w-full px-3 sm:px-4 pt-3">
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-surface p-1 border hairline">
          <button
            type="button"
            onClick={() => setMobilePane('all')}
            className={`h-8 rounded-xl px-2 text-[0.74rem] font-semibold transition cursor-pointer truncate ${
              mobilePane === 'all'
                ? 'bg-primary text-on-primary'
                : 'text-primary/70 hover:bg-primary/8'
            }`}
          >
            {t('filterAllMajor')}
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('dates')}
            className={`h-8 rounded-xl px-2 text-[0.74rem] font-semibold transition cursor-pointer truncate ${
              mobilePane === 'dates'
                ? 'bg-primary text-on-primary'
                : 'text-primary/70 hover:bg-primary/8'
            }`}
          >
            {t('verticalDatesTitle')} ({filteredMajorExams.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setMobilePane('scanner');
              setScannerCollapsed(false);
            }}
            className={`h-8 rounded-xl px-2 text-[0.74rem] font-semibold transition cursor-pointer truncate ${
              mobilePane === 'scanner'
                ? 'bg-primary text-on-primary'
                : 'text-primary/70 hover:bg-primary/8'
            }`}
          >
            {t('navScan')}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-8 py-3.5 sm:py-5 md:py-7 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] md:pb-10 grid lg:grid-cols-[1.08fr_1.22fr] duo-spanned-grid gap-4 sm:gap-6 items-start">
        {/* LEFT COLUMN: Connected Multi-File Scanner */}
        <section
          className={`card p-3.5 sm:p-4 md:p-5 space-y-4 min-w-0 ${
            mobilePane === 'dates' ? 'hidden lg:block' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-secondary">
                <Files size={13} />
                <span>{t('correlatedScannerTitle')}</span>
              </div>
              <p className="mt-1 text-[0.8rem] text-primary/65 leading-relaxed">
                {t('correlatedScannerDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScannerCollapsed((s) => !s)}
              className="lg:hidden h-8 w-8 grid place-items-center rounded-lg btn-ghost cursor-pointer shrink-0"
              aria-label="Toggle scanner"
            >
              {scannerCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*,.txt,.md,.csv,text/plain"
            multiple
            className="hidden"
            onChange={(e) => {
              addFilesToQueue(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              addFilesToQueue(e.target.files);
              e.target.value = '';
            }}
          />

          {!scannerCollapsed && (
            <>
              {scanErrors.length > 0 && (
                <div className="rounded-xl bg-secondary/10 px-3.5 py-2.5 space-y-2 border border-secondary/20">
                  <div className="space-y-1">
                    {scanErrors.map((err, i) => (
                      <p key={i} className="text-[0.78rem] font-medium text-secondary flex gap-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>{err}</span>
                      </p>
                    ))}
                  </div>
                  {stage === 'queue' && queuedFiles.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleConnectAndScan}
                        className="h-8 px-3 rounded-lg bg-primary text-on-primary text-[0.74rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw size={12} /> {t('tryAgain')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {stage === 'queue' && (
                <div className="space-y-3.5">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      addFilesToQueue(e.dataTransfer.files);
                    }}
                    className={`cursor-pointer rounded-2xl border-2 border-dashed transition px-3 py-5 sm:px-4 sm:py-7 text-center ${
                      isDragging
                        ? 'border-secondary bg-secondary/5'
                        : 'border-primary/20 hover:border-secondary/50'
                    }`}
                  >
                    <div className="mx-auto h-11 w-11 rounded-2xl bg-secondary/10 grid place-items-center mb-3">
                      <Upload size={20} className="text-secondary" />
                    </div>
                    <p className="font-display text-[1.06rem] font-semibold">
                      {queuedFiles.length === 0 ? t('chooseFile') : t('addMoreFiles')}
                    </p>
                    <p className="mt-1 text-[0.76rem] text-primary/55">
                      PDF, images, CSV, TXT, MD · up to 12 files connected together
                    </p>
                    <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-[0.76rem] font-semibold text-on-primary">
                        <Upload size={13} /> {queuedFiles.length === 0 ? t('chooseFile') : t('addMoreFiles')}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          cameraInputRef.current?.click();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl btn-secondary px-3.5 py-2 text-[0.76rem] font-semibold cursor-pointer"
                      >
                        <Camera size={13} /> {t('takePhoto')}
                      </button>
                    </div>
                  </div>

                  {queuedFiles.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[0.72rem] font-bold uppercase tracking-wider text-primary/55">
                        <span>
                          {t('queuedFilesLabel')} ({queuedFiles.length}/12)
                        </span>
                        <button
                          type="button"
                          onClick={() => setQueuedFiles([])}
                          className="text-secondary hover:underline cursor-pointer"
                        >
                          Clear all
                        </button>
                      </div>
                      <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {queuedFiles.map((file, idx) => (
                          <li
                            key={`${file.name}-${file.size}-${idx}`}
                            className="flex items-center justify-between gap-2 rounded-xl border border-primary/10 bg-surface-soft px-3 py-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="h-5 w-5 rounded-md bg-primary/10 text-[0.68rem] font-bold grid place-items-center shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-[0.8rem] font-medium truncate">
                                {file.name}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeQueuedFile(idx)}
                              aria-label={`Remove ${file.name}`}
                              className="h-6 w-6 grid place-items-center rounded-lg text-primary/45 hover:text-secondary cursor-pointer shrink-0"
                            >
                              <X size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>

                      <div className="grid grid-cols-1 min-[360px]:flex min-[360px]:flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="h-10 px-3.5 rounded-xl btn-secondary text-[0.8rem] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <FilePlus2 size={14} className="shrink-0" />
                          <span>{t('addMoreFiles')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => cameraInputRef.current?.click()}
                          className="h-10 px-3 rounded-xl btn-secondary text-[0.8rem] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Camera size={14} className="shrink-0" />
                          <span>{t('takePhoto')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleConnectAndScan}
                          className="flex-1 min-w-0 min-[360px]:min-w-[10.5rem] h-10 px-4 rounded-xl bg-primary text-on-primary text-[0.84rem] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Sparkles size={15} className="shrink-0" />
                          <span className="truncate">{t('connectAndScanBtn')}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {stage === 'reading' && (
                <div className="rounded-2xl border border-primary/10 bg-surface-soft p-6 text-center space-y-3">
                  <Loader2 size={24} className="mx-auto animate-spin text-secondary" />
                  <div className="font-display text-[1.08rem] font-semibold">{t('readingDoc')}</div>
                  <p className="text-[0.8rem] text-primary/65">{scanDetail}</p>
                  <button
                    type="button"
                    onClick={handleResetScanner}
                    className="h-9 px-4 rounded-xl btn-secondary text-[0.78rem] font-semibold cursor-pointer"
                  >
                    {t('stopReading')}
                  </button>
                </div>
              )}

              {stage === 'review' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded-lg bg-primary px-2.5 py-1 text-[0.72rem] font-semibold text-on-primary">
                        {drafts.length} exam{drafts.length === 1 ? '' : 's'}
                      </span>
                      <span className="rounded-lg bg-[#2F8F72]/15 px-2.5 py-1 text-[0.72rem] font-semibold text-[#2F8F72]">
                        {lessonDrafts.length} lesson{lessonDrafts.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetScanner}
                      className="text-[0.76rem] font-semibold text-primary/60 hover:text-secondary cursor-pointer inline-flex items-center gap-1"
                    >
                      <Trash2 size={13} /> {t('cancel')}
                    </button>
                  </div>

                  {drafts.length > 0 && (
                    <div className="space-y-2 lg:max-h-[26rem] lg:overflow-y-auto lg:pr-1">
                      {drafts.map((item) => {
                        const cfg = getExamTypeConfig(item.type);
                        return (
                          <div
                            key={item._id}
                            className={`rounded-2xl border border-primary/12 bg-surface-soft p-3 transition ${
                              item._selected ? '' : 'opacity-55'
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                type="button"
                                onClick={() => updateDraft(item._id, { _selected: !item._selected })}
                                aria-label="Toggle exam selection"
                                className="mt-1 h-5 w-5 rounded-md grid place-items-center border shrink-0 cursor-pointer"
                                style={{
                                  backgroundColor: item._selected ? cfg.color : 'transparent',
                                  borderColor: item._selected ? cfg.color : 'rgba(128,128,128,0.35)',
                                }}
                              >
                                {item._selected && <Check size={12} className="text-white" />}
                              </button>

                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <input
                                    dir="auto"
                                    className="field-sm flex-1 min-w-[8rem] font-semibold"
                                    value={item.subject}
                                    onChange={(e) => updateDraft(item._id, { subject: e.target.value })}
                                    placeholder={t('subject')}
                                  />
                                  {item._dup && (
                                    <span className="rounded-md bg-[#2F8F72]/15 px-2 py-0.5 text-[0.66rem] font-semibold text-[#2F8F72] shrink-0">
                                      Merges with existing
                                    </span>
                                  )}
                                </div>
                                <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
                                  <input
                                    type="date"
                                    className="field-sm w-full sm:w-[9.5rem]"
                                    value={item.date}
                                    onChange={(e) => updateDraft(item._id, { date: e.target.value })}
                                  />
                                  <input
                                    type="time"
                                    className="field-sm w-full sm:w-[6.5rem]"
                                    value={item.startTime}
                                    onChange={(e) =>
                                      updateDraft(item._id, { startTime: e.target.value })
                                    }
                                  />
                                  <select
                                    className="field-sm w-full sm:w-[7rem]"
                                    value={item.type}
                                    onChange={(e) =>
                                      updateDraft(item._id, { type: e.target.value as ExamType })
                                    }
                                  >
                                    {EXAM_TYPES.map((tp) => (
                                      <option key={tp.key} value={tp.key}>
                                        {getExamTypeLabel(tp.key, lang)}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    dir="auto"
                                    className="field-sm w-full sm:flex-1 min-w-0 sm:min-w-[5.5rem]"
                                    value={item.room}
                                    onChange={(e) => updateDraft(item._id, { room: e.target.value })}
                                    placeholder={t('roomHallLabel')}
                                  />
                                </div>
                                <input
                                  dir="auto"
                                  className="field-sm w-full"
                                  value={item.material}
                                  onChange={(e) => updateDraft(item._id, { material: e.target.value })}
                                  placeholder={t('materialLabel')}
                                />
                                <input
                                  dir="auto"
                                  className="field-sm w-full"
                                  value={item.topics.join(', ')}
                                  onChange={(e) =>
                                    updateDraft(item._id, {
                                      topics: e.target.value
                                        .split(/[,،]+/)
                                        .map((x) => x.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                  placeholder={t('includedTopicsLabel')}
                                />
                                {!isValidIsoDate(item.date) && (
                                  <span className="block text-[0.7rem] font-semibold text-secondary">
                                    {t('dateLabel')} required
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {lessonDrafts.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[0.72rem] font-bold uppercase tracking-wider text-primary/60 flex items-center gap-1.5">
                          <BookCheck size={13} />
                          {t('studyChecklist')} ({selectedLessons.length}/{lessonDrafts.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const allSel = selectedLessons.length === lessonDrafts.length;
                            setLessonDrafts((prev) =>
                              prev.map((l) => ({ ...l, _selected: !allSel }))
                            );
                          }}
                          className="btn-secondary px-2.5 py-1 rounded-lg text-[0.72rem] font-semibold cursor-pointer"
                        >
                          {selectedLessons.length === lessonDrafts.length
                            ? t('uncheckAll')
                            : t('checkAll')}
                        </button>
                      </div>
                      <div className="lg:max-h-56 lg:overflow-y-auto space-y-1.5 lg:pr-1">
                        {lessonDrafts.map((lesson) => {
                          const linkedDraftExam =
                            selectedExams.find(
                              (ex) =>
                                isLikelyDuplicateSubject(ex.subject, lesson.subject) &&
                                (ex.topics || []).some((tp) => isSameLessonTopic(tp, lesson.title))
                            ) ||
                            selectedExams.find((ex) =>
                              isLikelyDuplicateSubject(ex.subject, lesson.subject)
                            );
                          const linkedExistingExam = !linkedDraftExam
                            ? majorExams.find(
                                (ex) =>
                                  isLikelyDuplicateSubject(ex.subject, lesson.subject) &&
                                  (ex.topics || []).some((tp) => isSameLessonTopic(tp, lesson.title))
                              ) ||
                              majorExams.find((ex) =>
                                isLikelyDuplicateSubject(ex.subject, lesson.subject)
                              )
                            : undefined;
                          const linkTarget = linkedDraftExam || linkedExistingExam;

                          return (
                            <div
                              key={lesson._id}
                              className={`flex items-start gap-2 rounded-xl border border-primary/10 bg-surface-soft p-2 ${
                                lesson._selected ? '' : 'opacity-55'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  updateLessonDraft(lesson._id, { _selected: !lesson._selected })
                                }
                                aria-label="Toggle lesson"
                                className={`mt-1 h-4.5 w-4.5 rounded grid place-items-center border shrink-0 cursor-pointer ${
                                  lesson._selected
                                    ? 'bg-[#2F8F72] border-[#2F8F72] text-white'
                                    : 'border-primary/30'
                                }`}
                              >
                                {lesson._selected && <Check size={11} strokeWidth={2.75} />}
                              </button>
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="grid sm:grid-cols-[0.8fr_1.3fr] gap-1.5">
                                  <input
                                    dir="auto"
                                    className="field-sm font-semibold"
                                    value={lesson.subject}
                                    onChange={(e) =>
                                      updateLessonDraft(lesson._id, { subject: e.target.value })
                                    }
                                    placeholder={t('subject')}
                                  />
                                  <input
                                    dir="auto"
                                    className="field-sm"
                                    value={lesson.title}
                                    onChange={(e) =>
                                      updateLessonDraft(lesson._id, { title: e.target.value })
                                    }
                                    placeholder={t('lessonOrTopic')}
                                  />
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <input
                                    dir="auto"
                                    className="field-sm flex-1 min-w-[8rem] text-[0.75rem]"
                                    value={lesson.notes}
                                    onChange={(e) =>
                                      updateLessonDraft(lesson._id, { notes: e.target.value })
                                    }
                                    placeholder={t('notesLabel')}
                                  />
                                  {linkTarget && (
                                    <span className="rounded-md bg-primary/8 px-2 py-0.5 text-[0.66rem] font-medium text-primary/70 shrink-0">
                                      → {linkTarget.subject}
                                      {linkTarget.date ? ` · ${linkTarget.date}` : ''}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {ignoredItems.length > 0 && (
                    <div className="rounded-xl border border-primary/10 bg-surface-soft px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setShowIgnored((s) => !s)}
                        className="w-full flex items-center justify-between text-[0.75rem] font-semibold text-primary/65 cursor-pointer"
                      >
                        <span>Skipped non-academic items ({ignoredItems.length})</span>
                        {showIgnored ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {showIgnored && (
                        <ul className="mt-2 space-y-1 text-[0.74rem] text-primary/50 border-t hairline pt-2">
                          {ignoredItems.map((line, i) => (
                            <li key={i}>· {line}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {missingDates.length > 0 && (
                    <div className="rounded-xl bg-secondary/10 px-3 py-2 text-[0.76rem] font-medium text-secondary flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>
                        Add a date or uncheck {missingDates.length} selected exam
                        {missingDates.length === 1 ? '' : 's'} above before saving.
                      </span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSaveScanned}
                    disabled={!canSave}
                    className="w-full h-11 rounded-xl bg-primary text-on-primary text-[0.86rem] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    {saving && <Loader2 size={15} className="animate-spin" />}
                    <span>
                      Save {selectedExams.length} exam{selectedExams.length === 1 ? '' : 's'}
                      {selectedLessons.length > 0
                        ? ` & ${selectedLessons.length} lesson${selectedLessons.length === 1 ? '' : 's'}`
                        : ''}
                    </span>
                  </button>
                </div>
              )}

              {stage === 'saved' && (
                <div className="rounded-2xl border border-primary/10 bg-surface-soft p-6 text-center space-y-3">
                  <div className="mx-auto h-12 w-12 rounded-full bg-[#2F8F72]/15 grid place-items-center">
                    <Check size={22} className="text-[#2F8F72]" />
                  </div>
                  <div className="font-display text-[1.15rem] font-semibold">
                    {savedCounts.exams} exam{savedCounts.exams === 1 ? '' : 's'} &{' '}
                    {savedCounts.lessons} lesson{savedCounts.lessons === 1 ? '' : 's'} saved
                  </div>
                  <p className="text-[0.8rem] text-primary/60">
                    Your vertical exam dates and Study Centre lessons are now synced.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setMobilePane('dates')}
                      className="lg:hidden h-9 px-4 rounded-xl bg-primary text-on-primary text-[0.8rem] font-semibold cursor-pointer"
                    >
                      {t('verticalDatesTitle')}
                    </button>
                    <button
                      type="button"
                      onClick={onGoStudy}
                      className="h-9 px-4 rounded-xl bg-[#2F8F72] text-white text-[0.8rem] font-semibold cursor-pointer"
                    >
                      {t('openStudyCentre')}
                    </button>
                    <button
                      type="button"
                      onClick={handleResetScanner}
                      className="h-9 px-4 rounded-xl btn-secondary text-[0.8rem] font-semibold cursor-pointer"
                    >
                      {t('scanAnother')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* RIGHT COLUMN: Vertical Chronological Dates Calendar (stacked underneath each other) */}
        <section
          className={`space-y-4 min-w-0 ${
            mobilePane === 'scanner' ? 'hidden lg:block' : ''
          }`}
        >
          <div className="card p-3.5 sm:p-4 md:p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-[1.12rem] sm:text-[1.18rem] font-semibold leading-snug break-words">
                  {t('verticalDatesTitle')}
                </h2>
                <p className="text-[0.76rem] sm:text-[0.78rem] text-primary/55 leading-snug">
                  {t('verticalDatesSub')}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-lg bg-primary/8 px-2.5 py-1 text-[0.74rem] font-semibold text-primary/75 tabular-nums shrink-0">
                <Layers size={13} />
                <span>{filteredMajorExams.length}</span>
              </span>
            </div>

            {/* Type Filter Tabs */}
            <div className="grid grid-cols-2 min-[480px]:flex min-[480px]:flex-wrap gap-1.5">
              {(
                [
                  { key: 'all', label: `${t('filterAllMajor')} (${countsByType.all})` },
                  ...MAJOR_EXAM_TYPES.map((tp) => ({
                    key: tp as MajorFilter,
                    label: `${getExamTypeLabel(tp, lang)} (${
                      tp === 'monthly'
                        ? countsByType.monthly
                        : tp === 'midterm'
                        ? countsByType.midterm
                        : countsByType.final
                    })`,
                  })),
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setTypeFilter(tab.key)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[0.74rem] sm:text-[0.76rem] font-semibold transition cursor-pointer truncate text-center ${
                    typeFilter === tab.key
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-soft text-primary/75 hover:bg-primary/10'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {loading && exams.length === 0 ? (
            <div className="space-y-3">
              <div className="h-28 rounded-2xl bg-primary/10 softpulse" />
              <div className="h-28 rounded-2xl bg-primary/10 softpulse" />
            </div>
          ) : error && exams.length === 0 ? (
            <div className="card p-6 text-center space-y-3">
              <p className="text-[0.86rem] text-secondary font-medium">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="h-9 px-4 rounded-xl bg-primary text-on-primary text-[0.8rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw size={14} /> {t('tryAgain')}
              </button>
            </div>
          ) : dateGroups.length === 0 ? (
            <div className="card p-7 text-center space-y-3">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
                <CalendarRange size={22} className="text-primary/50" />
              </div>
              <h3 className="font-display text-[1.2rem] font-semibold">{t('noMajorExamsYet')}</h3>
              <p className="text-[0.82rem] text-primary/60 max-w-md mx-auto">
                {t('noMajorExamsDesc')}
              </p>
              <button
                type="button"
                onClick={() => onAddMajor(defaultAddType)}
                className="h-9 px-4 rounded-xl bg-primary text-on-primary text-[0.82rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={14} /> {t('addMajorExam')}
              </button>
            </div>
          ) : (
            /* Vertical Stack: Dates placed strictly underneath each other */
            <div className="space-y-3.5">
              {dateGroups.map((group) => (
                <div key={group.date} className="card p-3.5 sm:p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b hairline">
                    <div className="font-display text-[0.98rem] sm:text-[1.06rem] font-semibold leading-snug break-words min-w-0">
                      {group.date === 'undated'
                        ? 'Date to be confirmed'
                        : formatLocalizedDate(group.date, 'EEEE, d MMMM yyyy', lang)}
                    </div>
                    {group.date !== 'undated' && (
                      <span className="rounded-lg bg-primary/8 px-2.5 py-0.5 text-[0.72rem] font-semibold text-primary/70 shrink-0">
                        {formatRelativeDayLocalized(group.date, lang)}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    {group.exams.map((ex) => {
                      const cfg = getExamTypeConfig(ex.type);
                      const readiness = getExamReadiness(ex, lessons);
                      return (
                        <div
                          key={ex.id}
                          className="rounded-2xl border border-primary/10 bg-surface-soft p-3 sm:p-3.5 hover:border-primary/25 transition"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-3">
                            <button
                              type="button"
                              onClick={() => onEdit(ex)}
                              className="min-w-0 w-full sm:flex-1 text-start cursor-pointer"
                            >
                              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                                <span
                                  className="rounded-lg px-2 py-0.5 text-[0.66rem] sm:text-[0.68rem] font-bold uppercase tracking-wide shrink-0"
                                  style={{ backgroundColor: `${cfg.color}18`, color: cfg.color }}
                                >
                                  {getExamTypeLabel(ex.type, lang)}
                                </span>
                                <h3
                                  dir="auto"
                                  className="font-display text-[1rem] sm:text-[1.05rem] font-semibold leading-snug break-words [overflow-wrap:anywhere] min-w-0"
                                >
                                  {ex.subject}
                                </h3>
                              </div>

                              {(ex.startTime || ex.room) && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.74rem] sm:text-[0.76rem] text-primary/60">
                                  {ex.startTime && (
                                    <span className="inline-flex items-center gap-1 shrink-0">
                                      <Clock size={12} />
                                      {formatTime12h(ex.startTime)}
                                      {ex.endTime ? ` – ${formatTime12h(ex.endTime)}` : ''}
                                    </span>
                                  )}
                                  {ex.room && (
                                    <span className="inline-flex items-center gap-1 min-w-0 break-words">
                                      <MapPin size={12} className="shrink-0" />
                                      <span className="break-words">{ex.room}</span>
                                    </span>
                                  )}
                                </div>
                              )}

                              {ex.material && (
                                <p
                                  dir="auto"
                                  className="mt-1.5 text-[0.76rem] sm:text-[0.78rem] text-primary/75 leading-snug break-words [overflow-wrap:anywhere]"
                                >
                                  <span className="font-semibold">{t('materialLabel')}:</span>{' '}
                                  {ex.material}
                                </p>
                              )}

                              {ex.topics && ex.topics.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {ex.topics.slice(0, 6).map((topic, idx) => (
                                    <span
                                      key={idx}
                                      dir="auto"
                                      className="rounded-md bg-primary/8 px-2 py-0.5 text-[0.7rem] font-medium text-primary/75 max-w-full break-words"
                                    >
                                      {topic}
                                    </span>
                                  ))}
                                  {ex.topics.length > 6 && (
                                    <span className="text-[0.7rem] text-primary/50 px-1 py-0.5">
                                      +{ex.topics.length - 6}
                                    </span>
                                  )}
                                </div>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={onGoStudy}
                              className="w-full sm:w-auto shrink-0 rounded-xl border border-primary/12 bg-surface px-3 py-2 sm:px-2.5 sm:py-1.5 text-[0.74rem] sm:text-[0.73rem] font-semibold hover:border-[#2F8F72]/50 transition cursor-pointer flex items-center justify-between sm:justify-start gap-1.5"
                            >
                              {readiness.totalCount === 0 ? (
                                <span className="text-primary/55 inline-flex items-center gap-1.5">
                                  <Circle size={12} /> {t('noTopicsLinked')}
                                </span>
                              ) : readiness.isReady ? (
                                <span className="text-[#2F8F72] inline-flex items-center gap-1.5">
                                  <CheckCircle2 size={13} /> {readiness.finishedCount}/
                                  {readiness.totalCount}
                                </span>
                              ) : (
                                <span className="text-secondary inline-flex items-center gap-1.5">
                                  <BookCheck size={13} /> {readiness.finishedCount}/
                                  {readiness.totalCount}
                                </span>
                              )}
                              <span className="sm:hidden text-[0.68rem] text-primary/50">
                                {t('navStudy')}
                              </span>
                            </button>
                          </div>

                          {readiness.totalCount > 0 && (
                            <div className="mt-2.5 h-1.5 rounded-full bg-primary/10 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#2F8F72] transition-all duration-300"
                                style={{
                                  width: `${Math.round(
                                    (readiness.finishedCount / readiness.totalCount) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
