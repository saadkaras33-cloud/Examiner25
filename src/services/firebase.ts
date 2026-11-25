import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  type Auth,
  type UserCredential,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
  type FirestoreSettings,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const db: Firestore = (() => {
  const settings: FirestoreSettings =
    typeof window !== 'undefined'
      ? {
          experimentalAutoDetectLongPolling: true,
          localCache: memoryLocalCache(),
          ignoreUndefinedProperties: true,
        }
      : { ignoreUndefinedProperties: true };
  try {
    return initializeFirestore(app, settings, firebaseConfig.firestoreDatabaseId);
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
})();

export const auth: Auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function isFirestorePermissionError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '').toLowerCase()
      : '';
  if (code.includes('permission-denied') || code.includes('permission_denied')) {
    return true;
  }
  const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return (
    msg.includes('missing or insufficient permissions') ||
    msg.includes('permission-denied') ||
    msg.includes('permission_denied')
  );
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    window.addEventListener(
      'online',
      () => {
        void testConnection();
      },
      { once: true }
    );
    return;
  }
  try {
    const authWithReady = auth as Auth & { authStateReady?: () => Promise<void> };
    if (typeof authWithReady.authStateReady === 'function') {
      await Promise.race([
        authWithReady.authStateReady().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1200)),
      ]);
    }
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      try {
        const dbId = encodeURIComponent(firebaseConfig.firestoreDatabaseId || '(default)');
        const pingUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          firebaseConfig.projectId
        )}/databases/${dbId}/documents/test/connection?key=${encodeURIComponent(
          firebaseConfig.apiKey
        )}`;
        const ping = await fetch(pingUrl);
        if (!ping.ok && ping.status !== 403 && ping.status !== 404) {
          console.error('Please check your Firebase configuration.');
        }
      } catch {
        console.error('Please check your Firebase configuration.');
      }
    }
  }
}

if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    void testConnection();
  }, 120);
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export interface GooglePopupAuthResult {
  idToken: string;
  googleIdToken: string | null;
  googleAccessToken: string | null;
  email: string;
  displayName: string;
  photoUrl: string;
}

let activeGooglePopupPromise: Promise<GooglePopupAuthResult> | null = null;
let redirectResultPromise: Promise<GooglePopupAuthResult | null> | null = null;
const busyListeners = new Set<(busy: boolean) => void>();

function notifyBusyListeners(busy: boolean) {
  for (const listener of busyListeners) {
    try {
      listener(busy);
    } catch {
      // Ignore listener errors
    }
  }
}

export function isGooglePopupInFlight(): boolean {
  return activeGooglePopupPromise !== null;
}

export function subscribeGooglePopupBusy(listener: (busy: boolean) => void): () => void {
  busyListeners.add(listener);
  return () => {
    busyListeners.delete(listener);
  };
}

async function credentialToGoogleResult(result: UserCredential): Promise<GooglePopupAuthResult> {
  const idToken = await result.user.getIdToken();
  const oauthCred = GoogleAuthProvider.credentialFromResult(result);
  if (!idToken) {
    throw new Error('Could not complete Google Sign-In.');
  }
  return {
    idToken,
    googleIdToken: oauthCred?.idToken || null,
    googleAccessToken: oauthCred?.accessToken || null,
    email: result.user.email || '',
    displayName: result.user.displayName || '',
    photoUrl: result.user.photoURL || '',
  };
}

export async function signInWithGooglePopup(): Promise<GooglePopupAuthResult> {
  if (activeGooglePopupPromise) {
    return activeGooglePopupPromise;
  }

  // Initiate signInWithPopup immediately on click before awaiting anything else so Safari/iOS/mobile preserves user gesture
  const popupRequest = signInWithPopup(auth, googleProvider);
  activeGooglePopupPromise = (async () => {
    notifyBusyListeners(true);
    try {
      const result = await popupRequest;
      return await credentialToGoogleResult(result);
    } finally {
      activeGooglePopupPromise = null;
      notifyBusyListeners(false);
    }
  })();

  return activeGooglePopupPromise;
}

export async function signInWithGoogleRedirect(): Promise<never> {
  await signInWithRedirect(auth, googleProvider);
  return new Promise<never>(() => {});
}

export function consumeGoogleRedirectResult(): Promise<GooglePopupAuthResult | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }
  if (!redirectResultPromise) {
    redirectResultPromise = (async () => {
      try {
        const result = await getRedirectResult(auth);
        if (!result?.user) return null;
        return await credentialToGoogleResult(result);
      } catch {
        return null;
      }
    })();
  }
  return redirectResultPromise;
}

export async function waitForAuthStateReady(): Promise<void> {
  const authWithReady = auth as Auth & { authStateReady?: () => Promise<void> };
  if (typeof authWithReady.authStateReady === 'function') {
    await Promise.race([
      authWithReady.authStateReady().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
  }
}

export async function signInFirebaseWithGoogleTokens(
  googleIdToken?: string | null,
  googleAccessToken?: string | null
): Promise<string | null> {
  if (!googleIdToken && !googleAccessToken) return null;
  try {
    const cred = GoogleAuthProvider.credential(googleIdToken || null, googleAccessToken || null);
    const res = await signInWithCredential(auth, cred);
    return await res.user.getIdToken();
  } catch {
    return null;
  }
}

export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  try {
    await waitForAuthStateReady();
    const current = auth.currentUser;
    if (!current) return null;
    return await current.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export async function signOutFirebase(): Promise<void> {
  try {
    await auth.signOut();
  } catch {
    // Ignore Firebase sign-out cleanup errors
  }
}
