import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { Exam, ExamInput, ExamType, LessonInput, LessonItem } from '../types.ts';
import {
  EXAM_TYPES,
  dedupeTopicList,
  getExamReadiness,
  isSameLessonTopic,
  lessonMatchesTopicOrSplit,
  splitMultiLessonText,
} from '../utils/exams.ts';
import { getExamTypeLabel, useTranslation } from '../utils/i18n.tsx';

interface ExamModalProps {
  exam: Partial<Exam> | null;
  exams?: Exam[];
  lessons: LessonItem[];
  onClose: () => void;
  onSave: (payload: ExamInput, existingId?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleLesson: (lesson: LessonItem) => Promise<void>;
  onAddLesson: (input: LessonInput) => Promise<void>;
}

export default function ExamModal({
  exam,
  exams = [],
  lessons,
  onClose,
  onSave,
  onDelete,
  onToggleLesson,
  onAddLesson,
}: ExamModalProps) {
  const { lang, t } = useTranslation();
  const isEditing = Boolean(exam && exam.id);
  const [form, setForm] = useState<ExamInput>({
    subject: exam?.subject || '',
    type: (exam?.type as ExamType) || 'final',
    date: exam?.date || format(new Date(), 'yyyy-MM-dd'),
    startTime: exam?.startTime || '',
    endTime: exam?.endTime || '',
    room: exam?.room || '',
    material: exam?.material || '',
    topics: Array.isArray(exam?.topics) ? exam.topics : [],
    notes: exam?.notes || '',
  });
  const [topicCells, setTopicCells] = useState<string[]>(() => {
    const initial = Array.isArray(exam?.topics) ? dedupeTopicList(exam.topics) : [];
    return initial.length > 0 ? initial : [''];
  });
  const [subjectSearchOpen, setSubjectSearchOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [trackingTopic, setTrackingTopic] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const topicInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const savedSubjects = useMemo(() => {
    const byLower = new Map<string, string>();
    for (const ex of exams) {
      const sub = String(ex.subject || '').trim();
      if (sub && !byLower.has(sub.toLowerCase())) {
        byLower.set(sub.toLowerCase(), sub);
      }
    }
    for (const l of lessons) {
      const sub = String(l.subject || '').trim();
      if (sub && sub.toLowerCase() !== 'general' && !byLower.has(sub.toLowerCase())) {
        byLower.set(sub.toLowerCase(), sub);
      }
    }
    return Array.from(byLower.values()).sort((a, b) => a.localeCompare(b));
  }, [exams, lessons]);

  const matchingSavedSubjects = useMemo(() => {
    const query = form.subject.trim().toLowerCase();
    if (!query) return savedSubjects;
    return savedSubjects.filter((sub) => sub.toLowerCase().includes(query));
  }, [savedSubjects, form.subject]);

  const showSubjectSearch =
    subjectSearchOpen && savedSubjects.length > 0 && matchingSavedSubjects.length > 0;

  const cleanTopics = useMemo(() => dedupeTopicList(topicCells), [topicCells]);

  const readiness = useMemo(
    () =>
      getExamReadiness(
        {
          id: exam?.id || '',
          subject: form.subject,
          topics: cleanTopics,
        },
        lessons
      ),
    [exam?.id, form.subject, cleanTopics, lessons]
  );

  const updateField = <K extends keyof ExamInput>(key: K, value: ExamInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  function selectSavedSubject(subject: string) {
    updateField('subject', subject);
    setSubjectSearchOpen(false);
  }

  function normalizeCellsPreservingDedup(rawCells: string[]): string[] {
    const out = dedupeTopicList(rawCells).slice(0, 50);
    return out.length > 0 ? out : [''];
  }

  function updateTopicCell(index: number, value: string) {
    setTopicCells((prev) => prev.map((item, i) => (i === index ? value : item)));
  }

  function normalizeCellAt(index: number) {
    setTopicCells((prev) => {
      const current = String(prev[index] || '').trim();
      if (!current) return prev;
      const parts = splitMultiLessonText(current);
      const hasDuplicate = prev.some(
        (other, i) =>
          i !== index &&
          other.trim().length > 0 &&
          lessonMatchesTopicOrSplit(other, current)
      );
      if (parts.length <= 1 && !hasDuplicate) return prev;
      return normalizeCellsPreservingDedup(prev);
    });
  }

  function insertTopicCell(afterIndex?: number) {
    setTopicCells((prev) => {
      const deduped = dedupeTopicList(prev).slice(0, 50);
      if (deduped.length >= 50) return deduped;
      const insertAt =
        typeof afterIndex === 'number'
          ? Math.min(afterIndex + 1, deduped.length)
          : deduped.length;
      const next = [...deduped];
      next.splice(insertAt, 0, '');
      requestAnimationFrame(() => {
        topicInputRefs.current[insertAt]?.focus();
      });
      return next;
    });
  }

  function removeTopicCell(index: number) {
    setTopicCells((prev) => {
      if (prev.length <= 1) return [''];
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleTopicCellPaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    const pastedParts = splitMultiLessonText(text);
    if (pastedParts.length <= 1 && !text.includes('\n')) return;
    e.preventDefault();
    setTopicCells((prev) => {
      const next = [...prev];
      const existing = next[index].trim();
      const replacement = existing
        ? [...splitMultiLessonText(existing), ...pastedParts]
        : pastedParts;
      next.splice(index, 1, ...replacement);
      return normalizeCellsPreservingDedup(next);
    });
  }

  async function handleTrackTopicInChecklist(topic: string) {
    setTrackingTopic(topic);
    try {
      await onAddLesson({
        subject: form.subject.trim() || 'General',
        title: topic,
        examId: exam?.id,
      });
    } finally {
      setTrackingTopic(null);
    }
  }

  async function handleTrackAllUntracked() {
    for (const topic of readiness.untrackedTopics) {
      await onAddLesson({
        subject: form.subject.trim() || 'General',
        title: topic,
        examId: exam?.id,
      });
    }
  }

  async function handleToggleChecklistLesson(lesson: LessonItem) {
    setTogglingId(lesson.id);
    try {
      await onToggleLesson(lesson);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleSave() {
    if (!form.subject.trim()) {
      setError('Give the exam a subject name.');
      return;
    }
    if (!form.date) {
      setError('Pick the exam date.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave(
        {
          subject: form.subject.trim(),
          type: form.type,
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          room: form.room.trim(),
          material: (form.material || '').trim(),
          topics: cleanTopics.slice(0, 50),
          notes: form.notes.trim(),
        },
        exam?.id
      );
      onClose();
    } catch (err: unknown) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const msg = err instanceof Error ? err.message : 'Could not save. Try again.';
      setError(
        offline
          ? "You're offline — your exam was not saved. Reconnect and press save again."
          : msg
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!exam?.id) return;
    setSaving(true);
    try {
      await onDelete(exam.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-primary/50 flex items-end md:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-xl bg-paper rounded-t-3xl md:rounded-3xl overflow-y-auto shadow-2xl max-h-[calc(100dvh-1.5rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-paper-blur z-10 px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between border-b hairline gap-2">
          <h2 className="font-display text-lg sm:text-xl font-semibold min-w-0 truncate">
            {isEditing ? form.subject || t('examDetails') : t('newExam')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="h-9 w-9 grid place-items-center rounded-xl btn-ghost cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 sm:px-5 py-4 space-y-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          {/* Live Study Readiness Panel (synced with Study Centre checklist) */}
          {(isEditing || form.subject.trim().length > 0 || cleanTopics.length > 0) && (
            <section
              className={`rounded-2xl border p-3.5 space-y-3 ${
                readiness.totalCount === 0
                  ? 'border-primary/15 bg-surface-soft'
                  : readiness.isReady
                  ? 'border-[#2F8F72]/35 bg-[#2F8F72]/10'
                  : 'border-secondary/35 bg-secondary/10'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  {readiness.totalCount === 0 ? (
                    <BookOpen size={18} className="mt-0.5 text-primary/55 shrink-0" />
                  ) : readiness.isReady ? (
                    <CheckCircle2 size={18} className="mt-0.5 text-[#2F8F72] shrink-0" />
                  ) : (
                    <Clock size={18} className="mt-0.5 text-secondary shrink-0" />
                  )}
                  <div>
                    <div className="text-[0.84rem] font-semibold leading-snug">
                      {readiness.totalCount === 0
                        ? t('noCoveredLessons')
                        : readiness.isReady
                        ? `${t('finishedChip')} (${readiness.finishedCount}/${readiness.totalCount})`
                        : `${t('stillToStudyChip')}: ${readiness.remainingCount}/${readiness.totalCount}`}
                    </div>
                    <p className="text-[0.74rem] text-primary/60 mt-0.5">
                      {readiness.totalCount === 0
                        ? t('addTopicsHint')
                        : readiness.isReady
                        ? t('everyLessonChecked')
                        : t('checkDirectlyHint')}
                    </p>
                  </div>
                </div>

                {readiness.untrackedTopics.length > 0 && (
                  <button
                    type="button"
                    onClick={handleTrackAllUntracked}
                    className="shrink-0 rounded-lg bg-primary text-on-primary px-2.5 py-1 text-[0.72rem] font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                  >
                    {t('trackAll')}
                  </button>
                )}
              </div>

              {(readiness.subjectLessons.length > 0 || readiness.untrackedTopics.length > 0) && (
                <div className="space-y-1.5 pt-1 border-t hairline">
                  {readiness.subjectLessons.map((lesson) => (
                    <button
                      key={lesson.id}
                      type="button"
                      disabled={togglingId === lesson.id}
                      onClick={() => handleToggleChecklistLesson(lesson)}
                      className="w-full flex items-start justify-between gap-2 rounded-xl bg-surface/80 px-3 py-2 text-start hover:bg-surface transition cursor-pointer"
                    >
                      <span className="flex items-start gap-2.5 min-w-0 flex-1">
                        <span
                          className={`mt-0.5 h-4.5 w-4.5 rounded-md grid place-items-center border shrink-0 ${
                            lesson.completed
                              ? 'bg-[#2F8F72] border-[#2F8F72] text-white'
                              : 'border-primary/30 bg-surface-soft'
                          }`}
                        >
                          {lesson.completed && <Check size={11} strokeWidth={2.75} />}
                        </span>
                        <span
                          dir="auto"
                          className={`text-[0.82rem] font-medium leading-snug break-words ${
                            lesson.completed ? 'line-through text-primary/45' : 'text-primary'
                          }`}
                        >
                          {lesson.title}
                        </span>
                      </span>
                      <span
                        className={`text-[0.68rem] font-semibold shrink-0 pt-0.5 ${
                          lesson.completed ? 'text-[#2F8F72]' : 'text-secondary'
                        }`}
                      >
                        {lesson.completed ? t('finishedChip') : t('stillToStudyChip')}
                      </span>
                    </button>
                  ))}

                  {readiness.untrackedTopics.map((topic) => (
                    <div
                      key={topic}
                      className="flex items-start justify-between gap-2 rounded-xl bg-surface/60 px-3 py-2 border border-dashed border-primary/20"
                    >
                      <span dir="auto" className="text-[0.82rem] font-medium text-primary/80 leading-snug break-words flex-1 min-w-0">
                        {topic}
                      </span>
                      <button
                        type="button"
                        disabled={trackingTopic === topic}
                        onClick={() => handleTrackTopicInChecklist(topic)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg btn-secondary px-2 py-0.5 text-[0.7rem] font-semibold cursor-pointer"
                      >
                        <Plus size={11} /> {t('addToChecklistBtn')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <div className="relative">
            <label className="field-label">{t('subject')}</label>
            <div className="relative">
              <input
                dir="auto"
                className="field pe-9"
                autoFocus={!isEditing}
                value={form.subject}
                onFocus={() => setSubjectSearchOpen(true)}
                onBlur={() => {
                  setTimeout(() => setSubjectSearchOpen(false), 120);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSubjectSearchOpen(false);
                  }
                }}
                onChange={(e) => {
                  updateField('subject', e.target.value);
                  setSubjectSearchOpen(true);
                }}
                placeholder="e.g. Organic Chemistry"
                autoComplete="off"
              />
              {savedSubjects.length > 0 && (
                <Search
                  size={15}
                  className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-primary/35"
                />
              )}
            </div>

            {showSubjectSearch && (
              <div className="mt-1.5 rounded-2xl border border-primary/15 bg-paper shadow-lg overflow-hidden">
                <div className="px-3 py-1.5 border-b hairline text-[0.66rem] font-bold uppercase tracking-wider text-primary/50 flex items-center justify-between">
                  <span>{t('savedSubjectsLabel')}</span>
                  <span>{matchingSavedSubjects.length}</span>
                </div>
                <ul className="max-h-44 overflow-y-auto divide-y hairline">
                  {matchingSavedSubjects.map((sub) => {
                    const isExact =
                      sub.toLowerCase() === form.subject.trim().toLowerCase();
                    return (
                      <li key={sub}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectSavedSubject(sub);
                          }}
                          className={`w-full px-3 py-2 text-start text-[0.84rem] flex items-center justify-between gap-2 transition cursor-pointer ${
                            isExact
                              ? 'bg-primary/10 font-semibold text-primary'
                              : 'hover:bg-primary/5 text-primary/85'
                          }`}
                        >
                          <span dir="auto" className="truncate">
                            {sub}
                          </span>
                          {isExact && <Check size={14} className="text-[#2F8F72] shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          <div>
            <label className="field-label">{t('typeLabel')}</label>
            <div className="flex flex-wrap gap-1.5">
              {EXAM_TYPES.map((et) => {
                const selected = form.type === et.key;
                return (
                  <button
                    key={et.key}
                    type="button"
                    onClick={() => updateField('type', et.key)}
                    className={`px-3 py-1.5 rounded-full text-[0.78rem] font-semibold border transition cursor-pointer ${
                      selected ? 'text-white' : 'btn-secondary'
                    }`}
                    style={
                      selected
                        ? { backgroundColor: et.color, borderColor: et.color }
                        : undefined
                    }
                  >
                    {getExamTypeLabel(et.key, lang)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="field-label">{t('dateLabel')}</label>
              <input
                type="date"
                className="field"
                value={form.date}
                onChange={(e) => updateField('date', e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">{t('startsLabel')}</label>
              <input
                type="time"
                className="field"
                value={form.startTime}
                onChange={(e) => updateField('startTime', e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">{t('endsLabel')}</label>
              <input
                type="time"
                className="field"
                value={form.endTime}
                onChange={(e) => updateField('endTime', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">{t('roomHallLabel')}</label>
              <input
                dir="auto"
                className="field"
                value={form.room}
                onChange={(e) => updateField('room', e.target.value)}
                placeholder={t('authOptional')}
              />
            </div>
            <div>
              <label className="field-label">{t('materialLabel')}</label>
              <input
                dir="auto"
                className="field"
                value={form.material || ''}
                onChange={(e) => updateField('material', e.target.value)}
                placeholder="Ch. 1–4"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="field-label mb-0">{t('includedTopicsLabel')}</label>
              {cleanTopics.length > 0 && (
                <span className="text-[0.72rem] font-semibold text-primary/55 tabular-nums">
                  {cleanTopics.length}
                </span>
              )}
            </div>

            <ul className="space-y-2">
              {topicCells.map((cell, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded-lg bg-primary/10 text-[0.72rem] font-bold text-primary/70 grid place-items-center shrink-0 tabular-nums">
                    {idx + 1}
                  </span>
                  <input
                    ref={(el) => {
                      topicInputRefs.current[idx] = el;
                    }}
                    dir="auto"
                    className="field flex-1 min-w-0"
                    value={cell}
                    onChange={(e) => updateTopicCell(idx, e.target.value)}
                    onBlur={() => normalizeCellAt(idx)}
                    onPaste={(e) => handleTopicCellPaste(idx, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        insertTopicCell(idx);
                      }
                    }}
                    placeholder={`${t('lessonCellPlaceholder')} ${idx + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeTopicCell(idx)}
                    aria-label={`Remove ${t('lessonCellPlaceholder')} ${idx + 1}`}
                    className="h-10 w-10 grid place-items-center rounded-xl btn-ghost text-primary/45 hover:text-secondary shrink-0 cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>

            {topicCells.length < 50 && (
              <button
                type="button"
                onClick={() => insertTopicCell()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-xl btn-secondary px-3 py-1.5 text-[0.78rem] font-semibold cursor-pointer"
              >
                <Plus size={14} /> {t('addLesson')}
              </button>
            )}
          </div>

          <div>
            <label className="field-label">{t('notesLabel')}</label>
            <textarea
              dir="auto"
              className="field resize-none"
              rows={2}
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
            />
          </div>

          {error && (
            <p className="text-[0.8rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 h-12 rounded-xl bg-primary text-on-primary font-semibold text-[0.92rem] flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.99] transition cursor-pointer"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {isEditing ? t('saveChanges') : t('addExam')}
            </button>

            {isEditing &&
              (confirmDelete ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="h-12 px-4 rounded-xl bg-secondary text-on-secondary font-semibold text-[0.85rem] cursor-pointer"
                >
                  {t('confirmBtn')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete exam"
                  className="h-12 w-12 grid place-items-center rounded-xl btn-secondary hover:text-secondary cursor-pointer"
                >
                  <Trash2 size={18} />
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
