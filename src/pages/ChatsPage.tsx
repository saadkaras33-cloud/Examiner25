import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookmarkPlus,
  CalendarCheck2,
  CalendarPlus,
  Check,
  Clock,
  Copy,
  Disc3,
  FileAudio,
  KeyRound,
  Loader2,
  LogOut,
  MapPin,
  MessageSquarePlus,
  Music2,
  Pause,
  Play,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import type {
  Exam,
  PrivateChatRoom,
  SavedMusicTrack,
  SharedExamPayload,
  UserProfile,
} from '../types.ts';
import type { StudyAudioController } from '../utils/useStudyAudioController.ts';
import {
  EXAM_TYPES,
  formatTimeRange,
  getExamTypeConfig,
} from '../utils/exams.ts';
import {
  formatLocalizedDate,
  formatRelativeDayLocalized,
  getExamTypeLabel,
  useTranslation,
} from '../utils/i18n.tsx';
import {
  fetchPrivateChats,
  joinPrivateChat,
  leavePrivateChat,
  respondToSharedExam,
  sendPrivateChatMessage,
  updatePrivateChat,
  uploadCustomAudioFile,
} from '../services/api.ts';
import AvatarSvg from '../components/AvatarSvg.tsx';
import StickerBackground from '../components/StickerBackground.tsx';

interface ChatsPageProps {
  currentUser: UserProfile;
  exams: Exam[];
  audio: StudyAudioController;
  savedSpotifyTracks: SavedMusicTrack[];
  onSaveMusicToApp: (track: SavedMusicTrack) => void;
  chats: PrivateChatRoom[];
  onChatsChange: (
    updater: PrivateChatRoom[] | ((prev: PrivateChatRoom[]) => PrivateChatRoom[])
  ) => void;
  onOpenCreateChat: () => void;
  onOpenEditChat: (chat: PrivateChatRoom) => void;
  onExamAdded: (exam: Exam) => void;
}

function getMemberInitials(name?: string): string {
  const parts = String(name || 'U')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatMessageTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function ChatsPage({
  currentUser,
  exams,
  audio,
  savedSpotifyTracks,
  onSaveMusicToApp,
  chats,
  onChatsChange,
  onOpenCreateChat,
  onOpenEditChat,
  onExamAdded,
}: ChatsPageProps) {
  const { lang, t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);

  const [chatError, setChatError] = useState('');
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [respondingMsgId, setRespondingMsgId] = useState<string | null>(null);

  // Room audio panel state
  const [musicMenuOpen, setMusicMenuOpen] = useState(false);
  const [uploadingGroupAudio, setUploadingGroupAudio] = useState(false);
  const [alsoSaveUploadedToApp, setAlsoSaveUploadedToApp] = useState(true);
  const [savedGroupTrackToast, setSavedGroupTrackToast] = useState(false);
  const groupAudioInputRef = useRef<HTMLInputElement>(null);

  // Share Exam Modal inside exam-only group
  const [shareExamModalOpen, setShareExamModalOpen] = useState(false);
  const [shareMode, setShareMode] = useState<'calendar' | 'custom'>('calendar');
  const [calendarSearch, setCalendarSearch] = useState('');
  const [sharingDirectId, setSharingDirectId] = useState<string | null>(null);
  const [shareSubject, setShareSubject] = useState('');
  const [shareType, setShareType] = useState<Exam['type']>('final');
  const [shareDate, setShareDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shareStartTime, setShareStartTime] = useState('09:00');
  const [shareEndTime, setShareEndTime] = useState('11:00');
  const [shareRoom, setShareRoom] = useState('');
  const [shareMaterial, setShareMaterial] = useState('');
  const [shareTopics, setShareTopics] = useState('');
  const [shareNotes, setShareNotes] = useState('');
  const [shareError, setShareError] = useState('');
  const [sharingExam, setSharingExam] = useState(false);

  const feedEndRef = useRef<HTMLDivElement>(null);

  const upsertChat = useCallback(
    (incoming: PrivateChatRoom) => {
      onChatsChange((prev) => {
        const idx = prev.findIndex((c) => c.id === incoming.id);
        if (idx === -1) return [incoming, ...prev];
        const next = [...prev];
        next[idx] = incoming;
        return next.sort((a, b) =>
          (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
        );
      });
    },
    [onChatsChange]
  );

  // Initial fetch of private chats
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPrivateChats()
      .then((list) => {
        if (!active) return;
        onChatsChange(list);
        setSelectedChatId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          return list[0]?.id || null;
        });
      })
      .catch(() => {
        // Keep existing chats if offline
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onChatsChange]);

  // Select newly added chat automatically if none selected
  useEffect(() => {
    if (chats.length > 0 && (!selectedChatId || !chats.some((c) => c.id === selectedChatId))) {
      setSelectedChatId(chats[0].id);
    }
  }, [chats, selectedChatId]);

  // Real-time WebSocket updates for private chats
  useEffect(() => {
    if (!currentUser?.id) return;
    let disposed = false;
    let ws: WebSocket | null = null;
    let pingTimer: number | undefined;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/chats?userId=${encodeURIComponent(
        currentUser.id || ''
      )}`;
      try {
        ws = new WebSocket(url);
      } catch {
        return;
      }

      ws.onopen = () => {
        pingTimer = window.setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || '{}')) as {
            type?: string;
            chat?: PrivateChatRoom;
          };
          if (
            (payload.type === 'chat:updated' || payload.type === 'chat:created') &&
            payload.chat?.id
          ) {
            upsertChat(payload.chat);
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        if (pingTimer) window.clearInterval(pingTimer);
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (pingTimer) window.clearInterval(pingTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [currentUser?.id, upsertChat]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === selectedChatId) || null,
    [chats, selectedChatId]
  );

  // Scroll feed to bottom when switching chat or receiving new exams
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.id, activeChat?.messages.length]);

  useEffect(() => {
    setMusicMenuOpen(false);
    setSavedGroupTrackToast(false);
  }, [activeChat?.id]);

  const filteredCalendarExams = useMemo(() => {
    const q = calendarSearch.trim().toLowerCase();
    if (!q) return exams;
    return exams.filter((ex) => {
      const hay = `${ex.subject} ${ex.date} ${ex.room} ${ex.material} ${(ex.topics || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [exams, calendarSearch]);

  async function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = joinCode.trim();
    if (!clean) return;
    setJoinError('');
    setJoining(true);
    try {
      const joined = await joinPrivateChat(clean);
      upsertChat(joined);
      setSelectedChatId(joined.id);
      setJoinCode('');
      setShowJoinInput(false);
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : 'Could not join chat.');
    } finally {
      setJoining(false);
    }
  }

  async function handleCopySecretCode(chat: PrivateChatRoom) {
    try {
      await navigator.clipboard.writeText(chat.secretCode);
      setCopiedCodeId(chat.id);
      window.setTimeout(() => setCopiedCodeId((curr) => (curr === chat.id ? null : curr)), 2000);
    } catch {
      // Clipboard blocked
    }
  }

  function openShareExamModal() {
    setShareSubject('');
    setShareType('final');
    setShareDate(new Date().toISOString().slice(0, 10));
    setShareStartTime('09:00');
    setShareEndTime('11:00');
    setShareRoom('');
    setShareMaterial('');
    setShareTopics('');
    setShareNotes('');
    setCalendarSearch('');
    setShareMode('calendar');
    setShareError('');
    setShareExamModalOpen(true);
  }

  function prefillFromExistingExam(exam: Exam) {
    setShareSubject(exam.subject);
    setShareType(exam.type);
    setShareDate(exam.date);
    setShareStartTime(exam.startTime || '');
    setShareEndTime(exam.endTime || '');
    setShareRoom(exam.room || '');
    setShareMaterial(exam.material || '');
    setShareTopics((exam.topics || []).join(', '));
    setShareNotes(exam.notes || '');
    setShareError('');
    setShareMode('custom');
  }

  async function handleShareCalendarExamNow(exam: Exam) {
    if (!activeChat) return;
    setShareError('');
    setSharingDirectId(exam.id);
    try {
      const payload: SharedExamPayload = {
        subject: exam.subject,
        type: exam.type,
        date: exam.date,
        startTime: exam.startTime || '',
        endTime: exam.endTime || '',
        room: exam.room || '',
        material: exam.material || '',
        topics: exam.topics || [],
        notes: exam.notes || '',
      };
      const updated = await sendPrivateChatMessage(activeChat.id, {
        kind: 'exam',
        exam: payload,
      });
      upsertChat(updated);
      setShareExamModalOpen(false);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Could not share exam.');
    } finally {
      setSharingDirectId(null);
    }
  }

  async function handleShareExamSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeChat) return;
    if (!shareSubject.trim()) {
      setShareError('Enter an exam subject.');
      return;
    }
    if (!shareDate.trim()) {
      setShareError('Pick the exam date.');
      return;
    }

    const payload: SharedExamPayload = {
      subject: shareSubject.trim(),
      type: shareType,
      date: shareDate.trim(),
      startTime: shareStartTime.trim(),
      endTime: shareEndTime.trim(),
      room: shareRoom.trim(),
      material: shareMaterial.trim(),
      topics: shareTopics
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      notes: shareNotes.trim(),
    };

    setShareError('');
    setSharingExam(true);
    try {
      const updated = await sendPrivateChatMessage(activeChat.id, {
        kind: 'exam',
        exam: payload,
      });
      upsertChat(updated);
      setShareExamModalOpen(false);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Could not share exam.');
    } finally {
      setSharingExam(false);
    }
  }

  async function handleRespondExam(
    chatId: string,
    messageId: string,
    decision: 'accepted' | 'refused'
  ) {
    setRespondingMsgId(`${messageId}:${decision}`);
    setChatError('');
    try {
      const result = await respondToSharedExam(chatId, messageId, decision);
      upsertChat(result.chat);
      if (decision === 'accepted' && result.addedExam) {
        onExamAdded(result.addedExam);
      }
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : 'Could not save response.');
    } finally {
      setRespondingMsgId(null);
    }
  }

  async function handleLeaveChat(chatId: string) {
    setLeaving(true);
    try {
      await leavePrivateChat(chatId);
      onChatsChange((prev) => prev.filter((c) => c.id !== chatId));
      setConfirmLeaveId(null);
      setSelectedChatId(null);
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : 'Could not leave chat.');
    } finally {
      setLeaving(false);
    }
  }

  function handleToggleGroupMusic(music: SavedMusicTrack) {
    const isThisActive = audio.currentTrack?.id === music.id;
    if (isThisActive) {
      audio.togglePlayPause();
    } else {
      audio.playSavedTrack(music);
    }
  }

  async function handleUploadGroupAudioFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeChat) return;
    setChatError('');
    setUploadingGroupAudio(true);
    try {
      const uploaded = await uploadCustomAudioFile(file, { saveToApp: alsoSaveUploadedToApp });
      if (alsoSaveUploadedToApp) {
        onSaveMusicToApp(uploaded);
      }
      const updated = await updatePrivateChat(activeChat.id, { backgroundMusic: uploaded });
      upsertChat(updated);
      audio.playSavedTrack(uploaded);
      setMusicMenuOpen(false);
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : 'Could not upload audio to group.');
    } finally {
      setUploadingGroupAudio(false);
    }
  }

  async function handleAssignAppTrackToGroup(track: SavedMusicTrack) {
    if (!activeChat) return;
    setChatError('');
    setUploadingGroupAudio(true);
    try {
      const updated = await updatePrivateChat(activeChat.id, { backgroundMusic: track });
      upsertChat(updated);
      audio.playSavedTrack(track);
      setMusicMenuOpen(false);
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : 'Could not set group audio.');
    } finally {
      setUploadingGroupAudio(false);
    }
  }

  function handleSaveGroupMusicToMainApp(music: SavedMusicTrack) {
    onSaveMusicToApp(music);
    setSavedGroupTrackToast(true);
    window.setTimeout(() => setSavedGroupTrackToast(false), 2000);
  }

  const [mobileShowFeed, setMobileShowFeed] = useState(false);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-paper grain">
      {/* Top Bar */}
      <header className="shrink-0 z-20 bg-paper-blur border-b hairline">
        <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary/60">
                {t('secretCodeLabel')}
              </div>
              <h1 className="font-display text-[1.35rem] sm:text-[1.45rem] md:text-[1.7rem] font-semibold leading-snug break-words">
                {t('navChats')}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowJoinInput((s) => !s);
                setJoinError('');
              }}
              className="h-9 sm:h-10 px-3 sm:px-3.5 rounded-xl btn-secondary text-[0.8rem] sm:text-[0.82rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <KeyRound size={15} className="text-secondary shrink-0" />
              <span>{t('joinPrivateChat')}</span>
            </button>

            <button
              type="button"
              onClick={onOpenCreateChat}
              className="h-9 sm:h-10 px-3.5 sm:px-4 rounded-xl bg-primary text-on-primary text-[0.8rem] sm:text-[0.82rem] font-semibold inline-flex items-center gap-1.5 hover:opacity-95 cursor-pointer shadow-xs"
            >
              <MessageSquarePlus size={15} className="shrink-0" />
              <span>{t('newPrivateChat')}</span>
            </button>
          </div>
        </div>

        {showJoinInput && (
          <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 pb-3">
            <form
              onSubmit={handleJoinSubmit}
              className="rounded-2xl border hairline bg-surface p-2.5 flex flex-wrap items-center gap-2"
            >
              <KeyRound size={15} className="text-secondary ms-1 shrink-0" />
              <input
                type="text"
                dir="ltr"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder={t('enterSecretCode')}
                className="flex-1 min-w-0 sm:min-w-[12rem] bg-transparent text-[0.88rem] font-mono uppercase tracking-wider outline-none px-1"
              />
              <button
                type="submit"
                disabled={joining || !joinCode.trim()}
                className="h-9 px-4 rounded-xl bg-secondary text-on-secondary text-[0.8rem] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer shrink-0"
              >
                {joining && <Loader2 size={13} className="animate-spin" />}
                {t('joinBtn')}
              </button>
            </form>
            {joinError && (
              <p className="mt-1.5 text-[0.76rem] font-medium text-secondary px-1">{joinError}</p>
            )}
          </div>
        )}
      </header>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {loading && chats.length === 0 ? (
          <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-3">
            <div className="h-24 rounded-2xl bg-primary/10 softpulse" />
            <div className="h-24 rounded-2xl bg-primary/10 softpulse" />
          </div>
        ) : chats.length === 0 ? (
          <div className="flex-1 overflow-y-auto flex items-center justify-center p-6">
            <div className="max-w-lg w-full text-center space-y-5 rise card p-6">
              <div className="mx-auto h-16 w-16 rounded-2xl bg-secondary/15 grid place-items-center">
                <Users size={28} className="text-secondary" />
              </div>
              <div className="space-y-2">
                <h2 className="font-display text-2xl font-semibold">{t('noChatsTitle')}</h2>
                <p className="text-[0.9rem] text-primary/70 leading-relaxed">{t('noChatsDesc')}</p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={onOpenCreateChat}
                  className="px-5 py-3 rounded-2xl bg-primary text-on-primary font-semibold text-[0.88rem] inline-flex items-center gap-2 cursor-pointer"
                >
                  <MessageSquarePlus size={16} />
                  {t('newPrivateChat')}
                </button>
              </div>

              <form
                onSubmit={handleJoinSubmit}
                className="rounded-2xl border hairline bg-surface-soft p-3 flex items-center gap-2 text-start"
              >
                <KeyRound size={16} className="text-secondary shrink-0 ms-1" />
                <input
                  type="text"
                  dir="ltr"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder={t('enterSecretCode')}
                  className="flex-1 min-w-0 bg-transparent text-[0.86rem] font-mono uppercase tracking-wider outline-none"
                />
                <button
                  type="submit"
                  disabled={joining || !joinCode.trim()}
                  className="h-9 px-3.5 rounded-xl bg-secondary text-on-secondary text-[0.8rem] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer shrink-0"
                >
                  {joining && <Loader2 size={13} className="animate-spin" />}
                  {t('joinBtn')}
                </button>
              </form>
              {joinError && (
                <p className="text-[0.78rem] font-medium text-secondary">{joinError}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex w-full max-w-6xl mx-auto">
            {/* Room List Column */}
            <div
              className={`border-e hairline bg-surface/80 backdrop-blur-xs overflow-y-auto p-3 space-y-2 ${
                mobileShowFeed ? 'hidden md:block md:w-72 lg:w-80 shrink-0' : 'w-full md:w-72 lg:w-80 shrink-0'
              }`}
            >
              {chats.map((chat) => {
                const selected = chat.id === activeChat?.id;
                const examCount = chat.messages.filter((m) => m.kind === 'exam').length;
                const lastExamMsg = [...chat.messages].reverse().find((m) => m.kind === 'exam');
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => {
                      setSelectedChatId(chat.id);
                      setMobileShowFeed(true);
                      setConfirmLeaveId(null);
                    }}
                    className={`w-full text-start rounded-2xl p-3 border transition flex items-start gap-3 cursor-pointer ${
                      selected
                        ? 'bg-primary text-on-primary border-primary shadow-sm'
                        : 'bg-surface border-primary/15 text-primary hover:border-primary/35'
                    }`}
                  >
                    {chat.avatarImage ? (
                      <img
                        src={chat.avatarImage}
                        alt={chat.groupName}
                        className="h-12 w-12 rounded-2xl object-cover shrink-0 border border-on-primary/20"
                      />
                    ) : (
                      <div
                        className={`h-12 w-12 rounded-2xl grid place-items-center font-display text-sm font-semibold shrink-0 ${
                          selected
                            ? 'bg-on-primary/15 text-on-primary'
                            : 'bg-secondary/15 text-secondary'
                        }`}
                      >
                        {getMemberInitials(chat.groupName)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span
                          dir="auto"
                          className="text-[0.9rem] font-semibold leading-snug break-words"
                        >
                          {chat.groupName}
                        </span>
                      </div>
                      <div
                        dir="auto"
                        className={`text-[0.72rem] leading-snug break-words mt-0.5 ${
                          selected ? 'opacity-85' : 'text-primary/65'
                        }`}
                      >
                        {chat.schoolName} · {chat.grade}
                        {chat.className ? ` · ${chat.className}` : ''}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.68rem]">
                        <span
                          className={`font-mono px-1.5 py-0.5 rounded-md ${
                            selected
                              ? 'bg-on-primary/15 text-on-primary'
                              : 'bg-primary/10 text-primary/80'
                          }`}
                        >
                          {chat.secretCode}
                        </span>
                        <span className={selected ? 'opacity-85' : 'text-primary/65'}>
                          {chat.members.length} {t('membersCount')}
                        </span>
                        <span className={selected ? 'opacity-85' : 'text-primary/65'}>
                          · {examCount}
                        </span>
                        {chat.backgroundMusic && (
                          <Disc3
                            size={12}
                            className={selected ? 'text-[#1ED760]' : 'text-[#1DB954]'}
                          />
                        )}
                      </div>
                      {lastExamMsg && (
                        <p
                          dir="auto"
                          className={`mt-1.5 text-[0.74rem] leading-snug break-words ${
                            selected ? 'opacity-90' : 'text-primary/70'
                          }`}
                        >
                          {lastExamMsg.exam?.subject || lastExamMsg.text}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Active Exam Group View */}
            {activeChat && (
              <div
                className={`flex-1 min-w-0 min-h-0 flex flex-col relative overflow-hidden ${
                  mobileShowFeed ? 'flex' : 'hidden md:flex'
                }`}
              >
                <input
                  ref={groupAudioInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={handleUploadGroupAudioFile}
                />

                {/* Chat Background Layer */}
                <StickerBackground theme={activeChat.theme} />

                {/* Active Room Header */}
                <div className="relative z-20 shrink-0 bg-paper-blur border-b hairline px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setMobileShowFeed(false)}
                      aria-label={t('backToChats')}
                      className="h-9 w-9 grid place-items-center rounded-xl btn-secondary cursor-pointer shrink-0 md:hidden"
                    >
                      <ArrowLeft size={16} className="rtl:rotate-180" />
                    </button>

                    {activeChat.avatarImage ? (
                      <img
                        src={activeChat.avatarImage}
                        alt={activeChat.groupName}
                        className="h-11 w-11 rounded-2xl object-cover border hairline shrink-0"
                      />
                    ) : (
                      <div className="h-11 w-11 rounded-2xl bg-secondary/15 text-secondary grid place-items-center font-display text-sm font-semibold shrink-0">
                        {getMemberInitials(activeChat.groupName)}
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2
                          dir="auto"
                          className="font-display text-[1.05rem] font-semibold leading-snug break-words"
                        >
                          {activeChat.groupName}
                        </h2>
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary/12 border border-secondary/30 px-2 py-0.5 text-[0.64rem] font-bold text-secondary">
                          <ShieldCheck size={10} />
                          {t('examOnlyGroupBadge')}
                        </span>
                      </div>
                      <div
                        dir="auto"
                        className="text-[0.72rem] text-primary/65 leading-snug break-words"
                      >
                        {activeChat.schoolName} · {activeChat.grade}
                        {activeChat.className ? ` · ${activeChat.className}` : ''} ·{' '}
                        {activeChat.members.length} {t('membersCount')}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopySecretCode(activeChat)}
                      title={t('copyCode')}
                      className="h-8 px-2.5 rounded-xl btn-secondary text-[0.74rem] font-mono font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedCodeId === activeChat.id ? (
                        <>
                          <Check size={13} className="text-[#2F8F72]" />
                          <span className="text-[#2F8F72]">{t('copiedCode')}</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} className="text-primary/70" />
                          <span>{activeChat.secretCode}</span>
                        </>
                      )}
                    </button>

                    {activeChat.backgroundMusic && (() => {
                      const music = activeChat.backgroundMusic;
                      const isThisPlaying =
                        audio.currentTrack?.id === music.id && audio.audioState.playing;
                      return (
                        <button
                          type="button"
                          onClick={() => handleToggleGroupMusic(music)}
                          title={music.title}
                          className="h-8 px-2.5 rounded-xl bg-[#15803D] text-white text-[0.74rem] font-semibold inline-flex items-center gap-1.5 hover:opacity-95 cursor-pointer shadow-xs"
                        >
                          {isThisPlaying ? <Pause size={12} /> : <Play size={12} />}
                          <span className="max-w-[8rem] truncate">{music.title}</span>
                        </button>
                      );
                    })()}

                    <button
                      type="button"
                      onClick={() => setMusicMenuOpen((m) => !m)}
                      title={t('groupAudioMenuBtn')}
                      aria-label={t('groupAudioMenuBtn')}
                      className={`h-8 px-2.5 rounded-xl text-[0.74rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition ${
                        musicMenuOpen
                          ? 'bg-secondary text-on-secondary shadow-xs'
                          : 'btn-secondary'
                      }`}
                    >
                      <Music2 size={14} />
                      <span className="hidden sm:inline">{t('groupAudioMenuBtn')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenEditChat(activeChat)}
                      title={t('chatSettingsTitle')}
                      aria-label={t('chatSettingsTitle')}
                      className="h-8 w-8 grid place-items-center rounded-xl btn-secondary cursor-pointer"
                    >
                      <Settings2 size={15} />
                    </button>

                    {confirmLeaveId === activeChat.id ? (
                      <div className="inline-flex items-center gap-1 bg-secondary/12 border border-secondary/35 rounded-xl px-2 py-1">
                        <button
                          type="button"
                          onClick={() => handleLeaveChat(activeChat.id)}
                          disabled={leaving}
                          className="text-[0.72rem] font-semibold text-secondary hover:underline cursor-pointer"
                        >
                          {leaving ? '…' : t('confirmBtn')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmLeaveId(null)}
                          className="text-[0.72rem] text-primary/75 hover:text-primary cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmLeaveId(activeChat.id)}
                        title={t('leaveChatBtn')}
                        aria-label={t('leaveChatBtn')}
                        className="h-8 w-8 grid place-items-center rounded-xl btn-secondary hover:text-secondary cursor-pointer"
                      >
                        <LogOut size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Group Audio Drawer */}
                {musicMenuOpen && (
                  <div className="relative z-20 shrink-0 border-b hairline bg-surface/95 backdrop-blur-md px-4 py-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={uploadingGroupAudio}
                        onClick={() => groupAudioInputRef.current?.click()}
                        className="h-9 px-3.5 rounded-xl bg-secondary text-on-secondary text-[0.78rem] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                      >
                        {uploadingGroupAudio ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Upload size={13} />
                        )}
                        <span>
                          {uploadingGroupAudio ? t('uploadingAudio') : t('uploadAudioToGroup')}
                        </span>
                      </button>

                      <label className="inline-flex items-center gap-1.5 text-[0.74rem] font-medium text-primary/80 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={alsoSaveUploadedToApp}
                          onChange={(e) => setAlsoSaveUploadedToApp(e.target.checked)}
                          className="accent-secondary h-3.5 w-3.5 rounded cursor-pointer"
                        />
                        <span>{t('alsoSaveToAppMusic')}</span>
                      </label>

                      {activeChat.backgroundMusic && (
                        <button
                          type="button"
                          onClick={() => handleSaveGroupMusicToMainApp(activeChat.backgroundMusic!)}
                          className="h-8 px-3 rounded-xl bg-[#15803D] text-white text-[0.74rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          {savedGroupTrackToast ? (
                            <>
                              <Check size={12} />
                              <span>{t('spotifySavedChip')}</span>
                            </>
                          ) : (
                            <>
                              <BookmarkPlus size={12} />
                              <span>{t('saveToAppMusic')}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {savedSpotifyTracks.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[0.68rem] font-bold uppercase tracking-wider text-primary/60">
                          {t('useFromAppMusic')}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {savedSpotifyTracks.slice(0, 8).map((tr) => {
                            const active = activeChat.backgroundMusic?.id === tr.id;
                            return (
                              <button
                                key={tr.id}
                                type="button"
                                disabled={uploadingGroupAudio}
                                onClick={() => void handleAssignAppTrackToGroup(tr)}
                                className={`rounded-xl px-2.5 py-1 text-[0.74rem] font-semibold transition inline-flex items-center gap-1.5 cursor-pointer ${
                                  active
                                    ? 'bg-[#15803D] text-white shadow-xs'
                                    : 'btn-secondary'
                                }`}
                              >
                                {tr.kind === 'custom' ? (
                                  <FileAudio size={12} />
                                ) : (
                                  <Disc3 size={12} />
                                )}
                                <span>{tr.title}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Secret code banner if chat has only 1 member */}
                {activeChat.members.length === 1 && (
                  <div className="relative z-10 shrink-0 px-4 pt-2.5">
                    <div className="rounded-xl bg-surface/95 border hairline px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[0.76rem]">
                      <span className="text-primary/80">{t('secretCodeHint')}</span>
                      <button
                        type="button"
                        onClick={() => handleCopySecretCode(activeChat)}
                        className="font-mono font-semibold text-secondary hover:underline cursor-pointer"
                      >
                        {activeChat.secretCode}
                      </button>
                    </div>
                  </div>
                )}

                {/* Exam-Only Feed */}
                <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3">
                  {activeChat.messages.map((msg) => {
                    if (msg.kind === 'system') {
                      return (
                        <div key={msg.id} className="flex justify-center">
                          <div className="rounded-xl bg-surface/95 border hairline px-3 py-1.5 text-[0.74rem] text-primary/75 text-center max-w-md shadow-xs">
                            {msg.text}
                          </div>
                        </div>
                      );
                    }

                    if (msg.kind !== 'exam' || !msg.exam) {
                      return null;
                    }

                    const isMe = msg.senderId === currentUser.id;
                    const senderInitials = getMemberInitials(msg.senderName);
                    const ex = msg.exam;
                    const cfg = getExamTypeConfig(ex.type);
                    const decisions = msg.decisions || {};
                    const myDecision = currentUser.id ? decisions[currentUser.id] : undefined;
                    const acceptedTotal = Object.values(decisions).filter(
                      (d) => d === 'accepted'
                    ).length;
                    const refusedTotal = Object.values(decisions).filter(
                      (d) => d === 'refused'
                    ).length;
                    const timeStr = formatTimeRange(ex.startTime, ex.endTime);

                    return (
                      <div
                        key={msg.id}
                        className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}
                      >
                        {!isMe && (
                          <span className="shrink-0 mb-1">
                            <AvatarSvg config={msg.senderAvatar} initials={senderInitials} size={28} />
                          </span>
                        )}

                        <div className="w-full max-w-md card p-4 bg-surface/95 backdrop-blur-xs border-primary/15 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: cfg.color }}
                              />
                              <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-primary/65">
                                {t('examSharedBadge')} · {t('sharedBy')} {msg.senderName}
                              </span>
                            </div>
                            <span
                              className="chip shrink-0"
                              style={{ backgroundColor: `${cfg.color}18`, color: cfg.color }}
                            >
                              {getExamTypeLabel(ex.type, lang)}
                            </span>
                          </div>

                          <div>
                            <h3
                              dir="auto"
                              className="font-display text-[1.15rem] font-semibold leading-snug break-words"
                            >
                              {ex.subject}
                            </h3>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem] text-primary/80">
                              <span className="font-semibold text-secondary">
                                {formatLocalizedDate(ex.date, 'EEE, d MMM yyyy', lang)} (
                                {formatRelativeDayLocalized(ex.date, lang)})
                              </span>
                              {timeStr && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={12} />
                                  {timeStr}
                                </span>
                              )}
                              {ex.room && (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin size={12} />
                                  {ex.room}
                                </span>
                              )}
                            </div>
                          </div>

                          {(ex.material || (ex.topics && ex.topics.length > 0) || ex.notes) && (
                            <div className="rounded-xl bg-surface-soft border hairline px-3 py-2 text-[0.76rem] space-y-1">
                              {ex.material && (
                                <div dir="auto">
                                  <span className="font-semibold text-primary/70">
                                    {t('materialLabel')}:{' '}
                                  </span>
                                  <span>{ex.material}</span>
                                </div>
                              )}
                              {ex.topics && ex.topics.length > 0 && (
                                <div dir="auto">
                                  <span className="font-semibold text-primary/70">
                                    {t('includedTopicsLabel')}:{' '}
                                  </span>
                                  <span>{ex.topics.join(' · ')}</span>
                                </div>
                              )}
                              {ex.notes && (
                                <div dir="auto" className="text-primary/75">
                                  {ex.notes}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[0.72rem] text-primary/65">
                            <span>
                              {acceptedTotal} {t('acceptedCount')} · {refusedTotal}{' '}
                              {t('refusedCount')}
                            </span>
                            <span>{formatMessageTime(msg.createdAt)}</span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <button
                              type="button"
                              disabled={respondingMsgId !== null}
                              onClick={() =>
                                handleRespondExam(activeChat.id, msg.id, 'accepted')
                              }
                              className={`flex-1 min-w-0 sm:min-w-[10rem] h-10 px-3 rounded-xl text-[0.8rem] font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer ${
                                myDecision === 'accepted'
                                  ? 'bg-[#2F8F72] text-white'
                                  : 'bg-primary text-on-primary hover:opacity-95'
                              }`}
                            >
                              {respondingMsgId === `${msg.id}:accepted` ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <CalendarCheck2 size={14} />
                              )}
                              {myDecision === 'accepted'
                                ? t('addedToCalendar')
                                : t('acceptAddToCalendar')}
                            </button>

                            <button
                              type="button"
                              disabled={respondingMsgId !== null}
                              onClick={() =>
                                handleRespondExam(activeChat.id, msg.id, 'refused')
                              }
                              className={`h-10 px-3.5 rounded-xl text-[0.8rem] font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer ${
                                myDecision === 'refused'
                                  ? 'bg-secondary text-on-secondary'
                                  : 'btn-secondary hover:text-secondary'
                              }`}
                            >
                              {respondingMsgId === `${msg.id}:refused` ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <XCircle size={14} />
                              )}
                              {myDecision === 'refused' ? t('refusedStatus') : t('refuseExam')}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={feedEndRef} />
                </div>

                {chatError && (
                  <div className="relative z-10 px-4 pb-1">
                    <p className="text-[0.76rem] font-medium text-secondary bg-surface/95 border border-secondary/25 rounded-xl px-3 py-1.5">
                      {chatError}
                    </p>
                  </div>
                )}

                {/* Bottom Exam-Only Action Bar (No Text Chatting) */}
                <div className="relative z-10 shrink-0 bg-paper-blur border-t hairline px-3 sm:px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex flex-wrap items-center justify-between gap-2.5">
                  <div className="text-[0.76rem] font-medium text-primary/70 inline-flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-secondary shrink-0" />
                    <span>{t('examOnlyFooterHint')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={openShareExamModal}
                    className="h-10 px-4 rounded-xl bg-secondary text-on-secondary hover:opacity-95 text-[0.84rem] font-semibold inline-flex items-center gap-2 shadow-sm cursor-pointer ms-auto"
                  >
                    <CalendarPlus size={16} />
                    <span>{t('shareFromCalendarBtn')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Share Exam From Calendar Modal */}
      {shareExamModalOpen && activeChat && (
        <div
          className="fixed inset-0 z-50 bg-primary/50 flex items-end md:items-center justify-center p-0 sm:p-4"
          onClick={() => setShareExamModalOpen(false)}
        >
          <div
            className="w-full md:max-w-xl bg-paper rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 bg-paper-blur px-5 pt-4 pb-3 flex items-center justify-between border-b hairline">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-secondary" />
                <h2 className="font-display text-lg font-semibold">{t('shareExamTitle')}</h2>
              </div>
              <button
                type="button"
                onClick={() => setShareExamModalOpen(false)}
                aria-label={t('close')}
                className="h-9 w-9 grid place-items-center rounded-xl btn-ghost cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="shrink-0 px-5 pt-3 pb-2 border-b hairline bg-surface">
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-primary/12 border hairline">
                <button
                  type="button"
                  onClick={() => setShareMode('calendar')}
                  className={`py-1.5 px-3 rounded-lg text-[0.78rem] font-semibold transition cursor-pointer ${
                    shareMode === 'calendar'
                      ? 'bg-primary text-on-primary shadow-xs'
                      : 'text-primary/80 hover:bg-surface'
                  }`}
                >
                  {t('pickExistingExam')} ({exams.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShareMode('custom')}
                  className={`py-1.5 px-3 rounded-lg text-[0.78rem] font-semibold transition cursor-pointer ${
                    shareMode === 'custom'
                      ? 'bg-primary text-on-primary shadow-xs'
                      : 'text-primary/80 hover:bg-surface'
                  }`}
                >
                  {t('orCreateExamDetails')}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
              {shareError && (
                <p className="text-[0.8rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
                  {shareError}
                </p>
              )}

              {shareMode === 'calendar' ? (
                <div className="space-y-3">
                  {exams.length > 0 && (
                    <div className="relative">
                      <Search
                        size={14}
                        className="absolute start-3 top-1/2 -translate-y-1/2 text-primary/50 pointer-events-none"
                      />
                      <input
                        type="text"
                        dir="auto"
                        value={calendarSearch}
                        onChange={(e) => setCalendarSearch(e.target.value)}
                        placeholder={t('searchCalendarExams')}
                        className="w-full h-9 rounded-xl border border-primary/15 bg-surface ps-8 pe-3 text-[0.82rem] outline-none focus:border-secondary/60"
                      />
                    </div>
                  )}

                  {filteredCalendarExams.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-primary/25 p-6 text-center space-y-3">
                      <p className="text-[0.86rem] text-primary/70">{t('noCalendarExamsToShare')}</p>
                      <button
                        type="button"
                        onClick={() => setShareMode('custom')}
                        className="h-9 px-4 rounded-xl bg-secondary text-on-secondary text-[0.8rem] font-semibold cursor-pointer"
                      >
                        {t('orCreateExamDetails')}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredCalendarExams.map((ex) => {
                        const cfg = getExamTypeConfig(ex.type);
                        const timeStr = formatTimeRange(ex.startTime, ex.endTime);
                        const busy = sharingDirectId === ex.id;
                        return (
                          <div
                            key={ex.id}
                            className="rounded-2xl border hairline bg-surface p-3.5 flex flex-wrap items-center justify-between gap-3"
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: cfg.color }}
                                />
                                <span dir="auto" className="font-semibold text-[0.9rem] break-words">
                                  {ex.subject}
                                </span>
                                <span
                                  className="chip"
                                  style={{ backgroundColor: `${cfg.color}18`, color: cfg.color }}
                                >
                                  {getExamTypeLabel(ex.type, lang)}
                                </span>
                              </div>
                              <div className="text-[0.74rem] text-primary/70 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                <span className="font-semibold text-secondary">
                                  {formatLocalizedDate(ex.date, 'EEE, d MMM yyyy', lang)}
                                </span>
                                {timeStr && <span>{timeStr}</span>}
                                {ex.room && <span>{ex.room}</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => prefillFromExistingExam(ex)}
                                className="h-9 px-3 rounded-xl btn-secondary text-[0.76rem] font-semibold cursor-pointer"
                              >
                                {t('customizeBtn')}
                              </button>
                              <button
                                type="button"
                                disabled={sharingDirectId !== null}
                                onClick={() => void handleShareCalendarExamNow(ex)}
                                className="h-9 px-3.5 rounded-xl bg-secondary text-on-secondary text-[0.78rem] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                              >
                                {busy ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Send size={13} />
                                )}
                                <span>{t('shareNowBtn')}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleShareExamSubmit} className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="field-label" htmlFor="share-subject">
                        {t('subject')} *
                      </label>
                      <input
                        id="share-subject"
                        type="text"
                        dir="auto"
                        className="field"
                        value={shareSubject}
                        onChange={(e) => setShareSubject(e.target.value)}
                        placeholder="e.g. Calculus II"
                        required
                      />
                    </div>

                    <div>
                      <label className="field-label" htmlFor="share-type">
                        {t('typeLabel')}
                      </label>
                      <select
                        id="share-type"
                        className="field"
                        value={shareType}
                        onChange={(e) => setShareType(e.target.value as Exam['type'])}
                      >
                        {EXAM_TYPES.map((tp) => (
                          <option key={tp.key} value={tp.key}>
                            {getExamTypeLabel(tp.key, lang)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="field-label" htmlFor="share-date">
                        {t('dateLabel')} *
                      </label>
                      <input
                        id="share-date"
                        type="date"
                        dir="ltr"
                        className="field"
                        value={shareDate}
                        onChange={(e) => setShareDate(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label className="field-label" htmlFor="share-start">
                        {t('startsLabel')}
                      </label>
                      <input
                        id="share-start"
                        type="time"
                        dir="ltr"
                        className="field"
                        value={shareStartTime}
                        onChange={(e) => setShareStartTime(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="field-label" htmlFor="share-end">
                        {t('endsLabel')}
                      </label>
                      <input
                        id="share-end"
                        type="time"
                        dir="ltr"
                        className="field"
                        value={shareEndTime}
                        onChange={(e) => setShareEndTime(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="field-label" htmlFor="share-room">
                        {t('roomHallLabel')}
                      </label>
                      <input
                        id="share-room"
                        type="text"
                        dir="auto"
                        className="field"
                        value={shareRoom}
                        onChange={(e) => setShareRoom(e.target.value)}
                        placeholder="e.g. Hall 3"
                      />
                    </div>

                    <div>
                      <label className="field-label" htmlFor="share-material">
                        {t('materialLabel')}
                      </label>
                      <input
                        id="share-material"
                        type="text"
                        dir="auto"
                        className="field"
                        value={shareMaterial}
                        onChange={(e) => setShareMaterial(e.target.value)}
                        placeholder="Chapters 1–5"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="field-label" htmlFor="share-topics">
                        {t('includedTopicsLabel')}
                      </label>
                      <input
                        id="share-topics"
                        type="text"
                        dir="auto"
                        className="field"
                        value={shareTopics}
                        onChange={(e) => setShareTopics(e.target.value)}
                        placeholder="Derivatives, Integrals"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="field-label" htmlFor="share-notes">
                        {t('notesLabel')}
                      </label>
                      <textarea
                        id="share-notes"
                        dir="auto"
                        rows={2}
                        className="field"
                        value={shareNotes}
                        onChange={(e) => setShareNotes(e.target.value)}
                        placeholder="Bring calculator…"
                      />
                    </div>
                  </div>

                  <div className="pt-1 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShareExamModalOpen(false)}
                      className="h-10 px-4 rounded-xl btn-secondary text-[0.84rem] font-semibold cursor-pointer"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={sharingExam}
                      className="h-10 px-5 rounded-xl bg-secondary text-on-secondary font-semibold text-[0.86rem] inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                    >
                      {sharingExam && <Loader2 size={14} className="animate-spin" />}
                      {t('shareExamBtn')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
