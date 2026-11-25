import { Globe } from 'lucide-react';
import type { LanguageId } from '../types.ts';
import { LANGUAGES, useTranslation } from '../utils/i18n.tsx';

interface LanguagePickerProps {
  variant?: 'sidebar' | 'pills' | 'select';
  onChangeLanguage?: (lang: LanguageId) => void;
}

export default function LanguagePicker({
  variant = 'sidebar',
  onChangeLanguage,
}: LanguagePickerProps) {
  const { lang, setLang, t } = useTranslation();

  function handleSelect(next: LanguageId) {
    setLang(next);
    onChangeLanguage?.(next);
  }

  if (variant === 'select') {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-xl border border-primary/15 bg-surface px-2.5 h-9">
        <Globe size={14} className="text-primary/55 shrink-0" />
        <select
          aria-label={t('languageLabel')}
          value={lang}
          onChange={(e) => handleSelect(e.target.value as LanguageId)}
          className="bg-transparent text-[0.76rem] font-semibold text-primary outline-none cursor-pointer"
        >
          {LANGUAGES.map((item) => (
            <option key={item.id} value={item.id} className="bg-surface text-primary">
              {item.nativeName}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (variant === 'pills') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-primary/55">
          <Globe size={13} />
          <span className="text-[0.68rem] font-semibold uppercase tracking-wider">
            {t('languageLabel')}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGES.map((item) => {
            const active = lang === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`px-3 py-1.5 rounded-xl text-[0.76rem] font-semibold transition cursor-pointer ${
                  active
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'btn-secondary'
                }`}
              >
                {item.nativeName}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-primary/60 inline-flex items-center gap-1">
          <Globe size={11} /> {t('languageLabel')}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {LANGUAGES.map((item) => {
          const active = lang === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              title={item.name}
              className={`px-2 py-1 rounded-lg text-[0.68rem] font-semibold transition cursor-pointer ${
                active
                  ? 'bg-primary text-on-primary'
                  : 'btn-secondary'
              }`}
            >
              {item.nativeName}
            </button>
          );
        })}
      </div>
    </div>
  );
}
