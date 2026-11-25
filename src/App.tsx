import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import {
  BookCheck,
  Calendar,
  CalendarRange,
  FileScan,
  GraduationCap,
  Menu,
  MessageSquarePlus,
  Plus,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import type {
  AvatarConfig,
  Exam,
  ExamInput,
  LanguageId,
  LessonInput,
  LessonItem,
  PrivateChatRoom,
  SavedMusicTrack,
  ThemeId,
  UserProfile,
} from './types.ts';
import {
  dedupeTopicList,
  formatIsoDate,
  isExamFinished,
  isLikelyDuplicateSubject,
  isMajorExamType,
  isSameLessonTopic,
  lessonMatchesTopicOrSplit,
  sortExams,
  splitMultiLessonText,
} from './utils/exams.ts';
import { getSavedThemeId } from './utils/themes.ts';
import {
  applyPosterThemePalette,
  extractPosterPalette,
  type PosterPalette,
} from './utils/posterPalette.ts';
import { LanguageProvider, useTranslation } from './utils/i18n.tsx';
import {
  getSavedSpotifyTracks,
  setSavedSpotifyTracks,
} from './utils/musicStorage.ts';
import { useStudyAudioController } from './utils/useStudyAudioController.ts';
import {
  clearMajorScanDrafts,
  clearScanDrafts,
  createExam,
  createLesson,
  createManyExams,
  createManyLessons,
  deleteExam,
  deleteLesson,
  fetchExams,
  fetchLessons,
  fetchSavedMusicFromServer,
  getActiveWorkspaceId,
  getCachedExams,
  getCachedLessons,
  getStoredUser,
  logInWithGoogleToken,
  restoreSessionFromServer,
  saveMusicToServer,
  setCachedExams,
  setCachedLessons,
  signOutAccount,
  updateExam,
  updateLesson,
  updateUserProfile,
} from './services/api.ts';
import { auth, consumeGoogleRedirectResult } from './services/firebase.ts';
import LandingPage from './components/LandingPage.tsx';
import GoogleSignInHandoffView from './components/GoogleSignInHandoffView.tsx';
import ExamModal from './components/ExamModal.tsx';
import AuthModal from './components/AuthModal.tsx';
import AvatarSvg from './components/AvatarSvg.tsx';
import AvatarGeneratorModal from './components/AvatarGeneratorModal.tsx';
import MusicPlayer from './components/MusicPlayer.tsx';
import LanguagePicker from './components/LanguagePicker.tsx';
import NewPrivateChatModal from './components/NewPrivateChatModal.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import SpotifyDynamicIsland from './components/SpotifyDynamicIsland.tsx';
import ThemePicker from './components/ThemePicker.tsx';
import TodayPage from './pages/TodayPage.tsx';
import MonthPage from './pages/MonthPage.tsx';
import MajorExamsPage from './pages/MajorExamsPage.tsx';
import StudyPage from './pages/StudyPage.tsx';
import ScanPage from './pages/ScanPage.tsx';
import ChatsPage from './pages/ChatsPage.tsx';

function mergeMusicTrackLists(
  primary: SavedMusicTrack[],
  secondary: SavedMusicTrack[]
): SavedMusicTrack[] {
  const seenIds = new Set<string>();
  const seenEmbeds = new Set<string>();
  const merged: SavedMusicTrack[] = [];
  for (const item of [...primary, ...secondary]) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    if (seenIds.has(item.id)) continue;
    if (item.embedUrl && seenEmbeds.has(item.embedUrl)) continue;
    seenIds.add(item.id);
    if (item.embedUrl) seenEmbeds.add(item.embedUrl);
    merged.push(item);
  }
  return merged;
}

function getInitials(user: UserProfile): string {
  const source = (user.displayName || user.email || '').split('@')[0];
  const parts = source
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'ME';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function ExaminerWorkspace() {
  const { setLang, t } = useTranslation();

  const [user, setUser] = useState<UserProfile | null>(() => getStoredUser());
  const workspaceId = user?.id || getActiveWorkspaceId();

  const [exams, setExams] = useState<Exam[]>(() =>
    getCachedExams().filter((ex) => !isExamFinished(ex))
  );
  const [lessons, setLessons] = useState<LessonItem[]>(() => getCachedLessons());
  const [savedSpotifyTracks, setSavedSpotifyTracksState] = useState<SavedMusicTrack[]>(() => {
    const stored = getStoredUser();
    if (stored?.savedMusic && stored.savedMusic.length > 0) return stored.savedMusic;
    return getSavedSpotifyTracks(stored?.id || getActiveWorkspaceId());
  });

  const [loading, setLoading] = useState(() => Boolean(getStoredUser()));
  const [error, setError] = useState<string | null>(null);
  const [modalExam, setModalExam] = useState<{ exam: Partial<Exam> | null } | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalView, setAuthModalView] = useState<'signup' | 'login' | 'account'>('signup');
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dynamicIslandHidden, setDynamicIslandHidden] = useState(false);
  const [dynamicIslandForceExpand, setDynamicIslandForceExpand] = useState(0);

  const [privateChats, setPrivateChats] = useState<PrivateChatRoom[]>([]);
  const [chatModalState, setChatModalState] = useState<{
    open: boolean;
    editing: PrivateChatRoom | null;
  }>({ open: false, editing: null });
  const [themeId, setThemeId] = useState<ThemeId>(
    () => getStoredUser()?.themeId || getSavedThemeId()
  );
  const [posterPalette, setPosterPalette] = useState<PosterPalette | null>(null);

  const userRef = useRef(user);
  userRef.current = user;
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;
  const savedSpotifyTracksRef = useRef(savedSpotifyTracks);
  savedSpotifyTracksRef.current = savedSpotifyTracks;

  const navigate = useNavigate();

  const navItems = useMemo(
    () => [
      { to: '/', label: t('navToday'), mobileLabel: t('navToday'), icon: GraduationCap },
      { to: '/calendar', label: t('navMonth'), mobileLabel: t('navMonth'), icon: Calendar },
      { to: '/assessments', label: t('navAssessments'), mobileLabel: t('navAssessments'), icon: CalendarRange },
      { to: '/study', label: t('navStudy'), mobileLabel: t('navStudy'), icon: BookCheck },
      { to: '/scan', label: t('navScan'), mobileLabel: t('navScan'), icon: FileScan },
      { to: '/chats', label: t('navChats'), mobileLabel: t('navChats'), icon: Users },
    ],
    [t]
  );

  useEffect(() => {
    applyPosterThemePalette(posterPalette, themeId);
  }, [posterPalette, themeId]);

  const applyUserSession = useCallback(
    (nextUser: UserProfile) => {
      setUser(nextUser);
      if (nextUser.themeId) {
        setThemeId(nextUser.themeId);
      }
      if (nextUser.language) {
        setLang(nextUser.language);
      }
      const wsId = nextUser.id || getActiveWorkspaceId();
      const localSaved = getSavedSpotifyTracks(wsId);
      const mergedMusic = mergeMusicTrackLists(nextUser.savedMusic || [], localSaved);
      savedSpotifyTracksRef.current = mergedMusic;
      setSavedSpotifyTracksState(mergedMusic);
      setSavedSpotifyTracks(wsId, mergedMusic);
      setExams(getCachedExams().filter((ex) => !isExamFinished(ex)));
      setLessons(getCachedLessons());
    },
    [setLang]
  );

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/google-signin') {
      return;
    }
    let active = true;
    (async () => {
      try {
        const redirectResult = await consumeGoogleRedirectResult();
        if (!active) return;
        if (redirectResult?.idToken) {
          const nextUser = await logInWithGoogleToken(redirectResult.idToken);
          if (!active) return;
          applyUserSession(nextUser);
          return;
        }
      } catch {
        // Fall through to normal session restoration if redirect exchange failed
      }

      const restored = await restoreSessionFromServer();
      if (!active) return;
      if (restored) {
        applyUserSession(restored);
      } else {
        setUser(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyUserSession]);

  useEffect(() => {
    if (user && (!loading || exams.length > 0)) {
      setCachedExams(exams);
    }
  }, [user, loading, exams]);

  useEffect(() => {
    if (user && (!loading || lessons.length > 0)) {
      setCachedLessons(lessons);
    }
  }, [user, loading, lessons]);

  const loadWorkspaceData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [examList, lessonList, serverMusic] = await Promise.all([
        fetchExams(),
        fetchLessons(),
        fetchSavedMusicFromServer(),
      ]);
      const todayIso = formatIsoDate(new Date());
      const cleanedExams: Exam[] = [];
      for (const ex of examList) {
        if (isExamFinished(ex, todayIso)) {
          void deleteExam(ex.id).catch(() => {});
          continue;
        }
        const rawTopics = Array.isArray(ex.topics) ? ex.topics : [];
        const cleanTopics = dedupeTopicList(rawTopics).slice(0, 50);
        const changed =
          cleanTopics.length !== rawTopics.length ||
          cleanTopics.some((tp, idx) => tp !== rawTopics[idx]);
        if (changed) {
          cleanedExams.push({ ...ex, topics: cleanTopics });
          void updateExam(ex.id, { ...ex, topics: cleanTopics }).catch(() => {});
        } else {
          cleanedExams.push(ex);
        }
      }

      // Clean up any legacy combined multi-lesson rows or exact duplicate lessons in the same subject
      const keptLessons: LessonItem[] = [];
      const lessonsToDelete: string[] = [];
      const lessonsToCreate: LessonInput[] = [];
      const lessonsToPatch: Array<{ id: string; completed: boolean }> = [];

      const findKeptMatch = (subject: string, title: string) =>
        keptLessons.find(
          (k) =>
            isLikelyDuplicateSubject(k.subject, subject) &&
            isSameLessonTopic(k.title, title)
        );

      // Process single-lesson entries first so combined legacy rows merge cleanly into existing singles
      const orderedLessons = [...lessonList].sort((a, b) => {
        const aLen = splitMultiLessonText(a.title).length;
        const bLen = splitMultiLessonText(b.title).length;
        return aLen - bLen;
      });

      for (const lesson of orderedLessons) {
        const parts = splitMultiLessonText(lesson.title);
        if (parts.length <= 1) {
          const singleTitle = parts[0] || lesson.title.trim();
          if (!singleTitle) {
            lessonsToDelete.push(lesson.id);
            continue;
          }
          const existing = findKeptMatch(lesson.subject, singleTitle);
          if (existing) {
            if (lesson.completed && !existing.completed) {
              existing.completed = true;
              lessonsToPatch.push({ id: existing.id, completed: true });
            }
            lessonsToDelete.push(lesson.id);
          } else {
            keptLessons.push(lesson);
          }
        } else {
          lessonsToDelete.push(lesson.id);
          for (const part of parts) {
            const existing = findKeptMatch(lesson.subject, part);
            if (existing) {
              if (lesson.completed && !existing.completed) {
                existing.completed = true;
                lessonsToPatch.push({ id: existing.id, completed: true });
              }
            } else {
              const alreadyQueued = lessonsToCreate.find(
                (q) =>
                  isLikelyDuplicateSubject(q.subject, lesson.subject) &&
                  isSameLessonTopic(q.title, part)
              );
              if (!alreadyQueued) {
                lessonsToCreate.push({
                  subject: lesson.subject || 'General',
                  title: part,
                  notes: lesson.notes || '',
                  examId: lesson.examId,
                });
              }
            }
          }
        }
      }

      let finalLessons = keptLessons;
      if (lessonsToDelete.length > 0 || lessonsToCreate.length > 0 || lessonsToPatch.length > 0) {
        for (const p of lessonsToPatch) {
          void updateLesson(p.id, { completed: p.completed }).catch(() => {});
        }
        for (const delId of lessonsToDelete) {
          void deleteLesson(delId).catch(() => {});
        }
        if (lessonsToCreate.length > 0) {
          try {
            const created = await createManyLessons(lessonsToCreate);
            finalLessons = [...keptLessons, ...created];
          } catch {
            finalLessons = keptLessons;
          }
        }
      }

      setExams(cleanedExams);
      setLessons(finalLessons);
      const wsId = workspaceIdRef.current;
      const localMusic = getSavedSpotifyTracks(wsId);
      const profileMusic = userRef.current?.savedMusic || [];
      const mergedMusic = mergeMusicTrackLists(
        mergeMusicTrackLists(serverMusic, localMusic),
        profileMusic
      );
      if (mergedMusic.length > 0 || serverMusic.length > 0) {
        savedSpotifyTracksRef.current = mergedMusic;
        setSavedSpotifyTracksState(mergedMusic);
        setSavedSpotifyTracks(wsId, mergedMusic);
        setUser((prev) => (prev ? { ...prev, savedMusic: mergedMusic } : prev));
        if (mergedMusic.length > serverMusic.length && userRef.current) {
          void saveMusicToServer(mergedMusic);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  const userId = user?.id;

  useEffect(() => {
    if (userId) {
      loadWorkspaceData();
    } else {
      setLoading(false);
    }
  }, [userId, loadWorkspaceData]);

  // Re-sync Cloud Firestore exams & lessons once Firebase Auth hydrates asynchronously
  useEffect(() => {
    if (!userId) return;
    let lastUid = auth.currentUser?.uid || null;
    const unsubscribe = auth.onAuthStateChanged((fbUser) => {
      const nextUid = fbUser?.uid || null;
      if (nextUid && nextUid !== lastUid) {
        lastUid = nextUid;
        void loadWorkspaceData();
      }
    });
    return () => unsubscribe();
  }, [userId, loadWorkspaceData]);

  useEffect(() => {
    const pruneFinishedExams = () => {
      const todayIso = formatIsoDate(new Date());
      setExams((prev) => {
        const expired = prev.filter((ex) => isExamFinished(ex, todayIso));
        if (expired.length === 0) return prev;
        for (const ex of expired) {
          void deleteExam(ex.id).catch(() => {});
        }
        return prev.filter((ex) => !isExamFinished(ex, todayIso));
      });
    };

    pruneFinishedExams();
    const timer = window.setInterval(pruneFinishedExams, 60000);
    const onFocusOrVisible = () => {
      if (document.visibilityState !== 'hidden') {
        pruneFinishedExams();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, []);

  const sortedExams = useMemo(
    () => sortExams(exams.filter((ex) => !isExamFinished(ex))),
    [exams]
  );

  function handleSelectTheme(nextTheme: ThemeId) {
    setThemeId(nextTheme);
    if (user) {
      updateUserProfile({ themeId: nextTheme }, user).then((updated) => {
        if (updated) setUser(updated);
      });
    }
  }

  function handleSelectLanguage(nextLang: LanguageId) {
    setLang(nextLang);
    if (user) {
      updateUserProfile({ language: nextLang }, user).then((updated) => {
        if (updated) setUser(updated);
      });
    }
  }

  const handleSaveSpotifyTracks = useCallback(
    (updater: SavedMusicTrack[] | ((prev: SavedMusicTrack[]) => SavedMusicTrack[])) => {
      const rawNext =
        typeof updater === 'function' ? updater(savedSpotifyTracksRef.current) : updater;
      const next = mergeMusicTrackLists(rawNext, []);
      savedSpotifyTracksRef.current = next;
      setSavedSpotifyTracksState(next);
      setSavedSpotifyTracks(workspaceIdRef.current, next);
      setUser((prev) => (prev ? { ...prev, savedMusic: next } : prev));
      if (userRef.current) {
        void saveMusicToServer(next);
      }
    },
    []
  );

  const audio = useStudyAudioController(workspaceId, savedSpotifyTracks, handleSaveSpotifyTracks);
  const activePosterUrl = audio.currentTrack?.thumbnailUrl || '';

  useEffect(() => {
    if (!activePosterUrl) {
      setPosterPalette(null);
      return;
    }
    let cancelled = false;
    extractPosterPalette(activePosterUrl)
      .then((pal) => {
        if (!cancelled) {
          setPosterPalette(pal);
        }
      })
      .catch(() => {
        if (!cancelled) setPosterPalette(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activePosterUrl]);

  // Passive keep-alive so long-idle tabs stay authenticated without forcing sign-out
  useEffect(() => {
    if (!user?.id) return;
    let lastCheck = Date.now();
    const keepAlive = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastCheck < 90000) return;
      lastCheck = now;
      void restoreSessionFromServer();
    };
    window.addEventListener('focus', keepAlive);
    document.addEventListener('visibilitychange', keepAlive);
    return () => {
      window.removeEventListener('focus', keepAlive);
      document.removeEventListener('visibilitychange', keepAlive);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  const handleSaveExtractedSpotifyTrack = useCallback(
    (track: SavedMusicTrack) => {
      handleSaveSpotifyTracks((prev) => [
        track,
        ...prev.filter((item) => item.id !== track.id && item.embedUrl !== track.embedUrl),
      ]);
    },
    [handleSaveSpotifyTracks]
  );

  function handleAuthSuccess(nextUser: UserProfile) {
    applyUserSession(nextUser);
    setAuthModalOpen(false);
  }

  async function handleSignOut() {
    clearScanDrafts();
    clearMajorScanDrafts();
    await signOutAccount(userRef.current);
    setPosterPalette(null);
    setExams([]);
    setLessons([]);
    setPrivateChats([]);
    savedSpotifyTracksRef.current = [];
    setSavedSpotifyTracksState([]);
    setUser(null);
    setAuthModalView('login');
  }

  async function handleSaveAvatar(config: AvatarConfig) {
    const updated = await updateUserProfile({ avatar: config }, userRef.current);
    if (!updated) {
      throw new Error('Could not save avatar to profile.');
    }
    setUser(updated);
  }

  async function handleSaveExam(payload: ExamInput, existingId?: string) {
    const cleanTopics = Array.isArray(payload.topics)
      ? dedupeTopicList(payload.topics).slice(0, 50)
      : [];
    let savedExam: Exam;
    let previousTopics: string[] = [];
    if (existingId) {
      const prevExam = exams.find((item) => item.id === existingId);
      previousTopics = Array.isArray(prevExam?.topics) ? prevExam.topics : [];
      savedExam = await updateExam(existingId, { ...payload, topics: cleanTopics });
      setExams((prev) => prev.map((item) => (item.id === existingId ? savedExam : item)));
    } else {
      savedExam = await createExam({ ...payload, topics: cleanTopics });
      setExams((prev) => [...prev, savedExam]);
    }

    const topicsToSync = cleanTopics.filter((topic) => {
      const wasAlreadyOnExam = previousTopics.some((pt) => lessonMatchesTopicOrSplit(pt, topic));
      if (existingId && wasAlreadyOnExam) return false;
      return !lessons.some(
        (l) =>
          (l.examId === savedExam.id || isLikelyDuplicateSubject(l.subject, savedExam.subject)) &&
          lessonMatchesTopicOrSplit(l.title, topic)
      );
    });
    if (topicsToSync.length > 0) {
      try {
        const createdLessons = await createManyLessons(
          topicsToSync.map((title) => ({
            subject: savedExam.subject || 'General',
            title,
            notes: savedExam.material ? `Material: ${savedExam.material}` : '',
            examId: savedExam.id,
          }))
        );
        setLessons((prev) => [...prev, ...createdLessons]);
      } catch {
        // Keep saved exam even if syncing helper checklist entries fails
      }
    }
  }

  async function handleDeleteExam(id: string) {
    await deleteExam(id);
    setExams((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleToggleLesson(lesson: LessonItem) {
    const updated = await updateLesson(lesson.id, { completed: !lesson.completed });
    setLessons((prev) => prev.map((item) => (item.id === lesson.id ? updated : item)));
  }

  async function handleAddLesson(input: LessonInput) {
    const subject = (input.subject || 'General').trim() || 'General';
    const parts = splitMultiLessonText(input.title);
    const itemsToAdd = (parts.length > 0 ? parts : [input.title.trim()]).filter(Boolean);
    if (itemsToAdd.length === 0) return;

    const toCreate: LessonInput[] = [];
    for (const partTitle of itemsToAdd) {
      const existsInChecklist = lessons.some(
        (l) =>
          isLikelyDuplicateSubject(l.subject, subject) &&
          lessonMatchesTopicOrSplit(l.title, partTitle)
      );
      if (existsInChecklist) continue;
      if (toCreate.some((q) => isSameLessonTopic(q.title, partTitle))) continue;

      let resolvedExamId = input.examId;
      if (!resolvedExamId) {
        const topicMatchedExam = exams.find(
          (ex) =>
            isLikelyDuplicateSubject(ex.subject, subject) &&
            (ex.topics || []).some((tp) => isSameLessonTopic(tp, partTitle))
        );
        const unscopedMatches = exams.filter(
          (ex) =>
            isLikelyDuplicateSubject(ex.subject, subject) &&
            (!Array.isArray(ex.topics) || ex.topics.length === 0)
        );
        resolvedExamId =
          topicMatchedExam?.id ||
          (unscopedMatches.length === 1 ? unscopedMatches[0].id : undefined);
      }

      toCreate.push({
        subject,
        title: partTitle,
        notes: (input.notes || '').trim(),
        examId: resolvedExamId,
      });
    }

    if (toCreate.length > 0) {
      const createdList =
        toCreate.length === 1
          ? [await createLesson(toCreate[0])]
          : await createManyLessons(toCreate);
      setLessons((prev) => [...prev, ...createdList]);
    }

    // If explicitly linked to an exam, also ensure all added parts appear in that exam's included topics
    if (input.examId) {
      const targetExam = exams.find((ex) => ex.id === input.examId);
      if (targetExam) {
        const mergedTopics = dedupeTopicList([
          ...(Array.isArray(targetExam.topics) ? targetExam.topics : []),
          ...itemsToAdd,
        ]).slice(0, 50);
        const existingTopics = Array.isArray(targetExam.topics) ? targetExam.topics : [];
        const changed =
          mergedTopics.length !== existingTopics.length ||
          mergedTopics.some((tp, idx) => tp !== existingTopics[idx]);
        if (changed) {
          try {
            const updatedExam = await updateExam(targetExam.id, {
              ...targetExam,
              topics: mergedTopics,
            });
            setExams((prev) => prev.map((ex) => (ex.id === targetExam.id ? updatedExam : ex)));
          } catch {
            // Ignore secondary topic backfill error
          }
        }
      }
    }
  }

  async function handleDeleteLesson(id: string) {
    await deleteLesson(id);
    setLessons((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleSaveBatch(payload: { exams: ExamInput[]; lessons: LessonInput[] }) {
    // Expand and deduplicate incoming lessons so combined entries never duplicate single lessons
    const normalizedBatchLessons: LessonInput[] = [];
    for (const lesson of payload.lessons) {
      const subject = (lesson.subject || 'General').trim() || 'General';
      for (const part of splitMultiLessonText(lesson.title)) {
        const dupInBatch = normalizedBatchLessons.some(
          (cur) =>
            isLikelyDuplicateSubject(cur.subject, subject) &&
            isSameLessonTopic(cur.title, part)
        );
        if (!dupInBatch) {
          normalizedBatchLessons.push({
            ...lesson,
            subject,
            title: part,
          });
        }
      }
    }

    // Enrich exams that didn't receive explicit topics using matching lessons in the same batch
    const enrichedExams: ExamInput[] = payload.exams.map((ex) => {
      const currentTopics = dedupeTopicList(ex.topics || []).slice(0, 50);
      if (currentTopics.length > 0) {
        return { ...ex, topics: currentTopics };
      }
      const sameSubjectCount = payload.exams.filter((other) =>
        isLikelyDuplicateSubject(other.subject, ex.subject)
      ).length;
      if (sameSubjectCount === 1) {
        const matchedTopics = dedupeTopicList(
          normalizedBatchLessons
            .filter((l) => isLikelyDuplicateSubject(l.subject, ex.subject) && l.title.trim())
            .map((l) => l.title.trim())
        ).slice(0, 50);
        if (matchedTopics.length > 0) {
          return { ...ex, topics: matchedTopics };
        }
      }
      return ex;
    });

    const examsToCreate: ExamInput[] = [];
    const examsToUpdate: Array<{ existing: Exam; incoming: ExamInput }> = [];

    for (const ex of enrichedExams) {
      const match = exams.find(
        (existing) =>
          existing.date === ex.date &&
          isLikelyDuplicateSubject(existing.subject, ex.subject) &&
          (existing.type === ex.type ||
            (isMajorExamType(existing.type) && isMajorExamType(ex.type)))
      );
      if (match) {
        examsToUpdate.push({ existing: match, incoming: ex });
      } else {
        examsToCreate.push(ex);
      }
    }

    const updatedExams: Exam[] = [];
    const updatedMap = new Map<string, Exam>();
    for (const { existing, incoming } of examsToUpdate) {
      const mergedTopics = dedupeTopicList([
        ...(Array.isArray(existing.topics) ? existing.topics : []),
        ...(incoming.topics || []),
      ]).slice(0, 50);
      const existingMat = (existing.material || '').trim();
      const incomingMat = (incoming.material || '').trim();
      const mergedMaterial =
        incomingMat && !existingMat
          ? incomingMat
          : incomingMat && !existingMat.toLowerCase().includes(incomingMat.toLowerCase())
          ? `${existingMat} · ${incomingMat}`
          : existingMat;

      const existingNotes = (existing.notes || '').trim();
      const incomingNotes = (incoming.notes || '').trim();
      const mergedNotes =
        incomingNotes && !existingNotes
          ? incomingNotes
          : incomingNotes && !existingNotes.toLowerCase().includes(incomingNotes.toLowerCase())
          ? `${existingNotes}\n${incomingNotes}`
          : existingNotes;

      const mergedPayload: ExamInput = {
        subject: existing.subject || incoming.subject,
        type: existing.type === 'other' ? incoming.type : existing.type,
        date: existing.date || incoming.date,
        startTime: existing.startTime || incoming.startTime,
        endTime: existing.endTime || incoming.endTime,
        room: existing.room || incoming.room,
        material: mergedMaterial,
        topics: mergedTopics,
        notes: mergedNotes,
      };
      const updated = await updateExam(existing.id, mergedPayload);
      updatedExams.push(updated);
      updatedMap.set(updated.id, updated);
    }

    let createdExams: Exam[] = [];
    if (examsToCreate.length > 0) {
      createdExams = await createManyExams(examsToCreate);
    }

    if (createdExams.length > 0 || updatedMap.size > 0) {
      setExams((prev) => [
        ...prev.map((ex) => updatedMap.get(ex.id) || ex),
        ...createdExams,
      ]);
    }

    const newLessonsOnly = normalizedBatchLessons.filter(
      (lesson) =>
        !lessons.some(
          (existing) =>
            isLikelyDuplicateSubject(existing.subject, lesson.subject) &&
            lessonMatchesTopicOrSplit(existing.title, lesson.title)
        )
    );

    if (newLessonsOnly.length > 0) {
      const examPool = [
        ...createdExams,
        ...updatedExams,
        ...exams.map((ex) => updatedMap.get(ex.id) || ex),
      ];
      const existingTopicsToAdd = new Map<string, string[]>();

      const linkedLessons: LessonInput[] = newLessonsOnly.map((lesson) => {
        if (lesson.examId) return lesson;
        const topicMatch =
          createdExams.find(
            (ex) =>
              isLikelyDuplicateSubject(ex.subject, lesson.subject) &&
              (ex.topics || []).some((topic) => isSameLessonTopic(topic, lesson.title))
          ) ||
          updatedExams.find(
            (ex) =>
              isLikelyDuplicateSubject(ex.subject, lesson.subject) &&
              (ex.topics || []).some((topic) => isSameLessonTopic(topic, lesson.title))
          ) ||
          examPool.find(
            (ex) =>
              isLikelyDuplicateSubject(ex.subject, lesson.subject) &&
              (ex.topics || []).some((topic) => isSameLessonTopic(topic, lesson.title))
          );
        const unguardedSubjectMatch =
          createdExams.find(
            (ex) =>
              isLikelyDuplicateSubject(ex.subject, lesson.subject) &&
              (!Array.isArray(ex.topics) || ex.topics.length === 0)
          ) ||
          updatedExams.find(
            (ex) =>
              isLikelyDuplicateSubject(ex.subject, lesson.subject) &&
              (!Array.isArray(ex.topics) || ex.topics.length === 0)
          ) ||
          examPool.find(
            (ex) =>
              isLikelyDuplicateSubject(ex.subject, lesson.subject) &&
              (!Array.isArray(ex.topics) || ex.topics.length === 0)
          );
        const subjectMatch = topicMatch || unguardedSubjectMatch;

        if (subjectMatch && lesson.title.trim()) {
          const isCreatedExam = createdExams.some((c) => c.id === subjectMatch.id);
          const hasExplicitScope =
            Array.isArray(subjectMatch.topics) && subjectMatch.topics.length > 0;
          if (!isCreatedExam && !hasExplicitScope) {
            const existingTopics = Array.isArray(subjectMatch.topics) ? subjectMatch.topics : [];
            const alreadyInExam = existingTopics.some((tp) => isSameLessonTopic(tp, lesson.title));
            if (!alreadyInExam) {
              const bucket = existingTopicsToAdd.get(subjectMatch.id) || [];
              if (!bucket.some((tp) => isSameLessonTopic(tp, lesson.title))) {
                bucket.push(lesson.title.trim());
                existingTopicsToAdd.set(subjectMatch.id, bucket);
              }
            }
          }
        }
        return subjectMatch ? { ...lesson, examId: subjectMatch.id } : lesson;
      });
      const createdLessons = await createManyLessons(linkedLessons);
      setLessons((prev) => [...prev, ...createdLessons]);

      // Sync newly attached lesson titles back into existing matching exam cards
      if (existingTopicsToAdd.size > 0) {
        const backfilledMap = new Map<string, Exam>();
        for (const [examId, newTopics] of existingTopicsToAdd.entries()) {
          const target = examPool.find((ex) => ex.id === examId);
          if (!target) continue;
          const mergedTopics = Array.from(
            new Set([...(Array.isArray(target.topics) ? target.topics : []), ...newTopics])
          ).slice(0, 50);
          try {
            const updated = await updateExam(examId, { ...target, topics: mergedTopics });
            backfilledMap.set(examId, updated);
          } catch {
            // Keep created lessons even if topic backfill update fails
          }
        }
        if (backfilledMap.size > 0) {
          setExams((prev) => prev.map((ex) => backfilledMap.get(ex.id) || ex));
        }
      }
    }
  }

  const handleExamAddedFromChat = useCallback((exam: Exam) => {
    setExams((prev) => {
      if (prev.some((e) => e.id === exam.id)) return prev;
      return [...prev, exam];
    });
  }, []);

  const handleChatCreatedOrUpdated = useCallback(
    (chat: PrivateChatRoom) => {
      setPrivateChats((prev) => {
        const idx = prev.findIndex((c) => c.id === chat.id);
        if (idx === -1) return [chat, ...prev];
        const next = [...prev];
        next[idx] = chat;
        return next;
      });
      navigate('/chats');
    },
    [navigate]
  );

  if (typeof window !== 'undefined' && window.location.pathname === '/google-signin') {
    return <GoogleSignInHandoffView />;
  }

  if (!user) {
    return (
      <>
        <LandingPage
          onSignIn={() => {
            setAuthModalView('signup');
            setAuthModalOpen(true);
          }}
          onOpenLogin={() => {
            setAuthModalView('login');
            setAuthModalOpen(true);
          }}
          onGoogleSuccess={handleAuthSuccess}
        />
        {authModalOpen && (
          <AuthModal
            user={null}
            initialView={authModalView}
            currentTheme={themeId}
            onSelectTheme={handleSelectTheme}
            onChangeLanguage={handleSelectLanguage}
            onClose={() => setAuthModalOpen(false)}
            onAuthSuccess={handleAuthSuccess}
            onSignOut={handleSignOut}
          />
        )}
      </>
    );
  }

  const initials = getInitials(user);
  const hasHeaderPoster = Boolean(audio.currentTrack?.thumbnailUrl);

  return (
    <div className="h-dvh min-h-dvh w-full relative flex bg-paper overflow-hidden">
      {/* App-wide blurred zoomed poster color wash when a song poster is active */}
      {posterPalette && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[1] pointer-events-none poster-app-aura"
        />
      )}

      <div className="relative z-10 flex flex-1 min-w-0 min-h-0 overflow-hidden h-full w-full">
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-30 bg-primary/35 backdrop-blur-[1px] transition-opacity"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside
          aria-hidden={!sidebarOpen}
          className={`absolute inset-y-0 start-0 z-40 w-[min(21rem,88vw)] bg-paper border-e hairline shadow-2xl overflow-y-auto flex flex-col transition-transform duration-200 ease-out ${
            sidebarOpen
              ? 'translate-x-0 visible'
              : '-translate-x-full rtl:translate-x-full invisible pointer-events-none'
          }`}
        >
          <div className="px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-4 flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 rounded-xl bg-primary grid place-items-center shrink-0">
                  <GraduationCap size={17} className="text-on-primary" />
                </span>
                <span className="font-display text-[1.35rem] font-semibold leading-none">
                  Examiner
                </span>
              </div>
              <p className="mt-2 text-[0.72rem] text-primary/65 leading-snug">
                {t('appTagline')}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label={t('closeMenu')}
              className="h-9 w-9 grid place-items-center rounded-xl btn-ghost cursor-pointer shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="px-3 space-y-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[0.88rem] font-semibold transition ${
                    isActive
                      ? 'bg-primary text-on-primary'
                      : 'text-primary/85 hover:bg-primary/10 hover:text-primary'
                  }`
                }
              >
                <Icon size={17} className="shrink-0" />
                <span className="leading-snug break-words">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="px-3 mt-4 space-y-2">
            <button
              type="button"
              onClick={() => {
                setModalExam({ exam: null });
                setSidebarOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl btn-secondary px-3 py-2.5 text-[0.84rem] font-semibold cursor-pointer"
            >
              <Plus size={16} /> {t('addExam')}
            </button>

            <button
              type="button"
              onClick={() => {
                setChatModalState({ open: true, editing: null });
                setSidebarOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-secondary text-on-secondary px-3 py-2.5 text-[0.84rem] font-semibold hover:opacity-95 transition cursor-pointer shadow-xs"
            >
              <MessageSquarePlus size={16} /> {t('newPrivateChat')}
            </button>

            <PWAInstallButton variant="sidebar" />
          </div>

          <div className="mt-4 pt-2 border-t hairline space-y-1">
            <LanguagePicker variant="sidebar" onChangeLanguage={handleSelectLanguage} />
            <ThemePicker
              currentTheme={themeId}
              onSelectTheme={handleSelectTheme}
              variant="inline"
              onOpenFullPicker={() => {
                setThemeModalOpen(true);
                setSidebarOpen(false);
              }}
            />
          </div>

          <div className="mt-auto pt-3">
            <MusicPlayer
              audio={audio}
              onSaveSpotifyTracks={handleSaveSpotifyTracks}
              onOpenDynamicIsland={() => {
                setDynamicIslandHidden(false);
                setDynamicIslandForceExpand((c) => c + 1);
                setSidebarOpen(false);
              }}
            />

            <div className="p-3 pt-1 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setAuthModalView('account');
                  setAuthModalOpen(true);
                  setSidebarOpen(false);
                }}
                className="flex-1 min-w-0 flex items-center gap-2.5 rounded-xl p-2 hover:bg-primary/10 transition text-start cursor-pointer"
              >
                <span className="shrink-0">
                  <AvatarSvg config={user.avatar} initials={initials} size={36} />
                </span>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block text-[0.8rem] font-semibold leading-snug break-words">
                    {user.displayName || t('authAccountTitle')}
                  </span>
                  <span className="block text-[0.68rem] text-primary/65 leading-snug break-all">
                    {user.email || t('navAccount')}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAvatarModalOpen(true);
                  setSidebarOpen(false);
                }}
                title={t('customizeAvatar')}
                aria-label={t('customizeAvatar')}
                className="h-9 w-9 grid place-items-center rounded-xl btn-ghost hover:text-secondary shrink-0 cursor-pointer"
              >
                <Sparkles size={15} />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <header className="relative shrink-0 z-30 pt-[env(safe-area-inset-top,0px)] overflow-hidden">
            {hasHeaderPoster && audio.currentTrack?.thumbnailUrl ? (
              <div aria-hidden="true" className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                <img
                  src={audio.currentTrack.thumbnailUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover blur-2xl scale-150 saturate-150 brightness-[0.42]"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/30 to-black/45" />
              </div>
            ) : audio.currentTrack ? (
              <div
                aria-hidden="true"
                className="absolute inset-0 z-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(120deg, rgb(var(--rgb-poster-a) / 0.24), rgb(var(--rgb-bg) / 0.88), rgb(var(--rgb-poster-b) / 0.2))',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                }}
              />
            ) : (
              <div aria-hidden="true" className="absolute inset-0 z-0 bg-paper-blur pointer-events-none" />
            )}

            <div className="relative z-10 max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-2 flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => setSidebarOpen((s) => !s)}
                aria-label={t('openMenu')}
                title={t('openMenu')}
                className={`h-9 w-9 grid place-items-center rounded-xl transition cursor-pointer shrink-0 ${
                  hasHeaderPoster
                    ? 'bg-white/18 hover:bg-white/28 text-white'
                    : 'bg-primary/10 hover:bg-primary/18 text-primary'
                }`}
              >
                <Menu size={18} />
              </button>
              <div className="min-w-0 flex-1 flex items-center">
                <SpotifyDynamicIsland
                  key={dynamicIslandForceExpand}
                  audio={audio}
                  forceExpanded={dynamicIslandForceExpand > 0}
                  hidden={dynamicIslandHidden}
                  hasHeaderPoster={hasHeaderPoster}
                  onHideChange={setDynamicIslandHidden}
                />
              </div>
            </div>
          </header>

          <main className="flex-1 min-h-0 overflow-hidden">
            <Routes>
              <Route
                path="/"
                element={
                  <TodayPage
                    exams={sortedExams}
                    lessons={lessons}
                    loading={loading}
                    error={error}
                    onRetry={loadWorkspaceData}
                    onEdit={(exam) => setModalExam({ exam })}
                    onAdd={() => setModalExam({ exam: null })}
                    onGoScan={() => navigate('/scan')}
                  />
                }
              />
              <Route
                path="/calendar"
                element={
                  <MonthPage
                    exams={sortedExams}
                    lessons={lessons}
                    loading={loading}
                    error={error}
                    onRetry={loadWorkspaceData}
                    onEdit={(exam) => setModalExam({ exam })}
                  />
                }
              />
              <Route
                path="/assessments"
                element={
                  <MajorExamsPage
                    exams={sortedExams}
                    lessons={lessons}
                    loading={loading}
                    error={error}
                    onRetry={loadWorkspaceData}
                    onEdit={(exam) => setModalExam({ exam })}
                    onAddMajor={(defaultType) =>
                      setModalExam({ exam: { type: defaultType || 'midterm' } })
                    }
                    onSaveBatch={handleSaveBatch}
                    onGoStudy={() => navigate('/study')}
                  />
                }
              />
              <Route
                path="/study"
                element={
                  <StudyPage
                    exams={sortedExams}
                    lessons={lessons}
                    loading={loading}
                    error={error}
                    onRetry={loadWorkspaceData}
                    onToggleLesson={handleToggleLesson}
                    onAddLesson={handleAddLesson}
                    onDeleteLesson={handleDeleteLesson}
                    onSelectExam={(exam) => setModalExam({ exam })}
                    onGoScan={() => navigate('/scan')}
                    onGoAssessments={() => navigate('/assessments')}
                  />
                }
              />
              <Route
                path="/scan"
                element={
                  <ScanPage
                    exams={sortedExams}
                    lessons={lessons}
                    onSaveBatch={handleSaveBatch}
                    onExit={() => navigate('/')}
                    onGoStudy={() => navigate('/study')}
                  />
                }
              />
              <Route
                path="/chats"
                element={
                  <ChatsPage
                    currentUser={user}
                    exams={sortedExams}
                    audio={audio}
                    savedSpotifyTracks={savedSpotifyTracks}
                    onSaveMusicToApp={handleSaveExtractedSpotifyTrack}
                    chats={privateChats}
                    onChatsChange={setPrivateChats}
                    onOpenCreateChat={() => setChatModalState({ open: true, editing: null })}
                    onOpenEditChat={(chat) => setChatModalState({ open: true, editing: chat })}
                    onExamAdded={handleExamAddedFromChat}
                  />
                }
              />
              <Route
                path="*"
                element={
                  <TodayPage
                    exams={sortedExams}
                    lessons={lessons}
                    loading={loading}
                    error={error}
                    onRetry={loadWorkspaceData}
                    onEdit={(exam) => setModalExam({ exam })}
                    onAdd={() => setModalExam({ exam: null })}
                    onGoScan={() => navigate('/scan')}
                  />
                }
              />
            </Routes>
          </main>
        </div>
      </div>

      {modalExam && (
        <ExamModal
          exam={modalExam.exam}
          exams={exams}
          lessons={lessons}
          onClose={() => setModalExam(null)}
          onSave={handleSaveExam}
          onDelete={handleDeleteExam}
          onToggleLesson={handleToggleLesson}
          onAddLesson={handleAddLesson}
        />
      )}

      {authModalOpen && (
        <AuthModal
          user={user}
          initialView={authModalView}
          examCount={sortedExams.length}
          currentTheme={themeId}
          onOpenThemePicker={() => setThemeModalOpen(true)}
          onSelectTheme={handleSelectTheme}
          onChangeLanguage={handleSelectLanguage}
          onClose={() => setAuthModalOpen(false)}
          onAuthSuccess={handleAuthSuccess}
          onUserUpdate={(nextUser) => setUser(nextUser)}
          onSignOut={handleSignOut}
        />
      )}

      {avatarModalOpen && (
        <AvatarGeneratorModal
          initialConfig={user.avatar}
          initials={initials}
          onClose={() => setAvatarModalOpen(false)}
          onSave={handleSaveAvatar}
        />
      )}

      {themeModalOpen && (
        <ThemePicker
          currentTheme={themeId}
          onSelectTheme={handleSelectTheme}
          variant="modal"
          onClose={() => setThemeModalOpen(false)}
        />
      )}

      {chatModalState.open && (
        <NewPrivateChatModal
          existingChat={chatModalState.editing}
          savedSpotifyTracks={savedSpotifyTracks}
          onSaveExtractedSpotify={handleSaveExtractedSpotifyTrack}
          currentTheme={themeId}
          onClose={() => setChatModalState({ open: false, editing: null })}
          onCreatedOrUpdated={handleChatCreatedOrUpdated}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <ExaminerWorkspace />
      </BrowserRouter>
    </LanguageProvider>
  );
}
