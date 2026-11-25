import { useRef, useState } from 'react';
import {
  Check,
  Disc3,
  FileAudio,
  Headphones,
  Link2,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { SavedMusicTrack } from '../types.ts';
import { extractSpotifyUrl } from '../services/api.ts';
import { useTranslation } from '../utils/i18n.tsx';
import { formatAudioClock, type StudyAudioController } from '../utils/useStudyAudioController.ts';

interface MusicPlayerProps {
  audio: StudyAudioController;
  onSaveSpotifyTracks: (
    next: SavedMusicTrack[] | ((prev: SavedMusicTrack[]) => SavedMusicTrack[])
  ) => void;
  onOpenDynamicIsland?: () => void;
}

export default function MusicPlayer({
  audio,
  onSaveSpotifyTracks,
  onOpenDynamicIsland,
}: MusicPlayerProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [spotifyInput, setSpotifyInput] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [extractError, setExtractError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    tracks,
    currentIdx,
    currentTrack,
    activeSubIndex,
    activeSubTrack,
    audioState,
    resolvingTrack,
    volume,
    muted,
    setVolume,
    toggleMute,
    seekTo,
    togglePlayPause,
    stepTrack,
    selectTrackIndex,
    playStudyTrack,
    addLocalFiles,
    removeTrack,
  } = audio;

  async function handleExtractSpotify(e: React.FormEvent) {
    e.preventDefault();
    const raw = spotifyInput.trim();
    if (!raw) {
      setExtractError(t('spotifyEmptyError'));
      return;
    }
    setExtractError('');
    setExtracting(true);
    try {
      const extracted = await extractSpotifyUrl(raw);
      onSaveSpotifyTracks((prev) => [
        extracted,
        ...prev.filter((item) => item.id !== extracted.id && item.embedUrl !== extracted.embedUrl),
      ]);
      setExpanded(true);
      setSpotifyInput('');

      void playStudyTrack(
        {
          id: extracted.id,
          title: extracted.title,
          subtitle: extracted.subtitle,
          kind: 'spotify',
          spotifyKind: extracted.spotifyKind,
          spotifyId: extracted.spotifyId,
          spotifyUrl: extracted.spotifyUrl,
          embedUrl: extracted.embedUrl,
          thumbnailUrl: extracted.thumbnailUrl,
          previewUrl: extracted.previewUrl,
          durationMs: extracted.durationMs,
          youtubeVideoId: extracted.youtubeVideoId,
          youtubeVideoIds: extracted.youtubeVideoIds,
          matchVersion: extracted.matchVersion,
          tracks: extracted.tracks,
        },
        0
      );
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Could not read that Spotify link.');
    } finally {
      setExtracting(false);
    }
  }

  async function handleAudioFileChange(files: FileList | null) {
    if (!files || files.length === 0) return;
    setExtractError('');
    setUploadingAudio(true);
    try {
      await addLocalFiles(files);
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Could not upload audio file.');
    } finally {
      setUploadingAudio(false);
    }
  }

  function kindBadgeLabel(spKind?: 'track' | 'album' | 'playlist') {
    if (spKind === 'album') return t('spotifyAlbum');
    if (spKind === 'playlist') return t('spotifyPlaylist');
    return t('spotifySong');
  }

  const displayTitle = activeSubTrack ? activeSubTrack.title : currentTrack.title;
  const displaySubtitle = activeSubTrack
    ? `${activeSubTrack.artist} · ${currentTrack.title}`
    : currentTrack.subtitle;
  const isBusy = resolvingTrack || audioState.loading;

  return (
    <div className="mx-3 mb-2 rounded-2xl bg-surface border hairline p-3 space-y-2.5">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleAudioFileChange(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {currentTrack.thumbnailUrl ? (
            <img
              src={currentTrack.thumbnailUrl}
              alt={displayTitle}
              referrerPolicy="no-referrer"
              className="h-9 w-9 rounded-lg object-cover shrink-0 mt-0.5"
            />
          ) : (
            <span className="h-9 w-9 rounded-lg bg-secondary/15 text-secondary grid place-items-center shrink-0 mt-0.5">
              <Headphones size={15} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div dir="auto" className="text-[0.8rem] font-semibold leading-snug break-words">
              {displayTitle}
            </div>
            <div dir="auto" className="text-[0.68rem] text-primary/65 leading-snug break-words mt-0.5">
              {isBusy
                ? t('spotifyExtracting')
                : audioState.playing
                ? `${t('playing')} · ${displaySubtitle}`
                : displaySubtitle}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={t('tracks')}
          className="h-7 w-7 grid place-items-center rounded-lg btn-ghost shrink-0 cursor-pointer"
        >
          <ListMusic size={15} />
        </button>
      </div>

      {/* Scrub progress bar for full-length songs and audio files */}
      {(audioState.duration > 0 || audioState.currentTime > 0) && (
        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(audioState.duration || audioState.currentTime))}
            step={1}
            value={Math.min(
              Math.floor(audioState.currentTime),
              Math.max(1, Math.floor(audioState.duration || audioState.currentTime))
            )}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Seek audio"
            className="w-full accent-[#1DB954] h-1 cursor-pointer"
          />
          <div className="flex items-center justify-between text-[0.65rem] font-mono text-primary/60 tabular-nums">
            <span>{formatAudioClock(audioState.currentTime)}</span>
            <span>{audioState.duration > 0 ? formatAudioClock(audioState.duration) : '--:--'}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => stepTrack(-1)}
            aria-label="Previous track"
            className="h-8 w-8 grid place-items-center rounded-lg btn-ghost cursor-pointer"
          >
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            onClick={togglePlayPause}
            aria-label={audioState.playing ? 'Pause' : 'Play'}
            className="h-9 w-9 grid place-items-center rounded-xl bg-primary text-on-primary cursor-pointer"
          >
            {isBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : audioState.playing ? (
              <Pause size={15} />
            ) : (
              <Play size={15} className="ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => stepTrack(1)}
            aria-label="Next track"
            className="h-8 w-8 grid place-items-center rounded-lg btn-ghost cursor-pointer"
          >
            <SkipForward size={14} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-1 ps-1">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="text-primary/80 hover:text-primary cursor-pointer"
          >
            {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
            className="w-full accent-secondary h-1 cursor-pointer"
          />
        </div>
      </div>

      {onOpenDynamicIsland && (
        <button
          type="button"
          onClick={onOpenDynamicIsland}
          className="w-full min-h-[2.1rem] px-3 py-1.5 rounded-xl bg-[#15803D] text-white hover:opacity-95 text-[0.74rem] font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
        >
          <Sparkles size={14} className="shrink-0" />
          <span className="leading-snug text-center">{t('openDynamicIsland')}</span>
        </button>
      )}

      {expanded && (
        <div className="pt-2 border-t hairline space-y-2.5">
          <form onSubmit={handleExtractSpotify} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Link2
                  size={12}
                  className="absolute start-2.5 top-1/2 -translate-y-1/2 text-primary/50 pointer-events-none"
                />
                <input
                  type="text"
                  dir="ltr"
                  value={spotifyInput}
                  onChange={(e) => setSpotifyInput(e.target.value)}
                  placeholder={t('spotifyPasteHint')}
                  className="w-full h-8 rounded-lg border border-primary/15 bg-surface-soft ps-7 pe-2 text-[0.72rem] outline-none focus:border-[#1DB954]/60"
                />
              </div>
              <button
                type="submit"
                disabled={extracting}
                className="h-8 px-2.5 rounded-lg bg-[#15803D] text-white text-[0.7rem] font-semibold inline-flex items-center gap-1 hover:opacity-95 disabled:opacity-60 cursor-pointer shrink-0 whitespace-nowrap"
              >
                {extracting && <Loader2 size={11} className="animate-spin" />}
                {extracting ? t('spotifyExtracting') : t('spotifyExtractShort')}
              </button>
            </div>
            {extractError && (
              <p className="text-[0.68rem] font-medium text-secondary leading-tight">
                {extractError}
              </p>
            )}
          </form>

          {currentTrack.kind === 'spotify' && currentTrack.tracks && currentTrack.tracks.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-xl border hairline bg-surface-soft p-1.5 space-y-1">
              {currentTrack.tracks.map((tr, i) => {
                const subActive = i === activeSubIndex;
                return (
                  <button
                    key={`${tr.id || tr.title}_${i}`}
                    type="button"
                    onClick={() => void playStudyTrack(currentTrack, i)}
                    className={`w-full flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-[0.72rem] transition cursor-pointer ${
                      subActive
                        ? 'bg-[#1DB954]/15 text-[#1DB954] font-semibold'
                        : 'text-primary/85 hover:bg-primary/5'
                    }`}
                  >
                    <span dir="auto" className="leading-snug break-words flex-1">
                      {i + 1}. {tr.title} — {tr.artist}
                    </span>
                    <Play size={11} className="text-[#1DB954] shrink-0 mt-0.5" />
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {tracks.map((track, idx) => {
              const active = idx === currentIdx;
              const removable =
                track.kind === 'file' || track.kind === 'spotify' || track.kind === 'custom';
              return (
                <div
                  key={track.id}
                  className={`w-full flex items-start justify-between gap-1.5 rounded-xl px-2.5 py-2 text-[0.74rem] transition ${
                    active
                      ? 'bg-primary/12 font-semibold text-primary'
                      : 'text-primary/80 hover:bg-primary/5'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectTrackIndex(idx, 0)}
                    className="flex-1 min-w-0 text-start flex items-start gap-2 cursor-pointer"
                  >
                    {track.kind === 'spotify' && (
                      <Disc3 size={12} className="text-[#1DB954] shrink-0 mt-0.5" />
                    )}
                    {track.kind === 'custom' && (
                      <FileAudio size={12} className="text-secondary shrink-0 mt-0.5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block leading-snug break-words">
                        {track.title}
                      </span>
                      <span className="block text-[0.64rem] text-primary/60 leading-snug break-words">
                        {track.kind === 'spotify'
                          ? `${kindBadgeLabel(track.spotifyKind)} · ${track.subtitle}`
                          : track.kind === 'custom'
                          ? `${t('customAudioBadge')} · ${track.subtitle}`
                          : track.subtitle}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-1 shrink-0 pt-0.5">
                    {(track.kind === 'spotify' || track.kind === 'custom' || track.kind === 'file') && (
                      <span className="inline-flex items-center gap-0.5 text-[0.6rem] font-bold text-[#1DB954]">
                        <Check size={9} /> {t('spotifySavedChip')}
                      </span>
                    )}
                    {removable && (
                      <button
                        type="button"
                        onClick={() => void removeTrack(track)}
                        aria-label={t('removeTrack')}
                        className="text-primary/50 hover:text-secondary cursor-pointer p-0.5"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={uploadingAudio}
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl btn-secondary px-2.5 py-2 text-[0.74rem] font-semibold disabled:opacity-60 cursor-pointer"
          >
            {uploadingAudio ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {uploadingAudio ? t('uploadingAudio') : t('uploadAudioToApp')}
          </button>
        </div>
      )}
    </div>
  );
}
