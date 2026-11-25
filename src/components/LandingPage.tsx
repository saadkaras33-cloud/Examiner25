import { useState } from 'react';
import { Calendar, FileText, Loader2, Sparkles } from 'lucide-react';
import type { UserProfile } from '../types.ts';
import { getExamTypeLabel, useTranslation } from '../utils/i18n.tsx';
import GoogleSignInButton from './GoogleSignInButton.tsx';
import LanguagePicker from './LanguagePicker.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface LandingPageProps {
  onSignIn: () => Promise<void> | void;
  onOpenLogin?: () => Promise<void> | void;
  onGoogleSuccess?: (user: UserProfile) => void;
}

const PREVIEW_DAYS = [
  { letter: 'M', num: 11, active: false },
  { letter: 'T', num: 12, active: false },
  { letter: 'W', num: 13, active: true },
  { letter: 'T', num: 14, active: false },
  { letter: 'F', num: 15, active: false },
  { letter: 'S', num: 16, active: false },
  { letter: 'S', num: 17, active: false },
];

export default function LandingPage({
  onSignIn,
  onOpenLogin,
  onGoogleSuccess,
}: LandingPageProps) {
  const { lang, t } = useTranslation();
  const [signingIn, setSigningIn] = useState(false);
  const [googleError, setGoogleError] = useState('');

  const previewExams = [
    {
      subject: 'Organic Chemistry',
      type: getExamTypeLabel('final', lang),
      color: '#E25838',
      detail: 'Thu · 9:00 AM',
    },
    {
      subject: 'Statistics II',
      type: getExamTypeLabel('quiz', lang),
      color: '#7A6BC4',
      detail: 'Fri · 11:30 AM',
    },
  ];

  async function handleStart() {
    setSigningIn(true);
    try {
      await onSignIn();
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="h-full min-h-dvh overflow-y-auto overflow-x-clip bg-paper grain">
      <div className="max-w-5xl mx-auto px-3.5 sm:px-5 pt-[calc(0.85rem+env(safe-area-inset-top,0px))] flex justify-end">
        <LanguagePicker variant="select" />
      </div>

      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-3.5 sm:px-5 py-6 sm:py-8 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
        <div className="w-full max-w-5xl grid md:grid-cols-2 gap-8 sm:gap-10 md:gap-16 items-center">
          <div className="rise min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 mb-5 sm:mb-6 max-w-full">
              <Sparkles size={13} className="text-secondary shrink-0" />
              <span className="text-[0.68rem] sm:text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary/60 truncate">
                {t('landingBadge')}
              </span>
            </div>

            <h1 className="font-display text-[2.25rem] min-[375px]:text-[2.7rem] sm:text-6xl md:text-[4.2rem] leading-[0.95] font-semibold break-words">
              {t('landingHero1')}
              <br />
              {t('landingHero2')}
              <br />
              <span className="relative inline-block">
                {t('landingHero3')}
                <span className="absolute left-0 -bottom-1 h-[6px] w-full bg-secondary/70 rounded-full" />
              </span>
            </h1>

            <p className="mt-6 text-[0.98rem] leading-relaxed text-primary/60 max-w-sm">
              {t('landingSub')}
            </p>

            <div className="mt-8 flex flex-col gap-3 max-w-md">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={signingIn}
                  className="px-7 py-3.5 rounded-2xl bg-primary text-on-primary font-semibold text-[0.95rem] inline-flex items-center gap-2 active:scale-[0.98] transition disabled:opacity-60 cursor-pointer"
                >
                  {signingIn && <Loader2 size={17} className="animate-spin" />}
                  {t('landingCtaCreate')}
                </button>
                {onOpenLogin && (
                  <button
                    type="button"
                    onClick={() => onOpenLogin()}
                    className="px-5 py-3.5 rounded-2xl btn-secondary font-semibold text-[0.92rem] transition cursor-pointer"
                  >
                    {t('landingCtaSignIn')}
                  </button>
                )}
                <PWAInstallButton variant="landing" />
              </div>

              {onGoogleSuccess && (
                <div>
                  <GoogleSignInButton
                    compact
                    onSuccess={onGoogleSuccess}
                    onError={setGoogleError}
                    className="w-full sm:w-auto"
                  />
                  {googleError && (
                    <p className="mt-2 text-[0.78rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
                      {googleError}
                    </p>
                  )}
                </div>
              )}
            </div>

            <p className="mt-3 text-[0.75rem] text-primary/65">
              {t('landingFoot')}
            </p>
          </div>

          <div className="rise min-w-0" style={{ animationDelay: '0.12s' }}>
            <div className="relative">
              <div className="hidden sm:block absolute inset-0 translate-x-3 translate-y-4 bg-primary/[0.06] rounded-3xl border border-primary/10" />
              <div className="relative card p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-display text-base sm:text-lg font-semibold">{t('landingThisWeek')}</span>
                  <Calendar size={18} className="text-primary/50 shrink-0" />
                </div>

                <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-5">
                  {PREVIEW_DAYS.map((day, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl py-1.5 sm:py-2 text-center border ${
                        day.active
                          ? 'bg-primary text-on-primary border-primary'
                          : 'bg-surface-soft border-primary/10 text-primary/60'
                      }`}
                    >
                      <div className="text-[0.58rem] sm:text-[0.6rem] font-semibold uppercase opacity-60">
                        {day.letter}
                      </div>
                      <div className="font-display text-sm sm:text-base font-semibold">{day.num}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  {previewExams.map((item) => (
                    <div
                      key={item.subject}
                      className="flex items-center gap-3 rounded-2xl border border-primary/10 bg-surface-soft px-3.5 py-3"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div dir="auto" className="text-[0.85rem] font-semibold leading-snug break-words">{item.subject}</div>
                        <div className="text-[0.72rem] text-primary/50">{item.detail}</div>
                      </div>
                      <span
                        className="chip"
                        style={{ backgroundColor: `${item.color}16`, color: item.color }}
                      >
                        {item.type}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2 rounded-2xl bg-primary/[0.04] border border-dashed border-primary/20 px-3.5 py-3">
                  <FileText size={16} className="text-primary/40" />
                  <span className="text-[0.76rem] text-primary/50">
                    {t('landingPdfIn')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
