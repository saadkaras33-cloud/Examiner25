import firebaseConfig from '../../firebase-applet-config.json';

interface GisIdPromptMomentNotification {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getNotDisplayedReason?: () => string;
  getSkippedReason?: () => string;
}

interface GisCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GisTokenError {
  type?: string;
  message?: string;
}

interface GoogleAccountsApi {
  id: {
    initialize: (config: {
      client_id: string;
      callback: (response: GisCredentialResponse) => void;
      auto_select?: boolean;
      cancel_on_tap_outside?: boolean;
      context?: 'signin' | 'signup' | 'use';
      ux_mode?: 'popup' | 'redirect';
      itp_support?: boolean;
      use_fedcm_for_prompt?: boolean;
      use_fedcm_for_button?: boolean;
    }) => void;
    renderButton: (
      parent: HTMLElement,
      options: {
        type?: 'standard' | 'icon';
        theme?: 'outline' | 'filled_blue' | 'filled_black';
        size?: 'large' | 'medium' | 'small';
        text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
        shape?: 'rectangular' | 'pill' | 'circle' | 'square';
        logo_alignment?: 'left' | 'center';
        width?: number | string;
        locale?: string;
      }
    ) => void;
    prompt: (listener?: (notification: GisIdPromptMomentNotification) => void) => void;
    cancel: () => void;
  };
  oauth2: {
    initTokenClient: (config: {
      client_id: string;
      scope: string;
      prompt?: '' | 'none' | 'consent' | 'select_account';
      callback: (response: GisTokenResponse) => void;
      error_callback?: (error: GisTokenError) => void;
    }) => {
      requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
    };
  };
}

declare global {
  interface Window {
    google?: {
      accounts?: GoogleAccountsApi;
    };
  }
}

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let gisLoadPromise: Promise<GoogleAccountsApi> | null = null;
let gisIdInitializedClientId: string | null = null;
const idCredentialHandlers: Array<(credential: string) => void> = [];

function registerIdCredentialHandler(handler: (credential: string) => void): void {
  const existingIdx = idCredentialHandlers.indexOf(handler);
  if (existingIdx !== -1) {
    idCredentialHandlers.splice(existingIdx, 1);
  }
  idCredentialHandlers.push(handler);
}

export function getGoogleOAuthClientId(): string {
  return String((firebaseConfig as { oAuthClientId?: string }).oAuthClientId || '').trim();
}

function getGoogleAccountsSync(): GoogleAccountsApi | null {
  if (typeof window === 'undefined') return null;
  const accounts = window.google?.accounts;
  if (accounts?.id && accounts?.oauth2) return accounts;
  return null;
}

export function isGoogleGisReadySync(): boolean {
  return Boolean(getGoogleAccountsSync() && getGoogleOAuthClientId());
}

export function preloadGoogleGis(): Promise<GoogleAccountsApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Sign-In requires a browser environment.'));
  }

  const ready = getGoogleAccountsSync();
  if (ready) {
    return Promise.resolve(ready);
  }

  if (gisLoadPromise) {
    return gisLoadPromise;
  }

  gisLoadPromise = new Promise<GoogleAccountsApi>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      gisLoadPromise = null;
      reject(new Error('Google Sign-In service timed out while loading.'));
    }, 8500);

    const finishSuccess = () => {
      const api = getGoogleAccountsSync();
      if (api) {
        window.clearTimeout(timeoutId);
        resolve(api);
        return true;
      }
      return false;
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_SRC}"]`
    );

    if (existingScript) {
      if (finishSuccess()) return;
      const poll = window.setInterval(() => {
        if (finishSuccess()) {
          window.clearInterval(poll);
        }
      }, 60);
      existingScript.addEventListener(
        'error',
        () => {
          window.clearInterval(poll);
          window.clearTimeout(timeoutId);
          gisLoadPromise = null;
          reject(new Error('Could not load Google Sign-In script.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (finishSuccess()) return;
      let tries = 0;
      const poll = window.setInterval(() => {
        tries += 1;
        if (finishSuccess()) {
          window.clearInterval(poll);
        } else if (tries > 25) {
          window.clearInterval(poll);
          window.clearTimeout(timeoutId);
          gisLoadPromise = null;
          reject(new Error('Google Sign-In API did not initialize.'));
        }
      }, 60);
    };
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      gisLoadPromise = null;
      reject(new Error('Google Sign-In script was blocked or unreachable.'));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

function ensureGisIdInitialized(
  api: GoogleAccountsApi,
  inIframe: boolean
): boolean {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) return false;

  if (gisIdInitializedClientId !== clientId) {
    api.id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response?.credential && idCredentialHandlers.length > 0) {
          const latest = idCredentialHandlers[idCredentialHandlers.length - 1];
          latest(response.credential);
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
      context: 'signin',
      ux_mode: 'popup',
      itp_support: true,
      use_fedcm_for_prompt: !inIframe,
      use_fedcm_for_button: !inIframe,
    });
    gisIdInitializedClientId = clientId;
  }
  return true;
}

export async function mountGisIdButton(
  container: HTMLElement,
  options: {
    width?: number;
    inIframe?: boolean;
    onCredential: (googleIdToken: string) => void;
  }
): Promise<boolean> {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) return false;

  const api = await preloadGoogleGis();
  registerIdCredentialHandler(options.onCredential);
  if (!ensureGisIdInitialized(api, Boolean(options.inIframe))) {
    return false;
  }

  container.innerHTML = '';
  const safeWidth =
    typeof options.width === 'number' && Number.isFinite(options.width)
      ? Math.max(200, Math.min(400, Math.round(options.width)))
      : undefined;

  api.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'left',
    ...(safeWidth ? { width: safeWidth } : {}),
  });

  return container.childElementCount > 0;
}

export async function promptGisOneTap(options: {
  inIframe?: boolean;
  onCredential: (googleIdToken: string) => void;
  onUnavailable?: (reason: string) => void;
}): Promise<void> {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) return;

  const api = await preloadGoogleGis();
  registerIdCredentialHandler(options.onCredential);
  if (!ensureGisIdInitialized(api, Boolean(options.inIframe))) return;

  try {
    api.id.prompt((notification) => {
      if (notification.isNotDisplayed?.()) {
        options.onUnavailable?.(notification.getNotDisplayedReason?.() || 'not_displayed');
      } else if (notification.isSkippedMoment?.()) {
        options.onUnavailable?.(notification.getSkippedReason?.() || 'skipped');
      }
    });
  } catch {
    // Ignore One Tap errors when prompt isn't supported
  }
}

export function clearGisCredentialHandler(handler: (credential: string) => void): void {
  const idx = idCredentialHandlers.indexOf(handler);
  if (idx !== -1) {
    idCredentialHandlers.splice(idx, 1);
  }
}

/**
 * Initiates Google OAuth2 Token popup directly with accounts.google.com, bypassing
 * Firebase's cross-origin __/auth/handler page. Call synchronously from click handlers
 * when isGoogleGisReadySync() is true so mobile/Safari browsers preserve user gesture.
 */
export function requestGisAccessToken(): Promise<string> {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) {
    return Promise.reject(new Error('Google OAuth client ID is not configured.'));
  }

  const startWithApi = (api: GoogleAccountsApi) =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      const client = api.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        prompt: 'select_account',
        callback: (resp) => {
          if (settled) return;
          settled = true;
          if (resp?.error) {
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          if (!resp?.access_token) {
            reject(new Error('Google did not return an access token.'));
            return;
          }
          resolve(resp.access_token);
        },
        error_callback: (err) => {
          if (settled) return;
          settled = true;
          const type = String(err?.type || '');
          if (type === 'popup_failed_to_open') {
            reject(new Error('AUTH_POPUP_BLOCKED'));
          } else if (type === 'popup_closed') {
            reject(new Error('AUTH_POPUP_CLOSED'));
          } else {
            reject(new Error(err?.message || 'Google OAuth sign-in failed.'));
          }
        },
      });
      client.requestAccessToken({ prompt: 'select_account' });
    });

  const syncApi = getGoogleAccountsSync();
  if (syncApi) {
    return startWithApi(syncApi);
  }
  return preloadGoogleGis().then(startWithApi);
}
