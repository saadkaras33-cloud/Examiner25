import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SavedMusicTrack } from '../types.ts';
import { resolveFullSpotifyTrack, uploadCustomAudioFile } from '../services/api.ts';
import {
  deleteLocalAudioTrack,
  loadAllLocalAudioTracks,
  saveLocalAudioTrack,
} from './musicStorage.ts';
import {
  BUILTIN_STUDY_TRACKS,
  studyAudio,
  type AudioPlaybackState,
  type StudyTrack,
} from './studyAudio.ts';

const MUSIC_PREFS_PREFIX = 'examiner_music_prefs_';
const CURRENT_SPOTIFY_MATCH_VERSION = 2;

interface StoredMusicPrefs {
  selectedTrackId: string;
  volume: number;
  muted: boolean;
}

function loadMusicPrefs(workspaceId: string): StoredMusicPrefs {
  try {
    const raw = localStorage.getItem(`${MUSIC_PREFS_PREFIX}${workspaceId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        selectedTrackId:
          typeof parsed.selectedTrackId === 'string' && parsed.selectedTrackId
            ? parsed.selectedTrackId
            : BUILTIN_STUDY_TRACKS[0].id,
        volume:
          typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
            ? parsed.volume
            : 0.55,
        muted: Boolean(parsed.muted),
      };
    }
  } catch {
    // Ignore storage errors
  }
  return {
    selectedTrackId: BUILTIN_STUDY_TRACKS[0].id,
    volume: 0.55,
    muted: false,
  };
}

export function formatAudioClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const mins = String(Math.floor(total / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

export function useStudyAudioController(
  workspaceId: string,
  savedSpotifyTracks: SavedMusicTrack[],
  onSaveSpotifyTracks: (
    next: SavedMusicTrack[] | ((prev: SavedMusicTrack[]) => SavedMusicTrack[])
  ) => void
) {
  const initialPrefs = useMemo(() => loadMusicPrefs(workspaceId), [workspaceId]);

  const [localTracks, setLocalTracks] = useState<StudyTrack[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string>(initialPrefs.selectedTrackId);
  const [activeSubIndex, setActiveSubIndex] = useState<number>(0);
  const [volume, setVolume] = useState<number>(initialPrefs.volume);
  const [muted, setMuted] = useState<boolean>(initialPrefs.muted);
  const [audioState, setAudioState] = useState<AudioPlaybackState>(() => studyAudio.getState());
  const [resolvingTrack, setResolvingTrack] = useState<boolean>(false);

  const objectUrlsRef = useRef<string[]>([]);
  const savedSpotifyRef = useRef(savedSpotifyTracks);
  savedSpotifyRef.current = savedSpotifyTracks;

  useEffect(() => {
    const unsub = studyAudio.subscribe(setAudioState);
    return unsub;
  }, []);

  useEffect(() => {
    let active = true;
    loadAllLocalAudioTracks(workspaceId).then((records) => {
      if (!active) return;
      for (const oldUrl of objectUrlsRef.current) {
        URL.revokeObjectURL(oldUrl);
      }
      const nextUrls: string[] = [];
      const loaded: StudyTrack[] = records.map((rec) => {
        const objectUrl = URL.createObjectURL(rec.blob);
        nextUrls.push(objectUrl);
        return {
          id: rec.id,
          title: rec.title,
          subtitle: rec.subtitle,
          kind: 'file',
          objectUrl,
        };
      });
      objectUrlsRef.current = nextUrls;
      setLocalTracks(loaded);
    });
    return () => {
      active = false;
      for (const oldUrl of objectUrlsRef.current) {
        URL.revokeObjectURL(oldUrl);
      }
      objectUrlsRef.current = [];
    };
  }, [workspaceId]);

  const spotifyAsStudyTracks: StudyTrack[] = useMemo(
    () =>
      savedSpotifyTracks.map((sp) => ({
        id: sp.id,
        title: sp.title,
        subtitle: sp.subtitle,
        kind: sp.kind === 'custom' ? 'custom' : 'spotify',
        audioUrl: sp.audioUrl,
        mimeType: sp.mimeType,
        spotifyKind: sp.spotifyKind,
        spotifyId: sp.spotifyId,
        spotifyUrl: sp.spotifyUrl,
        embedUrl: sp.embedUrl,
        thumbnailUrl: sp.thumbnailUrl,
        previewUrl: sp.previewUrl,
        durationMs: sp.durationMs,
        youtubeVideoId: sp.youtubeVideoId,
        youtubeVideoIds: sp.youtubeVideoIds,
        matchVersion: sp.matchVersion,
        tracks: sp.tracks,
      })),
    [savedSpotifyTracks]
  );

  const tracks = useMemo(
    () => [...BUILTIN_STUDY_TRACKS, ...localTracks, ...spotifyAsStudyTracks],
    [localTracks, spotifyAsStudyTracks]
  );

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const currentIdx = useMemo(() => {
    const idx = tracks.findIndex((tr) => tr.id === selectedTrackId);
    return idx >= 0 ? idx : 0;
  }, [tracks, selectedTrackId]);

  const currentTrack = tracks[currentIdx] || tracks[0];

  useEffect(() => {
    try {
      localStorage.setItem(
        `${MUSIC_PREFS_PREFIX}${workspaceId}`,
        JSON.stringify({ selectedTrackId, volume, muted })
      );
    } catch {
      // Ignore storage errors
    }
  }, [workspaceId, selectedTrackId, volume, muted]);

  useEffect(() => {
    studyAudio.setVolume(muted ? 0 : volume);
  }, [volume, muted]);

  const ensureSavedInLibrary = useCallback(
    (item: SavedMusicTrack | StudyTrack) => {
      if (item.kind !== 'spotify' && item.kind !== 'custom') return;
      const alreadyExists = savedSpotifyRef.current.some(
        (sp) =>
          sp.id === item.id ||
          (item.embedUrl && sp.embedUrl === item.embedUrl) ||
          (item.audioUrl && sp.audioUrl === item.audioUrl)
      );
      if (alreadyExists) return;
      const toSave: SavedMusicTrack = {
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        kind: item.kind === 'custom' ? 'custom' : 'spotify',
        audioUrl: item.audioUrl,
        mimeType: item.mimeType,
        spotifyKind: item.spotifyKind,
        spotifyId: item.spotifyId,
        spotifyUrl: item.spotifyUrl,
        embedUrl: item.embedUrl,
        thumbnailUrl: item.thumbnailUrl,
        previewUrl: item.previewUrl,
        durationMs: item.durationMs,
        youtubeVideoId: item.youtubeVideoId,
        youtubeVideoIds: item.youtubeVideoIds,
        matchVersion: item.matchVersion,
        tracks: item.tracks,
        savedAt: 'savedAt' in item && item.savedAt ? item.savedAt : new Date().toISOString(),
      };
      onSaveSpotifyTracks((prev) => {
        if (
          prev.some(
            (sp) =>
              sp.id === toSave.id ||
              (toSave.embedUrl && sp.embedUrl === toSave.embedUrl) ||
              (toSave.audioUrl && sp.audioUrl === toSave.audioUrl)
          )
        ) {
          return prev;
        }
        return [toSave, ...prev];
      });
    },
    [onSaveSpotifyTracks]
  );

  const playStudyTrack = useCallback(
    async (targetTrack: StudyTrack, subIdx = 0) => {
      setSelectedTrackId(targetTrack.id);
      setActiveSubIndex(subIdx);
      ensureSavedInLibrary(targetTrack);

      if (targetTrack.kind !== 'spotify') {
        setResolvingTrack(false);
        studyAudio.play(targetTrack);
        return;
      }

      const subList = targetTrack.tracks || [];
      const subItem = subList.length > 0 ? subList[subIdx] || subList[0] : null;
      const playTitle = subItem ? subItem.title : targetTrack.title;
      const playArtist = subItem ? subItem.artist : targetTrack.subtitle;
      const playDurationMs = subItem ? subItem.durationMs : targetTrack.durationMs;
      const playPreview = subItem ? subItem.previewUrl : targetTrack.previewUrl;

      const currentMatchVersion = subItem ? subItem.matchVersion : targetTrack.matchVersion;
      let candidateIds = subItem
        ? subItem.youtubeVideoIds && subItem.youtubeVideoIds.length > 0
          ? subItem.youtubeVideoIds
          : subItem.youtubeVideoId
          ? [subItem.youtubeVideoId]
          : []
        : targetTrack.youtubeVideoIds && targetTrack.youtubeVideoIds.length > 0
        ? targetTrack.youtubeVideoIds
        : targetTrack.youtubeVideoId
        ? [targetTrack.youtubeVideoId]
        : [];

      const advanceAfterEnd = () => {
        const latestTracks = tracksRef.current;
        const latestTrack = latestTracks.find((tr) => tr.id === targetTrack.id);
        if (latestTrack?.tracks && subIdx + 1 < latestTrack.tracks.length) {
          void playStudyTrack(latestTrack, subIdx + 1);
          return;
        }
        const curIndex = latestTracks.findIndex((tr) => tr.id === targetTrack.id);
        if (curIndex >= 0 && latestTracks.length > 1) {
          const nextTrack = latestTracks[(curIndex + 1) % latestTracks.length];
          void playStudyTrack(nextTrack, 0);
        }
      };

      if (candidateIds.length === 0 || currentMatchVersion !== CURRENT_SPOTIFY_MATCH_VERSION) {
        setResolvingTrack(true);
        try {
          const resolved = await resolveFullSpotifyTrack(playTitle, playArtist, playDurationMs);
          if (resolved.videoIds.length > 0) {
            candidateIds = resolved.videoIds;
            onSaveSpotifyTracks((prev) =>
              prev.map((sp) => {
                if (sp.id !== targetTrack.id) return sp;
                if (subItem && sp.tracks) {
                  const nextSub = sp.tracks.map((s, i) =>
                    i === subIdx
                      ? {
                          ...s,
                          youtubeVideoId: candidateIds[0],
                          youtubeVideoIds: candidateIds,
                          matchVersion: CURRENT_SPOTIFY_MATCH_VERSION,
                        }
                      : s
                  );
                  return { ...sp, tracks: nextSub };
                }
                return {
                  ...sp,
                  youtubeVideoId: candidateIds[0],
                  youtubeVideoIds: candidateIds,
                  matchVersion: CURRENT_SPOTIFY_MATCH_VERSION,
                };
              })
            );
          }
        } finally {
          setResolvingTrack(false);
        }
      }

      if (candidateIds.length > 0) {
        await studyAudio.playYouTubeCandidates(
          candidateIds,
          playPreview,
          playDurationMs ? playDurationMs / 1000 : undefined,
          advanceAfterEnd
        );
      } else if (playPreview) {
        studyAudio.playUrl(playPreview, false, advanceAfterEnd);
      } else {
        studyAudio.stop();
      }
    },
    [ensureSavedInLibrary, onSaveSpotifyTracks]
  );

  const togglePlayPause = useCallback(() => {
    if (audioState.playing) {
      studyAudio.pause();
      return;
    }
    if (audioState.mode !== 'idle' && audioState.currentTime > 0) {
      if (studyAudio.resume()) return;
    }
    if (currentTrack) {
      void playStudyTrack(currentTrack, activeSubIndex);
    }
  }, [audioState.playing, audioState.mode, audioState.currentTime, currentTrack, activeSubIndex, playStudyTrack]);

  const stepTrack = useCallback(
    (delta: number) => {
      if (currentTrack?.kind === 'spotify' && currentTrack.tracks && currentTrack.tracks.length > 1) {
        const nextSub = activeSubIndex + delta;
        if (nextSub >= 0 && nextSub < currentTrack.tracks.length) {
          void playStudyTrack(currentTrack, nextSub);
          return;
        }
      }
      const nextIdx = (currentIdx + delta + tracks.length) % tracks.length;
      const nextTrack = tracks[nextIdx];
      if (nextTrack) {
        void playStudyTrack(nextTrack, 0);
      }
    },
    [currentTrack, activeSubIndex, currentIdx, tracks, playStudyTrack]
  );

  const selectTrackIndex = useCallback(
    (index: number, subIdx = 0) => {
      const safeIdx = (index + tracks.length) % tracks.length;
      const target = tracks[safeIdx];
      if (target) {
        void playStudyTrack(target, subIdx);
      }
    },
    [tracks, playStudyTrack]
  );

  const addLocalFiles = useCallback(
    async (fileList: FileList | null) => {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      const uploadedSaved: SavedMusicTrack[] = [];
      const fallbackAdded: StudyTrack[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const title = file.name.replace(/\.[^.]+$/, '') || 'Audio track';
        try {
          const uploaded = await uploadCustomAudioFile(file, {
            title,
            saveToApp: true,
          });
          uploadedSaved.push(uploaded);
        } catch {
          const id = `local_${Date.now()}_${i}`;
          const subtitle = 'Saved audio file';
          await saveLocalAudioTrack({
            id,
            workspaceId,
            title,
            subtitle,
            mimeType: file.type || 'audio/mpeg',
            blob: file,
            createdAt: Date.now() + i,
          });
          const objectUrl = URL.createObjectURL(file);
          objectUrlsRef.current.push(objectUrl);
          fallbackAdded.push({
            id,
            title,
            subtitle,
            kind: 'file',
            objectUrl,
          });
        }
      }

      if (uploadedSaved.length > 0) {
        onSaveSpotifyTracks((prev) => [
          ...uploadedSaved,
          ...prev.filter((item) => !uploadedSaved.some((u) => u.id === item.id)),
        ]);
        const first = uploadedSaved[0];
        void playStudyTrack(
          {
            id: first.id,
            title: first.title,
            subtitle: first.subtitle,
            kind: 'custom',
            audioUrl: first.audioUrl,
            mimeType: first.mimeType,
          },
          0
        );
      }

      if (fallbackAdded.length > 0) {
        setLocalTracks((prev) => [...prev, ...fallbackAdded]);
        if (uploadedSaved.length === 0 && fallbackAdded[0]) {
          void playStudyTrack(fallbackAdded[0], 0);
        }
      }
    },
    [workspaceId, onSaveSpotifyTracks, playStudyTrack]
  );

  const playSavedTrack = useCallback(
    (saved: SavedMusicTrack) => {
      ensureSavedInLibrary(saved);
      void playStudyTrack(
        {
          id: saved.id,
          title: saved.title,
          subtitle: saved.subtitle,
          kind: saved.kind === 'custom' ? 'custom' : 'spotify',
          audioUrl: saved.audioUrl,
          mimeType: saved.mimeType,
          spotifyKind: saved.spotifyKind,
          spotifyId: saved.spotifyId,
          spotifyUrl: saved.spotifyUrl,
          embedUrl: saved.embedUrl,
          thumbnailUrl: saved.thumbnailUrl,
          previewUrl: saved.previewUrl,
          durationMs: saved.durationMs,
          youtubeVideoId: saved.youtubeVideoId,
          youtubeVideoIds: saved.youtubeVideoIds,
          matchVersion: saved.matchVersion,
          tracks: saved.tracks,
        },
        0
      );
    },
    [ensureSavedInLibrary, playStudyTrack]
  );

  const removeTrack = useCallback(
    async (track: StudyTrack) => {
      if (track.kind === 'file') {
        await deleteLocalAudioTrack(track.id);
        if (track.objectUrl) {
          URL.revokeObjectURL(track.objectUrl);
        }
        setLocalTracks((prev) => prev.filter((item) => item.id !== track.id));
      } else if (track.kind === 'spotify' || track.kind === 'custom') {
        onSaveSpotifyTracks((prev) => prev.filter((item) => item.id !== track.id));
      }
      if (selectedTrackId === track.id) {
        studyAudio.stop();
        setSelectedTrackId(BUILTIN_STUDY_TRACKS[0].id);
        setActiveSubIndex(0);
      }
    },
    [onSaveSpotifyTracks, selectedTrackId]
  );

  const activeSubTrack =
    currentTrack?.kind === 'spotify' && currentTrack.tracks && currentTrack.tracks.length > 0
      ? currentTrack.tracks[activeSubIndex] || currentTrack.tracks[0]
      : null;

  return {
    tracks,
    currentIdx,
    currentTrack,
    activeSubIndex,
    activeSubTrack,
    audioState,
    resolvingTrack,
    volume,
    muted,
    setVolume: (val: number) => {
      setMuted(false);
      setVolume(val);
    },
    toggleMute: () => setMuted((m) => !m),
    seekTo: (secs: number) => studyAudio.seekTo(secs),
    togglePlayPause,
    stepTrack,
    selectTrackIndex,
    playStudyTrack,
    playSavedTrack,
    addLocalFiles,
    removeTrack,
  };
}

export type StudyAudioController = ReturnType<typeof useStudyAudioController>;
