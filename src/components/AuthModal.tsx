import { useEffect, useState } from 'react';
import {
  Check,
  GraduationCap,
  Loader2,
  LogOut,
  Palette,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AvatarConfig,
  LanguageId,
  ThemeId,
  UserProfile,
} from '../types.ts';
import {
  deleteAccount,
  logInAccount,
  signUpAccount,
  updateUserProfile,
} from '../services/api.ts';
import { useTranslation } from '../utils/i18n.tsx';
import AvatarSvg from './AvatarSvg.tsx';
import AvatarGeneratorModal from './AvatarGeneratorModal.tsx';
import GoogleSignInButton from './GoogleSignInButton.tsx';
import LanguagePicker from './LanguagePicker.tsx';
import ThemePicker from './ThemePicker.tsx';

type AuthView = 'login' | 'signup' | 'forgot' | 'account' | 'deleteConfirm';

interface AuthModalProps {
  user: UserProfile | null;
  initialView?: AuthView;
  examCount?: number;
  currentTheme?: ThemeId;
  onOpenThemePicker?: () => void;
  onSelectTheme?: (id: ThemeId) => void;
  onChangeLanguage?: (lang: LanguageId) => void;
  onClose: () => void;
  onAuthSuccess: (user: UserProfile) => void;
  onUserUpdate?: (user: UserProfile) => void;
  onSignOut: () => void;
  onQuickGuest?: () => void;
}

export default function AuthModal({
  user,
  initialView,
  examCount = 0,
  currentTheme = 'paper',
  onOpenThemePicker,
  onSelectTheme,
  onChangeLanguage,
  onClose,
  onAuthSuccess,
  onUserUpdate,
  onSignOut,
  onQuickGuest,
}: AuthModalProps) {
  const { t } = useTranslation();
  const defaultView: AuthView = initialView || (user ? 'account' : 'signup');
  const [view, setView] = useState<AuthView>(defaultView);
  const [email, setEmail] = useState(user?.isGuest ? '' : user?.email || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(user?.isGuest ? '' : user?.displayName || '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [showAvatarGen, setShowAvatarGen] = useState(false);

  useEffect(() => {
    if (user && !user.isGuest) {
      setDisplayName(user.displayName || '');
    }
  }, [user]);

  function switchView(next: AuthView) {
    setError('');
    setSuccess('');
    setView(next);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const nextUser = await logInAccount({ email, password });
      onAuthSuccess(nextUser);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const nextUser = await signUpAccount({ email, password, displayName });
      onAuthSuccess(nextUser);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create account.');
    } finally {
      setBusy(false);
    }
  }

  function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !email.includes('@')) {
      setError('Enter your account email.');
      return;
    }
    setSuccess('If an account matches that email, reset instructions are ready.');
  }

  async function handleDeleteConfirm() {
    setError('');
    setBusy(true);
    try {
      await deleteAccount();
      onSignOut();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete account.');
      setBusy(false);
    }
  }

  async function handleSaveAvatar(config: AvatarConfig) {
    setError('');
    const updated = await updateUserProfile({ avatar: config }, user);
    if (!updated) {
      throw new Error('Could not save avatar.');
    }
    if (onUserUpdate) {
      onUserUpdate(updated);
    } else {
      onAuthSuccess(updated);
    }
    setSuccess(t('avatarSavedDone'));
  }

  async function handleSaveProfileName(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = displayName.trim();
    if (!cleanName) {
      setError('Enter your display name.');
      return;
    }
    setError('');
    setSuccess('');
    setProfileSaving(true);
    try {
      const updated = await updateUserProfile({ displayName: cleanName }, user);
      if (!updated) {
        throw new Error('Could not save profile changes.');
      }
      if (onUserUpdate) {
        onUserUpdate(updated);
      } else {
        onAuthSuccess(updated);
      }
      setSuccess(t('avatarSavedDone'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  const title =
    view === 'signup'
      ? t('authCreateTitle')
      : view === 'forgot'
      ? t('authForgotTitle')
      : view === 'account'
      ? t('authAccountTitle')
      : view === 'deleteConfirm'
      ? t('authDeleteTitle')
      : t('authSignInTitle');

  const initials = (
    (user?.displayName || user?.email || 'ME')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .slice(0, 2) || 'ME'
  ).toUpperCase();

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-primary/50 flex items-end md:items-center justify-center p-0 sm:p-4"
        onClick={onClose}
      >
        <div
          className="w-full md:max-w-md bg-paper rounded-t-3xl md:rounded-3xl overflow-y-auto shadow-2xl max-h-[calc(100dvh-1.5rem)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 bg-paper-blur z-10 px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between border-b hairline gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-7 w-7 rounded-lg bg-primary grid place-items-center shrink-0">
                <GraduationCap size={14} className="text-on-primary" />
              </span>
              <h2 className="font-display text-lg sm:text-xl font-semibold leading-snug break-words">{title}</h2>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <LanguagePicker variant="select" onChangeLanguage={onChangeLanguage} />
              <button
                type="button"
                onClick={onClose}
                aria-label={t('close')}
                className="h-9 w-9 grid place-items-center rounded-xl btn-ghost cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="px-4 sm:px-5 py-5 pb-[calc(1.75rem+env(safe-area-inset-bottom,0px))]">
            {view === 'account' && user && (
              <div className="space-y-4">
                <div className="flex items-center gap-3.5 rounded-2xl bg-surface border border-primary/10 p-4">
                  <button
                    type="button"
                    onClick={() => setShowAvatarGen(true)}
                    title={t('customizeAvatar')}
                    className="shrink-0 rounded-full ring-2 ring-transparent hover:ring-secondary transition cursor-pointer"
                  >
                    <AvatarSvg config={user.avatar} initials={initials} size={48} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-primary/60">
                      {user.isGuest ? t('authGuestWorkspace') : t('authSignedInAs')}
                    </div>
                    <div dir="auto" className="text-[0.95rem] font-semibold leading-snug break-words">
                      {user.displayName || t('navAccount')}
                    </div>
                    {user.email && (
                      <div className="text-[0.78rem] text-primary/65 break-all">{user.email}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display text-lg font-semibold tabular-nums">
                      {examCount}
                    </div>
                    <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-primary/60">
                      {t('authExamsLabel')}
                    </div>
                  </div>
                </div>

                {error && (
                  <p className="text-[0.8rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
                    {error}
                  </p>
                )}
                {success && (
                  <p className="text-[0.8rem] font-medium text-[#2F8F72] bg-[#2F8F72]/10 rounded-xl px-3 py-2 inline-flex w-full items-center gap-1.5">
                    <Check size={14} /> {success}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setShowAvatarGen(true)}
                  className="w-full h-11 rounded-xl btn-secondary font-semibold text-[0.86rem] inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Sparkles size={15} className="text-secondary" />
                  {t('customizeProfileAvatar')}
                </button>

                <form
                  onSubmit={handleSaveProfileName}
                  className="rounded-2xl bg-surface border border-primary/10 p-4 space-y-2.5"
                >
                  <label className="field-label mb-0" htmlFor="ex-account-name">
                    {t('authDisplayName')}
                  </label>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input
                      id="ex-account-name"
                      type="text"
                      dir="auto"
                      className="field-sm flex-1 min-w-0"
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                        setSuccess('');
                      }}
                      placeholder={t('authYourName')}
                    />
                    <button
                      type="submit"
                      disabled={profileSaving}
                      className="h-9 px-3.5 rounded-xl bg-primary text-on-primary text-[0.8rem] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer shrink-0"
                    >
                      {profileSaving && <Loader2 size={13} className="animate-spin" />}
                      {t('saveChanges')}
                    </button>
                  </div>
                </form>

                <div className="rounded-2xl bg-surface border border-primary/10 p-4">
                  <LanguagePicker variant="pills" onChangeLanguage={onChangeLanguage} />
                </div>

                {onSelectTheme && (
                  <div className="rounded-2xl bg-surface border border-primary/10 py-2 space-y-2">
                    <div className="px-4 pt-1 flex items-center gap-1.5 text-primary/65">
                      <Palette size={13} />
                      <span className="text-[0.68rem] font-semibold uppercase tracking-wider">
                        {t('appearance')}
                      </span>
                    </div>
                    <ThemePicker
                      currentTheme={currentTheme}
                      onSelectTheme={onSelectTheme}
                      variant="inline"
                      onOpenFullPicker={
                        onOpenThemePicker
                          ? () => {
                              onClose();
                              onOpenThemePicker();
                            }
                          : undefined
                      }
                    />
                  </div>
                )}

                {user.isGuest && (
                  <div className="rounded-2xl bg-primary/[0.04] border border-primary/10 p-4 space-y-2.5">
                    <p className="text-[0.82rem] text-primary/70 leading-relaxed">
                      {t('authSignupNote')}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => switchView('login')}
                        className="flex-1 h-10 rounded-xl bg-primary text-on-primary text-[0.84rem] font-semibold cursor-pointer"
                      >
                        {t('landingCtaSignIn')}
                      </button>
                      <button
                        type="button"
                        onClick={() => switchView('signup')}
                        className="flex-1 h-10 rounded-xl btn-secondary text-[0.84rem] font-semibold cursor-pointer"
                      >
                        {t('authCreateTitle')}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onSignOut();
                    onClose();
                  }}
                  className="w-full h-11 rounded-xl btn-secondary font-semibold text-[0.88rem] inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut size={16} />
                  {t('authSignOutBtn')}
                </button>

                {!user.isGuest && (
                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => switchView('deleteConfirm')}
                      className="text-[0.78rem] font-semibold text-secondary hover:underline cursor-pointer"
                    >
                      {t('authDeleteBtn')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {view === 'deleteConfirm' && (
              <div className="space-y-4">
                <p className="text-[0.88rem] text-primary/70 leading-relaxed">
                  {t('authDeleteWarn')}
                </p>
                {error && (
                  <p className="text-[0.8rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  disabled={busy}
                  className="w-full h-12 rounded-xl bg-secondary text-on-secondary font-semibold text-[0.9rem] inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  {t('authDeleteConfirm')}
                </button>
                <button
                  type="button"
                  onClick={() => switchView('account')}
                  className="w-full h-10 rounded-xl btn-secondary text-[0.84rem] font-semibold cursor-pointer"
                >
                  {t('authKeepAccount')}
                </button>
              </div>
            )}

            {view === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <GoogleSignInButton
                  onSuccess={(nextUser) => {
                    onAuthSuccess(nextUser);
                    onClose();
                  }}
                  onError={setError}
                />
                <div className="flex items-center gap-3">
                  <span className="flex-1 h-px bg-primary/10" />
                  <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-primary/40">
                    {t('orContinueWith')}
                  </span>
                  <span className="flex-1 h-px bg-primary/10" />
                </div>
                {error && (
                  <p className="text-[0.8rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
                    {error}
                  </p>
                )}
                <div>
                  <label className="field-label" htmlFor="ex-login-email">
                    {t('authEmailLabel')}
                  </label>
                  <input
                    id="ex-login-email"
                    type="email"
                    dir="ltr"
                    className="field"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    autoComplete="email"
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="field-label mb-0" htmlFor="ex-login-password">
                      {t('authPasswordLabel')}
                    </label>
                    <button
                      type="button"
                      onClick={() => switchView('forgot')}
                      className="text-[0.72rem] font-semibold text-primary/80 hover:text-secondary cursor-pointer"
                    >
                      {t('authForgotLink')}
                    </button>
                  </div>
                  <input
                    id="ex-login-password"
                    type="password"
                    className="field"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 rounded-xl bg-primary text-on-primary font-semibold text-[0.92rem] inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {t('landingCtaSignIn')}
                </button>

                {onQuickGuest && (
                  <button
                    type="button"
                    onClick={() => {
                      onQuickGuest();
                      onClose();
                    }}
                    className="w-full h-11 rounded-xl btn-secondary font-semibold text-[0.86rem] cursor-pointer"
                  >
                    Continue as guest
                  </button>
                )}

                <p className="text-center text-[0.82rem] text-primary/60">
                  {t('authNoAccount')}{' '}
                  <button
                    type="button"
                    onClick={() => switchView('signup')}
                    className="font-semibold text-primary hover:underline cursor-pointer"
                  >
                    {t('authCreateOne')}
                  </button>
                </p>
              </form>
            )}

            {view === 'signup' && (
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="rounded-xl bg-primary/[0.04] border border-primary/10 px-3.5 py-2.5 text-[0.78rem] text-primary/70 leading-relaxed">
                  {t('authSignupNote')}
                </div>
                <GoogleSignInButton
                  onSuccess={(nextUser) => {
                    onAuthSuccess(nextUser);
                    onClose();
                  }}
                  onError={setError}
                />
                <div className="flex items-center gap-3">
                  <span className="flex-1 h-px bg-primary/10" />
                  <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-primary/40">
                    {t('orContinueWith')}
                  </span>
                  <span className="flex-1 h-px bg-primary/10" />
                </div>
                {error && (
                  <p className="text-[0.8rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
                    {error}
                  </p>
                )}
                <div>
                  <label className="field-label" htmlFor="ex-signup-email">
                    {t('authEmailLabel')}
                  </label>
                  <input
                    id="ex-signup-email"
                    type="email"
                    dir="ltr"
                    className="field"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    autoComplete="email"
                    required
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="ex-signup-password">
                    {t('authPasswordLabel')}
                  </label>
                  <input
                    id="ex-signup-password"
                    type="password"
                    className="field"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('authPasswordHint')}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="ex-signup-name">
                    {t('authDisplayName')}{' '}
                    <span className="lowercase font-normal text-primary/40">
                      {t('authOptional')}
                    </span>
                  </label>
                  <input
                    id="ex-signup-name"
                    type="text"
                    dir="auto"
                    className="field"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('authYourName')}
                    autoComplete="name"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 rounded-xl bg-primary text-on-primary font-semibold text-[0.92rem] inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {t('authCreateTitle')}
                </button>

                <p className="text-center text-[0.82rem] text-primary/60">
                  {t('authHaveAccount')}{' '}
                  <button
                    type="button"
                    onClick={() => switchView('login')}
                    className="font-semibold text-primary hover:underline cursor-pointer"
                  >
                    {t('landingCtaSignIn')}
                  </button>
                </p>
              </form>
            )}

            {view === 'forgot' && (
              <form onSubmit={handleForgot} className="space-y-4">
                {error && (
                  <p className="text-[0.8rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
                    {error}
                  </p>
                )}
                {success && (
                  <p className="text-[0.8rem] font-medium text-[#2F8F72] bg-[#2F8F72]/10 rounded-xl px-3 py-2">
                    {success}
                  </p>
                )}
                <div>
                  <label className="field-label" htmlFor="ex-forgot-email">
                    {t('authEmailLabel')}
                  </label>
                  <input
                    id="ex-forgot-email"
                    type="email"
                    dir="ltr"
                    className="field"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    autoComplete="email"
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="w-full h-12 rounded-xl bg-primary text-on-primary font-semibold text-[0.92rem] cursor-pointer"
                >
                  {t('authSendReset')}
                </button>

                <p className="text-center text-[0.82rem] text-primary/60">
                  <button
                    type="button"
                    onClick={() => switchView('login')}
                    className="font-semibold text-primary hover:underline cursor-pointer"
                  >
                    {t('authBackSignIn')}
                  </button>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>

      {showAvatarGen && user && (
        <AvatarGeneratorModal
          initialConfig={user.avatar}
          initials={initials}
          onClose={() => setShowAvatarGen(false)}
          onSave={handleSaveAvatar}
        />
      )}
    </>
  );
}
