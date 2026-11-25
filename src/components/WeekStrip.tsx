import { addDays, isSameDay, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Exam } from '../types.ts';
import { formatIsoDate, getExamTypeConfig } from '../utils/exams.ts';
import { formatLocalizedDate, useTranslation } from '../utils/i18n.tsx';

interface WeekStripProps {
  weekStart: Date;
  selected: Date;
  onSelect: (date: Date) => void;
  byDate: Record<string, Exam[]>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isCurrentWeek: boolean;
}

export default function WeekStrip({
  weekStart,
  selected,
  onSelect,
  byDate,
  onPrev,
  onNext,
  onToday,
  isCurrentWeek,
}: WeekStripProps) {
  const { lang, t } = useTranslation();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2.5">
        <div className="text-[0.68rem] sm:text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-primary/50 min-w-0">
          {formatLocalizedDate(weekStart, 'd MMM', lang)} –{' '}
          {formatLocalizedDate(addDays(weekStart, 6), 'd MMM yyyy', lang)}
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={onToday}
              className="text-[0.68rem] sm:text-[0.7rem] font-semibold px-2 sm:px-2.5 py-1 rounded-full btn-secondary cursor-pointer"
            >
              {t('thisWeekBtn')}
            </button>
          )}
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous week"
            className="h-8 w-8 grid place-items-center rounded-xl btn-ghost cursor-pointer"
          >
            <ChevronLeft size={17} className="rtl:rotate-180" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next week"
            className="h-8 w-8 grid place-items-center rounded-xl btn-ghost cursor-pointer"
          >
            <ChevronRight size={17} className="rtl:rotate-180" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 min-[380px]:gap-1.5 sm:gap-2">
        {days.map((day) => {
          const iso = formatIsoDate(day);
          const dayExams = byDate[iso] || [];
          const isSelected = selected && isSameDay(day, selected);
          const today = isToday(day);

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(day)}
              className={`relative flex flex-col items-center gap-0.5 sm:gap-1 rounded-xl sm:rounded-2xl pt-2 pb-1.5 px-0.5 sm:pt-2.5 sm:pb-2 sm:px-1 border transition cursor-pointer min-w-0 ${
                isSelected
                  ? 'bg-primary border-primary text-on-primary shadow-lg'
                  : 'bg-surface border-primary/10 hover:border-primary/30 text-primary'
              }`}
            >
              <span
                className={`text-[0.56rem] sm:text-[0.6rem] font-semibold uppercase tracking-wider ${
                  isSelected ? 'opacity-85' : 'text-primary/65'
                }`}
              >
                {formatLocalizedDate(day, 'EEEEE', lang)}
              </span>
              <span className="font-display text-[1.05rem] min-[360px]:text-[1.22rem] sm:text-[1.35rem] leading-none font-semibold">
                {formatLocalizedDate(day, 'd', lang)}
              </span>
              <span className="h-2 flex items-center gap-[2px] sm:gap-[3px]">
                {dayExams.length > 0 &&
                  dayExams.slice(0, 3).map((ex, idx) => (
                    <span
                      key={idx}
                      className="h-[4px] w-[4px] sm:h-[5px] sm:w-[5px] rounded-full"
                      style={{
                        backgroundColor: isSelected
                          ? 'var(--color-ink-on-primary)'
                          : getExamTypeConfig(ex.type).color,
                      }}
                    />
                  ))}
                {isSelected && dayExams.length === 0 && (
                  <span
                    className="h-[4px] w-[4px] sm:h-[5px] sm:w-[5px] rounded-full opacity-35"
                    style={{ backgroundColor: 'var(--color-ink-on-primary)' }}
                  />
                )}
              </span>
              {today && !isSelected && (
                <span className="absolute top-1 right-1 sm:top-1.5 sm:right-1.5 h-1.5 w-1.5 rounded-full bg-secondary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
