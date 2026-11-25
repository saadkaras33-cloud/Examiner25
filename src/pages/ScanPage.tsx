import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookCheck,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  FileScan,
  GraduationCap,
  Loader2,
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
  dedupeTopicList,
  formatTime12h,
  getExamTypeConfig,
  isLikelyDuplicateSubject,
  isSameLessonTopic,
  isValidIsoDate,
  randomId,
  splitMultiLessonText,
} from '../utils/exams.ts';
import {
  formatLocalizedDate,
  getExamTypeLabel,
  useTranslation,
} from '../utils/i18n.tsx';
import {
  clearScanDrafts,
  getSavedScanDrafts,
  saveScanDrafts,
  scanScheduleFile,
} from '../services/api.ts';

interface ScanPageProps {
  exams: Exam[];
  lessons: LessonItem[];
  onSaveBatch: (payload: { exams: ExamInput[]; lessons: LessonInput[] }) => Promise<void>;
  onExit: () => void;
  onGoStudy: () => void;
}

type ScanStage = 'idle' | 'reading' | 'review' | 'saved';

const KEPT_ITEMS = [
  'Finals, midterms, quizzes & practicals',
  'Study materials & what each exam covers',
  'Lessons, chapters & syllabus topics',
  'Resits and make-ups',
];

const SKIPPED_ITEMS = [
  'Holidays and term dates',
  'Registration deadlines',
  'Fee notices & general announcements',
  'Non-academic schedules',
];

export default function ScanPage({
  exams,
  lessons,
  onSaveBatch,
  onExit,
  onGoStudy,
}: ScanPageProps) {
  const { lang, t } = useTranslation();
  const initialDraftsRef = useRef(getSavedScanDrafts());
  const [stage, setStage] = useState<ScanStage>(() =>
    initialDraftsRef.current ? 'review' : 'idle'
  );
  const [progress, setProgress] = useState({ index: 0, total: 0, name: '', detail: '' });
  const [drafts, setDrafts] = useState<ScannedExamDraft[]>(
    () => initialDraftsRef.current?.drafts || []
  );
  const [lessonDrafts, setLessonDrafts] = useState<ScannedLessonDraft[]>(
    () => initialDraftsRef.current?.lessonDrafts || []
  );
  const [ignoredItems, setIgnoredItems] = useState<string[]>(
    () => initialDraftsRef.current?.ignoredItems || []
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [showIgnored, setShowIgnored] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedCounts, setSavedCounts] = useState({ exams: 0, lessons: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFilesRef = useRef<File[]>([]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (stage === 'review' && (drafts.length > 0 || lessonDrafts.length > 0)) {
      saveScanDrafts({ drafts, lessonDrafts, ignoredItems });
    }
  }, [stage, drafts, lessonDrafts, ignoredItems]);

  const existingKeys = useMemo(
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

  async function processFiles(fileList: FileList | File[] | null) {
    const files = Array.from(fileList || []).slice(0, 20);
    if (files.length === 0) return;
    lastFilesRef.current = files;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    cancelledRef.current = false;
    setStage('reading');
    setErrors([]);
    setSavedCounts({ exams: 0, lessons: 0 });
    setDrafts([]);
    setLessonDrafts([]);
    setIgnoredItems([]);

    const extractedExams: Array<ExamInput & { material: string; topics: string[] }> = [];
    const extractedLessons: Array<{ subject: string; title: string; notes: string }> = [];
    const skipped: string[] = [];
    const errList: string[] = [];

    for (let i = 0; i < files.length && !cancelledRef.current; i++) {
      const file = files[i];
      setProgress({ index: i + 1, total: files.length, name: file.name, detail: 'Preparing document…' });
      try {
        const result = await scanScheduleFile(file, {
          signal: controller.signal,
          onProgress: (info) => {
            if (!cancelledRef.current) {
              setProgress({
                index: i + 1,
                total: files.length,
                name: file.name,
                detail: info.detail,
              });
            }
          },
        });
        if (cancelledRef.current) break;

        for (const ex of result.exams) {
          extractedExams.push(ex);
        }
        for (const ls of result.lessons) {
          extractedLessons.push(ls);
        }
        for (const line of result.ignored) {
          skipped.push(line);
        }
        if (result.exams.length === 0 && result.lessons.length === 0) {
          errList.push(`${file.name}: no exam dates or study lessons were found in this document.`);
        }
      } catch (err: unknown) {
        if (cancelledRef.current) break;
        const msg = err instanceof Error ? err.message : 'could not be read';
        errList.push(`${file.name}: ${msg}`);
      }
    }

    if (cancelledRef.current) {
      setDrafts([]);
      setLessonDrafts([]);
      setIgnoredItems([]);
      setErrors([]);
      setSavedCounts({ exams: 0, lessons: 0 });
      setStage('idle');
      return;
    }

    // Expand any combined lesson strings and mirror exam topics into lesson candidates
    const candidateLessons: Array<{ subject: string; title: string; notes: string }> = [];
    for (const l of extractedLessons) {
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
    for (const ex of extractedExams) {
      for (const topic of dedupeTopicList(ex.topics || [])) {
        const alreadyListed = candidateLessons.some(
          (l) =>
            isLikelyDuplicateSubject(l.subject, ex.subject) &&
            isSameLessonTopic(l.title, topic)
        );
        if (!alreadyListed) {
          candidateLessons.push({
            subject: ex.subject,
            title: topic,
            notes: ex.material ? `Material: ${ex.material}` : '',
          });
        }
      }
    }

    const seenExams = existingKeys.map((k) => ({ ...k }));
    const reviewExams: ScannedExamDraft[] = extractedExams.map((item) => {
      let topics = dedupeTopicList(item.topics || []);
      if (topics.length === 0) {
        const subjectExamsCount = extractedExams.filter((other) =>
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
      const dup = item.date
        ? seenExams.some(
            (k) =>
              k.date === item.date &&
              k.type === item.type &&
              (!k.startTime || !item.startTime || k.startTime === item.startTime) &&
              isLikelyDuplicateSubject(k.subject, item.subject)
          )
        : false;
      if (!dup && item.date) {
        seenExams.push({
          subject: item.subject,
          date: item.date,
          startTime: item.startTime || '',
          type: item.type || 'other',
        });
      }
      return {
        ...item,
        topics,
        _id: randomId(),
        _selected: !dup,
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
    setIgnoredItems(Array.from(new Set(skipped)));
    if (reviewExams.length === 0 && reviewLessons.length === 0 && errList.length === 0) {
      setErrors(['Nothing exam-like or lesson-like was found in that document.']);
    } else {
      setErrors(errList);
    }
    setStage(reviewExams.length > 0 || reviewLessons.length > 0 ? 'review' : 'idle');
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

  async function handleSaveAll() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSaveBatch({
        exams: selectedExams.map((d) => ({
          subject: d.subject || 'Untitled exam',
          date: d.date,
          startTime: d.startTime,
          endTime: d.endTime,
          room: d.room,
          type: d.type,
          material: d.material,
          topics: d.topics,
          notes: d.notes,
        })),
        lessons: selectedLessons.map((l) => ({
          subject: l.subject || 'General',
          title: l.title.trim(),
          notes: l.notes.trim(),
        })),
      });
      setSavedCounts({ exams: selectedExams.length, lessons: selectedLessons.length });
      clearScanDrafts();
      lastFilesRef.current = [];
      setStage('saved');
    } catch (err: unknown) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const msg = err instanceof Error ? err.message : 'Could not save the scanned items.';
      setErrors([
        offline
          ? "You're offline — nothing was saved. Your results are still here; reconnect and press save again."
          : msg,
      ]);
    } finally {
      setSaving(false);
    }
  }

  function handleStopReading() {
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
    clearScanDrafts();
    setStage('idle');
    setDrafts([]);
    setLessonDrafts([]);
    setIgnoredItems([]);
    setErrors([]);
    setProgress({ index: 0, total: 0, name: '', detail: '' });
  }

  function handleReset() {
    cancelledRef.current = false;
    abortControllerRef.current?.abort();
    clearScanDrafts();
    lastFilesRef.current = [];
    setStage('idle');
    setDrafts([]);
    setLessonDrafts([]);
    setIgnoredItems([]);
    setErrors([]);
    setProgress({ index: 0, total: 0, name: '', detail: '' });
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-paper grain">
      <header className="sticky top-0 z-20 bg-paper-blur border-b hairline">
        <div className="max-w-4xl mx-auto w-full px-3 sm:px-4 md:px-6 py-3 flex items-start gap-2.5">
          {stage !== 'idle' && (
            <button
              type="button"
              onClick={() =>
                stage === 'review' ? handleReset() : stage === 'reading' ? handleStopReading() : onExit()
              }
              aria-label={t('close')}
              className="mt-0.5 h-10 w-10 grid place-items-center rounded-xl btn-secondary shrink-0 cursor-pointer"
            >
              <ArrowLeft size={18} className="rtl:rotate-180" />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <div className="text-[0.63rem] font-semibold uppercase tracking-[0.16em] text-primary/65">
              {t('documentReader')}
            </div>
            <h1 className="font-display text-[1.35rem] sm:text-[1.45rem] md:text-[1.7rem] font-semibold leading-snug break-words">
              {stage === 'review'
                ? t('checkWhatIFound')
                : stage === 'saved'
                ? t('savedTitle')
                : t('scanTitle')}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto w-full px-3 sm:px-4 md:px-8 py-4 sm:py-5 md:py-8 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] md:pb-10">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*,.txt,.md,.csv,text/plain"
          multiple
          className="hidden"
          onChange={(e) => {
            processFiles(e.target.files);
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
            processFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {stage === 'idle' && (
          <div className="rise space-y-5">
            {errors.length > 0 && (
              <div className="rounded-2xl bg-secondary/10 px-4 py-3 space-y-2.5 border border-secondary/20">
                <div className="space-y-1">
                  {errors.map((err, idx) => (
                    <p key={idx} className="text-[0.8rem] font-medium text-secondary flex gap-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}
                    </p>
                  ))}
                </div>
                {lastFilesRef.current.length > 0 && (
                  <button
                    type="button"
                    onClick={() => processFiles(lastFilesRef.current)}
                    className="h-9 px-3.5 rounded-xl bg-primary text-on-primary text-[0.78rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={13} /> {t('tryAgain')}
                  </button>
                )}
              </div>
            )}

            <div className="card p-5 md:p-7">
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
                  processFiles(e.dataTransfer.files);
                }}
                className={`cursor-pointer rounded-2xl border-2 border-dashed transition px-5 py-10 md:py-14 text-center ${
                  isDragging
                    ? 'border-secondary bg-secondary/5'
                    : 'border-primary/20 hover:border-secondary/50'
                }`}
              >
                <div className="mx-auto h-14 w-14 rounded-2xl bg-secondary/10 grid place-items-center mb-4">
                  <FileScan size={24} className="text-secondary" />
                </div>
                <h2 className="font-display text-xl md:text-2xl font-semibold">
                  {t('dropAnyFile')}
                </h2>
                <p className="mt-1.5 text-[0.88rem] text-primary/60 max-w-md mx-auto leading-relaxed">
                  {t('dropAnyFileDesc')}
                </p>
                <div className="mt-5 flex flex-col sm:flex-row gap-2.5 justify-center">
                  <span className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-[0.88rem] font-semibold text-on-primary">
                    <Upload size={16} /> {t('chooseFile')}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      cameraInputRef.current?.click();
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl btn-secondary px-5 py-3 text-[0.88rem] font-semibold"
                  >
                    <Camera size={16} /> {t('takePhoto')}
                  </span>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={15} className="text-secondary" />
                <h3 className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-primary/70">
                  {t('scanCapBanner')}
                </h3>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-wider text-primary/60 mb-2">
                    {t('kept')}
                  </p>
                  <ul className="space-y-1.5">
                    {KEPT_ITEMS.map((item) => (
                      <li
                        key={item}
                        className="flex items-center gap-2 text-[0.82rem] text-primary/80"
                      >
                        <Check size={13} className="text-[#2F8F72] shrink-0" /> {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-wider text-primary/60 mb-2">
                    {t('skipped')}
                  </p>
                  <ul className="space-y-1.5">
                    {SKIPPED_ITEMS.map((item) => (
                      <li
                        key={item}
                        className="flex items-center gap-2 text-[0.82rem] text-primary/65"
                      >
                        <X size={13} className="text-primary/45 shrink-0" /> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {stage === 'reading' && (
          <div className="rise card p-6 md:p-10 text-center">
            <div className="relative mx-auto w-28 h-36 rounded-xl border border-primary/20 bg-surface-soft overflow-hidden mb-6">
              <div className="absolute inset-x-3 top-4 space-y-2">
                {[100, 70, 88, 55, 80, 40].map((w, idx) => (
                  <div
                    key={idx}
                    className="h-1.5 rounded-full bg-primary/10"
                    style={{ width: `${w}%` }}
                  />
                ))}
              </div>
              <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-secondary/25 to-transparent sweep" />
              <div className="absolute inset-x-0 top-1/2 h-[2px] bg-secondary/80 sweep" />
            </div>

            <h2 className="font-display text-xl font-semibold">{t('readingDoc')}</h2>
            <p className="mt-1.5 text-[0.85rem] text-primary/60">
              {progress.total > 1
                ? `${progress.index} / ${progress.total}${progress.detail ? ` · ${progress.detail}` : ''}`
                : progress.detail || t('scanCapBanner')}
            </p>
            <p className="mt-1 text-[0.75rem] text-primary/40 break-words px-2 max-w-md mx-auto">
              {progress.name}
            </p>
            <Loader2 size={18} className="mt-5 mx-auto animate-spin text-primary/40" />
            <div className="mt-5">
              <button
                type="button"
                onClick={handleStopReading}
                className="rounded-xl btn-secondary px-4 py-2 text-[0.82rem] font-semibold cursor-pointer"
              >
                {t('stopReading')}
              </button>
            </div>
          </div>
        )}

        {stage === 'review' && (
          <div className="rise space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary px-3 py-1 text-[0.72rem] font-semibold text-on-primary">
                {drafts.length} exam{drafts.length === 1 ? '' : 's'} found
              </span>
              <span className="rounded-full bg-[#2F8F72]/15 px-3 py-1 text-[0.72rem] font-semibold text-[#2F8F72]">
                {lessonDrafts.length} lesson{lessonDrafts.length === 1 ? '' : 's'} for checklist
              </span>
              {ignoredItems.length > 0 && (
                <span className="rounded-full bg-primary/10 px-3 py-1 text-[0.72rem] font-semibold text-primary/60">
                  {ignoredItems.length} non-academic item{ignoredItems.length === 1 ? '' : 's'} skipped
                </span>
              )}
            </div>

            {errors.length > 0 && (
              <div className="rounded-2xl bg-secondary/10 px-4 py-3 space-y-1">
                {errors.map((err, idx) => (
                  <p key={idx} className="text-[0.8rem] font-medium text-secondary flex gap-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}
                  </p>
                ))}
              </div>
            )}

            {/* Scanned Exams (Calendar + Material + What it includes on) */}
            {drafts.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center gap-2 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-primary/50">
                  <GraduationCap size={14} /> Exams for calendar ({selectedExams.length}/{drafts.length})
                </div>

                {drafts.map((item) => {
                  const cfg = getExamTypeConfig(item.type);
                  return (
                    <div
                      key={item._id}
                      className={`card p-3.5 transition ${item._selected ? '' : 'opacity-60'}`}
                    >
                      <div className="flex gap-2.5">
                        <button
                          type="button"
                          onClick={() => updateDraft(item._id, { _selected: !item._selected })}
                          aria-label={item._selected ? 'Skip this exam' : 'Include this exam'}
                          className="mt-0.5 h-6 w-6 rounded-lg grid place-items-center border shrink-0 transition cursor-pointer"
                          style={{
                            backgroundColor: item._selected ? cfg.color : 'var(--color-surface-soft)',
                            borderColor: item._selected ? cfg.color : 'rgba(128,128,128,0.28)',
                          }}
                        >
                          {item._selected && <Check size={14} className="text-white" />}
                        </button>

                        <div className="flex-1 min-w-0 space-y-2">
                          <input
                            dir="auto"
                            className="field-sm w-full font-semibold"
                            value={item.subject}
                            onChange={(e) => updateDraft(item._id, { subject: e.target.value })}
                            placeholder="Subject"
                          />

                          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
                            <input
                              type="date"
                              className="field-sm w-full sm:w-[10.2rem]"
                              value={item.date}
                              onChange={(e) => updateDraft(item._id, { date: e.target.value })}
                            />
                            <input
                              type="time"
                              className="field-sm w-full sm:w-[7rem]"
                              value={item.startTime}
                              onChange={(e) => updateDraft(item._id, { startTime: e.target.value })}
                            />
                            <select
                              className="field-sm w-full sm:w-[7.4rem]"
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
                              className="field-sm w-full sm:flex-1 min-w-0 sm:min-w-[6rem]"
                              value={item.room}
                              onChange={(e) => updateDraft(item._id, { room: e.target.value })}
                              placeholder={t('roomHallLabel')}
                            />
                          </div>

                          <div className="grid sm:grid-cols-2 gap-1.5">
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
                                    .map((topicItem) => topicItem.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder={t('includedTopicsLabel')}
                            />
                          </div>

                          <div className="flex items-center gap-2 flex-wrap pt-0.5">
                            {!isValidIsoDate(item.date) && (
                              <span className="text-[0.7rem] font-semibold text-secondary">
                                {t('dateLabel')}!
                              </span>
                            )}
                            {item.date && isValidIsoDate(item.date) && (
                              <span className="text-[0.7rem] text-primary/45">
                                {formatLocalizedDate(item.date, 'EEE, d MMM yyyy', lang)}
                                {item.startTime ? ` · ${formatTime12h(item.startTime)}` : ''}
                              </span>
                            )}
                            {item._dup && (
                              <span className="text-[0.7rem] font-semibold text-primary/45">
                                · ✓
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {/* Scanned Lessons (Study Centre Checklist) */}
            {lessonDrafts.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-primary/50">
                    <BookCheck size={14} /> {t('studyChecklist')} ({selectedLessons.length}/
                    {lessonDrafts.length})
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const allSelected = selectedLessons.length === lessonDrafts.length;
                      setLessonDrafts((prev) =>
                        prev.map((l) => ({ ...l, _selected: !allSelected }))
                      );
                    }}
                    className="btn-secondary px-2.5 py-1 rounded-lg text-[0.74rem] font-semibold cursor-pointer"
                  >
                    {selectedLessons.length === lessonDrafts.length ? t('uncheckAll') : t('checkAll')}
                  </button>
                </div>

                <div className="card p-3 space-y-2">
                  {lessonDrafts.map((lesson) => (
                    <div
                      key={lesson._id}
                      className={`flex items-start gap-2.5 rounded-xl border border-primary/10 bg-surface-soft p-2.5 transition ${
                        lesson._selected ? '' : 'opacity-55'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          updateLessonDraft(lesson._id, { _selected: !lesson._selected })
                        }
                        aria-label={lesson._selected ? 'Skip lesson' : 'Include lesson'}
                        className={`mt-1 h-5 w-5 rounded-md grid place-items-center border shrink-0 transition cursor-pointer ${
                          lesson._selected
                            ? 'bg-[#2F8F72] border-[#2F8F72] text-white'
                            : 'bg-surface border-primary/25'
                        }`}
                      >
                        {lesson._selected && <Check size={12} strokeWidth={2.75} />}
                      </button>

                      <div className="flex-1 min-w-0 grid sm:grid-cols-[0.9fr_1.4fr_1fr] gap-1.5">
                        <input
                          dir="auto"
                          className="field-sm font-semibold"
                          value={lesson.subject}
                          onChange={(e) =>
                            updateLessonDraft(lesson._id, { subject: e.target.value })
                          }
                          placeholder="Subject"
                        />
                        <input
                          dir="auto"
                          className="field-sm"
                          value={lesson.title}
                          onChange={(e) =>
                            updateLessonDraft(lesson._id, { title: e.target.value })
                          }
                          placeholder="Lesson or topic"
                        />
                        <input
                          dir="auto"
                          className="field-sm"
                          value={lesson.notes}
                          onChange={(e) =>
                            updateLessonDraft(lesson._id, { notes: e.target.value })
                          }
                          placeholder="Notes (optional)"
                        />
                      </div>

                      {lesson._dup && (
                        <span className="self-center text-[0.68rem] font-semibold text-primary/45 shrink-0">
                          already in checklist
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {ignoredItems.length > 0 && (
              <div className="card-flat p-4">
                <button
                  type="button"
                  onClick={() => setShowIgnored((s) => !s)}
                  className="w-full flex items-center justify-between text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-primary/40" />
                    <span className="text-[0.8rem] font-semibold text-primary/70">
                      Skipped as non-academic ({ignoredItems.length})
                    </span>
                  </div>
                  {showIgnored ? (
                    <ChevronUp size={16} className="text-primary/40" />
                  ) : (
                    <ChevronDown size={16} className="text-primary/40" />
                  )}
                </button>
                {showIgnored && (
                  <ul className="mt-3 space-y-1.5 border-t hairline pt-3">
                    {ignoredItems.map((line, idx) => (
                      <li key={idx} className="text-[0.79rem] text-primary/50 leading-snug">
                        · {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {missingDates.length > 0 && (
              <div className="rounded-xl bg-secondary/10 px-3.5 py-2.5 text-[0.78rem] font-medium text-secondary flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Add a date or uncheck {missingDates.length} selected exam
                  {missingDates.length === 1 ? '' : 's'} above before saving.
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={!canSave}
                className="flex-1 h-12 rounded-xl bg-primary text-on-primary font-semibold text-[0.9rem] inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition cursor-pointer"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                Save {selectedExams.length} exam{selectedExams.length === 1 ? '' : 's'}
                {selectedLessons.length > 0
                  ? ` & ${selectedLessons.length} lesson${selectedLessons.length === 1 ? '' : 's'}`
                  : ''}
              </button>
              <button
                type="button"
                onClick={handleReset}
                aria-label="Discard results"
                className="h-12 w-12 grid place-items-center rounded-xl btn-secondary hover:text-secondary cursor-pointer"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        )}

        {stage === 'saved' && (
          <div className="rise card p-6 md:p-10 text-center max-w-lg mx-auto">
            <div className="mx-auto h-16 w-16 rounded-full bg-[#2F8F72]/10 grid place-items-center mb-4">
              <Check size={28} className="text-[#2F8F72]" />
            </div>
            <h2 className="font-display text-2xl font-semibold">
              {savedCounts.exams > 0 && savedCounts.lessons > 0
                ? `${savedCounts.exams} exam${savedCounts.exams === 1 ? '' : 's'} & ${savedCounts.lessons} lesson${savedCounts.lessons === 1 ? '' : 's'} saved`
                : savedCounts.exams > 0
                ? `${savedCounts.exams} exam${savedCounts.exams === 1 ? '' : 's'} added`
                : `${savedCounts.lessons} lesson${savedCounts.lessons === 1 ? '' : 's'} added`}
            </h2>
            <p className="mt-2 text-[0.88rem] text-primary/60">
              {savedCounts.exams > 0 && savedCounts.lessons > 0
                ? 'Exams are on your calendar with their covered topics, and lessons are ready in your Study Centre checklist.'
                : savedCounts.exams > 0
                ? 'They are on your week and month calendars now.'
                : 'Your lessons are ready to check off in the Study Centre.'}
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
              <button
                type="button"
                onClick={onExit}
                className="rounded-xl bg-primary px-5 py-3 text-[0.88rem] font-semibold text-on-primary cursor-pointer"
              >
                {t('viewCalendar')}
              </button>
              <button
                type="button"
                onClick={onGoStudy}
                className="rounded-xl bg-[#2F8F72] px-5 py-3 text-[0.88rem] font-semibold text-white cursor-pointer"
              >
                {t('openStudyCentre')}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-xl btn-secondary px-5 py-3 text-[0.88rem] font-semibold cursor-pointer"
              >
                {t('scanAnother')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
