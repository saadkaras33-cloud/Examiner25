import { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookCheck,
  Check,
  CheckCircle2,
  Circle,
  FileScan,
  GraduationCap,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type { Exam, LessonInput, LessonItem } from '../types.ts';
import {
  getExamReadiness,
  getExamsForLesson,
  getExamTypeConfig,
  isLikelyDuplicateSubject,
  isMajorExamType,
  isSameLessonTopic,
  normalizeSubject,
} from '../utils/exams.ts';
import {
  formatLocalizedDate,
  formatRelativeDayLocalized,
  getExamTypeLabel,
  useTranslation,
} from '../utils/i18n.tsx';

interface StudyPageProps {
  exams: Exam[];
  lessons: LessonItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onToggleLesson: (lesson: LessonItem) => Promise<void>;
  onAddLesson: (input: LessonInput) => Promise<void>;
  onDeleteLesson: (id: string) => Promise<void>;
  onSelectExam: (exam: Exam) => void;
  onGoScan: () => void;
  onGoAssessments?: () => void;
  isSplit?: boolean;
}

type StatusFilter = 'all' | 'todo' | 'done';

export default function StudyPage({
  exams,
  lessons,
  loading,
  error,
  onRetry,
  onToggleLesson,
  onAddLesson,
  onDeleteLesson,
  onSelectExam,
  onGoScan,
  onGoAssessments,
  isSplit = false,
}: StudyPageProps) {
  const { lang, t } = useTranslation();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [readinessScope, setReadinessScope] = useState<'all' | 'major'>('all');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const [newSubject, setNewSubject] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newExamId, setNewExamId] = useState('');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});

  const finishedCount = useMemo(
    () => lessons.filter((l) => l.completed).length,
    [lessons]
  );
  const remainingCount = lessons.length - finishedCount;
  const progressPct =
    lessons.length > 0 ? Math.round((finishedCount / lessons.length) * 100) : 0;

  const subjectSuggestions = useMemo(() => {
    const map = new Map<string, string>();
    for (const ex of exams) {
      if (ex.subject) {
        const key = normalizeSubject(ex.subject) || ex.subject.toLowerCase();
        if (!map.has(key)) map.set(key, ex.subject);
      }
    }
    for (const l of lessons) {
      if (l.subject) {
        const key = normalizeSubject(l.subject) || l.subject.toLowerCase();
        if (!map.has(key)) map.set(key, l.subject);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [exams, lessons]);

  const upcomingReadiness = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const base = exams.filter((ex) => {
      if (ex.date && ex.date < todayIso) return false;
      if (readinessScope === 'major' && !isMajorExamType(ex.type)) return false;
      return true;
    });
    const list = readinessScope === 'major' ? base : base.slice(0, 8);
    return list.map((ex) => ({
      exam: ex,
      readiness: getExamReadiness(ex, lessons),
    }));
  }, [exams, lessons, readinessScope]);

  const filteredLessons = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lessons.filter((item) => {
      if (filter === 'todo' && item.completed) return false;
      if (filter === 'done' && !item.completed) return false;
      if (subjectFilter !== 'all' && !isLikelyDuplicateSubject(item.subject, subjectFilter)) {
        return false;
      }
      if (q) {
        const hay = `${item.subject} ${item.title} ${item.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lessons, filter, subjectFilter, query]);

  const groupedBySubject = useMemo(() => {
    const groups: Array<{
      subject: string;
      items: LessonItem[];
      allItemsCount: number;
      allDoneCount: number;
      relatedExams: Exam[];
      untrackedTopics: Array<{ topic: string; examId?: string }>;
    }> = [];

    for (const item of filteredLessons) {
      const existing = groups.find((g) => isLikelyDuplicateSubject(g.subject, item.subject));
      if (existing) {
        existing.items.push(item);
      } else {
        const allInSubject = lessons.filter((l) =>
          isLikelyDuplicateSubject(l.subject, item.subject)
        );
        const relatedExams = exams.filter((ex) =>
          isLikelyDuplicateSubject(ex.subject, item.subject)
        );
        const untrackedMap = new Map<string, string | undefined>();
        for (const ex of relatedExams) {
          for (const topic of ex.topics || []) {
            const exists = allInSubject.some((l) => isSameLessonTopic(l.title, topic));
            if (!exists && !untrackedMap.has(topic)) {
              untrackedMap.set(topic, ex.id);
            }
          }
        }
        groups.push({
          subject: item.subject || 'General',
          items: [item],
          allItemsCount: allInSubject.length,
          allDoneCount: allInSubject.filter((l) => l.completed).length,
          relatedExams,
          untrackedTopics: Array.from(untrackedMap.entries()).map(([topic, examId]) => ({
            topic,
            examId,
          })),
        });
      }
    }

    return groups.sort((a, b) => a.subject.localeCompare(b.subject));
  }, [filteredLessons, lessons, exams]);

  async function handleToggle(item: LessonItem) {
    setBusyIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      await onToggleLesson(item);
    } finally {
      setBusyIds((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function handleDelete(id: string) {
    setBusyIds((prev) => ({ ...prev, [id]: true }));
    try {
      await onDeleteLesson(id);
    } finally {
      setBusyIds((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) {
      setFormError('Enter a lesson or chapter title.');
      return;
    }
    setFormError('');
    setAdding(true);
    try {
      await onAddLesson({
        subject: newSubject.trim() || 'General',
        title: newTitle.trim(),
        notes: newNotes.trim(),
        examId: newExamId || undefined,
      });
      setNewTitle('');
      setNewNotes('');
      setShowAddForm(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not add lesson.');
    } finally {
      setAdding(false);
    }
  }

  async function handleAddUntrackedTopic(subject: string, topic: string, examId?: string) {
    await onAddLesson({
      subject,
      title: topic,
      examId,
    });
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-paper grain">
      <header className="sticky top-0 z-20 bg-paper-blur border-b hairline">
        <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary/65">
              {lessons.length === 0
                ? t('studyChecklist')
                : `${finishedCount} / ${lessons.length} ${t('finishedLabel')}`}
            </div>
            <h1 className="font-display text-[1.35rem] sm:text-[1.45rem] md:text-[1.7rem] font-semibold leading-snug break-words">
              {t('studyCentre')}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-8 py-4 md:py-7 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] md:pb-10 space-y-5">
        {showAddForm && (
          <form onSubmit={handleQuickAdd} className="rise card p-4 md:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[1.08rem] font-semibold">{t('addLessonTitle')}</h2>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 rounded-lg btn-secondary text-[0.78rem] font-semibold cursor-pointer"
              >
                {t('cancel')}
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">{t('subject')}</label>
                <input
                  dir="auto"
                  list="study-subject-suggestions"
                  className="field"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="e.g. Organic Chemistry"
                />
                <datalist id="study-subject-suggestions">
                  {subjectSuggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="field-label">{t('lessonOrTopic')}</label>
                <input
                  dir="auto"
                  className="field"
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Chapter 4: Reaction Mechanisms"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">{t('linkedExamOpt')}</label>
                <select
                  className="field"
                  value={newExamId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setNewExamId(id);
                    const matched = exams.find((ex) => ex.id === id);
                    if (matched && !newSubject.trim()) {
                      setNewSubject(matched.subject);
                    }
                  }}
                >
                  <option value="">{t('matchBySubjectAuto')}</option>
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.subject} ({formatLocalizedDate(ex.date, 'd MMM', lang)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">{t('studyNotesOpt')}</label>
                <input
                  dir="auto"
                  className="field"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="…"
                />
              </div>
            </div>

            {formError && (
              <p className="text-[0.8rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
                {formError}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={adding}
                className="h-10 px-5 rounded-xl bg-primary text-on-primary text-[0.84rem] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
              >
                <Plus size={15} /> {adding ? t('adding') : t('addToChecklist')}
              </button>
            </div>
          </form>
        )}

        {loading && lessons.length === 0 ? (
          <div className="space-y-4">
            <div className="h-32 rounded-3xl bg-primary/10 softpulse" />
            <div className="h-44 rounded-2xl bg-primary/10 softpulse" />
          </div>
        ) : error && lessons.length === 0 ? (
          <div className="rise max-w-xl mx-auto text-center pt-6 md:pt-14">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-secondary/10 grid place-items-center mb-4">
              <AlertCircle size={24} className="text-secondary" />
            </div>
            <h2 className="font-display text-[1.5rem] font-semibold">{t('couldntLoadExams')}</h2>
            <p className="mt-2 text-[0.9rem] text-primary/60">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[0.86rem] font-semibold text-on-primary cursor-pointer"
            >
              <RefreshCw size={15} /> {t('tryAgain')}
            </button>
          </div>
        ) : lessons.length === 0 ? (
          <div className="rise max-w-xl mx-auto text-center pt-6 md:pt-14">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 grid place-items-center mb-5">
              <BookCheck size={28} className="text-primary/50" />
            </div>
            <h2 className="font-display text-[1.75rem] font-semibold leading-tight">
              {t('studyEmpty')}
            </h2>
            <p className="mt-2 text-[0.92rem] text-primary/60 leading-relaxed">
              {t('studyEmptyDesc')}
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
              <button
                type="button"
                onClick={onGoScan}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-[0.88rem] font-semibold text-on-primary cursor-pointer"
              >
                <FileScan size={17} /> {t('scanScheduleOrSyllabus')}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl btn-secondary px-5 py-3 text-[0.88rem] font-semibold cursor-pointer"
              >
                <Plus size={17} /> {t('addFirstLesson')}
              </button>
            </div>
          </div>
        ) : (
          <div className={`grid ${isSplit ? 'xl:grid-cols-[1.55fr_1fr]' : 'lg:grid-cols-[1.55fr_1fr]'} gap-5 sm:gap-6`}>
            <div className="space-y-4 min-w-0">
              {/* Overall progress summary */}
              <div className="card p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-primary/45">
                      {t('overallPrep')}
                    </div>
                    <div className="mt-0.5 font-display text-[1.35rem] font-semibold tabular-nums">
                      {remainingCount === 0
                        ? t('allLessonsFinished')
                        : `${remainingCount} ${t('stillToStudyChip')}`}
                    </div>
                  </div>
                  <div className="text-end tabular-nums">
                    <span className="font-display text-[1.6rem] font-semibold">{progressPct}%</span>
                    <span className="block text-[0.72rem] text-primary/50">
                      {finishedCount}/{lessons.length} {t('doneLabel')}
                    </span>
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-primary/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#2F8F72] transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="max-w-full overflow-x-auto inline-flex rounded-xl border border-primary/20 bg-surface p-1 gap-0.5">
                  {(
                    [
                      { key: 'all', label: `${lessons.length}` },
                      { key: 'todo', label: `${t('stillToStudyChip')} (${remainingCount})` },
                      { key: 'done', label: `${t('finishedChip')} (${finishedCount})` },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setFilter(tab.key)}
                      className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[0.76rem] sm:text-[0.78rem] font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                        filter === tab.key
                          ? 'bg-primary text-on-primary'
                          : 'text-primary/80 hover:bg-primary/10 hover:text-primary'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {subjectSuggestions.length > 1 && (
                  <select
                    value={subjectFilter}
                    onChange={(e) => setSubjectFilter(e.target.value)}
                    aria-label={t('allSubjects')}
                    className="h-9 max-w-full rounded-xl border border-primary/15 bg-surface px-3 text-[0.8rem] font-semibold text-primary/75 outline-none"
                  >
                    <option value="all">{t('allSubjects')}</option>
                    {subjectSuggestions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}

                <div className="relative w-full sm:w-auto sm:flex-1 min-w-0 sm:min-w-[11rem]">
                  <Search
                    size={14}
                    className="absolute start-3 top-1/2 -translate-y-1/2 text-primary/35"
                  />
                  <input
                    dir="auto"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('searchLessons')}
                    className="w-full h-9 rounded-xl border border-primary/15 bg-surface ps-8 pe-3 text-[0.82rem] outline-none focus:border-primary/40"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddForm((s) => !s)}
                  className="h-9 px-3 rounded-xl bg-primary text-on-primary inline-flex items-center gap-1.5 text-[0.8rem] font-semibold active:scale-[0.98] transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus size={15} /> {t('addLesson')}
                </button>
              </div>

              {/* Grouped checklist */}
              {groupedBySubject.length === 0 ? (
                <div className="card p-8 text-center">
                  <p className="text-[0.88rem] text-primary/55">{t('noLessonsMatch')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedBySubject.map((group) => (
                    <section key={group.subject} className="card p-4 md:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b hairline">
                        <div className="min-w-0 flex-1">
                          <h2 dir="auto" className="font-display text-[1.15rem] font-semibold leading-snug break-words">
                            {group.subject}
                          </h2>
                          {group.relatedExams.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {group.relatedExams.map((ex) => {
                                const cfg = getExamTypeConfig(ex.type);
                                return (
                                  <button
                                    key={ex.id}
                                    type="button"
                                    onClick={() => onSelectExam(ex)}
                                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[0.7rem] font-semibold hover:opacity-80 transition cursor-pointer"
                                    style={{
                                      backgroundColor: `${cfg.color}16`,
                                      color: cfg.color,
                                    }}
                                  >
                                    <GraduationCap size={11} />
                                    {getExamTypeLabel(ex.type, lang)} ·{' '}
                                    {formatLocalizedDate(ex.date, 'd MMM', lang)}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <span className="text-[0.78rem] font-semibold tabular-nums text-primary/60">
                          {group.allDoneCount}/{group.allItemsCount} {t('finishedLabel')}
                        </span>
                      </div>

                      <div className="mt-2.5 divide-y hairline">
                        {group.items.map((item) => {
                          const busy = Boolean(busyIds[item.id]);
                          const itemExams = getExamsForLesson(item, exams);
                          return (
                            <div key={item.id} className="py-2.5 flex items-start gap-3 group">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleToggle(item)}
                                aria-label={item.title}
                                className={`mt-0.5 h-5 w-5 rounded-md grid place-items-center border transition shrink-0 cursor-pointer ${
                                  item.completed
                                    ? 'bg-[#2F8F72] border-[#2F8F72] text-white'
                                    : 'border-primary/25 bg-surface-soft hover:border-primary/50'
                                }`}
                              >
                                {item.completed && <Check size={13} strokeWidth={2.75} />}
                              </button>

                              <div className="flex-1 min-w-0">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleToggle(item)}
                                  className="w-full text-start cursor-pointer"
                                >
                                  <span
                                    dir="auto"
                                    className={`block text-[0.9rem] font-medium leading-snug ${
                                      item.completed ? 'line-through text-primary/40' : 'text-primary'
                                    }`}
                                  >
                                    {item.title}
                                  </span>
                                  {item.notes && (
                                    <span dir="auto" className="block mt-0.5 text-[0.75rem] text-primary/50">
                                      {item.notes}
                                    </span>
                                  )}
                                </button>
                                {itemExams.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {itemExams.map((ex) => {
                                      const cfg = getExamTypeConfig(ex.type);
                                      return (
                                        <button
                                          key={ex.id}
                                          type="button"
                                          onClick={() => onSelectExam(ex)}
                                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.66rem] font-semibold hover:opacity-80 transition cursor-pointer"
                                          style={{
                                            backgroundColor: `${cfg.color}16`,
                                            color: cfg.color,
                                          }}
                                        >
                                          <GraduationCap size={10} />
                                          <span>
                                            {getExamTypeLabel(ex.type, lang)}
                                            {ex.date
                                              ? ` · ${formatLocalizedDate(ex.date, 'd MMM', lang)}`
                                              : ''}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleDelete(item.id)}
                                aria-label={`${t('removeTrack')}: ${item.title}`}
                                className="h-7 w-7 grid place-items-center rounded-lg btn-ghost hover:text-secondary transition shrink-0 cursor-pointer"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {group.untrackedTopics.length > 0 && (
                        <div className="mt-3 pt-3 border-t hairline">
                          <div className="text-[0.68rem] font-bold uppercase tracking-wider text-primary/70 mb-2">
                            {t('includedNotTracked')}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.untrackedTopics.map(({ topic, examId }) => (
                              <button
                                key={topic}
                                type="button"
                                onClick={() =>
                                  handleAddUntrackedTopic(
                                    group.subject,
                                    topic,
                                    examId || group.relatedExams[0]?.id
                                  )
                                }
                                className="inline-flex items-center gap-1 max-w-full rounded-lg border border-primary/35 bg-surface-soft px-2.5 py-1 text-[0.74rem] font-semibold text-primary hover:border-secondary hover:text-secondary transition cursor-pointer text-start break-words"
                              >
                                <Plus size={12} className="shrink-0" /> <span>{topic}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </div>

            {/* Sidebar: Exam Readiness overview */}
            <aside className="space-y-4 min-w-0">
              <section className="card p-4 md:p-5">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <h2 className="font-display text-[1.1rem] font-semibold">{t('examReadiness')}</h2>
                  {onGoAssessments && (
                    <button
                      type="button"
                      onClick={onGoAssessments}
                      className="text-[0.7rem] font-semibold text-secondary hover:underline cursor-pointer"
                    >
                      {t('navAssessments')}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mb-3">
                  <button
                    type="button"
                    onClick={() => setReadinessScope('all')}
                    className={`px-2.5 py-1 rounded-lg text-[0.72rem] font-semibold cursor-pointer ${
                      readinessScope === 'all'
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-soft text-primary/70 hover:bg-primary/10'
                    }`}
                  >
                    {t('clickToInspect')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReadinessScope('major')}
                    className={`px-2.5 py-1 rounded-lg text-[0.72rem] font-semibold cursor-pointer ${
                      readinessScope === 'major'
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-soft text-primary/70 hover:bg-primary/10'
                    }`}
                  >
                    {t('navAssessments')}
                  </button>
                </div>

                {upcomingReadiness.length === 0 ? (
                  <p className="text-[0.83rem] text-primary/50">{t('noUpcomingExams')}</p>
                ) : (
                  <div className="space-y-2.5">
                    {upcomingReadiness.map(({ exam, readiness }) => {
                      const cfg = getExamTypeConfig(exam.type);
                      return (
                        <button
                          key={exam.id}
                          type="button"
                          onClick={() => onSelectExam(exam)}
                          className="w-full text-start rounded-2xl border border-primary/10 bg-surface-soft p-3 hover:border-primary/30 transition cursor-pointer"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div dir="auto" className="text-[0.88rem] font-semibold leading-snug break-words">
                                {exam.subject}
                              </div>
                              <div className="text-[0.72rem] text-primary/50 mt-0.5">
                                {formatRelativeDayLocalized(exam.date, lang)} ·{' '}
                                {formatLocalizedDate(exam.date, 'd MMM', lang)}
                              </div>
                            </div>
                            <span
                              className="shrink-0 rounded-lg px-2 py-0.5 text-[0.68rem] font-semibold"
                              style={{ backgroundColor: `${cfg.color}18`, color: cfg.color }}
                            >
                              {getExamTypeLabel(exam.type, lang)}
                            </span>
                          </div>

                          <div className="mt-2.5 flex items-center gap-1.5 text-[0.76rem] font-semibold">
                            {readiness.totalCount === 0 ? (
                              <span className="text-primary/45 inline-flex items-center gap-1.5">
                                <Circle size={13} /> {t('noTopicsLinked')}
                              </span>
                            ) : readiness.isReady ? (
                              <span className="text-[#2F8F72] inline-flex items-center gap-1.5">
                                <CheckCircle2 size={14} /> {t('finishedChip')} —{' '}
                                {readiness.finishedCount}/{readiness.totalCount}
                              </span>
                            ) : (
                              <span className="text-secondary inline-flex items-center gap-1.5">
                                <BookCheck size={14} /> {readiness.remainingCount}{' '}
                                {t('stillToStudyChip')} ({readiness.finishedCount}/
                                {readiness.totalCount})
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
