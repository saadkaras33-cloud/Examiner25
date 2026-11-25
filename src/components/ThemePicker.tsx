import { useMemo, useState } from 'react';
import { Check, Moon, Palette, Search, Sparkles, Sun, X } from 'lucide-react';
import type { ThemeId } from '../types.ts';
import { useTranslation } from '../utils/i18n.tsx';
import { getThemePalette, THEME_PALETTES } from '../utils/themes.ts';

interface ThemePickerProps {
  currentTheme: ThemeId;
  onSelectTheme: (id: ThemeId) => void;
  variant?: 'inline' | 'modal';
  onClose?: () => void;
  onOpenFullPicker?: () => void;
}

type KindFilter = 'all' | 'solid' | 'gradient';
type ToneFilter = 'all' | 'light' | 'dark';

const QUICK_FEATURED_IDS = [
  'paper',
  'sage',
  'ocean',
  'plum',
  'midnight',
  'espresso',
  'grad-sunrise-peach',
  'grad-aurora-mint',
  'grad-lavender-silk',
  'grad-midnight-aurora',
  'grad-cosmic-indigo',
  'grad-crimson-dusk',
];

export default function ThemePicker({
  currentTheme,
  onSelectTheme,
  variant = 'inline',
  onClose,
  onOpenFullPicker,
}: ThemePickerProps) {
  const { t } = useTranslation();
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [toneFilter, setToneFilter] = useState<ToneFilter>('all');
  const [query, setQuery] = useState('');
  const [internalModalOpen, setInternalModalOpen] = useState(false);

  const activePalette = useMemo(() => getThemePalette(currentTheme), [currentTheme]);

  const featuredPalettes = useMemo(() => {
    const map = new Map(THEME_PALETTES.map((p) => [p.id, p]));
    const picked = QUICK_FEATURED_IDS.map((id) => map.get(id)).filter(
      (p): p is (typeof THEME_PALETTES)[number] => Boolean(p)
    );
    if (!picked.some((p) => p.id === activePalette.id)) {
      picked.unshift(activePalette);
    }
    return picked.slice(0, 12);
  }, [activePalette]);

  const filteredPalettes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return THEME_PALETTES.filter((p) => {
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false;
      if (toneFilter === 'light' && p.isDark) return false;
      if (toneFilter === 'dark' && !p.isDark) return false;
      if (q && !`${p.name} ${p.kind} ${p.id}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [kindFilter, toneFilter, query]);

  const renderModal = (handleClose: () => void) => (
    <div
      className="fixed inset-0 z-50 bg-primary/50 flex items-end md:items-center justify-center p-0 sm:p-4"
      onClick={handleClose}
    >
      <div
        className="w-full md:max-w-3xl bg-paper rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[calc(100dvh-1.5rem)] flex flex-col overflow-hidden border hairline"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 bg-paper-blur z-10 px-4 sm:px-5 pt-4 pb-3 border-b hairline space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="h-8 w-8 rounded-xl bg-secondary/15 text-secondary grid place-items-center shrink-0">
                <Palette size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg sm:text-xl font-semibold leading-tight truncate">
                  {t('themeColours')} · 100
                </h2>
                <p className="text-[0.72rem] text-primary/65 truncate">
                  {activePalette.name} ·{' '}
                  {activePalette.kind === 'gradient' ? t('gradientTag') : t('solidTag')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label={t('close')}
              className="h-9 w-9 grid place-items-center rounded-xl btn-ghost cursor-pointer shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="max-w-full overflow-x-auto inline-flex rounded-xl bg-primary/10 border hairline p-1 gap-0.5">
              {(
                [
                  { key: 'all', label: t('themesAllCount') },
                  { key: 'solid', label: t('themesSolidTab') },
                  { key: 'gradient', label: t('themesGradientTab') },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setKindFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-lg text-[0.76rem] font-semibold transition cursor-pointer whitespace-nowrap ${
                    kindFilter === tab.key
                      ? 'bg-primary text-on-primary shadow-xs'
                      : 'text-primary/80 hover:bg-surface'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="max-w-full overflow-x-auto inline-flex rounded-xl bg-primary/10 border hairline p-1 gap-0.5">
              <button
                type="button"
                onClick={() => setToneFilter('all')}
                className={`px-2.5 py-1.5 rounded-lg text-[0.74rem] font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  toneFilter === 'all'
                    ? 'bg-secondary text-on-secondary'
                    : 'text-primary/80 hover:bg-surface'
                }`}
              >
                {t('allMode')}
              </button>
              <button
                type="button"
                onClick={() => setToneFilter('light')}
                className={`px-2.5 py-1.5 rounded-lg text-[0.74rem] font-semibold inline-flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  toneFilter === 'light'
                    ? 'bg-secondary text-on-secondary'
                    : 'text-primary/80 hover:bg-surface'
                }`}
              >
                <Sun size={12} /> {t('light')}
              </button>
              <button
                type="button"
                onClick={() => setToneFilter('dark')}
                className={`px-2.5 py-1.5 rounded-lg text-[0.74rem] font-semibold inline-flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  toneFilter === 'dark'
                    ? 'bg-secondary text-on-secondary'
                    : 'text-primary/80 hover:bg-surface'
                }`}
              >
                <Moon size={12} /> {t('dark')}
              </button>
            </div>

            <div className="relative w-full sm:w-auto sm:flex-1 min-w-0 sm:min-w-[10rem]">
              <Search
                size={14}
                className="absolute start-3 top-1/2 -translate-y-1/2 text-primary/45 pointer-events-none"
              />
              <input
                type="text"
                dir="auto"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchThemesPlaceholder')}
                className="w-full h-9 rounded-xl border border-primary/20 bg-surface ps-8 pe-7 text-[0.8rem] outline-none focus:border-secondary"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('close')}
                  className="absolute end-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-primary/12 grid place-items-center cursor-pointer"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 pb-[calc(1.75rem+env(safe-area-inset-bottom,0px))]">
          {filteredPalettes.length === 0 ? (
            <div className="py-12 text-center text-[0.88rem] text-primary/60">
              {t('searchThemesPlaceholder')}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-2.5">
              {filteredPalettes.map((palette) => {
                const active = currentTheme === palette.id;
                return (
                  <button
                    key={palette.id}
                    type="button"
                    onClick={() => onSelectTheme(palette.id)}
                    className={`group rounded-2xl p-2.5 border text-start transition cursor-pointer flex flex-col gap-2 ${
                      active
                        ? 'border-secondary bg-secondary/10 ring-2 ring-secondary/35'
                        : 'border-primary/15 bg-surface hover:border-primary/40'
                    }`}
                  >
                    <div
                      className="h-14 w-full rounded-xl border border-black/10 relative overflow-hidden flex items-end justify-between p-2"
                      style={{ background: palette.swatchPreviewCss }}
                    >
                      <span
                        className="h-5 w-5 rounded-full border border-white/60 shadow-xs shrink-0"
                        style={{ backgroundColor: palette.swatchSecondary }}
                      />
                      <span
                        className="rounded-md px-1.5 py-0.5 text-[0.58rem] font-bold uppercase tracking-wider"
                        style={{
                          backgroundColor: palette.isDark
                            ? 'rgba(255,255,255,0.16)'
                            : 'rgba(0,0,0,0.09)',
                          color: palette.swatchPrimary,
                        }}
                      >
                        {palette.kind === 'gradient' ? t('gradientTag') : t('solidTag')}
                      </span>
                      {active && (
                        <span className="absolute top-1.5 end-1.5 h-5 w-5 rounded-full bg-secondary text-on-secondary grid place-items-center shadow-xs">
                          <Check size={12} strokeWidth={2.75} />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 px-0.5">
                      <div className="text-[0.8rem] font-semibold leading-snug truncate">
                        {palette.name}
                      </div>
                      <div className="text-[0.66rem] text-primary/55 flex items-center gap-1">
                        <span>{palette.isDark ? t('dark') : t('light')}</span>
                        <span>·</span>
                        <span>{palette.kind === 'gradient' ? t('gradientTag') : t('solidTag')}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (variant === 'modal') {
    return renderModal(() => onClose?.());
  }

  return (
    <>
      <div className="px-4 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-primary/55">
            {t('themeColours')} (100)
          </span>
          <span className="text-[0.68rem] font-medium text-primary/65 truncate max-w-[8.5rem]">
            {activePalette.name}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {featuredPalettes.map((palette) => {
            const active = currentTheme === palette.id;
            return (
              <button
                key={palette.id}
                type="button"
                title={`${palette.name} (${palette.kind === 'gradient' ? t('gradientTag') : t('solidTag')})`}
                aria-label={palette.name}
                onClick={() => onSelectTheme(palette.id)}
                className={`h-7 w-7 rounded-full grid place-items-center border-2 transition cursor-pointer ${
                  active ? 'border-secondary scale-110' : 'border-primary/20 hover:border-primary/45'
                }`}
                style={{
                  background:
                    palette.kind === 'gradient'
                      ? palette.swatchPreviewCss
                      : `linear-gradient(135deg, ${palette.swatchBg} 55%, ${palette.swatchPrimary} 55%)`,
                }}
              >
                {active && (
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-2 ring-white"
                    style={{ backgroundColor: palette.swatchSecondary }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            if (onOpenFullPicker) {
              onOpenFullPicker();
            } else {
              setInternalModalOpen(true);
            }
          }}
          className="w-full h-9 px-3 rounded-xl btn-secondary text-[0.76rem] font-semibold inline-flex items-center justify-between gap-2 cursor-pointer"
        >
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={13} className="text-secondary shrink-0" />
            <span>{t('browseAllThemesBtn')}</span>
          </span>
          <span className="text-[0.68rem] text-primary/65">50 Solid · 50 Grad</span>
        </button>
      </div>

      {internalModalOpen && renderModal(() => setInternalModalOpen(false))}
    </>
  );
}
