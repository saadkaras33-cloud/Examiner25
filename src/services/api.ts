import type {
  ChatThemeConfig,
  Exam,
  ExamDecision,
  ExamInput,
  LanguageId,
  LessonInput,
  LessonItem,
  PrivateChatRoom,
  SavedMusicTrack,
  ScannedExamDraft,
  ScannedLessonDraft,
  SharedExamPayload,
  ThemeId,
  UserProfile,
} from '../types.ts';
import { EXAM_TYPES, isValidIsoDate } from '../utils/exams.ts';
import { isValidThemeId } from '../utils/themeIds.ts';
import { getSavedThemeId } from '../utils/themes.ts';
import { getSavedLanguageId, isValidLanguageId } from '../utils/i18n.tsx';
import {
  getFirebaseIdToken,
  signInFirebaseWithGoogleTokens,
  signOutFirebase,
} from './firebase.ts';
import {
  deleteFirestoreExam,
  deleteFirestoreLesson,
  loadFirestoreExams,
  loadFirestoreLessons,
  loadFirestoreUserProfile,
  saveFirestoreExam,
  saveFirestoreExamsBatch,
  saveFirestoreLesson,
  saveFirestoreLessonsBatch,
  saveFirestoreUserProfilePatch,
} from './firestoreSync.ts';

const WORKSPACE_KEY = 'examiner_workspace_id';
const USER_KEY = 'examiner_user_profile';
const SIGNED_OUT_KEY = 'examiner_signed_out';
const EXAMS_CACHE_PREFIX = 'examiner_exams_cache_';
const EXAMS_MIRROR_PREFIX = 'examiner_exams_mirror_';
const DELETED_EXAMS_PREFIX = 'examiner_deleted_exams_';
const LESSONS_CACHE_PREFIX = 'examiner_lessons_cache_';
const LESSONS_MIRROR_PREFIX = 'examiner_lessons_mirror_';
const DELETED_LESSONS_PREFIX = 'examiner_deleted_lessons_';
const SCAN_DRAFTS_PREFIX = 'examiner_scan_drafts_';
const MAJOR_SCAN_DRAFTS_PREFIX = 'examiner_major_scan_drafts_';
const ACCOUNT_PREFS_MIRROR_PREFIX = 'examiner_prefs_mirror_';

function getLegacyGuestWorkspaceId(): string | undefined {
  try {
    const id = localStorage.getItem(WORKSPACE_KEY);
    return id && id.trim() ? id.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function getActiveWorkspaceId(): string {
  const user = getStoredUser();
  if (user?.id) return user.id;
  return getLegacyGuestWorkspaceId() || 'default';
}

function examsCacheKey(): string {
  return `${EXAMS_CACHE_PREFIX}${getActiveWorkspaceId()}`;
}

function lessonsCacheKey(): string {
  return `${LESSONS_CACHE_PREFIX}${getActiveWorkspaceId()}`;
}

function scanDraftsCacheKey(): string {
  return `${SCAN_DRAFTS_PREFIX}${getActiveWorkspaceId()}`;
}

function majorScanDraftsCacheKey(): string {
  return `${MAJOR_SCAN_DRAFTS_PREFIX}${getActiveWorkspaceId()}`;
}

function getMirrorScope(): string {
  const u = getStoredUser();
  if (u?.email && u.email.includes('@')) return u.email.trim().toLowerCase();
  return getActiveWorkspaceId();
}

function examsMirrorKey(): string {
  return `${EXAMS_MIRROR_PREFIX}${getMirrorScope()}`;
}

function lessonsMirrorKey(): string {
  return `${LESSONS_MIRROR_PREFIX}${getMirrorScope()}`;
}

function deletedExamsKey(): string {
  return `${DELETED_EXAMS_PREFIX}${getMirrorScope()}`;
}

function deletedLessonsKey(): string {
  return `${DELETED_LESSONS_PREFIX}${getMirrorScope()}`;
}

const TOMBSTONE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function readTombstones(storageKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    const clean: Record<string, number> = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && now - ts < TOMBSTONE_TTL_MS) {
        clean[id] = ts;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function markTombstone(storageKey: string, id: string): void {
  try {
    const current = readTombstones(storageKey);
    current[id] = Date.now();
    localStorage.setItem(storageKey, JSON.stringify(current));
  } catch {
    // Ignore storage quota errors
  }
}

function clearTombstone(storageKey: string, id: string): void {
  try {
    const current = readTombstones(storageKey);
    if (id in current) {
      delete current[id];
      localStorage.setItem(storageKey, JSON.stringify(current));
    }
  } catch {
    // Ignore
  }
}

async function waitBounded(promise: Promise<unknown>, ms = 3000): Promise<void> {
  await Promise.race([
    promise.catch(() => undefined),
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)),
  ]);
}

function mirrorKeyForEmail(email: string): string {
  return `${ACCOUNT_PREFS_MIRROR_PREFIX}${email.trim().toLowerCase()}`;
}

function saveAccountPrefsMirror(profile: UserProfile): void {
  if (!profile.email || !profile.email.includes('@')) return;
  try {
    localStorage.setItem(
      mirrorKeyForEmail(profile.email),
      JSON.stringify({
        displayName: profile.displayName,
        avatar: profile.avatar,
        themeId: profile.themeId,
        language: profile.language,
        savedMusic: profile.savedMusic || [],
        updatedAt: Date.now(),
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

function loadAccountPrefsMirror(email: string): Partial<UserProfile> | null {
  if (!email || !email.includes('@')) return null;
  try {
    const raw = localStorage.getItem(mirrorKeyForEmail(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
      avatar:
        parsed.avatar && typeof parsed.avatar === 'object'
          ? (parsed.avatar as UserProfile['avatar'])
          : undefined,
      themeId: isValidThemeId(parsed.themeId) ? (parsed.themeId as ThemeId) : undefined,
      language: isValidLanguageId(parsed.language) ? (parsed.language as LanguageId) : undefined,
      savedMusic: Array.isArray(parsed.savedMusic) ? (parsed.savedMusic as SavedMusicTrack[]) : [],
    };
  } catch {
    return null;
  }
}

function mergeTrackArrays(a: SavedMusicTrack[] = [], b: SavedMusicTrack[] = []): SavedMusicTrack[] {
  const seen = new Set<string>();
  const out: SavedMusicTrack[] = [];
  for (const t of [...a, ...b]) {
    if (!t || !t.id) continue;
    const key = t.id || t.embedUrl || t.audioUrl || '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function authHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-workspace-id': getActiveWorkspaceId(),
  };
}

async function authHeadersWithToken(forceRefreshToken = false): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-workspace-id': getActiveWorkspaceId(),
  };
  const fbToken = await getFirebaseIdToken(forceRefreshToken);
  if (fbToken) {
    base.Authorization = `Bearer ${fbToken}`;
  }
  return base;
}

function normalizeUserProfile(raw: Record<string, unknown>): UserProfile {
  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : 'My account',
    email: typeof raw.email === 'string' ? raw.email : '',
    isGuest: false,
    authProvider: raw.authProvider === 'google' ? 'google' : 'email',
    photoUrl: typeof raw.photoUrl === 'string' ? raw.photoUrl : undefined,
    avatar:
      raw.avatar && typeof raw.avatar === 'object'
        ? (raw.avatar as UserProfile['avatar'])
        : undefined,
    themeId: isValidThemeId(raw.themeId) ? (raw.themeId as ThemeId) : undefined,
    language: isValidLanguageId(raw.language) ? (raw.language as LanguageId) : undefined,
    savedMusic: Array.isArray(raw.savedMusic) ? (raw.savedMusic as SavedMusicTrack[]) : [],
  };
}

export function getStoredUser(): UserProfile | null {
  try {
    if (localStorage.getItem(SIGNED_OUT_KEY) === '1') {
      return null;
    }
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        !parsed.isGuest &&
        typeof parsed.id === 'string' &&
        typeof parsed.email === 'string' &&
        parsed.email.includes('@')
      ) {
        return normalizeUserProfile(parsed);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function saveStoredUser(profile: UserProfile | null): void {
  try {
    if (!profile) {
      localStorage.setItem(SIGNED_OUT_KEY, '1');
      localStorage.removeItem(USER_KEY);
    } else {
      localStorage.removeItem(SIGNED_OUT_KEY);
      localStorage.setItem(USER_KEY, JSON.stringify(profile));
      saveAccountPrefsMirror(profile);
    }
  } catch {
    // Ignore storage errors
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8000,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    if (timedOut) {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

async function reconcileAccountPreferences(serverUser: UserProfile): Promise<UserProfile> {
  const [cloudProfile, mirror] = await Promise.all([
    loadFirestoreUserProfile().catch(() => null),
    Promise.resolve(loadAccountPrefsMirror(serverUser.email)),
  ]);

  const mergedMusic = mergeTrackArrays(
    serverUser.savedMusic || [],
    mergeTrackArrays(cloudProfile?.savedMusic || [], mirror?.savedMusic || [])
  );

  const resolvedAvatar = serverUser.avatar || cloudProfile?.avatar || mirror?.avatar;
  const resolvedTheme =
    (serverUser.themeId && serverUser.themeId !== 'paper' && isValidThemeId(serverUser.themeId)
      ? serverUser.themeId
      : undefined) ||
    (cloudProfile?.themeId && isValidThemeId(cloudProfile.themeId) ? cloudProfile.themeId : undefined) ||
    (mirror?.themeId && isValidThemeId(mirror.themeId) ? mirror.themeId : undefined) ||
    serverUser.themeId ||
    'paper';
  const resolvedLang =
    (serverUser.language && serverUser.language !== 'en' ? serverUser.language : undefined) ||
    cloudProfile?.language ||
    mirror?.language ||
    serverUser.language ||
    'en';
  const resolvedName =
    serverUser.displayName || cloudProfile?.displayName || mirror?.displayName || 'My account';

  const reconciled: UserProfile = {
    ...serverUser,
    displayName: resolvedName,
    avatar: resolvedAvatar,
    themeId: resolvedTheme,
    language: resolvedLang,
    savedMusic: mergedMusic,
  };

  // Backfill server or Firestore if cloud/mirror held missing edits
  const needsServerSync =
    (!serverUser.avatar && Boolean(resolvedAvatar)) ||
    (resolvedTheme !== (serverUser.themeId || 'paper')) ||
    (resolvedLang !== (serverUser.language || 'en')) ||
    mergedMusic.length > (serverUser.savedMusic?.length || 0);

  if (needsServerSync && reconciled.id) {
    try {
      const headers = await authHeadersWithToken();
      await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { ...headers, 'x-workspace-id': reconciled.id },
        credentials: 'include',
        body: JSON.stringify({
          email: reconciled.email,
          displayName: reconciled.displayName,
          authProvider: reconciled.authProvider,
          ...(resolvedAvatar ? { avatar: resolvedAvatar } : {}),
          themeId: resolvedTheme,
          language: resolvedLang,
          savedMusic: mergedMusic,
        }),
      });
    } catch {
      // Non-fatal
    }
  }

  void saveFirestoreUserProfilePatch(reconciled, {
    displayName: reconciled.displayName,
    avatar: reconciled.avatar,
    themeId: reconciled.themeId,
    language: reconciled.language,
    savedMusic: reconciled.savedMusic,
  }).catch(() => {});

  saveStoredUser(reconciled);
  return reconciled;
}

export async function restoreSessionFromServer(): Promise<UserProfile | null> {
  try {
    if (localStorage.getItem(SIGNED_OUT_KEY) === '1') {
      return null;
    }
    const stored = getStoredUser();
    const fbToken = await getFirebaseIdToken();
    const headers: Record<string, string> = {};
    if (stored?.id) headers['x-workspace-id'] = stored.id;
    if (fbToken) headers.Authorization = `Bearer ${fbToken}`;

    const res = await fetchWithTimeout(
      '/api/auth/me',
      {
        headers,
        credentials: 'include',
      },
      5500
    );
    if (res.status === 401) {
      if (fbToken) {
        const syncRes = await fetchWithTimeout(
          '/api/auth/session-sync',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ idToken: fbToken, workspaceId: stored?.id }),
          },
          5500
        ).catch(() => null);
        if (syncRes && syncRes.ok) {
          const syncBody = await syncRes.json().catch(() => ({}));
          if (syncBody?.user?.id) {
            return await reconcileAccountPreferences(normalizeUserProfile(syncBody.user));
          }
        }
      }
      if (stored && stored.id && stored.email) {
        // Rehydrate ephemeral server session gracefully instead of signing out an active user
        return stored;
      }
      return null;
    }
    if (!res.ok) {
      return stored;
    }
    const body = await res.json().catch(() => ({}));
    if (body?.user && body.user.id && body.user.email) {
      return await reconcileAccountPreferences(normalizeUserProfile(body.user));
    }
    return stored;
  } catch {
    return getStoredUser();
  }
}

export async function signOutAccount(currentUser?: UserProfile | null): Promise<void> {
  if (currentUser) {
    saveAccountPrefsMirror(currentUser);
  }
  saveStoredUser(null);
  await signOutFirebase();
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Local sign out already completed
  }
}

export async function updateUserProfile(
  patch: Partial<UserProfile>,
  fallbackUser?: UserProfile | null
): Promise<UserProfile | null> {
  const current = getStoredUser() || fallbackUser || null;
  if (!current) return null;
  const updated: UserProfile = { ...current, ...patch };
  saveStoredUser(updated);
  saveAccountPrefsMirror(updated);

  if (!updated.isGuest) {
    // Only transmit fields present in `patch` (plus identity hints for server recovery) so concurrent saves never overwrite each other
    const payload: Record<string, unknown> = {
      email: updated.email,
      authProvider: updated.authProvider,
    };
    if ('displayName' in patch) payload.displayName = updated.displayName;
    if ('avatar' in patch) payload.avatar = updated.avatar;
    if ('themeId' in patch) payload.themeId = updated.themeId;
    if ('language' in patch) payload.language = updated.language;
    if ('savedMusic' in patch) payload.savedMusic = updated.savedMusic;

    void saveFirestoreUserProfilePatch(updated, patch).catch(() => {});

    try {
      const headers = await authHeadersWithToken();
      headers['x-workspace-id'] = updated.id || getActiveWorkspaceId();
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.user?.id) {
          const synced = normalizeUserProfile(body.user);
          // Re-apply latest local patch keys in case another field is newer locally
          const finalUser: UserProfile = { ...synced, ...patch };
          saveStoredUser(finalUser);
          return finalUser;
        }
      }
    } catch {
      // Local & Firestore updates remain intact
    }
  }
  return updated;
}

export async function signUpAccount(payload: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<UserProfile> {
  const guestWorkspaceId = getLegacyGuestWorkspaceId();
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      ...payload,
      themeId: getSavedThemeId(),
      language: getSavedLanguageId(),
      guestWorkspaceId,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Could not create account.');
  }
  const user = await reconcileAccountPreferences(normalizeUserProfile(body.user));
  saveStoredUser(user);
  return user;
}

export async function logInAccount(payload: {
  email: string;
  password: string;
}): Promise<UserProfile> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Could not sign in.');
  }
  const user = await reconcileAccountPreferences(normalizeUserProfile(body.user));
  saveStoredUser(user);
  return user;
}

export async function logInWithGoogleToken(
  tokenOrPayload:
    | string
    | {
        idToken?: string | null;
        googleIdToken?: string | null;
        googleAccessToken?: string | null;
      }
): Promise<UserProfile> {
  const payload =
    typeof tokenOrPayload === 'string'
      ? { idToken: tokenOrPayload }
      : tokenOrPayload;

  let firebaseIdToken = payload.idToken || null;
  if (!firebaseIdToken && (payload.googleIdToken || payload.googleAccessToken)) {
    firebaseIdToken = await signInFirebaseWithGoogleTokens(
      payload.googleIdToken,
      payload.googleAccessToken
    );
  }

  const guestWorkspaceId = getLegacyGuestWorkspaceId();
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      idToken: firebaseIdToken || undefined,
      googleIdToken: payload.googleIdToken || undefined,
      googleAccessToken: payload.googleAccessToken || undefined,
      themeId: getSavedThemeId(),
      language: getSavedLanguageId(),
      guestWorkspaceId,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.user) {
    throw new Error(body.error || 'Could not sign in with Google.');
  }
  const user = await reconcileAccountPreferences(normalizeUserProfile(body.user));
  saveStoredUser(user);
  return user;
}

export async function submitGoogleHandoff(
  nonce: string,
  payload: {
    idToken?: string | null;
    googleIdToken?: string | null;
    googleAccessToken?: string | null;
  }
): Promise<void> {
  const guestWorkspaceId = getLegacyGuestWorkspaceId();
  const res = await fetch('/api/auth/google/handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nonce,
      idToken: payload.idToken || undefined,
      googleIdToken: payload.googleIdToken || undefined,
      googleAccessToken: payload.googleAccessToken || undefined,
      themeId: getSavedThemeId(),
      language: getSavedLanguageId(),
      guestWorkspaceId,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Could not hand off Google sign-in.');
  }
}

export async function pollGoogleHandoff(nonce: string): Promise<
  | { status: 'pending' }
  | { status: 'ready'; user: UserProfile }
> {
  const params = new URLSearchParams({
    themeId: getSavedThemeId(),
    language: getSavedLanguageId(),
  });
  const guestWorkspaceId = getLegacyGuestWorkspaceId();
  if (guestWorkspaceId) params.set('guestWorkspaceId', guestWorkspaceId);

  const res = await fetchWithTimeout(
    `/api/auth/google/handoff/${encodeURIComponent(nonce)}?${params.toString()}`,
    { credentials: 'include' },
    6000
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Google sign-in handoff failed.');
  }
  if (body?.status === 'ready' && body?.user) {
    await signInFirebaseWithGoogleTokens(body.googleIdToken, body.googleAccessToken);
    const user = await reconcileAccountPreferences(normalizeUserProfile(body.user));
    saveStoredUser(user);
    return { status: 'ready', user };
  }
  return { status: 'pending' };
}

export async function fetchSavedMusicFromServer(): Promise<SavedMusicTrack[]> {
  try {
    const headers = await authHeadersWithToken();
    const res = await fetchWithTimeout(
      '/api/music',
      {
        headers,
        credentials: 'include',
      },
      6000
    );
    if (!res.ok) return [];
    const body = await res.json().catch(() => ({}));
    return Array.isArray(body.tracks) ? (body.tracks as SavedMusicTrack[]) : [];
  } catch {
    return [];
  }
}

let musicSaveQueue: Promise<unknown> = Promise.resolve();

export async function saveMusicToServer(tracks: SavedMusicTrack[]): Promise<SavedMusicTrack[]> {
  const stored = getStoredUser();
  if (stored) {
    const updated = { ...stored, savedMusic: tracks };
    saveStoredUser(updated);
  }

  const runSave = async (): Promise<SavedMusicTrack[]> => {
    try {
      const currentStored = getStoredUser();
      if (currentStored) {
        const updated = { ...currentStored, savedMusic: tracks };
        void saveFirestoreUserProfilePatch(updated, { savedMusic: tracks }).catch(() => {});
      }
      const headers = await authHeadersWithToken();
      const res = await fetch('/api/music', {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify({ tracks }),
      });
      if (!res.ok) return tracks;
      const body = await res.json().catch(() => ({}));
      return Array.isArray(body.tracks) ? (body.tracks as SavedMusicTrack[]) : tracks;
    } catch {
      return tracks;
    }
  };

  const nextTask = musicSaveQueue.then(runSave, runSave);
  musicSaveQueue = nextTask.catch(() => undefined);
  return nextTask;
}

export async function uploadCustomAudioFile(
  file: File,
  options?: { title?: string; saveToApp?: boolean }
): Promise<SavedMusicTrack> {
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Audio file must be 15 MB or smaller.');
  }
  const base64 = await blobToBase64(file);
  const headers = await authHeadersWithToken();
  const res = await fetchWithTimeout(
    '/api/audio/upload',
    {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        filename: file.name || 'audio.mp3',
        mimeType: file.type || 'audio/mpeg',
        dataBase64: base64,
        title: options?.title || file.name.replace(/\.[^.]+$/, '') || 'Custom audio',
        saveToApp: options?.saveToApp !== false,
      }),
    },
    25000
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.track) {
    throw new Error(body.error || 'Could not upload audio file.');
  }
  return body.track as SavedMusicTrack;
}

export async function deleteAccount(): Promise<void> {
  const examsKey = examsCacheKey();
  const examsMirKey = examsMirrorKey();
  const lessonsKey = lessonsCacheKey();
  const lessonsMirKey = lessonsMirrorKey();
  const draftsKey = scanDraftsCacheKey();
  const majorDraftsKey = majorScanDraftsCacheKey();
  const res = await fetch('/api/auth/account', {
    method: 'DELETE',
    headers: { 'x-workspace-id': getActiveWorkspaceId() },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not delete account.');
  }
  saveStoredUser(null);
  try {
    localStorage.removeItem(examsKey);
    localStorage.removeItem(examsMirKey);
    localStorage.removeItem(lessonsKey);
    localStorage.removeItem(lessonsMirKey);
    localStorage.removeItem(draftsKey);
    localStorage.removeItem(majorDraftsKey);
  } catch {
    // Ignore
  }
}

export function getCachedExams(): Exam[] {
  try {
    const primary = localStorage.getItem(examsCacheKey());
    if (primary) {
      const parsed = JSON.parse(primary);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    const mirror = localStorage.getItem(examsMirrorKey());
    if (mirror) {
      const parsed = JSON.parse(mirror);
      if (Array.isArray(parsed)) return parsed;
    }
    if (primary) {
      const parsed = JSON.parse(primary);
      if (Array.isArray(parsed)) return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

export function setCachedExams(exams: Exam[]): void {
  try {
    const json = JSON.stringify(exams);
    localStorage.setItem(examsCacheKey(), json);
    if (getStoredUser()?.email) {
      localStorage.setItem(examsMirrorKey(), json);
    }
  } catch {
    // Ignore
  }
}

export function getCachedLessons(): LessonItem[] {
  try {
    const primary = localStorage.getItem(lessonsCacheKey());
    if (primary) {
      const parsed = JSON.parse(primary);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    const mirror = localStorage.getItem(lessonsMirrorKey());
    if (mirror) {
      const parsed = JSON.parse(mirror);
      if (Array.isArray(parsed)) return parsed;
    }
    if (primary) {
      const parsed = JSON.parse(primary);
      if (Array.isArray(parsed)) return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

export function setCachedLessons(lessons: LessonItem[]): void {
  try {
    const json = JSON.stringify(lessons);
    localStorage.setItem(lessonsCacheKey(), json);
    if (getStoredUser()?.email) {
      localStorage.setItem(lessonsMirrorKey(), json);
    }
  } catch {
    // Ignore
  }
}

export interface StoredScanDraftState {
  drafts: ScannedExamDraft[];
  lessonDrafts: ScannedLessonDraft[];
  ignoredItems: string[];
}

export function getSavedScanDrafts(): StoredScanDraftState | null {
  try {
    const raw = localStorage.getItem(scanDraftsCacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (!Array.isArray(parsed.drafts) && !Array.isArray(parsed.lessonDrafts))) {
      return null;
    }
    const drafts = Array.isArray(parsed.drafts) ? parsed.drafts : [];
    const lessonDrafts = Array.isArray(parsed.lessonDrafts) ? parsed.lessonDrafts : [];
    const ignoredItems = Array.isArray(parsed.ignoredItems) ? parsed.ignoredItems : [];
    if (drafts.length === 0 && lessonDrafts.length === 0) return null;
    return { drafts, lessonDrafts, ignoredItems };
  } catch {
    return null;
  }
}

export function saveScanDrafts(state: StoredScanDraftState): void {
  try {
    localStorage.setItem(scanDraftsCacheKey(), JSON.stringify(state));
  } catch {
    // Ignore
  }
}

export function clearScanDrafts(): void {
  try {
    localStorage.removeItem(scanDraftsCacheKey());
  } catch {
    // Ignore
  }
}

export function getSavedMajorScanDrafts(): StoredScanDraftState | null {
  try {
    const raw = localStorage.getItem(majorScanDraftsCacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (!Array.isArray(parsed.drafts) && !Array.isArray(parsed.lessonDrafts))) {
      return null;
    }
    const drafts = Array.isArray(parsed.drafts) ? parsed.drafts : [];
    const lessonDrafts = Array.isArray(parsed.lessonDrafts) ? parsed.lessonDrafts : [];
    const ignoredItems = Array.isArray(parsed.ignoredItems) ? parsed.ignoredItems : [];
    if (drafts.length === 0 && lessonDrafts.length === 0) return null;
    return { drafts, lessonDrafts, ignoredItems };
  } catch {
    return null;
  }
}

export function saveMajorScanDrafts(state: StoredScanDraftState): void {
  try {
    localStorage.setItem(majorScanDraftsCacheKey(), JSON.stringify(state));
  } catch {
    // Ignore
  }
}

export function clearMajorScanDrafts(): void {
  try {
    localStorage.removeItem(majorScanDraftsCacheKey());
  } catch {
    // Ignore
  }
}

async function syncExamsToServer(exams: Exam[]): Promise<void> {
  if (exams.length === 0) return;
  try {
    const headers = await authHeadersWithToken();
    await fetchWithTimeout(
      '/api/exams/sync',
      {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ exams }),
      },
      8000
    );
  } catch {
    // Non-fatal
  }
}

async function syncLessonsToServer(lessons: LessonItem[]): Promise<void> {
  if (lessons.length === 0) return;
  try {
    const headers = await authHeadersWithToken();
    await fetchWithTimeout(
      '/api/lessons/sync',
      {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ lessons }),
      },
      8000
    );
  } catch {
    // Non-fatal
  }
}

export async function fetchExams(): Promise<Exam[]> {
  let serverFailed = false;
  let cloudFailed = false;

  const headers = await authHeadersWithToken();
  const [serverExams, cloudExams] = await Promise.all([
    fetchWithTimeout(
      '/api/exams',
      {
        headers,
        credentials: 'include',
      },
      8000
    )
      .then(async (res) => {
        if (!res.ok) {
          serverFailed = true;
          return [] as Exam[];
        }
        const data = await res.json().catch(() => ({}));
        return Array.isArray(data.exams) ? (data.exams as Exam[]) : [];
      })
      .catch(() => {
        serverFailed = true;
        return [] as Exam[];
      }),
    loadFirestoreExams().catch(() => {
      cloudFailed = true;
      return [] as Exam[];
    }),
  ]);

  const localFallback = getCachedExams();
  if (serverFailed && cloudFailed && localFallback.length === 0) {
    throw new Error('Could not load exams.');
  }

  const tombstones = readTombstones(deletedExamsKey());
  const byId = new Map<string, Exam>();

  for (const ex of localFallback) {
    if (ex && ex.id && !(ex.id in tombstones)) {
      byId.set(ex.id, ex);
    }
  }
  for (const ce of cloudExams) {
    if (!ce || !ce.id) continue;
    if (ce.id in tombstones) {
      void deleteFirestoreExam(ce.id).catch(() => {});
      continue;
    }
    byId.set(ce.id, ce);
  }
  for (const se of serverExams) {
    if (!se || !se.id) continue;
    if (se.id in tombstones) {
      void fetch(`/api/exams/${encodeURIComponent(se.id)}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      }).catch(() => {});
      continue;
    }
    byId.set(se.id, se);
  }

  const merged = Array.from(byId.values());
  setCachedExams(merged);

  // Bidirectional backfill so server restarts & delayed Firestore writes stay reconciled
  const user = getStoredUser();
  const cloudIds = new Set(cloudExams.map((e) => e.id));
  const serverIds = new Set(serverExams.map((e) => e.id));

  const missingInCloud = merged.filter((e) => !cloudIds.has(e.id));
  if (user && !cloudFailed && missingInCloud.length > 0) {
    void saveFirestoreExamsBatch(user, missingInCloud).catch(() => {});
  }

  const missingOnServer = merged.filter((e) => !serverIds.has(e.id));
  if (!serverFailed && missingOnServer.length > 0) {
    void syncExamsToServer(missingOnServer);
  }

  return merged;
}

export async function createExam(input: ExamInput): Promise<Exam> {
  const headers = await authHeadersWithToken();
  const res = await fetch('/api/exams', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Could not save. Try again.');
  }
  const exam = body.exam as Exam;
  clearTombstone(deletedExamsKey(), exam.id);
  const nextCache = [...getCachedExams().filter((e) => e.id !== exam.id), exam];
  setCachedExams(nextCache);

  const user = getStoredUser();
  if (user) {
    await waitBounded(saveFirestoreExam(user, exam), 3000);
  }
  return exam;
}

export async function createManyExams(inputs: ExamInput[]): Promise<Exam[]> {
  const headers = await authHeadersWithToken();
  const res = await fetch('/api/exams/batch', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ exams: inputs }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Could not save the exams.');
  }
  const created = Array.isArray(body.exams) ? (body.exams as Exam[]) : [];
  const createdIds = new Set(created.map((e) => e.id));
  for (const ex of created) {
    clearTombstone(deletedExamsKey(), ex.id);
  }
  const nextCache = [...getCachedExams().filter((e) => !createdIds.has(e.id)), ...created];
  setCachedExams(nextCache);

  const user = getStoredUser();
  if (user && created.length > 0) {
    await waitBounded(saveFirestoreExamsBatch(user, created), 4000);
  }
  return created;
}

export async function updateExam(id: string, input: ExamInput): Promise<Exam> {
  const headers = await authHeadersWithToken();
  const res = await fetch(`/api/exams/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers,
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Could not save. Try again.');
  }
  const exam = body.exam as Exam;
  clearTombstone(deletedExamsKey(), exam.id);
  const existing = getCachedExams();
  const idx = existing.findIndex((e) => e.id === exam.id);
  const nextCache =
    idx === -1 ? [...existing, exam] : existing.map((e, i) => (i === idx ? exam : e));
  setCachedExams(nextCache);

  const user = getStoredUser();
  if (user) {
    await waitBounded(saveFirestoreExam(user, exam), 3000);
  }
  return exam;
}

export async function deleteExam(id: string): Promise<void> {
  markTombstone(deletedExamsKey(), id);
  setCachedExams(getCachedExams().filter((e) => e.id !== id));

  const headers = await authHeadersWithToken();
  const res = await fetch(`/api/exams/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not delete.');
  }
  await waitBounded(deleteFirestoreExam(id), 3000);
}

export async function fetchLessons(): Promise<LessonItem[]> {
  let serverFailed = false;
  let cloudFailed = false;

  const headers = await authHeadersWithToken();
  const [serverLessons, cloudLessons] = await Promise.all([
    fetchWithTimeout(
      '/api/lessons',
      {
        headers,
        credentials: 'include',
      },
      8000
    )
      .then(async (res) => {
        if (!res.ok) {
          serverFailed = true;
          return [] as LessonItem[];
        }
        const data = await res.json().catch(() => ({}));
        return Array.isArray(data.lessons) ? (data.lessons as LessonItem[]) : [];
      })
      .catch(() => {
        serverFailed = true;
        return [] as LessonItem[];
      }),
    loadFirestoreLessons().catch(() => {
      cloudFailed = true;
      return [] as LessonItem[];
    }),
  ]);

  const localFallback = getCachedLessons();
  if (serverFailed && cloudFailed && localFallback.length === 0) {
    throw new Error('Could not load study checklist.');
  }

  const tombstones = readTombstones(deletedLessonsKey());
  const byId = new Map<string, LessonItem>();

  for (const l of localFallback) {
    if (l && l.id && !(l.id in tombstones)) {
      byId.set(l.id, l);
    }
  }
  for (const cl of cloudLessons) {
    if (!cl || !cl.id) continue;
    if (cl.id in tombstones) {
      void deleteFirestoreLesson(cl.id).catch(() => {});
      continue;
    }
    byId.set(cl.id, cl);
  }
  for (const sl of serverLessons) {
    if (!sl || !sl.id) continue;
    if (sl.id in tombstones) {
      void fetch(`/api/lessons/${encodeURIComponent(sl.id)}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      }).catch(() => {});
      continue;
    }
    byId.set(sl.id, sl);
  }

  const merged = Array.from(byId.values());
  setCachedLessons(merged);

  const user = getStoredUser();
  const cloudIds = new Set(cloudLessons.map((l) => l.id));
  const serverIds = new Set(serverLessons.map((l) => l.id));

  const missingInCloud = merged.filter((l) => !cloudIds.has(l.id));
  if (user && !cloudFailed && missingInCloud.length > 0) {
    void saveFirestoreLessonsBatch(user, missingInCloud).catch(() => {});
  }

  const missingOnServer = merged.filter((l) => !serverIds.has(l.id));
  if (!serverFailed && missingOnServer.length > 0) {
    void syncLessonsToServer(missingOnServer);
  }

  return merged;
}

export async function createLesson(input: LessonInput): Promise<LessonItem> {
  const headers = await authHeadersWithToken();
  const res = await fetch('/api/lessons', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Could not add lesson.');
  }
  const lesson = body.lesson as LessonItem;
  clearTombstone(deletedLessonsKey(), lesson.id);
  setCachedLessons([...getCachedLessons().filter((l) => l.id !== lesson.id), lesson]);

  const user = getStoredUser();
  if (user) {
    await waitBounded(saveFirestoreLesson(user, lesson), 3000);
  }
  return lesson;
}

export async function createManyLessons(inputs: LessonInput[]): Promise<LessonItem[]> {
  const headers = await authHeadersWithToken();
  const res = await fetch('/api/lessons/batch', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ lessons: inputs }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Could not save lessons.');
  }
  const created = Array.isArray(body.lessons) ? (body.lessons as LessonItem[]) : [];
  const createdIds = new Set(created.map((l) => l.id));
  for (const ls of created) {
    clearTombstone(deletedLessonsKey(), ls.id);
  }
  setCachedLessons([...getCachedLessons().filter((l) => !createdIds.has(l.id)), ...created]);

  const user = getStoredUser();
  if (user && created.length > 0) {
    await waitBounded(saveFirestoreLessonsBatch(user, created), 4000);
  }
  return created;
}

export async function updateLesson(
  id: string,
  patch: Partial<LessonInput>
): Promise<LessonItem> {
  const existingList = getCachedLessons();
  const cached = existingList.find((l) => l.id === id);
  const fullPayload = cached ? { ...cached, ...patch } : patch;

  const headers = await authHeadersWithToken();
  const res = await fetch(`/api/lessons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    credentials: 'include',
    body: JSON.stringify(fullPayload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Could not update lesson.');
  }
  const lesson = body.lesson as LessonItem;
  clearTombstone(deletedLessonsKey(), lesson.id);
  const idx = existingList.findIndex((l) => l.id === lesson.id);
  setCachedLessons(
    idx === -1 ? [...existingList, lesson] : existingList.map((l, i) => (i === idx ? lesson : l))
  );

  const user = getStoredUser();
  if (user) {
    await waitBounded(saveFirestoreLesson(user, lesson), 3000);
  }
  return lesson;
}

export async function deleteLesson(id: string): Promise<void> {
  markTombstone(deletedLessonsKey(), id);
  setCachedLessons(getCachedLessons().filter((l) => l.id !== id));

  const headers = await authHeadersWithToken();
  const res = await fetch(`/api/lessons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not delete lesson.');
  }
  await waitBounded(deleteFirestoreLesson(id), 3000);
}

const MAX_IMAGE_DIM = 2560;
const MAX_SCAN_BINARY_BYTES = 23 * 1024 * 1024;
const CANVAS_NATIVE_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const GEMINI_SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

const UNSUPPORTED_SCAN_EXT_RE =
  /\.(docx?|xlsx?|pptx?|zip|rar|7z|pages|numbers|key|rtf|odt|ods|odp|exe|dmg|mp4|mov|mp3|wav)$/i;

export function classifyScanFileKind(file: File): 'pdf' | 'text' | 'image' {
  const rawType = (file.type || '').toLowerCase().trim();
  const lower = (file.name || '').toLowerCase().trim();

  if (UNSUPPORTED_SCAN_EXT_RE.test(lower)) {
    throw new Error(
      `Unsupported file format (${file.name || 'document'}). Please upload PDF, photo (JPG/PNG/WEBP/HEIC), or plain text/CSV.`
    );
  }
  if (rawType === 'application/pdf' || /\.pdf$/i.test(lower)) {
    return 'pdf';
  }
  if (rawType.startsWith('text/') || /\.(txt|md|csv)$/i.test(lower)) {
    return 'text';
  }
  if (
    rawType.startsWith('image/') ||
    /\.(jpe?g|png|webp|gif|heic|heif|bmp|avif)$/i.test(lower)
  ) {
    return 'image';
  }
  if (rawType && rawType !== 'application/octet-stream') {
    throw new Error(
      `Unsupported file format (${file.name || rawType}). Please upload PDF, photo (JPG/PNG/WEBP/HEIC), or plain text/CSV.`
    );
  }
  throw new Error(
    `Could not recognize file type (${file.name || 'file'}). Please upload PDF, photo (JPG/PNG/WEBP/HEIC), or plain text/CSV.`
  );
}

function resolveDeclaredImageMime(file: File): string {
  const rawType = (file.type || '').toLowerCase();
  if (rawType && rawType !== 'application/octet-stream') {
    if (rawType === 'image/jpg') return 'image/jpeg';
    return rawType;
  }
  const lower = (file.name || '').toLowerCase();
  if (/\.png$/i.test(lower)) return 'image/png';
  if (/\.webp$/i.test(lower)) return 'image/webp';
  if (/\.gif$/i.test(lower)) return 'image/gif';
  if (/\.heic$/i.test(lower)) return 'image/heic';
  if (/\.heif$/i.test(lower)) return 'image/heif';
  return 'image/jpeg';
}

function estimateBase64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(blob);
  });
}

async function decodeImageSource(
  file: File
): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
      close: () => bitmap.close?.(),
    };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Unsupported image format.'));
        el.src = url;
      });
      return {
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        close: () => URL.revokeObjectURL(url),
      };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }
}

async function prepareImageFile(
  file: File,
  options?: { maxDim?: number; quality?: number; skipSizeBytes?: number }
): Promise<{ file: File; mimeType: string }> {
  const mimeType = resolveDeclaredImageMime(file);
  if (!mimeType.startsWith('image/')) {
    return { file, mimeType };
  }
  const needsFormatConversion = !CANVAS_NATIVE_IMAGE_MIMES.has(mimeType);
  const maxDim = options?.maxDim ?? MAX_IMAGE_DIM;
  const quality = options?.quality ?? 0.9;
  const skipSizeBytes = options?.skipSizeBytes ?? 2 * 1024 * 1024;

  // Preserve standard PNG/JPEG/WEBP untouched only when format is supported and size is already modest
  if (!needsFormatConversion && file.size <= skipSizeBytes) {
    return { file, mimeType };
  }
  try {
    const src = await decodeImageSource(file);
    try {
      const maxSide = Math.max(src.width, src.height);
      if (
        !needsFormatConversion &&
        maxSide <= maxDim &&
        file.size <= Math.max(skipSizeBytes, 3.5 * 1024 * 1024)
      ) {
        return { file, mimeType };
      }
      const scale = maxSide > 0 ? Math.min(1, maxDim / maxSide) : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(src.width * scale));
      canvas.height = Math.max(1, Math.round(src.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return { file, mimeType };
      }
      ctx.imageSmoothingQuality = 'high';
      src.draw(ctx, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality)
      );
      if (!blob) {
        return { file, mimeType };
      }
      if (!needsFormatConversion && blob.size >= file.size) {
        return { file, mimeType };
      }
      const filename = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
      return {
        file: new File([blob], filename, { type: 'image/jpeg' }),
        mimeType: 'image/jpeg',
      };
    } finally {
      src.close();
    }
  } catch {
    return { file, mimeType };
  }
}

export interface ScanDocumentResult {
  exams: Array<ExamInput & { material: string; topics: string[] }>;
  lessons: Array<{ subject: string; title: string; notes: string }>;
  ignored: string[];
  totalPages?: number;
}

export interface ScanProgressInfo {
  detail: string;
  chunkIndex: number;
  chunkTotal: number;
  totalPages?: number;
}

function normalizeScannedExamType(rawType: unknown): Exam['type'] {
  const lower = String(rawType || 'other').toLowerCase().trim();
  const exact = EXAM_TYPES.find((t) => t.key === lower)?.key;
  if (exact) return exact;
  if (/month|شهري|شهر|mensuel/.test(lower)) return 'monthly';
  if (/mid|نصفي|منتصف|partiel/.test(lower)) return 'midterm';
  if (/final|نهائي|آخر العام/.test(lower)) return 'final';
  if (/quiz|قصير|فجائي/.test(lower)) return 'quiz';
  if (/practical|lab|عملي/.test(lower)) return 'practical';
  if (/oral|شفوي|شفهي/.test(lower)) return 'oral';
  return 'other';
}

function foldScanDigits(raw: unknown): string {
  return String(raw || '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
}

function normalizeScannedDate(raw: unknown): string {
  if (isValidIsoDate(raw)) return raw;
  const cleaned = foldScanDigits(raw).trim();
  if (!cleaned) return '';
  const ymd = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const dmy = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    let d = Number(dmy[1]);
    let m = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (m > 12 && d <= 12) {
      const swap = d;
      d = m;
      m = swap;
    }
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return '';
}

function normalizeScannedTime(raw: unknown): string {
  const cleaned = foldScanDigits(raw).trim();
  if (!cleaned) return '';
  const match = cleaned.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm|ص|م)?/i);
  if (!match) return '';
  let h = Number(match[1]);
  const m = Number(match[2]);
  const period = (match[3] || '').toLowerCase();
  if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59 || h > 23) return '';
  if ((period === 'pm' || period === 'م') && h < 12) h += 12;
  if ((period === 'am' || period === 'ص') && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeScanResponseBody(body: Record<string, unknown>): ScanDocumentResult {
  const rawExams = Array.isArray(body.exams) ? body.exams : [];
  const normalizedExams = rawExams
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && (item.subject || item.name || item.course || item.title))
    )
    .map((item) => {
      const matchedType = normalizeScannedExamType(item.type);
      const topics = Array.isArray(item.topics)
        ? item.topics
            .flatMap((t: unknown) =>
              String(t || '')
                .split(/[,،;\n]+/)
                .map((s) => s.trim())
            )
            .filter(Boolean)
        : typeof item.topics === 'string'
        ? item.topics
            .split(/[,،;\n]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      return {
        subject: String(item.subject || item.name || item.course || item.title || '').trim(),
        date: normalizeScannedDate(item.date),
        startTime: normalizeScannedTime(item.startTime || item.time),
        endTime: normalizeScannedTime(item.endTime),
        room: String(item.room || item.hall || '').trim(),
        type: matchedType,
        material: String(item.material || '').trim(),
        topics: Array.from(new Set(topics)),
        notes: String(item.notes || '').trim(),
      };
    });

  const rawLessons = Array.isArray(body.lessons) ? body.lessons : [];
  const normalizedLessons = rawLessons
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && (item.title || item.lesson || item.topic || item.name))
    )
    .map((item) => ({
      subject: String(item.subject || 'General').trim(),
      title: String(item.title || item.lesson || item.topic || item.name || '').trim(),
      notes: String(item.notes || '').trim(),
    }));

  const ignored = Array.isArray(body.ignored)
    ? body.ignored
        .filter((line: unknown): line is string => typeof line === 'string' && line.trim().length > 0)
        .map((s: string) => s.trim())
    : [];

  return {
    exams: normalizedExams,
    lessons: normalizedLessons,
    ignored,
    totalPages: typeof body.totalPages === 'number' ? body.totalPages : undefined,
  };
}

export async function scanScheduleFile(
  file: File,
  options?: {
    signal?: AbortSignal;
    onProgress?: (info: ScanProgressInfo) => void;
  }
): Promise<ScanDocumentResult> {
  if (options?.signal?.aborted) {
    throw new DOMException('Scan cancelled', 'AbortError');
  }
  if (file.size === 0) {
    throw new Error('This file is empty.');
  }

  const kind = classifyScanFileKind(file);
  const isPdf = kind === 'pdf';
  const isText = kind === 'text';

  let base64: string;
  let mimeType: string;

  if (isPdf) {
    options?.onProgress?.({
      detail: 'Reading PDF pages…',
      chunkIndex: 1,
      chunkTotal: 1,
    });
    base64 = await blobToBase64(file);
    mimeType = 'application/pdf';
  } else if (isText) {
    options?.onProgress?.({
      detail: 'Reading document text…',
      chunkIndex: 1,
      chunkTotal: 1,
    });
    base64 = await blobToBase64(file);
    mimeType = 'text/plain';
  } else {
    options?.onProgress?.({
      detail: 'Preparing image…',
      chunkIndex: 1,
      chunkTotal: 1,
    });
    const prepared = await prepareImageFile(file);
    base64 = await blobToBase64(prepared.file);
    mimeType = GEMINI_SUPPORTED_IMAGE_MIMES.has(prepared.mimeType)
      ? prepared.mimeType
      : 'image/jpeg';
  }

  if (estimateBase64Bytes(base64) > MAX_SCAN_BINARY_BYTES) {
    throw new Error(
      'This file is too large to upload in one scan (over 23 MB). Try compressing or splitting the PDF.'
    );
  }

  options?.onProgress?.({
    detail: 'Reading schedule & study topics…',
    chunkIndex: 1,
    chunkTotal: 1,
  });

  const doScanRequest = async (forceRefresh = false): Promise<Response> => {
    const headers = await authHeadersWithToken(forceRefresh);
    return fetchWithTimeout(
      '/api/scan',
      {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          name: file.name,
          mimeType,
          data: base64,
        }),
      },
      140000,
      options?.signal
    );
  };

  let res = await doScanRequest(false);
  if (res.status === 401) {
    await restoreSessionFromServer();
    res = await doScanRequest(true);
  }

  if (res.status === 413) {
    throw new Error(
      'This file is too large for a single upload. Try compressing the PDF or cropping the photo.'
    );
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      (typeof body.error === 'string' && body.error) ||
        'The document could not be read right now. Please try again.'
    );
  }

  return normalizeScanResponseBody(body);
}

export async function scanCorrelatedFiles(
  files: File[],
  options?: {
    signal?: AbortSignal;
    onProgress?: (detail: string) => void;
    existingExams?: Array<{ subject: string; date: string; type: Exam['type'] }>;
  }
): Promise<ScanDocumentResult> {
  const queue = files.slice(0, 12);
  if (queue.length === 0) {
    throw new Error('Select one or more files first.');
  }

  const adaptiveMaxDim = queue.length > 5 ? 1600 : 1920;
  const encodedFiles: Array<{ name: string; mimeType: string; data: string }> = [];
  let totalBinaryBytes = 0;

  for (let i = 0; i < queue.length; i++) {
    if (options?.signal?.aborted) {
      throw new DOMException('Scan cancelled', 'AbortError');
    }
    const file = queue[i];
    if (file.size === 0) {
      throw new Error(`${file.name || 'One selected file'} is empty.`);
    }
    const kind = classifyScanFileKind(file);
    const isPdf = kind === 'pdf';
    const isText = kind === 'text';

    options?.onProgress?.(`Preparing file ${i + 1} of ${queue.length} (${file.name})…`);

    let mimeType: string;
    let base64: string;
    if (isPdf) {
      mimeType = 'application/pdf';
      base64 = await blobToBase64(file);
    } else if (isText) {
      mimeType = 'text/plain';
      base64 = await blobToBase64(file);
    } else {
      const prepared = await prepareImageFile(file, {
        maxDim: adaptiveMaxDim,
        quality: 0.84,
        skipSizeBytes: 900 * 1024,
      });
      base64 = await blobToBase64(prepared.file);
      mimeType = GEMINI_SUPPORTED_IMAGE_MIMES.has(prepared.mimeType)
        ? prepared.mimeType
        : 'image/jpeg';
    }

    totalBinaryBytes += estimateBase64Bytes(base64);
    if (totalBinaryBytes > MAX_SCAN_BINARY_BYTES) {
      throw new Error(
        'The combined files are over 23 MB. Remove a few pages or compress large PDFs and try again.'
      );
    }

    encodedFiles.push({
      name: file.name || `document_${i + 1}`,
      mimeType,
      data: base64,
    });
  }

  options?.onProgress?.(`Connecting ${encodedFiles.length} files & extracting exams and lessons…`);

  const existingExamsContext = (options?.existingExams || [])
    .filter((ex) => ex.subject?.trim())
    .slice(0, 40)
    .map((ex) => ({
      subject: ex.subject.trim(),
      date: ex.date || '',
      type: ex.type || 'monthly',
    }));

  const doRequest = async (forceRefresh = false): Promise<Response> => {
    const headers = await authHeadersWithToken(forceRefresh);
    return fetchWithTimeout(
      '/api/scan-correlated',
      {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          files: encodedFiles,
          ...(existingExamsContext.length > 0 ? { existingExams: existingExamsContext } : {}),
        }),
      },
      170000,
      options?.signal
    );
  };

  let res = await doRequest(false);
  if (res.status === 401) {
    await restoreSessionFromServer();
    res = await doRequest(true);
  }

  if (res.status === 413) {
    throw new Error(
      'The combined upload exceeded the server size limit. Scan fewer files at once or compress large PDFs.'
    );
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      (typeof body.error === 'string' && body.error) ||
        'Could not connect and scan the selected files right now. Please try again.'
    );
  }

  return normalizeScanResponseBody(body);
}

export async function extractSpotifyUrl(url: string): Promise<SavedMusicTrack> {
  const res = await fetchWithTimeout(
    '/api/spotify/extract',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    },
    14000
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.track) {
    throw new Error(body.error || 'Could not read that Spotify link.');
  }
  return body.track as SavedMusicTrack;
}

export async function resolveFullSpotifyTrack(
  title: string,
  artist?: string,
  durationMs?: number
): Promise<{ videoId: string | null; videoIds: string[] }> {
  const res = await fetchWithTimeout(
    '/api/spotify/resolve-track',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, artist, durationMs }),
    },
    10000
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { videoId: null, videoIds: [] };
  }
  return {
    videoId: typeof body.videoId === 'string' ? body.videoId : null,
    videoIds: Array.isArray(body.videoIds) ? body.videoIds : [],
  };
}

export interface TrackLyricsResult {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  instrumental: boolean;
  trackName?: string;
  artistName?: string;
}

export async function fetchTrackLyrics(payload: {
  title: string;
  artist?: string;
  durationMs?: number;
}): Promise<TrackLyricsResult> {
  try {
    const res = await fetchWithTimeout(
      '/api/spotify/lyrics',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      7500
    );
    if (!res.ok) {
      return { syncedLyrics: null, plainLyrics: null, instrumental: false };
    }
    const body = await res.json().catch(() => ({}));
    return {
      syncedLyrics: typeof body.syncedLyrics === 'string' ? body.syncedLyrics : null,
      plainLyrics: typeof body.plainLyrics === 'string' ? body.plainLyrics : null,
      instrumental: Boolean(body.instrumental),
      trackName: typeof body.trackName === 'string' ? body.trackName : undefined,
      artistName: typeof body.artistName === 'string' ? body.artistName : undefined,
    };
  } catch {
    return { syncedLyrics: null, plainLyrics: null, instrumental: false };
  }
}

// Private Study Chats API
export async function fetchPrivateChats(): Promise<PrivateChatRoom[]> {
  const res = await fetchWithTimeout(
    '/api/chats',
    {
      headers: { 'x-workspace-id': getActiveWorkspaceId() },
      credentials: 'include',
    },
    8000
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not load private chats.');
  }
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body.chats) ? (body.chats as PrivateChatRoom[]) : [];
}

export async function createPrivateChat(payload: {
  schoolName: string;
  grade: string;
  className?: string;
  groupName?: string;
  avatarImage?: string;
  backgroundMusic?: SavedMusicTrack | null;
  theme?: ChatThemeConfig;
}): Promise<PrivateChatRoom> {
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.chat) {
    throw new Error(body.error || 'Could not create private chat.');
  }
  return body.chat as PrivateChatRoom;
}

export async function joinPrivateChat(secretCode: string): Promise<PrivateChatRoom> {
  const res = await fetch('/api/chats/join', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ secretCode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.chat) {
    throw new Error(body.error || 'Could not join chat with that secret code.');
  }
  return body.chat as PrivateChatRoom;
}

export async function updatePrivateChat(
  chatId: string,
  patch: {
    schoolName?: string;
    grade?: string;
    className?: string;
    groupName?: string;
    avatarImage?: string | null;
    backgroundMusic?: SavedMusicTrack | null;
    theme?: ChatThemeConfig;
    regenerateCode?: boolean;
  }
): Promise<PrivateChatRoom> {
  const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.chat) {
    throw new Error(body.error || 'Could not update private chat.');
  }
  return body.chat as PrivateChatRoom;
}

export async function leavePrivateChat(chatId: string): Promise<void> {
  const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/leave`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not leave chat.');
  }
}

export async function sendPrivateChatMessage(
  chatId: string,
  payload: {
    kind: 'exam';
    text?: string;
    exam: SharedExamPayload;
  }
): Promise<PrivateChatRoom> {
  const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.chat) {
    throw new Error(body.error || 'Could not share exam.');
  }
  return body.chat as PrivateChatRoom;
}

export async function respondToSharedExam(
  chatId: string,
  messageId: string,
  decision: ExamDecision
): Promise<{ chat: PrivateChatRoom; addedExam: Exam | null }> {
  const res = await fetch(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/respond`,
    {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'include',
      body: JSON.stringify({ decision }),
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.chat) {
    throw new Error(body.error || 'Could not save your exam response.');
  }
  return {
    chat: body.chat as PrivateChatRoom,
    addedExam: (body.addedExam as Exam | null) || null,
  };
}
