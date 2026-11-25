import { useMemo, useState } from 'react';
import { addDays, addWeeks, isSameDay, isSameWeek, startOfWeek } from 'date-fns';
import {
  AlertCircle,
  BookCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileScan,
  GraduationCap,
  MapPin,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { Exam, LessonItem } from '../types.ts';
import {
  formatIsoDate,
  formatTimeRange,
  getExamReadiness,
  getExamTypeConfig,
  groupExamsByDate,
} from '../utils/exams.ts';
import {
  formatLocalizedDate,
  formatRelativeDayLocalized,
  useTranslation,
} from '../utils/i18n.tsx';
import ExamCard from '../components/ExamCard.tsx';
import WeekStrip from '../components/WeekStrip.tsx';

interface TodayPageProps {
  exams: Exam[];
  lessons: LessonItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onEdit: (exam: Exam) => void;
  onAdd: () => void;
  onGoScan: () => void;
  isSplit?: boolean;
}

export default function TodayPage({
  exams,
  lessons,
  loading,
  error,
  onRetry,
  onEdit,
  onAdd,
  onGoScan,
  isSplit = false,
}: TodayPageProps) {
  const { lang, t } = useTranslation();
  const now = new Date();
  const todayIso = formatIsoDate(now);
  const [selectedDate, setSelectedDate] = useState<Date>(now);
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(now, { weekStartsOn: 1 }));

  const byDate = useMemo(() => groupExamsByDate(exams), [exams]);
  const upcomingExams = useMemo(
    () => exams.filter((ex) => ex.date && ex.date >= todayIso),
    [exams, todayIso]
  );
  const nextExam = upcomingExams[0];
  const nextExamReadiness = useMemo(
    () => (nextExam ? getExamReadiness(nextExam, lessons) : null),
    [nextExam, lessons]
  );
  const weekExams = useMemo(() => {
    const startIso = formatIsoDate(weekStart);
    const endIso = formatIsoDate(addDays(weekStart, 6));
    return exams.filter((ex) => ex.date >= startIso && ex.date <= endIso);
  }, [exams, weekStart]);

  const selectedDayExams = byDate[formatIsoDate(selectedDate)] || [];
  const upcomingList = upcomingExams.slice(0, 8);
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-paper grain">
      <header className="sticky top-0 z-20 bg-paper-blur border-b hairline">
        <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary/65">
              {formatLocalizedDate(now, 'EEEE, d MMMM', lang)}
            </div>
            <h1 className="font-display text-[1.35rem] sm:text-[1.45rem] md:text-[1.7rem] font-semibold leading-snug break-words">
              {t('yourExams')}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-4 md:py-7 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] md:pb-10">
        {loading && exams.length === 0 ? (
          <div className="space-y-4">
            <div className="h-40 rounded-3xl bg-primary/10 softpulse" />
            <div className="h-24 rounded-2xl bg-primary/10 softpulse" />
            <div className="h-16 rounded-2xl bg-primary/10 softpulse" />
          </div>
        ) : error && exams.length === 0 ? (
          <div className="rise max-w-xl mx-auto text-center pt-6 md:pt-16">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-secondary/10 grid place-items-center mb-5">
              <AlertCircle size={26} className="text-secondary" />
            </div>
            <h2 className="font-display text-[1.6rem] font-semibold leading-tight">
              {t('couldntLoadExams')}
            </h2>
            <p className="mt-2 text-[0.92rem] text-primary/60 leading-relaxed">
              {isOffline ? t('offlineExamsNote') : t('errorExamsNote')}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-[0.88rem] font-semibold text-on-primary cursor-pointer"
            >
              <RefreshCw size={16} /> {t('tryAgain')}
            </button>
            {!isOffline && error && (
              <p className="mt-4 text-[0.72rem] text-primary/35 break-words">{error}</p>
            )}
          </div>
        ) : exams.length === 0 ? (
          <div className="rise max-w-xl mx-auto text-center pt-6 md:pt-16">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 grid place-items-center mb-5">
              <GraduationCap size={26} className="text-primary/50" />
            </div>
            <h2 className="font-display text-[1.8rem] font-semibold leading-tight">
              {t('calendarEmpty')}
            </h2>
            <p className="mt-2 text-[0.92rem] text-primary/60 leading-relaxed">
              {t('calendarEmptyDesc')}
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
              <button
                type="button"
                onClick={onGoScan}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-[0.88rem] font-semibold text-on-primary cursor-pointer"
              >
                <FileScan size={17} /> {t('scanDocument')}
              </button>
              <button
                type="button"
                onClick={onAdd}
                className="inline-flex items-center justify-center gap-2 rounded-xl btn-secondary px-5 py-3 text-[0.88rem] font-semibold cursor-pointer"
              >
                <Plus size={17} /> {t('addManually')}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`grid gap-5 sm:gap-6 ${
              isSplit ? 'xl:grid-cols-[1.55fr_1fr]' : 'lg:grid-cols-[1.55fr_1fr]'
            }`}
          >
            <div className="space-y-5 min-w-0">
              {nextExam ? (
                <button
                  type="button"
                  onClick={() => onEdit(nextExam)}
                  className="rise w-full text-start relative overflow-hidden rounded-3xl bg-primary text-on-primary p-5 md:p-7 active:scale-[0.995] transition cursor-pointer"
                >
                  <div className="absolute -right-12 -top-14 h-44 w-44 rounded-full bg-current opacity-[0.06]" />
                  <div className="absolute -right-4 bottom-6 h-24 w-24 rounded-full bg-secondary/25 blur-xl" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[0.63rem] font-semibold uppercase tracking-[0.18em] opacity-80">
                        {t('nextExam')}
                      </span>
                      <span className="rounded-full bg-secondary text-on-secondary px-2.5 py-0.5 text-[0.68rem] font-bold">
                        {formatRelativeDayLocalized(nextExam.date, lang)}
                      </span>
                    </div>
                    <div dir="auto" className="font-display text-[1.7rem] md:text-[2.1rem] leading-tight font-semibold break-words">
                      {nextExam.subject}
                    </div>
                    <div className="mt-3 flex items-center gap-x-4 gap-y-1.5 flex-wrap text-[0.8rem] opacity-80">
                      <span className="font-semibold opacity-95">
                        {formatLocalizedDate(nextExam.date, 'EEEE, d MMMM', lang)}
                      </span>
                      {formatTimeRange(nextExam.startTime, nextExam.endTime) && (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock size={13} />
                          {formatTimeRange(nextExam.startTime, nextExam.endTime)}
                        </span>
                      )}
                      {nextExam.room && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin size={13} />
                          {nextExam.room}
                        </span>
                      )}
                      {nextExamReadiness && nextExamReadiness.totalCount > 0 && (
                        <span className="inline-flex items-center gap-1.5 font-semibold opacity-95">
                          {nextExamReadiness.isReady ? (
                            <>
                              <CheckCircle2 size={13} /> {t('finishedChip')} (
                              {nextExamReadiness.totalCount}/{nextExamReadiness.totalCount})
                            </>
                          ) : (
                            <>
                              <BookCheck size={13} /> {nextExamReadiness.finishedCount}/
                              {nextExamReadiness.totalCount} {t('doneLabel')}
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ) : (
                <div className="card p-5 md:p-7">
                  <h2 className="font-display text-xl font-semibold">{t('allCaughtUp')}</h2>
                  <p className="mt-1.5 text-[0.88rem] text-primary/60">
                    {t('noExamsAhead')}
                  </p>
                  <button
                    type="button"
                    onClick={onGoScan}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[0.85rem] font-semibold text-on-primary cursor-pointer"
                  >
                    <FileScan size={16} /> {t('scanDocument')}
                  </button>
                </div>
              )}

              <section className="card p-4 md:p-5">
                <WeekStrip
                  weekStart={weekStart}
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  byDate={byDate}
                  onPrev={() => {
                    setWeekStart((d) => addWeeks(d, -1));
                    setSelectedDate((d) => addWeeks(d, -1));
                  }}
                  onNext={() => {
                    setWeekStart((d) => addWeeks(d, 1));
                    setSelectedDate((d) => addWeeks(d, 1));
                  }}
                  onToday={() => {
                    const today = new Date();
                    setWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
                    setSelectedDate(today);
                  }}
                  isCurrentWeek={isSameWeek(weekStart, now, { weekStartsOn: 1 })}
                />

                <div className="mt-5 pt-4 border-t hairline">
                  <div className="flex items-baseline justify-between mb-2.5">
                    <h2 className="font-display text-[1.05rem] font-semibold">
                      {isSameDay(selectedDate, now)
                        ? t('todayLabel')
                        : formatLocalizedDate(selectedDate, 'EEEE d MMM', lang)}
                    </h2>
                    <span className="text-[0.72rem] font-medium text-primary/65">
                      {weekExams.length} {t('authExamsLabel').toLowerCase()}
                    </span>
                  </div>

                  {selectedDayExams.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-primary/25 px-4 py-6 text-center">
                      <GraduationCap size={20} className="mx-auto text-primary/45 mb-1.5" />
                      <p className="text-[0.83rem] text-primary/65">{t('nothingScheduledDay')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedDayExams.map((ex) => (
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
                </div>
              </section>
            </div>

            <aside className="space-y-4 min-w-0">
              <section className="card p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-display text-[1.1rem] font-semibold">{t('upcoming')}</h2>
                  <span className="text-[0.7rem] font-semibold rounded-full bg-primary/10 px-2 py-0.5 text-primary/60">
                    {upcomingExams.length}
                  </span>
                </div>

                {upcomingList.length === 0 ? (
                  <p className="text-[0.83rem] text-primary/70 py-2">
                    {t('nothingUpcoming')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {upcomingList.map((ex) => {
                      const typeCfg = getExamTypeConfig(ex.type);
                      return (
                        <button
                          key={ex.id}
                          type="button"
                          onClick={() => onEdit(ex)}
                          className="w-full flex items-start gap-3 rounded-2xl px-2.5 py-2.5 hover:bg-primary/5 text-start transition cursor-pointer"
                        >
                          <span
                            className="mt-0.5 shrink-0 w-11 rounded-lg py-1 text-center"
                            style={{ backgroundColor: `${typeCfg.color}18` }}
                          >
                            <span
                              className="block text-[0.58rem] font-bold uppercase"
                              style={{ color: typeCfg.color }}
                            >
                              {formatLocalizedDate(ex.date, 'MMM', lang)}
                            </span>
                            <span
                              className="block font-display text-[1.05rem] leading-none font-semibold"
                              style={{ color: typeCfg.color }}
                            >
                              {formatLocalizedDate(ex.date, 'd', lang)}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span dir="auto" className="block text-[0.86rem] font-semibold leading-snug break-words">
                              {ex.subject}
                            </span>
                            <span className="block text-[0.72rem] text-primary/65 leading-snug break-words">
                              {formatRelativeDayLocalized(ex.date, lang)}
                              {ex.startTime
                                ? ` · ${formatTimeRange(ex.startTime, ex.endTime)}`
                                : ''}
                            </span>
                          </span>
                          <ChevronRight size={14} className="mt-1 text-primary/45 shrink-0 rtl:rotate-180" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <button
                type="button"
                onClick={onGoScan}
                className="w-full text-start card p-4 flex items-center gap-3 hover:border-primary/25 transition cursor-pointer"
              >
                <span className="h-10 w-10 rounded-xl bg-secondary/10 grid place-items-center shrink-0">
                  <FileScan size={18} className="text-secondary" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.86rem] font-semibold">{t('readSchedule')}</span>
                  <span className="block text-[0.74rem] text-primary/70">
                    {t('readScheduleSub')}
                  </span>
                </span>
              </button>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
