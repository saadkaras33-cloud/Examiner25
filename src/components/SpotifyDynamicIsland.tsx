import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Disc3,
  EyeOff,
  FileAudio,
  Headphones,
  Loader2,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { fetchTrackLyrics } from '../services/api.ts';
import { useTranslation } from '../utils/i18n.tsx';
import { formatAudioClock, type StudyAudioController } from '../utils/useStudyAudioController.ts';

interface SpotifyDynamicIslandProps {
  audio: StudyAudioController;
  forceExpanded?: boolean;
  hidden?: boolean;
  hasHeaderPoster?: boolean;
  onHideChange?: (hidden: boolean) => void;
  onExpandedChange?: (expanded: boolean) => void;
}

interface LrcLine {
  time: number;
  text: string;
}

function parseLrcLines(syncedLyrics: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const rawLines = syncedLyrics.split(/\r?\n/);
  const tagRegex = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const raw of rawLines) {
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(raw)) !== null) {
      const mins = Number(match[1]);
      const secs = Number(match[2]);
      const fracRaw = match[3] || '0';
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      timestamps.push(mins * 60 + secs + frac);
    }
    const text = raw.replace(tagRegex, '').trim();
    if (timestamps.length > 0 && text) {
      for (const ts of timestamps) {
        lines.push({ time: ts, text });
      }
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export default function SpotifyDynamicIsland({
  audio,
  forceExpanded = false,
  hidden = false,
  hasHeaderPoster = false,
  onHideChange,
  onExpandedChange,
}: SpotifyDynamicIslandProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [syncedLines, setSyncedLines] = useState<LrcLine[]>([]);
  const [plainLines, setPlainLines] = useState<string[]>([]);
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [lyricsTrackKey, setLyricsTrackKey] = useState('');

  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  const {
    currentTrack,
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
  } = audio;

  useEffect(() => {
    if (forceExpanded) {
      setExpanded(true);
    }
  }, [forceExpanded]);

  const setExpandedState = (next: boolean) => {
    setExpanded(next);
    onExpandedChange?.(next);
  };

  const displayTitle = activeSubTrack ? activeSubTrack.title : currentTrack?.title || 'Study Audio';
  const displayArtist = activeSubTrack ? activeSubTrack.artist : currentTrack?.subtitle || '';
  const durationMs = activeSubTrack?.durationMs || currentTrack?.durationMs;
  const posterUrl = currentTrack?.thumbnailUrl;
  const isBusy = resolvingTrack || audioState.loading;

  const lookupKey = useMemo(
    () => `${currentTrack?.id || ''}:${displayTitle}:${displayArtist}`,
    [currentTrack?.id, displayTitle, displayArtist]
  );

  // Fetch song lyrics whenever the active song changes
  useEffect(() => {
    if (!currentTrack || currentTrack.kind === 'synth') {
      setSyncedLines([]);
      setPlainLines([]);
      setIsInstrumental(false);
      setLyricsLoading(false);
      setLyricsTrackKey('');
      return;
    }

    if (lyricsTrackKey === lookupKey) return;
    let active = true;
    setLyricsLoading(true);
    setSyncedLines([]);
    setPlainLines([]);
    setIsInstrumental(false);

    fetchTrackLyrics({
      title: displayTitle,
      artist: displayArtist,
      durationMs,
    })
      .then((res) => {
        if (!active) return;
        setLyricsTrackKey(lookupKey);
        setIsInstrumental(res.instrumental);
        if (res.syncedLyrics) {
          setSyncedLines(parseLrcLines(res.syncedLyrics));
        } else if (res.plainLyrics) {
          setPlainLines(
            res.plainLyrics
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean)
          );
        }
      })
      .finally(() => {
        if (active) setLyricsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [currentTrack, displayTitle, displayArtist, durationMs, lookupKey, lyricsTrackKey]);

  const activeSyncedIdx = useMemo(() => {
    if (syncedLines.length === 0) return -1;
    const tSec = audioState.currentTime + 0.15;
    let found = -1;
    for (let i = 0; i < syncedLines.length; i++) {
      if (syncedLines[i].time <= tSec) {
        found = i;
      } else {
        break;
      }
    }
    return found;
  }, [syncedLines, audioState.currentTime]);

  useEffect(() => {
    if (expanded && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expanded, activeSyncedIdx]);

  if (!currentTrack) {
    return null;
  }

  const TrackIcon =
    currentTrack.kind === 'spotify'
      ? Disc3
      : currentTrack.kind === 'custom' || currentTrack.kind === 'file'
      ? FileAudio
      : Headphones;

  // Compact restore trigger when user hid the expanded sheet
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => {
          onHideChange?.(false);
          setExpandedState(true);
        }}
        className={`h-8 max-w-full sm:max-w-[14rem] rounded-full px-2.5 inline-flex items-center gap-1.5 transition cursor-pointer ${
          hasHeaderPoster
            ? 'bg-white/15 hover:bg-white/25 text-white'
            : 'bg-primary/10 hover:bg-primary/18 text-primary'
        }`}
      >
        <TrackIcon size={12} className="shrink-0 opacity-90" />
        <span dir="auto" className="text-[0.68rem] font-semibold truncate">
          {displayTitle}
        </span>
      </button>
    );
  }

  const activeLyricPreview =
    activeSyncedIdx >= 0
      ? syncedLines[activeSyncedIdx]?.text
      : plainLines.length > 0
      ? plainLines[0]
      : '';

  const subtitleOrLyric =
    activeLyricPreview ||
    (isBusy ? t('spotifyExtracting') : displayArtist || t('studyPlayer'));

  return (
    <div className="relative min-w-0 flex-1 flex items-center justify-between gap-2">
      {/* Borderless inline song name + live lyrics beside the sidebar button inside the blurred poster upward bar */}
      <button
        type="button"
        onClick={() => setExpandedState(!expanded)}
        className="flex items-center gap-2 min-w-0 flex-1 text-start cursor-pointer py-0.5"
      >
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={displayTitle}
            referrerPolicy="no-referrer"
            className={`h-7 w-7 rounded-full object-cover shadow-xs shrink-0 ${
              audioState.playing ? 'animate-[spin_10s_linear_infinite]' : ''
            }`}
          />
        ) : (
          <span
            className={`h-7 w-7 rounded-full grid place-items-center shrink-0 ${
              hasHeaderPoster
                ? 'bg-white/18 text-white'
                : 'bg-secondary/15 text-secondary'
            }`}
          >
            <TrackIcon size={13} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div
            dir="auto"
            className={`text-[0.76rem] sm:text-[0.86rem] font-semibold leading-[1.24] whitespace-normal break-words [overflow-wrap:anywhere] ${
              hasHeaderPoster ? 'text-white drop-shadow-xs' : 'text-primary'
            }`}
          >
            {subtitleOrLyric}
          </div>
          <div
            dir="auto"
            className={`text-[0.62rem] sm:text-[0.64rem] font-medium leading-tight truncate mt-0.5 ${
              hasHeaderPoster ? 'text-white/75 drop-shadow-xs' : 'text-primary/65'
            }`}
          >
            {displayTitle}
          </div>
        </div>
      </button>

      {/* Borderless inline audio controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        {audioState.playing && (
          <span aria-hidden="true" className="hidden xs:flex items-end gap-[2px] h-2.5 px-0.5">
            <span
              className={`w-[2px] h-full rounded-full animate-pulse ${
                hasHeaderPoster ? 'bg-white/90' : 'bg-secondary'
              }`}
            />
            <span
              className={`w-[2px] h-2/3 rounded-full animate-pulse ${
                hasHeaderPoster ? 'bg-white/90' : 'bg-secondary'
              }`}
            />
            <span
              className={`w-[2px] h-4/5 rounded-full animate-pulse ${
                hasHeaderPoster ? 'bg-white/90' : 'bg-secondary'
              }`}
            />
          </span>
        )}

        <button
          type="button"
          onClick={togglePlayPause}
          aria-label={audioState.playing ? 'Pause' : 'Play'}
          className={`h-7 w-7 rounded-full grid place-items-center hover:scale-105 transition cursor-pointer shrink-0 ${
            hasHeaderPoster
              ? 'bg-white text-[#101418] shadow-xs'
              : 'bg-primary text-on-primary shadow-xs'
          }`}
        >
          {isBusy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : audioState.playing ? (
            <Pause size={12} />
          ) : (
            <Play size={12} className="ms-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setExpandedState(!expanded)}
          aria-label={t('lyricsTitle')}
          title={t('lyricsTitle')}
          className={`h-7 px-2 rounded-full text-[0.62rem] font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0 transition ${
            hasHeaderPoster
              ? expanded
                ? 'bg-white text-[#101418]'
                : 'bg-white/18 hover:bg-white/28 text-white'
              : expanded
              ? 'bg-secondary text-on-secondary'
              : 'bg-primary/10 hover:bg-primary/18 text-primary'
          }`}
        >
          <Music2 size={10} />
          <span className="hidden sm:inline">{t('lyricsTitle')}</span>
        </button>
      </div>

      {/* Expanded Dynamic Island Popover anchored seamlessly below the top upward bar (zero solid borders) */}
      {expanded && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setExpandedState(false)}
            className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
          />

          <div className="fixed top-[calc(3.6rem+env(safe-area-inset-top,0px))] start-2.5 end-2.5 sm:start-4 sm:end-auto sm:w-[min(92vw,26.5rem)] max-h-[calc(100dvh-4.35rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] z-50 flex flex-col overflow-hidden rounded-[24px] sm:rounded-[28px] text-white shadow-[0_24px_60px_rgba(0,0,0,0.48)]">
            <div aria-hidden="true" className="absolute inset-0 z-0 overflow-hidden bg-[#0e1116]">
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover blur-2xl scale-150 brightness-[0.42] saturate-150"
                />
              ) : (
                <div
                  className="w-full h-full"
                  style={{
                    background:
                      'linear-gradient(135deg, rgb(var(--rgb-poster-a) / 0.5), rgb(var(--rgb-poster-b) / 0.7))',
                  }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/40 to-black/72 backdrop-blur-md" />
            </div>

            <div className="relative z-10 p-3.5 sm:p-4 space-y-3 flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain">
              {/* Header Row */}
              <div className="flex items-start gap-3">
                {posterUrl ? (
                  <img
                    src={posterUrl}
                    alt={displayTitle}
                    referrerPolicy="no-referrer"
                    className="h-14 w-14 rounded-2xl object-cover shadow-lg shrink-0"
                  />
                ) : (
                  <span className="h-14 w-14 rounded-2xl bg-white/15 text-white grid place-items-center shrink-0">
                    <TrackIcon size={24} />
                  </span>
                )}

                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-white/75">
                    <Disc3 size={10} />
                    <span>
                      {currentTrack.kind === 'spotify'
                        ? 'Spotify'
                        : currentTrack.kind === 'custom'
                        ? t('customAudioBadge')
                        : t('studyPlayer')}
                    </span>
                  </div>
                  <div
                    dir="auto"
                    className="text-[0.88rem] font-semibold leading-snug break-words text-white mt-0.5"
                  >
                    {displayTitle}
                  </div>
                  <div dir="auto" className="text-[0.7rem] text-white/75 leading-snug break-words">
                    {displayArtist}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {onHideChange && (
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedState(false);
                        onHideChange(true);
                      }}
                      aria-label={t('hideDynamicIsland')}
                      title={t('hideDynamicIsland')}
                      className="h-8 w-8 rounded-full bg-white/15 hover:bg-white/25 text-white grid place-items-center cursor-pointer"
                    >
                      <EyeOff size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedState(false)}
                    aria-label={t('collapseBtn')}
                    title={t('collapseBtn')}
                    className="h-8 w-8 rounded-full bg-white/15 hover:bg-white/25 text-white grid place-items-center cursor-pointer"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
              </div>

              {/* Scrubber & Timestamps */}
              <div className="space-y-1">
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.floor(audioState.duration || audioState.currentTime || 1))}
                  step={1}
                  value={Math.min(
                    Math.floor(audioState.currentTime),
                    Math.max(1, Math.floor(audioState.duration || audioState.currentTime || 1))
                  )}
                  onChange={(e) => seekTo(Number(e.target.value))}
                  aria-label="Seek track"
                  className="w-full accent-white h-1.5 cursor-pointer"
                />
                <div className="flex items-center justify-between text-[0.66rem] font-mono text-white/75 tabular-nums">
                  <span>{formatAudioClock(audioState.currentTime)}</span>
                  <span>
                    {audioState.duration > 0 ? formatAudioClock(audioState.duration) : '--:--'}
                  </span>
                </div>
              </div>

              {/* Transport + Volume Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => stepTrack(-1)}
                    aria-label="Previous track"
                    className="h-9 w-9 rounded-full bg-white/15 hover:bg-white/25 text-white grid place-items-center cursor-pointer"
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlayPause}
                    aria-label={audioState.playing ? 'Pause' : 'Play'}
                    className="h-10 w-10 rounded-full bg-white text-[#101418] grid place-items-center hover:scale-105 transition cursor-pointer shadow-sm"
                  >
                    {isBusy ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : audioState.playing ? (
                      <Pause size={17} />
                    ) : (
                      <Play size={17} className="ms-0.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => stepTrack(1)}
                    aria-label="Next track"
                    className="h-9 w-9 rounded-full bg-white/15 hover:bg-white/25 text-white grid place-items-center cursor-pointer"
                  >
                    <SkipForward size={15} />
                  </button>
                </div>

                <div className="flex items-center gap-1.5 flex-1 min-w-[7rem] max-w-[9.5rem]">
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                    className="text-white/85 hover:text-white cursor-pointer"
                  >
                    {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label="Volume"
                    className="w-full accent-white h-1 cursor-pointer"
                  />
                </div>
              </div>

              {/* Song Lyrics Card (zero hard solid lines) */}
              <div className="rounded-2xl bg-black/30 backdrop-blur-sm p-3 pb-7 flex flex-col flex-1 min-h-[10rem] max-h-[46dvh] overflow-y-auto overscroll-contain space-y-1.5">
                <div className="flex items-center justify-between text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/65 pb-1 shrink-0">
                  <span className="inline-flex items-center gap-1">
                    <Music2 size={11} className="text-white/90" />
                    {t('lyricsTitle')}
                  </span>
                  {syncedLines.length > 0 && (
                    <span className="text-white/90">{t('syncedLiveBadge')}</span>
                  )}
                </div>

                {currentTrack.kind === 'synth' ? (
                  <div className="py-6 text-center text-[0.75rem] text-white/75">
                    {t('instrumentalTrack')}
                  </div>
                ) : lyricsLoading ? (
                  <div className="py-6 flex items-center justify-center gap-2 text-[0.75rem] text-white/80">
                    <Loader2 size={14} className="animate-spin text-white" />
                    <span>{t('loadingLyrics')}</span>
                  </div>
                ) : isInstrumental ? (
                  <div className="py-6 text-center text-[0.75rem] text-white/75">
                    {t('instrumentalTrack')}
                  </div>
                ) : syncedLines.length > 0 ? (
                  <div className="space-y-1.5 py-1 pb-4">
                    {syncedLines.map((line, i) => {
                      const isActive = i === activeSyncedIdx;
                      return (
                        <button
                          key={`${line.time}_${i}`}
                          ref={isActive ? activeLineRef : undefined}
                          type="button"
                          onClick={() => seekTo(line.time)}
                          dir="auto"
                          className={`w-full text-start rounded-lg px-2 py-1.5 transition cursor-pointer leading-snug whitespace-normal break-words [overflow-wrap:anywhere] ${
                            isActive
                              ? 'text-white font-bold text-[0.84rem] bg-white/15'
                              : 'text-white/65 hover:text-white/95 text-[0.76rem]'
                          }`}
                        >
                          {line.text}
                        </button>
                      );
                    })}
                  </div>
                ) : plainLines.length > 0 ? (
                  <div className="space-y-2 py-1 pb-4">
                    {plainLines.map((line, i) => (
                      <p
                        key={i}
                        dir="auto"
                        className="text-[0.78rem] text-white/90 leading-relaxed whitespace-normal break-words [overflow-wrap:anywhere]"
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-[0.75rem] text-white/75">
                    {t('noLyricsFound')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
