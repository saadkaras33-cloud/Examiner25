import type { SpotifyTrackItem } from '../types.ts';

export interface StudyTrack {
  id: string;
  title: string;
  subtitle: string;
  kind: 'synth' | 'file' | 'spotify' | 'custom';
  preset?: 'lofi' | 'rain' | 'piano' | 'alpha';
  objectUrl?: string;
  audioUrl?: string;
  mimeType?: string;
  previewUrl?: string;
  spotifyKind?: 'track' | 'album' | 'playlist';
  spotifyId?: string;
  spotifyUrl?: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  durationMs?: number;
  youtubeVideoId?: string;
  youtubeVideoIds?: string[];
  matchVersion?: number;
  tracks?: SpotifyTrackItem[];
}

export interface AudioPlaybackState {
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  mode: 'idle' | 'synth' | 'file' | 'youtube';
}

export const BUILTIN_STUDY_TRACKS: StudyTrack[] = [
  {
    id: 'lofi-chords',
    title: 'Warm Study Chords',
    subtitle: 'Soft Rhodes progression',
    kind: 'synth',
    preset: 'lofi',
  },
  {
    id: 'rainy-library',
    title: 'Rainy Library',
    subtitle: 'Filtered rain ambience',
    kind: 'synth',
    preset: 'rain',
  },
  {
    id: 'piano-drift',
    title: 'Felt Piano Drift',
    subtitle: 'Gentle pentatonic notes',
    kind: 'synth',
    preset: 'piano',
  },
  {
    id: 'alpha-focus',
    title: 'Deep Focus Drone',
    subtitle: 'Warm harmonic hum',
    kind: 'synth',
    preset: 'alpha',
  },
];

interface YTPlayerInstance {
  loadVideoById: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setVolume: (vol: number) => void;
  mute: () => void;
  unMute: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
}

interface YTGlobal {
  Player: new (
    el: HTMLElement | string,
    opts: {
      width?: number | string;
      height?: number | string;
      videoId?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (ev: { target: YTPlayerInstance }) => void;
        onStateChange?: (ev: { data: number; target: YTPlayerInstance }) => void;
        onError?: (ev: { data: number }) => void;
      };
    }
  ) => YTPlayerInstance;
  PlayerState?: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
  };
}

let ytApiPromise: Promise<YTGlobal> | null = null;

function loadYouTubeIframeApi(): Promise<YTGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('No window'));
  }
  const win = window as unknown as { YT?: YTGlobal; onYouTubeIframeAPIReady?: () => void };
  if (win.YT?.Player) {
    return Promise.resolve(win.YT);
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<YTGlobal>((resolve, reject) => {
    const prevReady = win.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      reject(new Error('YouTube API load timeout'));
    }, 10000);

    win.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      if (typeof prevReady === 'function') prevReady();
      if (win.YT?.Player) {
        resolve(win.YT);
      } else {
        reject(new Error('YouTube Player unavailable'));
      }
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Failed to load YouTube API'));
      };
      document.head.appendChild(tag);
    }
  });

  return ytApiPromise;
}

class StudyAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private intervalId: number | null = null;
  private activeNodes: AudioNode[] = [];
  private htmlAudio: HTMLAudioElement | null = null;
  private ytPlayer: YTPlayerInstance | null = null;
  private ytReady = false;
  private ytHostEl: HTMLDivElement | null = null;
  private ytCandidates: string[] = [];
  private ytCandidateIdx = 0;
  private ytFallbackPreview: string | undefined;
  private ytOnEnded: (() => void) | undefined;
  private ytPollId: number | null = null;
  private pendingYtId: string | null = null;
  private volume = 0.55;
  private playSession = 0;

  private state: AudioPlaybackState = {
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    mode: 'idle',
  };

  private listeners = new Set<(state: AudioPlaybackState) => void>();

  getState(): AudioPlaybackState {
    return this.state;
  }

  subscribe(listener: (state: AudioPlaybackState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: Partial<AudioPlaybackState>) {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) {
      cb(this.state);
    }
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume * 0.45;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private ensureYtHost(): HTMLDivElement {
    if (this.ytHostEl && document.body.contains(this.ytHostEl)) {
      return this.ytHostEl;
    }
    const wrapper = document.createElement('div');
    wrapper.id = 'examiner-full-audio-host';
    wrapper.style.position = 'fixed';
    wrapper.style.bottom = '0';
    wrapper.style.right = '0';
    wrapper.style.width = '2px';
    wrapper.style.height = '2px';
    wrapper.style.opacity = '0.01';
    wrapper.style.pointerEvents = 'none';
    wrapper.style.overflow = 'hidden';
    wrapper.style.zIndex = '-1';
    const target = document.createElement('div');
    wrapper.appendChild(target);
    document.body.appendChild(wrapper);
    this.ytHostEl = wrapper;
    return wrapper;
  }

  private stopYtPoll() {
    if (this.ytPollId !== null) {
      window.clearInterval(this.ytPollId);
      this.ytPollId = null;
    }
  }

  private startYtPoll() {
    this.stopYtPoll();
    this.ytPollId = window.setInterval(() => {
      if (!this.ytPlayer || !this.ytReady || this.state.mode !== 'youtube') return;
      try {
        const cur = this.ytPlayer.getCurrentTime?.() || 0;
        const dur = this.ytPlayer.getDuration?.() || 0;
        const pState = this.ytPlayer.getPlayerState?.();
        const isPlaying = pState === 1;
        this.emit({
          currentTime: cur,
          duration: dur > 0 ? dur : this.state.duration,
          playing: isPlaying || pState === 3,
          loading: pState === 3 && cur === 0,
        });
      } catch {
        // Ignore transient YT state read errors
      }
    }, 500);
  }

  setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume * 0.45, this.ctx.currentTime, 0.05);
    }
    if (this.htmlAudio) {
      this.htmlAudio.volume = this.volume;
    }
    if (this.ytPlayer && this.ytReady) {
      try {
        if (this.volume === 0) {
          this.ytPlayer.mute();
        } else {
          this.ytPlayer.unMute();
          this.ytPlayer.setVolume(Math.round(this.volume * 100));
        }
      } catch {
        // Ignore YT player errors
      }
    }
  }

  seekTo(seconds: number) {
    const safeSec = Math.max(0, seconds);
    if (this.htmlAudio) {
      this.htmlAudio.currentTime = safeSec;
      this.emit({ currentTime: safeSec });
      return;
    }
    if (this.ytPlayer && this.ytReady && this.state.mode === 'youtube') {
      try {
        this.ytPlayer.seekTo(safeSec, true);
        this.emit({ currentTime: safeSec });
      } catch {
        // Ignore seek error
      }
    }
  }

  pause() {
    if (this.htmlAudio && !this.htmlAudio.paused) {
      this.htmlAudio.pause();
      this.emit({ playing: false });
      return;
    }
    if (this.ytPlayer && this.ytReady && this.state.mode === 'youtube') {
      try {
        this.ytPlayer.pauseVideo();
        this.emit({ playing: false });
      } catch {
        // Ignore
      }
      return;
    }
    this.stop();
  }

  resume() {
    if (this.htmlAudio && this.htmlAudio.paused) {
      this.htmlAudio.play().catch(() => {});
      this.emit({ playing: true });
      return true;
    }
    if (this.ytPlayer && this.ytReady && this.state.mode === 'youtube') {
      try {
        this.ytPlayer.playVideo();
        this.emit({ playing: true });
        return true;
      } catch {
        // Ignore
      }
    }
    return false;
  }

  stop(keepYt = false) {
    this.playSession++;
    this.stopYtPoll();

    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    for (const node of this.activeNodes) {
      try {
        if ('stop' in node && typeof (node as OscillatorNode).stop === 'function') {
          (node as OscillatorNode).stop();
        }
        node.disconnect();
      } catch {
        // Ignore already stopped nodes
      }
    }
    this.activeNodes = [];

    if (this.htmlAudio) {
      this.htmlAudio.pause();
      this.htmlAudio.currentTime = 0;
      this.htmlAudio = null;
    }

    if (!keepYt && this.ytPlayer && this.ytReady) {
      try {
        this.ytPlayer.stopVideo();
      } catch {
        // Ignore
      }
    }

    this.emit({
      playing: false,
      loading: false,
      currentTime: 0,
      duration: 0,
      mode: 'idle',
    });
  }

  playUrl(url: string, loop = false, onEnded?: () => void) {
    this.stop();
    const session = this.playSession;
    const audio = new Audio(url);
    audio.loop = loop;
    audio.volume = this.volume;
    this.htmlAudio = audio;
    this.emit({ playing: true, loading: true, currentTime: 0, duration: 0, mode: 'file' });

    audio.addEventListener('loadedmetadata', () => {
      if (this.playSession !== session) return;
      this.emit({ duration: Number.isFinite(audio.duration) ? audio.duration : 0, loading: false });
    });
    audio.addEventListener('timeupdate', () => {
      if (this.playSession !== session) return;
      this.emit({
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : this.state.duration,
        playing: !audio.paused,
        loading: false,
      });
    });
    audio.addEventListener('ended', () => {
      if (this.playSession !== session) return;
      this.emit({ playing: false });
      onEnded?.();
    });
    audio.play().catch(() => {
      if (this.playSession === session) {
        this.emit({ playing: false, loading: false });
      }
    });
  }

  async playYouTubeCandidates(
    videoIds: string[],
    fallbackPreviewUrl?: string,
    expectedDurationSec?: number,
    onEnded?: () => void
  ) {
    const cleanIds = videoIds.filter(Boolean);
    if (cleanIds.length === 0) {
      if (fallbackPreviewUrl) {
        this.playUrl(fallbackPreviewUrl, false, onEnded);
      }
      return;
    }

    this.stop(true);
    const session = this.playSession;
    this.ytCandidates = cleanIds;
    this.ytCandidateIdx = 0;
    this.ytFallbackPreview = fallbackPreviewUrl;
    this.ytOnEnded = onEnded;

    this.emit({
      playing: true,
      loading: true,
      currentTime: 0,
      duration: expectedDurationSec || 0,
      mode: 'youtube',
    });

    try {
      const YT = await loadYouTubeIframeApi();
      if (this.playSession !== session) return;

      const firstId = cleanIds[0];
      if (!this.ytPlayer) {
        const wrapper = this.ensureYtHost();
        const mountEl = wrapper.firstElementChild as HTMLElement;
        this.pendingYtId = firstId;
        this.ytPlayer = new YT.Player(mountEl, {
          width: 2,
          height: 2,
          videoId: firstId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: (ev) => {
              this.ytReady = true;
              if (this.volume === 0) {
                ev.target.mute();
              } else {
                ev.target.unMute();
                ev.target.setVolume(Math.round(this.volume * 100));
              }
              const targetId = this.pendingYtId;
              this.pendingYtId = null;
              if (targetId && this.state.mode === 'youtube') {
                ev.target.loadVideoById(targetId);
                ev.target.playVideo();
                this.startYtPoll();
              }
            },
            onStateChange: (ev) => {
              if (this.state.mode !== 'youtube') return;
              if (ev.data === 1) {
                // PLAYING
                this.emit({
                  playing: true,
                  loading: false,
                  duration: ev.target.getDuration?.() || this.state.duration,
                });
              } else if (ev.data === 2) {
                // PAUSED
                this.emit({ playing: false, loading: false });
              } else if (ev.data === 0) {
                // ENDED
                this.emit({ playing: false, currentTime: ev.target.getDuration?.() || 0 });
                this.ytOnEnded?.();
              }
            },
            onError: () => {
              if (this.state.mode !== 'youtube') return;
              this.ytCandidateIdx += 1;
              const nextCandidate = this.ytCandidates[this.ytCandidateIdx];
              if (nextCandidate && this.ytPlayer && this.ytReady) {
                this.ytPlayer.loadVideoById(nextCandidate);
                this.ytPlayer.playVideo();
              } else if (this.ytFallbackPreview) {
                this.playUrl(this.ytFallbackPreview, false, this.ytOnEnded);
              } else {
                this.emit({ playing: false, loading: false });
              }
            },
          },
        });
      } else if (this.ytReady) {
        this.ytPlayer.loadVideoById(firstId);
        this.ytPlayer.playVideo();
        if (this.volume === 0) {
          this.ytPlayer.mute();
        } else {
          this.ytPlayer.unMute();
          this.ytPlayer.setVolume(Math.round(this.volume * 100));
        }
        this.startYtPoll();
      } else {
        this.pendingYtId = firstId;
      }
    } catch {
      if (this.playSession === session) {
        if (fallbackPreviewUrl) {
          this.playUrl(fallbackPreviewUrl, false, onEnded);
        } else {
          this.emit({ playing: false, loading: false, mode: 'idle' });
        }
      }
    }
  }

  play(track: StudyTrack, onEnded?: () => void) {
    this.stop(track.kind === 'spotify');

    if (track.kind === 'file' && track.objectUrl) {
      this.playUrl(track.objectUrl, true);
      return;
    }

    if (track.kind === 'custom' && track.audioUrl) {
      this.playUrl(track.audioUrl, true, onEnded);
      return;
    }

    if (track.kind === 'spotify') {
      const ytIds =
        track.youtubeVideoIds && track.youtubeVideoIds.length > 0
          ? track.youtubeVideoIds
          : track.youtubeVideoId
          ? [track.youtubeVideoId]
          : [];
      if (ytIds.length > 0) {
        this.playYouTubeCandidates(
          ytIds,
          track.previewUrl,
          track.durationMs ? track.durationMs / 1000 : undefined,
          onEnded
        );
        return;
      }
      const preview = track.previewUrl || track.tracks?.find((t) => t.previewUrl)?.previewUrl;
      if (preview) {
        this.playUrl(preview, false, onEnded);
      }
      return;
    }

    const ctx = this.ensureContext();
    const out = this.masterGain!;
    this.emit({ playing: true, loading: false, currentTime: 0, duration: 0, mode: 'synth' });

    if (track.preset === 'rain') {
      this.startRain(ctx, out);
    } else if (track.preset === 'piano') {
      this.startPiano(ctx, out);
    } else if (track.preset === 'alpha') {
      this.startAlphaDrone(ctx, out);
    } else {
      this.startLofiChords(ctx, out);
    }
  }

  private startRain(ctx: AudioContext, out: GainNode) {
    const bufferSize = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
      b6 = white * 0.115926;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;

    const gain = ctx.createGain();
    gain.gain.value = 0.65;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start();

    this.activeNodes.push(source, filter, gain);
  }

  private startAlphaDrone(ctx: AudioContext, out: GainNode) {
    const freqs = [110, 165, 220.5, 330];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    filter.connect(out);
    this.activeNodes.push(filter);

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;

      const g = ctx.createGain();
      g.gain.value = 0.14 / (idx + 1);

      osc.connect(g);
      g.connect(filter);
      osc.start();
      this.activeNodes.push(osc, g);
    });
  }

  private startLofiChords(ctx: AudioContext, out: GainNode) {
    const progression = [
      [261.63, 329.63, 392.0, 493.88],
      [220.0, 261.63, 329.63, 392.0],
      [174.61, 220.0, 261.63, 329.63],
      [196.0, 246.94, 293.66, 392.0],
    ];
    let step = 0;

    const triggerChord = () => {
      const chord = progression[step % progression.length];
      step++;
      const now = ctx.currentTime;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(620, now);
      filter.connect(out);

      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        osc.type = idx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, now);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.11, now + 0.35);
        g.gain.exponentialRampToValueAtTime(0.001, now + 3.4);

        osc.connect(g);
        g.connect(filter);
        osc.start(now);
        osc.stop(now + 3.5);
      });
    };

    triggerChord();
    this.intervalId = window.setInterval(triggerChord, 3200);
  }

  private startPiano(ctx: AudioContext, out: GainNode) {
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];
    let idx = 0;

    const playNote = () => {
      const now = ctx.currentTime;
      const freq = scale[(idx * 3 + 1) % scale.length];
      idx++;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const overtone = ctx.createOscillator();
      overtone.type = 'triangle';
      overtone.frequency.setValueAtTime(freq * 2, now);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.18, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 2.4);

      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.03, now);
      g2.gain.exponentialRampToValueAtTime(0.0005, now + 1.2);

      osc.connect(g);
      overtone.connect(g2);
      g.connect(out);
      g2.connect(out);

      osc.start(now);
      overtone.start(now);
      osc.stop(now + 2.5);
      overtone.stop(now + 1.3);
    };

    playNote();
    this.intervalId = window.setInterval(playNote, 1500);
  }
}

export const studyAudio = new StudyAudioEngine();
