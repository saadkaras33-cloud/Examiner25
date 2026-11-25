import { BookCheck, CheckCircle2, ChevronRight, Clock, MapPin } from 'lucide-react';
import type { Exam, LessonItem } from '../types.ts';
import {
  formatTimeRange,
  getExamReadiness,
  getExamTypeConfig,
} from '../utils/exams.ts';
import { formatLocalizedDate, getExamTypeLabel, useTranslation } from '../utils/i18n.tsx';

interface ExamCardProps {
  exam: Exam;
  lessons?: LessonItem[];
  onEdit?: (exam: Exam) => void;
  showDate?: boolean;
  compact?: boolean;
}

export default function ExamCard({
  exam,
  lessons = [],
  onEdit,
  showDate = true,
  compact = false,
}: ExamCardProps) {
  const { lang, t } = useTranslation();
  const typeCfg = getExamTypeConfig(exam.type);
  const typeLabel = getExamTypeLabel(typeCfg.key, lang);
  const timeRange = formatTimeRange(exam.startTime, exam.endTime);
  const readiness = getExamReadiness(exam, lessons);

  return (
    <button
      type="button"
      onClick={() => onEdit && onEdit(exam)}
      className="card w-full text-start px-4 py-3.5 flex items-start gap-3 transition active:scale-[0.985] hover:shadow-md group cursor-pointer"
    >
      <span
        className="mt-1 h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: typeCfg.color }}
      />
      <span className="flex-1 min-w-0">
        <span className="flex items-start gap-2 flex-wrap">
          <span dir="auto" className="font-semibold text-[0.95rem] leading-snug break-words">
            {exam.subject || t('untitledExam')}
          </span>
          <span
            className="chip shrink-0"
            style={{ backgroundColor: `${typeCfg.color}16`, color: typeCfg.color }}
          >
            {typeLabel}
          </span>
        </span>
        <span className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[0.78rem] text-primary/60">
          {showDate && (
            <span className="font-medium text-primary/70">
              {formatLocalizedDate(exam.date, 'EEE, d MMM', lang)}
            </span>
          )}
          {timeRange && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {timeRange}
            </span>
          )}
          {exam.room && (
            <span className="inline-flex items-center gap-1 break-words">
              <MapPin size={12} className="shrink-0" /> {exam.room}
            </span>
          )}
          {readiness.totalCount > 0 && (
            <span
              className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
                readiness.isReady ? 'text-[#2F8F72]' : 'text-secondary'
              }`}
            >
              {readiness.isReady ? (
                <>
                  <CheckCircle2 size={12} /> {t('finishedChip')} ({readiness.finishedCount}/
                  {readiness.totalCount})
                </>
              ) : (
                <>
                  <BookCheck size={12} /> {readiness.finishedCount}/{readiness.totalCount}{' '}
                  {t('doneLabel')}
                </>
              )}
            </span>
          )}
        </span>
      </span>
      <ChevronRight
        size={14}
        className="mt-1.5 shrink-0 text-primary/20 group-hover:text-primary/50 rtl:rotate-180"
      />
    </button>
  );
}
