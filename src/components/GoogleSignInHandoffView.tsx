import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, GraduationCap, Loader2, ShieldCheck } from 'lucide-react';
import {
  auth,
  consumeGoogleRedirectResult,
  signInFirebaseWithGoogleTokens,
  signInWithGooglePopup,
  signInWithGoogleRedirect,
  waitForAuthStateReady,
} from '../services/firebase.ts';
import {
  clearGisCredentialHandler,
  getGoogleOAuthClientId,
  isGoogleGisReadySync,
  mountGisIdButton,
  preloadGoogleGis,
  promptGisOneTap,
  requestGisAccessToken,
} from '../services/googleGis.ts';
import { submitGoogleHandoff } from '../services/api.ts';

function formatHandoffError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === 'AUTH_POPUP_BLOCKED') {
      return 'Popup was blocked. Try the Google button above or full-page sign-in below.';
    }
    if (err.message === 'AUTH_POPUP_CLOSED') {
      return 'Google sign-in window closed before finishing. Try again below.';
    }
  }
  const code =
    typeof err === 'object' && err && 'code' in err
      ? String((err as { code?: string }).code || '')
      : '';
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Domain "${host}" is not listed in Firebase Authorized Domains. Try the Google Sign-In button above or sign in with email.`;
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error while connecting to Google. Check your connection and try again.';
  }
  return err instanceof Error ? err.message : 'Google Sign-In could not be completed.';
}

export default function GoogleSignInHandoffView() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'signing-in' | 'success' | 'error'>(
    'checking'
  );
  const [message, setMessage] = useState('');
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const [gisMounted, setGisMounted] = useState(false);

  const gisButtonRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const nonce =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('nonce') || ''
      : '';

  const completeHandoff = useCallback(
    async (payload: {
      idToken?: string | null;
      googleIdToken?: string | null;
      googleAccessToken?: string | null;
    }) => {
      await submitGoogleHandoff(nonce, payload);
      setStatus('success');
      setMessage('Signed in! Returning to Examiner…');
      window.setTimeout(() => {
        try {
          window.close();
        } catch {
          // Ignore if browser prevents script-closing user-opened tab
        }
      }, 850);
    },
    [nonce]
  );

  const handleGisCredential = useCallback(
    async (googleIdToken: string) => {
      if (!nonce || statusRef.current === 'success') return;
      setStatus('signing-in');
      setMessage('');
      try {
        const firebaseIdToken = await signInFirebaseWithGoogleTokens(googleIdToken, null);
        await completeHandoff({
          idToken: firebaseIdToken,
          googleIdToken,
          googleAccessToken: null,
        });
      } catch (err: unknown) {
        setStatus('error');
        setMessage(formatHandoffError(err));
      }
    },
    [completeHandoff, nonce]
  );

  useEffect(() => {
    let active = true;
    async function init() {
      if (!nonce) {
        if (active) {
          setStatus('error');
          setMessage(
            'Missing sign-in session code. Return to Examiner and click Continue with Google again.'
          );
        }
        return;
      }

      // 1) Check if returning from a Firebase full-page Google redirect inside this tab
      const redirectResult = await consumeGoogleRedirectResult();
      if (!active) return;
      if (redirectResult) {
        setStatus('signing-in');
        try {
          await completeHandoff({
            idToken: redirectResult.idToken,
            googleIdToken: redirectResult.googleIdToken,
            googleAccessToken: redirectResult.googleAccessToken,
          });
          return;
        } catch (err: unknown) {
          if (active) {
            setStatus('error');
            setMessage(formatHandoffError(err));
          }
          return;
        }
      }

      // 2) Preload Google Identity Services & check existing Firebase persistence in parallel
      await Promise.all([
        waitForAuthStateReady(),
        getGoogleOAuthClientId() ? preloadGoogleGis().catch(() => null) : Promise.resolve(null),
      ]);
      if (!active) return;

      const current = auth.currentUser;
      const isGoogleUser = Boolean(
        current?.providerData?.some((p) => p?.providerId === 'google.com')
      );
      if (current && isGoogleUser && current.email) {
        setExistingEmail(current.email);
      }

      setStatus('ready');

      // 3) In top-level tab, prompt Google One Tap / FedCM if user has no existing session yet
      if (!(current && isGoogleUser) && getGoogleOAuthClientId()) {
        void promptGisOneTap({
          inIframe: false,
          onCredential: handleGisCredential,
        });
      }
    }

    void init();
    return () => {
      active = false;
      clearGisCredentialHandler(handleGisCredential);
    };
  }, [completeHandoff, handleGisCredential, nonce]);

  useEffect(() => {
    if (status !== 'ready' && status !== 'error') return undefined;
    const container = gisButtonRef.current;
    if (!container || !getGoogleOAuthClientId()) return undefined;

    let active = true;
    const width = Math.max(220, Math.min(360, Math.floor(container.clientWidth || 320)));
    void mountGisIdButton(container, {
      width,
      inIframe: false,
      onCredential: handleGisCredential,
    })
      .then((ok) => {
        if (active) setGisMounted(ok);
      })
      .catch(() => {
        if (active) setGisMounted(false);
      });

    return () => {
      active = false;
    };
  }, [handleGisCredential, status]);

  async function handleContinueExisting() {
    if (!nonce || !auth.currentUser) return;
    setStatus('signing-in');
    setMessage('');
    try {
      const idToken = await auth.currentUser.getIdToken(true);
      if (!idToken) {
        throw new Error('Session expired. Choose your Google account below.');
      }
      await completeHandoff({
        idToken,
        googleIdToken: null,
        googleAccessToken: null,
      });
    } catch (err: unknown) {
      setStatus('ready');
      setExistingEmail(null);
      setMessage(formatHandoffError(err));
    }
  }

  function handleOAuthChooserSignIn() {
    if (!nonce) return;
    setStatus('signing-in');
    setMessage('');

    const runOAuth = isGoogleGisReadySync()
      ? requestGisAccessToken()
      : preloadGoogleGis().then(() => requestGisAccessToken());

    runOAuth
      .then(async (accessToken) => {
        const firebaseIdToken = await signInFirebaseWithGoogleTokens(null, accessToken);
        await completeHandoff({
          idToken: firebaseIdToken,
          googleIdToken: null,
          googleAccessToken: accessToken,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === 'AUTH_POPUP_CLOSED') {
          setStatus('ready');
        } else {
          setStatus('error');
        }
        setMessage(formatHandoffError(err));
      });
  }

  function handleFirebasePopupFallback() {
    if (!nonce) return;
    setStatus('signing-in');
    setMessage('');
    signInWithGooglePopup()
      .then((result) =>
        completeHandoff({
          idToken: result.idToken,
          googleIdToken: result.googleIdToken,
          googleAccessToken: result.googleAccessToken,
        })
      )
      .catch(async (err: unknown) => {
        const code =
          typeof err === 'object' && err && 'code' in err
            ? String((err as { code?: string }).code || '')
            : '';

        if (
          code === 'auth/popup-blocked' ||
          code === 'auth/web-storage-unsupported' ||
          code === 'auth/operation-not-supported-in-this-environment' ||
          code === 'auth/internal-error'
        ) {
          setMessage('Opening full-page Google Sign-In…');
          try {
            await signInWithGoogleRedirect();
          } catch (redirErr: unknown) {
            setStatus('error');
            setMessage(formatHandoffError(redirErr));
          }
          return;
        }

        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          setStatus('ready');
          setMessage('Sign-in cancelled. Choose any Google sign-in option below.');
          return;
        }

        setStatus('error');
        setMessage(formatHandoffError(err));
      });
  }

  return (
    <div className="min-h-dvh bg-paper grain flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md card p-5 sm:p-7 space-y-5 text-center">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-primary text-on-primary grid place-items-center">
          <GraduationCap size={22} />
        </div>

        <div className="space-y-1.5">
          <h1 className="font-display text-xl sm:text-2xl font-semibold">
            Examiner · Google Sign-In
          </h1>
          <p className="text-[0.84rem] sm:text-[0.86rem] text-primary/70 leading-relaxed">
            {status === 'success'
              ? 'Your Google account is connected. Switch back to your Examiner tab — you can close this tab now.'
              : 'Continue with your Google account to sign straight into Examiner.'}
          </p>
        </div>

        {message && (
          <div
            className={`rounded-2xl px-4 py-3 text-[0.82rem] font-medium break-words ${
              status === 'success'
                ? 'bg-[#2F8F72]/15 text-[#2F8F72]'
                : status === 'error'
                ? 'bg-secondary/12 text-secondary'
                : 'bg-primary/8 text-primary/80'
            }`}
          >
            {message}
          </div>
        )}

        {status === 'checking' ? (
          <div className="py-4 inline-flex items-center justify-center gap-2 text-[0.86rem] text-primary/70 font-medium">
            <Loader2 size={18} className="animate-spin text-[#4285F4]" />
            <span>Preparing Google Sign-In…</span>
          </div>
        ) : status === 'success' ? (
          <div className="inline-flex items-center justify-center gap-2 text-[#2F8F72] font-semibold text-[0.9rem] py-2">
            <CheckCircle2 size={20} />
            <span>You’re signed in</span>
          </div>
        ) : (
          <div className="space-y-3">
            {existingEmail && (
              <button
                type="button"
                disabled={status === 'signing-in' || !nonce}
                onClick={() => void handleContinueExisting()}
                className="w-full min-h-12 px-4 py-2.5 rounded-2xl bg-primary text-on-primary font-semibold text-[0.9rem] inline-flex items-center justify-center gap-2 shadow-xs active:scale-[0.99] transition disabled:opacity-60 cursor-pointer break-all"
              >
                {status === 'signing-in' && <Loader2 size={16} className="animate-spin shrink-0" />}
                <span>Continue as {existingEmail}</span>
              </button>
            )}

            {/* Official Google Identity Services Native Button (FedCM / One Tap / Popup) */}
            <div
              ref={gisButtonRef}
              className={`w-full flex justify-center min-h-[44px] ${
                gisMounted ? '' : 'hidden'
              }`}
            />

            {/* Direct GIS OAuth2 Chooser Button */}
            <button
              type="button"
              disabled={status === 'signing-in' || !nonce}
              onClick={handleOAuthChooserSignIn}
              className="w-full h-11 px-4 rounded-full border border-primary/20 bg-white text-[#1F1F1F] hover:bg-[#F8FAFD] font-semibold text-[0.88rem] inline-flex items-center justify-center gap-2 shadow-xs active:scale-[0.99] transition disabled:opacity-60 cursor-pointer"
            >
              {status === 'signing-in' ? (
                <Loader2 size={17} className="animate-spin text-[#4285F4]" />
              ) : (
                <ShieldCheck size={17} className="text-[#4285F4]" />
              )}
              <span>
                {gisMounted ? 'Use Google OAuth account chooser' : 'Continue with Google'}
              </span>
            </button>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                disabled={status === 'signing-in' || !nonce}
                onClick={handleFirebasePopupFallback}
                className="text-[0.75rem] font-semibold text-primary/70 hover:text-secondary underline cursor-pointer disabled:opacity-50"
              >
                Firebase popup fallback
              </button>
              <button
                type="button"
                disabled={status === 'signing-in' || !nonce}
                onClick={() => void signInWithGoogleRedirect().catch(() => {})}
                className="text-[0.75rem] font-semibold text-primary/70 hover:text-secondary underline cursor-pointer disabled:opacity-50"
              >
                Full-page redirect fallback
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
