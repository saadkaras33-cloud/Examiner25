import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type {
  AvatarConfig,
  Exam,
  LanguageId,
  LessonItem,
  SavedMusicTrack,
  ThemeId,
  UserProfile,
} from '../types.ts';
import { isValidThemeId } from '../utils/themeIds.ts';
import {
  auth,
  db,
  handleFirestoreError,
  isFirestorePermissionError,
  OperationType,
  waitForAuthStateReady,
} from './firebase.ts';

const VALID_LANGS = new Set<LanguageId>(['en', 'ar', 'genz', 'fr', 'arz']);
const VALID_EXAM_TYPES = new Set([
  'monthly',
  'final',
  'midterm',
  'quiz',
  'practical',
  'oral',
  'other',
]);

const ensuredUids = new Set<string>();

async function getVerifiedUid(): Promise<string | null> {
  await waitForAuthStateReady();
  const user = auth.currentUser;
  if (!user || !user.uid || !user.emailVerified) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  return user.uid;
}

function sanitizeDocId(raw: string): string {
  const clean = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return clean || `doc_${Date.now().toString(36)}`;
}

function sanitizeSavedMusicForFirestore(tracks?: SavedMusicTrack[]): Array<Record<string, unknown>> {
  if (!Array.isArray(tracks)) return [];
  return tracks.slice(0, 100).map((t) => {
    const out: Record<string, unknown> = {
      id: String(t.id || '').slice(0, 120),
      title: String(t.title || 'Track').slice(0, 140),
      subtitle: String(t.subtitle || '').slice(0, 140),
      kind: t.kind === 'custom' ? 'custom' : 'spotify',
    };
    if (t.spotifyKind) out.spotifyKind = t.spotifyKind;
    if (t.spotifyId) out.spotifyId = String(t.spotifyId).slice(0, 80);
    if (t.spotifyUrl) out.spotifyUrl = String(t.spotifyUrl).slice(0, 500);
    if (t.embedUrl) out.embedUrl = String(t.embedUrl).slice(0, 500);
    if (t.audioUrl) out.audioUrl = String(t.audioUrl).slice(0, 500);
    if (t.mimeType) out.mimeType = String(t.mimeType).slice(0, 80);
    if (t.thumbnailUrl) out.thumbnailUrl = String(t.thumbnailUrl).slice(0, 500);
    if (t.previewUrl) out.previewUrl = String(t.previewUrl).slice(0, 500);
    if (typeof t.durationMs === 'number') out.durationMs = t.durationMs;
    if (t.youtubeVideoId) out.youtubeVideoId = String(t.youtubeVideoId).slice(0, 40);
    if (Array.isArray(t.youtubeVideoIds) && t.youtubeVideoIds.length > 0) {
      out.youtubeVideoIds = t.youtubeVideoIds.slice(0, 4).map((v) => String(v).slice(0, 40));
    }
    if (typeof t.matchVersion === 'number') out.matchVersion = t.matchVersion;
    if (Array.isArray(t.tracks) && t.tracks.length > 0) {
      out.tracks = t.tracks.slice(0, 50).map((sub) => {
        const subOut: Record<string, unknown> = {
          title: String(sub.title || 'Track').slice(0, 140),
          artist: String(sub.artist || '').slice(0, 140),
        };
        if (sub.id) subOut.id = String(sub.id).slice(0, 80);
        if (typeof sub.durationMs === 'number') subOut.durationMs = sub.durationMs;
        if (sub.previewUrl) subOut.previewUrl = String(sub.previewUrl).slice(0, 500);
        if (sub.spotifyUrl) subOut.spotifyUrl = String(sub.spotifyUrl).slice(0, 500);
        if (sub.embedUrl) subOut.embedUrl = String(sub.embedUrl).slice(0, 500);
        if (sub.youtubeVideoId) subOut.youtubeVideoId = String(sub.youtubeVideoId).slice(0, 40);
        if (Array.isArray(sub.youtubeVideoIds) && sub.youtubeVideoIds.length > 0) {
          subOut.youtubeVideoIds = sub.youtubeVideoIds.slice(0, 4).map((v) => String(v).slice(0, 40));
        }
        if (typeof sub.matchVersion === 'number') subOut.matchVersion = sub.matchVersion;
        return subOut;
      });
    }
    if (t.savedAt) out.savedAt = String(t.savedAt).slice(0, 40);
    return out;
  });
}

function sanitizeAvatarForFirestore(avatar?: AvatarConfig): Record<string, unknown> | null {
  if (!avatar || typeof avatar !== 'object') return null;
  return JSON.parse(JSON.stringify(avatar)) as Record<string, unknown>;
}

export async function loadFirestoreUserProfile(): Promise<Partial<UserProfile> | null> {
  const uid = await getVerifiedUid();
  if (!uid) return null;
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      ensuredUids.add(uid);
    } else {
      return null;
    }
    const d = snap.data() || {};
    return {
      displayName: typeof d.displayName === 'string' ? d.displayName : undefined,
      photoUrl: typeof d.photoUrl === 'string' ? d.photoUrl : undefined,
      themeId: isValidThemeId(d.themeId) ? (d.themeId as ThemeId) : undefined,
      language: VALID_LANGS.has(d.language) ? (d.language as LanguageId) : undefined,
      avatar: d.avatar && typeof d.avatar === 'object' ? (d.avatar as AvatarConfig) : undefined,
      savedMusic: Array.isArray(d.savedMusic) ? (d.savedMusic as SavedMusicTrack[]) : [],
    };
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      handleFirestoreError(err, OperationType.GET, path);
    }
    return null;
  }
}

export async function saveFirestoreUserProfilePatch(
  baseUser: UserProfile,
  patch: Partial<UserProfile>
): Promise<void> {
  const uid = await getVerifiedUid();
  if (!uid) return;
  const path = `users/${uid}`;
  const docRef = doc(db, 'users', uid);

  try {
    const snap = await getDoc(docRef);
    const merged: UserProfile = { ...baseUser, ...patch };
    const safeTheme = merged.themeId && isValidThemeId(merged.themeId) ? merged.themeId : 'paper';
    const safeLang = merged.language && VALID_LANGS.has(merged.language) ? merged.language : 'en';
    const safeName = String(merged.displayName || merged.email || 'Examiner User')
      .trim()
      .slice(0, 100) || 'Examiner User';

    if (!snap.exists()) {
      const safeEmail = String(merged.email || auth.currentUser?.email || '')
        .trim()
        .slice(0, 200);
      if (safeEmail.length < 3 || !safeEmail.includes('@')) {
        return;
      }
      const createPayload: Record<string, unknown> = {
        ownerId: uid,
        displayName: safeName,
        email: safeEmail,
        themeId: safeTheme,
        language: safeLang,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (merged.photoUrl) createPayload.photoUrl = String(merged.photoUrl).slice(0, 1000);
      const cleanAvatar = sanitizeAvatarForFirestore(merged.avatar);
      if (cleanAvatar) createPayload.avatar = cleanAvatar;
      if (Array.isArray(merged.savedMusic)) {
        createPayload.savedMusic = sanitizeSavedMusicForFirestore(merged.savedMusic);
      }
      await setDoc(docRef, createPayload);
      ensuredUids.add(uid);
      return;
    }

    ensuredUids.add(uid);
    const updatePayload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if ('displayName' in patch) {
      updatePayload.displayName = safeName;
    }
    if ('photoUrl' in patch) {
      updatePayload.photoUrl = merged.photoUrl ? String(merged.photoUrl).slice(0, 1000) : null;
    }
    if ('themeId' in patch) {
      updatePayload.themeId = safeTheme;
    }
    if ('language' in patch) {
      updatePayload.language = safeLang;
    }
    if ('avatar' in patch) {
      updatePayload.avatar = sanitizeAvatarForFirestore(patch.avatar);
    }
    if ('savedMusic' in patch) {
      updatePayload.savedMusic = sanitizeSavedMusicForFirestore(patch.savedMusic);
    }

    if (Object.keys(updatePayload).length > 1) {
      await updateDoc(docRef, updatePayload);
    }
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
}

export async function ensureFirestoreUserDocument(user: UserProfile): Promise<boolean> {
  const uid = await getVerifiedUid();
  if (!uid) return false;
  if (ensuredUids.has(uid)) return true;
  const path = `users/${uid}`;
  const docRef = doc(db, 'users', uid);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await saveFirestoreUserProfilePatch(user, {});
      return ensuredUids.has(uid);
    }
    ensuredUids.add(uid);
    return true;
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      handleFirestoreError(err, OperationType.GET, path);
    }
    return false;
  }
}

export async function loadFirestoreExams(): Promise<Exam[]> {
  const uid = await getVerifiedUid();
  if (!uid) return [];
  const path = `users/${uid}/exams`;
  try {
    const q = query(collection(db, path), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        subject: String(data.subject || ''),
        type: (data.type as Exam['type']) || 'other',
        date: String(data.date || ''),
        startTime: String(data.startTime || ''),
        endTime: String(data.endTime || ''),
        room: String(data.room || ''),
        material: String(data.material || ''),
        topics: Array.isArray(data.topics) ? data.topics.map(String) : [],
        notes: String(data.notes || ''),
        sourceChatKey: typeof data.sourceChatKey === 'string' ? data.sourceChatKey : undefined,
      };
    });
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
    return [];
  }
}

export async function saveFirestoreExam(user: UserProfile, exam: Exam): Promise<void> {
  const uid = await getVerifiedUid();
  if (!uid) return;
  const examId = sanitizeDocId(exam.id);
  const path = `users/${uid}/exams/${examId}`;
  try {
    const ready = await ensureFirestoreUserDocument(user);
    if (!ready) return;
    const ref = doc(db, 'users', uid, 'exams', examId);
    const snap = await getDoc(ref);
    const topics = Array.isArray(exam.topics)
      ? exam.topics.slice(0, 50).map((t) => String(t).slice(0, 120)).filter(Boolean)
      : [];
    const safeType = VALID_EXAM_TYPES.has(exam.type) ? exam.type : 'other';

    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        subject: String(exam.subject || 'Untitled exam').slice(0, 200),
        type: safeType,
        date: String(exam.date || '').slice(0, 20),
        startTime: String(exam.startTime || '').slice(0, 10),
        endTime: String(exam.endTime || '').slice(0, 10),
        room: String(exam.room || '').slice(0, 120),
        material: String(exam.material || '').slice(0, 500),
        topics,
        notes: String(exam.notes || '').slice(0, 1000),
        sourceChatKey: exam.sourceChatKey ? String(exam.sourceChatKey).slice(0, 160) : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        subject: String(exam.subject || 'Untitled exam').slice(0, 200),
        type: safeType,
        date: String(exam.date || '').slice(0, 20),
        startTime: String(exam.startTime || '').slice(0, 10),
        endTime: String(exam.endTime || '').slice(0, 10),
        room: String(exam.room || '').slice(0, 120),
        material: String(exam.material || '').slice(0, 500),
        topics,
        notes: String(exam.notes || '').slice(0, 1000),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
}

export async function saveFirestoreExamsBatch(user: UserProfile, exams: Exam[]): Promise<void> {
  if (exams.length === 0) return;
  const uid = await getVerifiedUid();
  if (!uid) return;
  const ready = await ensureFirestoreUserDocument(user);
  if (!ready) return;
  for (const ex of exams) {
    await saveFirestoreExam(user, ex);
  }
}

export async function deleteFirestoreExam(examId: string): Promise<void> {
  const uid = await getVerifiedUid();
  if (!uid) return;
  const safeId = sanitizeDocId(examId);
  const path = `users/${uid}/exams/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'exams', safeId));
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }
}

export async function loadFirestoreLessons(): Promise<LessonItem[]> {
  const uid = await getVerifiedUid();
  if (!uid) return [];
  const path = `users/${uid}/lessons`;
  try {
    const q = query(collection(db, path), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        subject: String(data.subject || 'General'),
        title: String(data.title || ''),
        notes: String(data.notes || ''),
        completed: Boolean(data.completed),
        examId: typeof data.examId === 'string' ? data.examId : undefined,
      };
    });
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
    return [];
  }
}

export async function saveFirestoreLesson(user: UserProfile, lesson: LessonItem): Promise<void> {
  const uid = await getVerifiedUid();
  if (!uid) return;
  const lessonId = sanitizeDocId(lesson.id);
  const path = `users/${uid}/lessons/${lessonId}`;
  try {
    const ready = await ensureFirestoreUserDocument(user);
    if (!ready) return;
    const ref = doc(db, 'users', uid, 'lessons', lessonId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        subject: String(lesson.subject || 'General').slice(0, 200),
        title: String(lesson.title || 'Lesson').slice(0, 300),
        notes: String(lesson.notes || '').slice(0, 1000),
        completed: Boolean(lesson.completed),
        examId: lesson.examId ? String(lesson.examId).slice(0, 128) : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        subject: String(lesson.subject || 'General').slice(0, 200),
        title: String(lesson.title || 'Lesson').slice(0, 300),
        notes: String(lesson.notes || '').slice(0, 1000),
        completed: Boolean(lesson.completed),
        examId: lesson.examId ? String(lesson.examId).slice(0, 128) : null,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
}

export async function saveFirestoreLessonsBatch(
  user: UserProfile,
  lessons: LessonItem[]
): Promise<void> {
  if (lessons.length === 0) return;
  const uid = await getVerifiedUid();
  if (!uid) return;
  const ready = await ensureFirestoreUserDocument(user);
  if (!ready) return;
  for (const ls of lessons) {
    await saveFirestoreLesson(user, ls);
  }
}

export async function deleteFirestoreLesson(lessonId: string): Promise<void> {
  const uid = await getVerifiedUid();
  if (!uid) return;
  const safeId = sanitizeDocId(lessonId);
  const path = `users/${uid}/lessons/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'lessons', safeId));
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }
}
