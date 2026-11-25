import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, ShieldCheck, X } from 'lucide-react';
import type { UserProfile } from '../types.ts';
import {
  isGooglePopupInFlight,
  signInFirebaseWithGoogleTokens,
  signInWithGooglePopup,
  signInWithGoogleRedirect,
  subscribeGooglePopupBusy,
} from '../services/firebase.ts';
import {
  clearGisCredentialHandler,
  getGoogleOAuthClientId,
  isGoogleGisReadySync,
  mountGisIdButton,
  preloadGoogleGis,
  requestGisAccessToken,
} from '../services/googleGis.ts';
import { logInWithGoogleToken, pollGoogleHandoff } from '../services/api.ts';
import { useTranslation } from '../utils/i18n.tsx';

interface GoogleSignInButtonProps {
  onSuccess: (user: UserProfile) => void;
  onError?: (message: string) => void;
  className?: string;
  compact?: boolean;
}

function createHandoffNonce(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    }
  } catch {
    // Fallback below
  }
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function isInsideIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

function formatGoogleAuthError(err: unknown): {
  message: string;
  suggestHandoff: boolean;
  suggestRedirect: boolean;
} {
  if (err instanceof Error) {
    if (err.message === 'AUTH_POPUP_BLOCKED') {
      return {
        message: 'Popup was blocked by your browser. Try the alternate sign-in option below.',
        suggestHandoff: true,
        suggestRedirect: true,
      };
    }
    if (err.message === 'AUTH_POPUP_CLOSED') {
      return {
        message: 'Google sign-in window closed before finishing. Try again or use an alternate option below.',
        suggestHandoff: true,
        suggestRedirect: true,
      };
    }
  }

  const code =
    typeof err === 'object' && err && 'code' in err
      ? String((err as { code?: string }).code || '')
      : '';

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return {
      message: 'Google sign-in window closed before finishing. Try again or use full-page sign-in below.',
      suggestHandoff: true,
      suggestRedirect: true,
    };
  }
  if (code === 'auth/popup-blocked') {
    return {
      message: 'Popup was blocked by your browser. Continuing with Google Sign-In…',
      suggestHandoff: true,
      suggestRedirect: true,
    };
  }
  if (code === 'auth/web-storage-unsupported' || code === 'auth/operation-not-supported-in-this-environment') {
    return {
      message: 'Browser blocked embedded sign-in storage. Use the Google sign-in tab link below.',
      suggestHandoff: true,
      suggestRedirect: true,
    };
  }
  if (code === 'auth/network-request-failed') {
    return {
      message: 'Network error while connecting to Google. Check your connection and try again.',
      suggestHandoff: false,
      suggestRedirect: false,
    };
  }
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return {
      message: `Domain "${host}" is not authorized for Firebase Auth.`,
      suggestHandoff: false,
      suggestRedirect: false,
    };
  }

  return {
    message: err instanceof Error ? err.message : 'Could not sign in with Google.',
    suggestHandoff: true,
    suggestRedirect: true,
  };
}

function GoogleLogoSvg() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

export default function GoogleSignInButton({
  onSuccess,
  onError,
  className = '',
  compact = false,
}: GoogleSignInButtonProps) {
  const { t } = useTranslation();
  const inIframe = useMemo(() => isInsideIframe(), []);
  const hasOAuthClient = Boolean(getGoogleOAuthClientId());
  const [busy, setBusy] = useState(() => isGooglePopupInFlight());
  const [gisButtonMounted, setGisButtonMounted] = useState(false);
  const [waitingHandoff, setWaitingHandoff] = useState(false);
  const [showFallbackOptions, setShowFallbackOptions] = useState(false);
  const [handoffNonce, setHandoffNonce] = useState(() => createHandoffNonce());

  const gisContainerRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const consecutiveErrorsRef = useRef<number>(0);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const handoffUrl = `/google-signin?nonce=${encodeURIComponent(handoffNonce)}`;

  const stopPolling = useCallback((refreshNonce = true) => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setWaitingHandoff(false);
    consecutiveErrorsRef.current = 0;
    if (refreshNonce) {
      setHandoffNonce(createHandoffNonce());
    }
  }, []);

  const handleGisCredential = useCallback(async (googleIdToken: string) => {
    setBusy(true);
    onErrorRef.current?.('');
    try {
      const firebaseIdToken = await signInFirebaseWithGoogleTokens(googleIdToken, null);
      const user = await logInWithGoogleToken({
        idToken: firebaseIdToken,
        googleIdToken,
      });
      onSuccessRef.current(user);
    } catch (err: unknown) {
      const formatted = formatGoogleAuthError(err);
      onErrorRef.current?.(formatted.message);
      setShowFallbackOptions(true);
    } finally {
      setBusy(false);
    }
  }, []);

  // Preload Google Identity Services SDK & mount native Google button sized cleanly to container width
  useEffect(() => {
    let active = true;
    const container = gisContainerRef.current;
    if (!hasOAuthClient || !container) {
      return undefined;
    }

    let resizeTimer: number | null = null;
    let lastRenderedWidth = 0;

    const renderNativeButton = async () => {
      if (!active || !gisContainerRef.current) return;
      const measured = Math.floor(gisContainerRef.current.clientWidth || 0);
      const targetWidth = Math.max(200, Math.min(compact ? 320 : 380, measured || (compact ? 260 : 320)));
      if (lastRenderedWidth > 0 && Math.abs(lastRenderedWidth - targetWidth) < 16) {
        return;
      }
      try {
        const mounted = await mountGisIdButton(gisContainerRef.current, {
          width: targetWidth,
          inIframe,
          onCredential: handleGisCredential,
        });
        if (active && mounted) {
          lastRenderedWidth = targetWidth;
          setGisButtonMounted(true);
        }
      } catch {
        if (active) {
          setGisButtonMounted(false);
        }
      }
    };

    void preloadGoogleGis()
      .then(() => renderNativeButton())
      .catch(() => {
        if (active) setGisButtonMounted(false);
      });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          void renderNativeButton();
        }, 120);
      });
      ro.observe(container);
    }

    return () => {
      active = false;
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      ro?.disconnect();
      clearGisCredentialHandler(handleGisCredential);
    };
  }, [compact, handleGisCredential, hasOAuthClient, inIframe]);

  useEffect(() => {
    setBusy(isGooglePopupInFlight());
    const unsub = subscribeGooglePopupBusy(setBusy);
    return () => {
      unsub();
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  function startHandoffPolling(activeNonce: string) {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
    }
    onError?.('');
    consecutiveErrorsRef.current = 0;
    setWaitingHandoff(true);
    startedAtRef.current = Date.now();

    const checkOnce = async () => {
      if (Date.now() - startedAtRef.current > 180000) {
        stopPolling(true);
        onError?.('Google Sign-In timed out. Try signing in again.');
        return;
      }
      try {
        const res = await pollGoogleHandoff(activeNonce);
        consecutiveErrorsRef.current = 0;
        if (res.status === 'ready') {
          stopPolling(true);
          onSuccess(res.user);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Google Sign-In handoff failed.';
        const isTerminal = /expired|invalid/i.test(msg);
        consecutiveErrorsRef.current += 1;
        if (isTerminal || consecutiveErrorsRef.current >= 8) {
          stopPolling(true);
          onError?.(msg);
        }
      }
    };

    pollTimerRef.current = window.setInterval(() => {
      void checkOnce();
    }, 1200);
  }

  function handleOAuthTokenClick() {
    if (busy || isGooglePopupInFlight()) return;
    setBusy(true);
    onError?.('');

    if (isGoogleGisReadySync()) {
      // Synchronous call directly on tap preserves mobile/Safari popup gesture without firebaseapp.com handler
      requestGisAccessToken()
        .then(async (accessToken) => {
          const firebaseIdToken = await signInFirebaseWithGoogleTokens(null, accessToken);
          const user = await logInWithGoogleToken({
            idToken: firebaseIdToken,
            googleAccessToken: accessToken,
          });
          onSuccess(user);
        })
        .catch((err: unknown) => {
          const formatted = formatGoogleAuthError(err);
          onError?.(formatted.message);
          setShowFallbackOptions(true);
        })
        .finally(() => {
          setBusy(false);
        });
      return;
    }

    // Fallback if GIS script hasn't loaded or was blocked by an ad-blocker
    handleFirebasePopupClick();
  }

  function handleFirebasePopupClick() {
    if (isGooglePopupInFlight()) return;
    setBusy(true);
    onError?.('');

    signInWithGooglePopup()
      .then(async (popupResult) => {
        const user = await logInWithGoogleToken(popupResult.idToken);
        onSuccess(user);
      })
      .catch(async (err: unknown) => {
        const code =
          typeof err === 'object' && err && 'code' in err
            ? String((err as { code?: string }).code || '')
            : '';

        if (
          !inIframe &&
          (code === 'auth/popup-blocked' ||
            code === 'auth/web-storage-unsupported' ||
            code === 'auth/operation-not-supported-in-this-environment' ||
            code === 'auth/internal-error')
        ) {
          try {
            await signInWithGoogleRedirect();
            return;
          } catch (redirErr: unknown) {
            const redirFormatted = formatGoogleAuthError(redirErr);
            onError?.(redirFormatted.message);
            setShowFallbackOptions(true);
            return;
          }
        }

        const formatted = formatGoogleAuthError(err);
        onError?.(formatted.message);
        setShowFallbackOptions(true);
      })
      .finally(() => {
        setBusy(isGooglePopupInFlight());
      });
  }

  const buttonClasses = `inline-flex items-center justify-center gap-2.5 rounded-full border border-primary/20 bg-white text-[#1F1F1F] hover:bg-[#F8FAFD] hover:border-primary/35 font-semibold shadow-xs active:scale-[0.99] transition disabled:opacity-60 cursor-pointer no-underline ${
    compact ? 'px-5 py-3 text-[0.9rem] w-full sm:w-auto' : 'w-full h-11 px-4 text-[0.88rem]'
  } ${className}`;

  return (
    <div className={`space-y-2 ${compact ? 'w-full sm:max-w-[320px]' : 'w-full'}`}>
      {/* Official Google Identity Services Button (FedCM / Native Google Account Picker) */}
      <div className="relative w-full">
        <div
          ref={gisContainerRef}
          className={`w-full flex justify-center sm:justify-start min-h-[42px] overflow-hidden ${
            gisButtonMounted ? '' : 'hidden'
          }`}
        />

        {busy && gisButtonMounted && (
          <div className="absolute inset-0 rounded-full bg-white/85 backdrop-blur-xs flex items-center justify-center gap-2 text-[0.84rem] font-semibold text-[#1F1F1F] z-10">
            <Loader2 size={16} className="animate-spin text-[#4285F4]" />
            <span>Signing in…</span>
          </div>
        )}

        {!gisButtonMounted && (
          <button
            type="button"
            onClick={handleOAuthTokenClick}
            disabled={busy || waitingHandoff}
            className={buttonClasses}
          >
            {busy || waitingHandoff ? (
              <Loader2 size={17} className="animate-spin text-[#4285F4] shrink-0" />
            ) : (
              <GoogleLogoSvg />
            )}
            <span className="truncate">{t('continueWithGoogle')}</span>
          </button>
        )}
      </div>

      {/* Waiting banner for /google-signin tab handoff */}
      {waitingHandoff && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary/8 px-3 py-2 text-[0.76rem] text-primary/80">
          <span className="min-w-0 truncate">Waiting for Google sign-in tab…</span>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={handoffUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-secondary underline inline-flex items-center gap-1"
            >
              <span>Open tab</span>
              <ExternalLink size={11} />
            </a>
            <button
              type="button"
              onClick={() => stopPolling(true)}
              className="h-6 px-2 rounded-lg bg-primary/12 hover:bg-primary/20 font-semibold text-primary inline-flex items-center gap-1 cursor-pointer"
            >
              <X size={11} />
              <span>Cancel</span>
            </button>
          </div>
        </div>
      )}

      {/* Alternate Google Sign-In options */}
      {!waitingHandoff && (
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-3 gap-y-1 text-[0.75rem] text-primary/65">
          {gisButtonMounted && (
            <button
              type="button"
              disabled={busy}
              onClick={handleOAuthTokenClick}
              className="font-semibold text-primary/75 hover:text-secondary underline inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck size={12} />
              <span>Use OAuth popup</span>
            </button>
          )}

          {inIframe ? (
            <a
              href={handoffUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => startHandoffPolling(handoffNonce)}
              className="font-semibold text-primary/75 hover:text-secondary underline inline-flex items-center gap-1"
            >
              <span>Open Google sign-in tab</span>
              <ExternalLink size={11} />
            </a>
          ) : (
            showFallbackOptions && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void signInWithGoogleRedirect().catch(() => {})}
                className="font-semibold text-secondary underline cursor-pointer disabled:opacity-50"
              >
                Use full-page Google sign-in
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
