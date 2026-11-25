import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Disc3,
  FileAudio,
  ImagePlus,
  Link2,
  Loader2,
  Palette,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  ChatThemeConfig,
  PrivateChatRoom,
  SavedMusicTrack,
  ThemeId,
} from '../types.ts';
import {
  createPrivateChat,
  extractSpotifyUrl,
  updatePrivateChat,
  uploadCustomAudioFile,
} from '../services/api.ts';
import { useTranslation } from '../utils/i18n.tsx';
import { getThemePalette, THEME_PALETTES } from '../utils/themes.ts';
import StickerBackground from './StickerBackground.tsx';
import ThemePicker from './ThemePicker.tsx';

interface NewPrivateChatModalProps {
  existingChat?: PrivateChatRoom | null;
  savedSpotifyTracks: SavedMusicTrack[];
  onSaveExtractedSpotify: (track: SavedMusicTrack) => void;
  currentTheme?: ThemeId;
  onClose: () => void;
  onCreatedOrUpdated: (chat: PrivateChatRoom) => void;
}

async function compressGalleryImage(file: File, maxDim: number, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read gallery image.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export default function NewPrivateChatModal({
  existingChat = null,
  savedSpotifyTracks,
  onSaveExtractedSpotify,
  currentTheme = 'paper',
  onClose,
  onCreatedOrUpdated,
}: NewPrivateChatModalProps) {
  const { t } = useTranslation();
  const isEditing = Boolean(existingChat);

  const [avatarImage, setAvatarImage] = useState<string | undefined>(existingChat?.avatarImage);
  const [schoolName, setSchoolName] = useState(existingChat?.schoolName || '');
  const [grade, setGrade] = useState(existingChat?.grade || '');
  const [className, setClassName] = useState(existingChat?.className || '');
  const [groupName, setGroupName] = useState(existingChat?.groupName || '');

  const [selectedMusic, setSelectedMusic] = useState<SavedMusicTrack | null>(
    existingChat?.backgroundMusic || null
  );
  const [spotifyInput, setSpotifyInput] = useState('');
  const [extractingMusic, setExtractingMusic] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [saveAudioToApp, setSaveAudioToApp] = useState(true);
  const [musicError, setMusicError] = useState('');

  const initialTheme: ChatThemeConfig =
    existingChat?.theme?.mode === 'theme' && existingChat.theme.themeId
      ? { mode: 'theme', themeId: existingChat.theme.themeId }
      : { mode: 'default' };

  const [themeTab, setThemeTab] = useState<'default' | 'theme'>(initialTheme.mode);
  const [theme, setTheme] = useState<ChatThemeConfig>(initialTheme);

  const [themeQuery, setThemeQuery] = useState('');
  const [themeKind, setThemeKind] = useState<'all' | 'solid' | 'gradient'>('all');
  const [fullPickerOpen, setFullPickerOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const avatarFileRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);

  const visibleThemes = useMemo(() => {
    const q = themeQuery.trim().toLowerCase();
    return THEME_PALETTES.filter((item) => {
      if (themeKind !== 'all' && item.kind !== themeKind) return false;
      if (q && !`${item.name} ${item.kind}`.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 18);
  }, [themeQuery, themeKind]);

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const compressed = await compressGalleryImage(file, 320, 0.86);
      setAvatarImage(compressed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load image from gallery.');
    }
  }

  async function handleAudioPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMusicError('');
    setUploadingAudio(true);
    try {
      const uploaded = await uploadCustomAudioFile(file, { saveToApp: saveAudioToApp });
      if (saveAudioToApp) {
        onSaveExtractedSpotify(uploaded);
      }
      setSelectedMusic(uploaded);
    } catch (err: unknown) {
      setMusicError(err instanceof Error ? err.message : 'Could not upload audio file.');
    } finally {
      setUploadingAudio(false);
    }
  }

  async function handleExtractSpotify() {
    const raw = spotifyInput.trim();
    if (!raw) {
      setMusicError(t('spotifyEmptyError'));
      return;
    }
    setMusicError('');
    setExtractingMusic(true);
    try {
      const extracted = await extractSpotifyUrl(raw);
      onSaveExtractedSpotify(extracted);
      setSelectedMusic(extracted);
      setSpotifyInput('');
    } catch (err: unknown) {
      setMusicError(err instanceof Error ? err.message : 'Could not extract Spotify track.');
    } finally {
      setExtractingMusic(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolName.trim()) {
      setError(t('chatSchoolRequired'));
      return;
    }
    if (!grade.trim()) {
      setError(t('chatGradeRequired'));
      return;
    }

    const finalTheme: ChatThemeConfig =
      themeTab === 'theme' && theme.themeId
        ? { mode: 'theme', themeId: theme.themeId }
        : { mode: 'default' };

    const effectiveGroupName = groupName.trim() || grade.trim();

    setError('');
    setSaving(true);
    try {
      const result = existingChat
        ? await updatePrivateChat(existingChat.id, {
            schoolName: schoolName.trim(),
            grade: grade.trim(),
            className: className.trim(),
            groupName: effectiveGroupName,
            avatarImage: avatarImage || null,
            backgroundMusic: selectedMusic,
            theme: finalTheme,
          })
        : await createPrivateChat({
            schoolName: schoolName.trim(),
            grade: grade.trim(),
            className: className.trim(),
            groupName: effectiveGroupName,
            avatarImage,
            backgroundMusic: selectedMusic,
            theme: finalTheme,
          });
      onCreatedOrUpdated(result);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save private chat.');
      setSaving(false);
    }
  }

  const selectedThemeId = theme.themeId || currentTheme || 'grad-sunrise-peach';
  const activeChatPalette = getThemePalette(selectedThemeId);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-primary/50 flex items-end md:items-center justify-center p-0 sm:p-4"
        onClick={onClose}
      >
        <div
          className="w-full md:max-w-xl bg-paper rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[calc(100dvh-1.5rem)] flex flex-col overflow-hidden border hairline"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 bg-paper-blur px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between border-b hairline gap-2">
            <h2 className="font-display text-lg sm:text-xl font-semibold min-w-0 truncate">
              {isEditing ? t('chatSettingsTitle') : t('newPrivateChat')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              className="h-9 w-9 grid place-items-center rounded-xl btn-ghost cursor-pointer shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
            {error && (
              <p className="text-[0.8rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            {/* Chat profile picture from gallery ONLY */}
            <div className="rounded-2xl border hairline bg-surface p-3.5 flex flex-wrap sm:flex-nowrap items-center gap-3.5">
              <input
                ref={avatarFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarPick}
              />
              {avatarImage ? (
                <img
                  src={avatarImage}
                  alt={groupName || grade || 'Chat'}
                  className="h-16 w-16 rounded-2xl object-cover border hairline shrink-0"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => avatarFileRef.current?.click()}
                  className="h-16 w-16 rounded-2xl border border-dashed border-primary/35 bg-surface-soft grid place-items-center text-primary/70 hover:border-secondary hover:text-secondary transition shrink-0 cursor-pointer"
                >
                  <ImagePlus size={22} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[0.82rem] font-semibold">{t('chatProfilePicLabel')}</div>
                <p className="text-[0.72rem] text-primary/65 mt-0.5">
                  {t('chatProfilePicGalleryOnly')}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => avatarFileRef.current?.click()}
                    className="h-8 px-3 rounded-lg btn-secondary text-[0.75rem] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <ImagePlus size={13} />
                    {t('chooseFromGallery')}
                  </button>
                  {avatarImage && (
                    <button
                      type="button"
                      onClick={() => setAvatarImage(undefined)}
                      className="h-8 px-2.5 rounded-lg bg-secondary/12 border border-secondary/35 text-[0.74rem] font-semibold text-secondary hover:bg-secondary/20 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 size={13} />
                      {t('removeTrack')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* School Name, Grade, Class (optional), Group Name (defaults to Grade) */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="chat-school">
                  {t('chatSchoolLabel')} *
                </label>
                <input
                  id="chat-school"
                  type="text"
                  dir="auto"
                  className="field"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  placeholder={t('chatSchoolPlaceholder')}
                  required
                />
              </div>

              <div>
                <label className="field-label" htmlFor="chat-grade">
                  {t('chatGradeLabel')} *
                </label>
                <input
                  id="chat-grade"
                  type="text"
                  dir="auto"
                  className="field"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  placeholder={t('chatGradePlaceholder')}
                  required
                />
              </div>

              <div>
                <label className="field-label" htmlFor="chat-class">
                  {t('chatClassLabel')}{' '}
                  <span className="lowercase font-normal text-primary/60">{t('authOptional')}</span>
                </label>
                <input
                  id="chat-class"
                  type="text"
                  dir="auto"
                  className="field"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder={t('chatClassPlaceholder')}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="chat-group-name">
                  {t('chatGroupNameLabel')}{' '}
                  <span className="lowercase font-normal text-primary/60">{t('authOptional')}</span>
                </label>
                <input
                  id="chat-group-name"
                  type="text"
                  dir="auto"
                  className="field"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder={grade.trim() || t('chatGroupNameHint')}
                />
                <p className="text-[0.68rem] text-primary/60 mt-1">{t('chatGroupNameHint')}</p>
              </div>
            </div>

            {/* Background Music */}
            <div className="rounded-2xl border hairline bg-surface p-3.5 space-y-2.5">
              <input
                ref={audioFileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleAudioPick}
              />

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Disc3 size={15} className="text-[#15803D] dark:text-[#4ADE80]" />
                  <span className="text-[0.82rem] font-semibold">
                    {t('chatBgMusicLabel')}{' '}
                    <span className="text-[0.72rem] font-normal text-primary/60">
                      {t('authOptional')}
                    </span>
                  </span>
                </div>
                {selectedMusic && (
                  <button
                    type="button"
                    onClick={() => setSelectedMusic(null)}
                    className="px-2 py-0.5 rounded-lg bg-secondary/12 text-[0.72rem] font-semibold text-secondary hover:bg-secondary/20 cursor-pointer"
                  >
                    {t('clearMusic')}
                  </button>
                )}
              </div>

              {selectedMusic && (
                <div className="flex items-center gap-2.5 rounded-xl bg-[#15803D]/12 border border-[#15803D]/35 px-3 py-2">
                  {selectedMusic.kind === 'custom' ? (
                    <FileAudio size={15} className="text-secondary shrink-0" />
                  ) : (
                    <Disc3 size={15} className="text-[#15803D] dark:text-[#4ADE80] shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div dir="auto" className="text-[0.8rem] font-semibold leading-snug break-words">
                      {selectedMusic.title}
                    </div>
                    <div dir="auto" className="text-[0.68rem] text-primary/65 leading-snug break-words">
                      {selectedMusic.kind === 'custom'
                        ? `${t('customAudioBadge')} · ${selectedMusic.subtitle}`
                        : selectedMusic.subtitle}
                    </div>
                  </div>
                  <Check size={14} className="text-[#15803D] dark:text-[#4ADE80] shrink-0" />
                </div>
              )}

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <Link2
                    size={13}
                    className="absolute start-2.5 top-1/2 -translate-y-1/2 text-primary/50 pointer-events-none"
                  />
                  <input
                    type="text"
                    dir="ltr"
                    value={spotifyInput}
                    onChange={(e) => setSpotifyInput(e.target.value)}
                    placeholder={t('spotifyPasteHint')}
                    className="w-full h-9 rounded-xl border border-primary/25 bg-surface-soft ps-8 pe-2.5 text-[0.78rem] outline-none focus:border-[#15803D]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleExtractSpotify}
                  disabled={extractingMusic}
                  className="h-9 px-3 rounded-xl bg-[#15803D] text-white text-[0.76rem] font-semibold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-60 cursor-pointer shrink-0"
                >
                  {extractingMusic && <Loader2 size={12} className="animate-spin" />}
                  {t('spotifyExtractShort')}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={uploadingAudio}
                  onClick={() => audioFileRef.current?.click()}
                  className="h-8 px-3 rounded-xl btn-secondary text-[0.75rem] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                >
                  {uploadingAudio ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Upload size={13} />
                  )}
                  <span>{uploadingAudio ? t('uploadingAudio') : t('uploadAudioToGroup')}</span>
                </button>

                <label className="inline-flex items-center gap-1.5 text-[0.72rem] font-medium text-primary/75 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveAudioToApp}
                    onChange={(e) => setSaveAudioToApp(e.target.checked)}
                    className="accent-secondary h-3.5 w-3.5 rounded cursor-pointer"
                  />
                  <span>{t('alsoSaveToAppMusic')}</span>
                </label>
              </div>

              {musicError && (
                <p className="text-[0.72rem] font-medium text-secondary">{musicError}</p>
              )}

              {savedSpotifyTracks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {savedSpotifyTracks.slice(0, 6).map((tr) => {
                    const active = selectedMusic?.id === tr.id;
                    return (
                      <button
                        key={tr.id}
                        type="button"
                        onClick={() => setSelectedMusic(active ? null : tr)}
                        className={`rounded-xl px-2.5 py-1 text-[0.72rem] font-semibold transition inline-flex items-center gap-1 cursor-pointer ${
                          active ? 'bg-[#15803D] text-white' : 'btn-secondary'
                        }`}
                      >
                        {tr.kind === 'custom' && <FileAudio size={11} />}
                        <span>{tr.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chat Background Theme: Default or Any of the 100 Solid & Gradient Themes */}
            <div className="rounded-2xl border hairline bg-surface p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Palette size={15} className="text-secondary" />
                  <span className="text-[0.82rem] font-semibold">{t('chatThemeLabel')}</span>
                </div>
                {themeTab === 'theme' && (
                  <button
                    type="button"
                    onClick={() => setFullPickerOpen(true)}
                    className="h-7 px-2.5 rounded-lg btn-secondary text-[0.7rem] font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Palette size={11} />
                    <span>{t('browseAllThemesBtn')}</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-primary/12 border hairline">
                <button
                  type="button"
                  onClick={() => {
                    setThemeTab('default');
                    setTheme({ mode: 'default' });
                  }}
                  className={`py-2 px-3 rounded-lg text-[0.78rem] font-semibold transition cursor-pointer ${
                    themeTab === 'default'
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-primary/80 hover:bg-surface'
                  }`}
                >
                  {t('chatThemeDefault')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setThemeTab('theme');
                    if (theme.mode !== 'theme' || !theme.themeId) {
                      setTheme({
                        mode: 'theme',
                        themeId: selectedThemeId,
                      });
                    }
                  }}
                  className={`py-2 px-3 rounded-lg text-[0.78rem] font-semibold transition inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    themeTab === 'theme'
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-primary/80 hover:bg-surface'
                  }`}
                >
                  <Palette size={13} />
                  <span>{t('chatThemeCustom')}</span>
                </button>
              </div>

              {themeTab === 'theme' && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[0.72rem] text-primary/70">{t('chatThemeCustomHint')}</p>
                    <span className="text-[0.7rem] font-semibold text-secondary shrink-0">
                      {activeChatPalette.name}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { key: 'all', label: t('allMode') },
                        { key: 'solid', label: t('themesSolidTab') },
                        { key: 'gradient', label: t('themesGradientTab') },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setThemeKind(item.key)}
                        className={`px-2.5 py-1 rounded-lg text-[0.7rem] font-semibold transition cursor-pointer ${
                          themeKind === item.key ? 'bg-secondary text-on-secondary' : 'btn-secondary'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative">
                    <Search
                      size={13}
                      className="absolute start-3 top-1/2 -translate-y-1/2 text-primary/55 pointer-events-none"
                    />
                    <input
                      type="text"
                      dir="auto"
                      value={themeQuery}
                      onChange={(e) => setThemeQuery(e.target.value)}
                      placeholder={t('searchThemesPlaceholder')}
                      className="w-full h-9 rounded-xl border border-primary/25 bg-surface-soft ps-8 pe-8 text-[0.78rem] outline-none focus:border-secondary"
                    />
                    {themeQuery && (
                      <button
                        type="button"
                        onClick={() => setThemeQuery('')}
                        aria-label={t('close')}
                        className="absolute end-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-primary/15 text-primary grid place-items-center cursor-pointer"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 max-h-44 overflow-y-auto pr-0.5">
                    {visibleThemes.map((item) => {
                      const active = selectedThemeId === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setTheme({ mode: 'theme', themeId: item.id })}
                          className={`rounded-xl overflow-hidden border-2 text-start transition cursor-pointer bg-surface-soft ${
                            active
                              ? 'border-secondary ring-2 ring-secondary/35'
                              : 'border-primary/20 hover:border-primary/45'
                          }`}
                        >
                          <div
                            className="h-10 w-full flex items-center justify-end px-1.5"
                            style={{ background: item.swatchPreviewCss }}
                          >
                            {active && (
                              <span className="h-4 w-4 rounded-full bg-secondary text-on-secondary grid place-items-center">
                                <Check size={10} />
                              </span>
                            )}
                          </div>
                          <div className="px-1.5 py-1">
                            <div className="text-[0.65rem] font-semibold truncate">{item.name}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative h-24 rounded-2xl border hairline overflow-hidden bg-surface-soft flex items-center justify-center">
                    <StickerBackground theme={{ mode: 'theme', themeId: selectedThemeId }} />
                    <div className="relative z-10 flex flex-col gap-1.5 w-full px-4">
                      <div className="self-start rounded-2xl bg-surface/95 border hairline px-3 py-1 text-[0.74rem] shadow-xs">
                        {grade || 'Grade 11'} · {schoolName || 'Study Group'}
                      </div>
                      <div className="self-end rounded-2xl bg-primary text-on-primary px-3 py-1 text-[0.74rem] shadow-xs">
                        Exam on Thursday 9:00 AM
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-1 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-4 rounded-xl btn-secondary text-[0.84rem] font-semibold cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-11 px-5 rounded-xl bg-primary text-on-primary font-semibold text-[0.88rem] inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer shadow-sm"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {isEditing ? t('saveChanges') : t('createPrivateChatBtn')}
              </button>
            </div>
          </form>
        </div>
      </div>

      {fullPickerOpen && (
        <ThemePicker
          variant="modal"
          currentTheme={selectedThemeId}
          onClose={() => setFullPickerOpen(false)}
          onSelectTheme={(id) => {
            setThemeTab('theme');
            setTheme({ mode: 'theme', themeId: id });
          }}
        />
      )}
    </>
  );
}
