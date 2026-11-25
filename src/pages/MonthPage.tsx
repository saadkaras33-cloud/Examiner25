import { useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { Exam, LessonItem } from '../types.ts';
import { formatIsoDate, getExamTypeConfig, groupExamsByDate } from '../utils/exams.ts';
import { formatLocalizedDate, useTranslation } from '../utils/i18n.tsx';
import ExamCard from '../components/ExamCard.tsx';

interface MonthPageProps {
  exams: Exam[];
  lessons: LessonItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onEdit: (exam: Partial<Exam>) => void;
  isSplit?: boolean;
}

export default function MonthPage({
  exams,
  lessons,
  loading,
  error,
  onRetry,
  onEdit,
  isSplit = false,
}: MonthPageProps) {
  const { lang, t } = useTranslation();
  const now = new Date();
  const [monthStart, setMonthStart] = useState<Date>(startOfMonth(now));
  const [selectedIso, setSelectedIso] = useState<string>(formatIsoDate(now));

  const byDate = useMemo(() => groupExamsByDate(exams), [exams]);

  const weekdays = useMemo(() => {
    const monday = startOfWeek(now, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => formatLocalizedDate(addDays(monday, i), 'EEE', lang));
  }, [lang]);

  const calendarDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(monthStart), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 }),
      }),
    [monthStart]
  );

  const monthExams = useMemo(
    () =>
      exams.filter(
        (ex) => ex.date && isSameMonth(new Date(`${ex.date}T00:00:00`), monthStart)
      ),
    [exams, monthStart]
  );

  const selectedExams = byDate[selectedIso] || [];

  function shiftMonth(delta: number) {
    const next = addMonths(monthStart, delta);
    setMonthStart(next);
    setSelectedIso(formatIsoDate(startOfMonth(next)));
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-paper grain">
      <header className="sticky top-0 z-20 bg-paper-blur border-b hairline">
        <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary/65">
              {monthExams.length} {t('authExamsLabel').toLowerCase()}
            </div>
            <h1 className="font-display text-[1.35rem] sm:text-[1.45rem] md:text-[1.7rem] font-semibold leading-snug break-words">
              {formatLocalizedDate(monthStart, 'MMMM yyyy', lang)}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-4 md:py-7 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] md:pb-10">
        {loading && exams.length === 0 ? (
          <div className="h-96 rounded-3xl bg-primary/10 softpulse" />
        ) : error && exams.length === 0 ? (
          <div className="card max-w-xl mx-auto p-8 text-center">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-secondary/10 grid place-items-center mb-4">
              <AlertCircle size={24} className="text-secondary" />
            </div>
            <h2 className="font-display text-[1.4rem] font-semibold leading-tight">
              {t('couldntLoadExams')}
            </h2>
            <p className="mt-2 text-[0.9rem] text-primary/60 leading-relaxed">
              {t('errorExamsNote')}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[0.86rem] font-semibold text-on-primary cursor-pointer"
            >
              <RefreshCw size={15} /> {t('tryAgain')}
            </button>
          </div>
        ) : (
          <div
            className={`grid gap-5 ${
              isSplit ? 'xl:grid-cols-[1.7fr_1fr]' : 'lg:grid-cols-[1.7fr_1fr]'
            }`}
          >
            <section className="card p-2 sm:p-4 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2 border-b hairline">
                <span className="font-display text-[0.95rem] sm:text-[1rem] font-semibold leading-snug break-words min-w-0">
                  {formatLocalizedDate(monthStart, 'MMMM yyyy', lang)}
                </span>
                <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    aria-label="Previous month"
                    className="h-8 w-8 grid place-items-center rounded-xl btn-ghost cursor-pointer"
                  >
                    <ChevronLeft size={16} className="rtl:rotate-180" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const today = new Date();
                      setMonthStart(startOfMonth(today));
                      setSelectedIso(formatIsoDate(today));
                    }}
                    className="px-2.5 sm:px-3 h-8 rounded-xl text-[0.72rem] sm:text-[0.75rem] font-semibold btn-secondary cursor-pointer"
                  >
                    {t('todayLabel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    aria-label="Next month"
                    className="h-8 w-8 grid place-items-center rounded-xl btn-ghost cursor-pointer"
                  >
                    <ChevronRight size={16} className="rtl:rotate-180" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-0.5 sm:gap-1.5 mb-1.5">
                {weekdays.map((day, i) => (
                  <div
                    key={i}
                    className="text-center text-[0.55rem] sm:text-[0.6rem] font-bold uppercase tracking-wider text-primary/60 py-1 truncate"
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-0.5 sm:gap-1.5">
                {calendarDays.map((day) => {
                  const iso = formatIsoDate(day);
                  const dayExams = byDate[iso] || [];
                  const outsideMonth = !isSameMonth(day, monthStart);
                  const isSelected = iso === selectedIso;
                  const today = isToday(day);

                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => {
                        setSelectedIso(iso);
                        if (outsideMonth) setMonthStart(startOfMonth(day));
                      }}
                      className={`relative min-h-[2.75rem] sm:min-h-[4.4rem] md:min-h-[5.4rem] rounded-lg sm:rounded-xl p-0.5 sm:p-1.5 border text-start transition flex flex-col items-start justify-start cursor-pointer min-w-0 ${
                        isSelected
                          ? 'bg-primary border-primary text-on-primary'
                          : outsideMonth
                          ? 'bg-surface-soft/55 border-primary/10 text-primary/65 hover:bg-primary/10 hover:text-primary'
                          : 'bg-surface-soft border-primary/15 text-primary hover:border-primary/35'
                      }`}
                    >
                      <span
                        className={`inline-grid place-items-center h-5 w-5 rounded-full text-[0.72rem] font-semibold ${
                          today && !isSelected ? 'bg-secondary text-on-secondary' : ''
                        }`}
                      >
                        {formatLocalizedDate(day, 'd', lang)}
                      </span>

                      {dayExams.length > 0 && (
                        <>
                          <span className="mt-0.5 hidden sm:block space-y-[2px] w-full">
                            {dayExams.slice(0, 2).map((ex) => {
                              const cfg = getExamTypeConfig(ex.type);
                              return (
                                <span
                                  key={ex.id}
                                  className="flex items-start gap-1 rounded px-1 py-[2px] text-[0.6rem] font-semibold leading-tight"
                                  style={
                                    isSelected
                                      ? { backgroundColor: 'rgba(128,128,128,0.22)' }
                                      : { backgroundColor: `${cfg.color}18`, color: cfg.color }
                                  }
                                >
                                  <span
                                    className="mt-1 h-1 w-1 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: isSelected
                                        ? 'var(--color-ink-on-primary)'
                                        : cfg.color,
                                    }}
                                  />
                                  <span dir="auto" className="break-words whitespace-normal leading-tight text-start">
                                    {ex.subject}
                                  </span>
                                </span>
                              );
                            })}
                            {dayExams.length > 2 && (
                              <span
                                className={`block text-[0.58rem] font-semibold ps-1 ${
                                  isSelected ? 'opacity-80' : 'text-primary/70'
                                }`}
                              >
                                +{dayExams.length - 2} {t('moreShort')}
                              </span>
                            )}
                          </span>

                          <span className="mt-1 flex sm:hidden gap-[3px]">
                            {dayExams.slice(0, 3).map((ex, idx) => (
                              <span
                                key={idx}
                                className="h-[5px] w-[5px] rounded-full"
                                style={{
                                  backgroundColor: isSelected
                                    ? 'var(--color-ink-on-primary)'
                                    : getExamTypeConfig(ex.type).color,
                                }}
                              />
                            ))}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <aside className="card p-4 md:p-5 h-fit lg:sticky lg:top-24">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="text-[0.63rem] font-semibold uppercase tracking-[0.16em] text-primary/60">
                    {formatLocalizedDate(selectedIso, 'EEEE', lang)}
                  </div>
                  <h2 className="font-display text-[1.2rem] font-semibold leading-tight">
                    {formatLocalizedDate(selectedIso, 'd MMMM yyyy', lang)}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit({ date: selectedIso })}
                  aria-label={t('addExam')}
                  className="h-9 w-9 grid place-items-center rounded-xl bg-primary text-on-primary shrink-0 cursor-pointer"
                >
                  <Plus size={16} />
                </button>
              </div>

              {selectedExams.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-primary/25 px-4 py-8 text-center">
                  <GraduationCap size={20} className="mx-auto text-primary/45 mb-1.5" />
                  <p className="text-[0.83rem] text-primary/65">{t('noExamsThisDay')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedExams.map((ex) => (
                    <ExamCard
                      key={ex.id}
                      exam={ex}
                      lessons={lessons}
                      onEdit={onEdit}
                      showDate={false}
                    />
                  ))}
                </div>
              )}

              {monthExams.length > 0 && (
                <div className="mt-4 pt-3 border-t hairline">
                  <div className="text-[0.7rem] font-semibold uppercase tracking-wider text-primary/60 mb-2">
                    {formatLocalizedDate(monthStart, 'MMMM', lang)} · {t('atAGlance')}
                  </div>
                  <div className="space-y-1">
                    {monthExams.slice(0, 10).map((ex) => (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => setSelectedIso(ex.date)}
                        className="w-full flex items-center gap-2 text-start rounded-lg px-1.5 py-1 hover:bg-primary/5 cursor-pointer"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: getExamTypeConfig(ex.type).color }}
                        />
                        <span dir="auto" className="text-[0.78rem] font-medium text-primary/85 leading-snug break-words flex-1">
                          {ex.subject}
                        </span>
                        <span className="text-[0.7rem] text-primary/60 shrink-0">
                          {formatLocalizedDate(ex.date, 'd MMM', lang)}
                        </span>
                      </button>
                    ))}
                    {monthExams.length > 10 && (
                      <p className="text-[0.7rem] text-primary/60 ps-1.5 pt-1">
                        +{monthExams.length - 10} {t('moreThisMonth')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
