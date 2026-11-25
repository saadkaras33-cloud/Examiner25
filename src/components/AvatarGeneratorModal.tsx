import { useState } from 'react';
import { Check, Loader2, Shuffle, X } from 'lucide-react';
import type { AvataaarsOptions, AvatarConfig } from '../types.ts';
import { useTranslation } from '../utils/i18n.tsx';
import AvatarSvg, {
  AVATAAARS_ACCESSORIES_OPTIONS,
  AVATAAARS_CIRCLE_COLORS,
  AVATAAARS_CLOTHES_OPTIONS,
  AVATAAARS_EYEBROW_OPTIONS,
  AVATAAARS_EYES_OPTIONS,
  AVATAAARS_FABRIC_COLORS,
  AVATAAARS_FACIAL_HAIR_OPTIONS,
  AVATAAARS_GRAPHIC_OPTIONS,
  AVATAAARS_HAIR_COLORS,
  AVATAAARS_HAT_TOPS,
  AVATAAARS_MOUTH_OPTIONS,
  AVATAAARS_SKIN_OPTIONS,
  AVATAAARS_TOP_OPTIONS,
  createDefaultAvataaars,
  createDefaultAvatar,
  randomAvataaars,
} from './AvatarSvg.tsx';

interface AvatarGeneratorModalProps {
  initialConfig?: AvatarConfig;
  initials: string;
  onClose: () => void;
  onSave: (config: AvatarConfig) => Promise<void> | void;
}

export default function AvatarGeneratorModal({
  initialConfig,
  initials,
  onClose,
  onSave,
}: AvatarGeneratorModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<AvatarConfig>(() => {
    if (initialConfig) {
      return {
        ...initialConfig,
        style: 'avataaars',
        avataaars: initialConfig.avataaars || createDefaultAvataaars(),
      };
    }
    return createDefaultAvatar();
  });
  const [saving, setSaving] = useState(false);
  const [savedDone, setSavedDone] = useState(false);
  const [saveError, setSaveError] = useState('');

  const av: AvataaarsOptions = draft.avataaars || createDefaultAvataaars();
  const isHatTop = AVATAAARS_HAT_TOPS.has(av.top);

  function updateAv(patch: Partial<AvataaarsOptions>) {
    setSavedDone(false);
    setSaveError('');
    setDraft((prev) => ({
      ...prev,
      style: 'avataaars',
      avataaars: {
        ...(prev.avataaars || createDefaultAvataaars()),
        ...patch,
      },
    }));
  }

  function handleRandomize() {
    setSavedDone(false);
    setSaveError('');
    setDraft((prev) => ({
      ...prev,
      style: 'avataaars',
      avataaars: randomAvataaars(),
    }));
  }

  async function handleSaveToProfile() {
    setSaveError('');
    setSaving(true);
    try {
      await Promise.resolve(onSave(draft));
      setSavedDone(true);
      window.setTimeout(() => {
        onClose();
      }, 320);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Could not save avatar to profile.');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-primary/50 flex items-end md:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-3xl bg-paper rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl max-h-[calc(100dvh-1.5rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 bg-paper-blur px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between border-b hairline gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-semibold truncate">{t('avatarTitle')}</h2>
            <p className="text-[0.72rem] text-primary/50 truncate">
              {t('avatarSubtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRandomize}
              className="h-9 px-3 rounded-xl bg-secondary text-on-secondary font-semibold text-[0.78rem] inline-flex items-center gap-1.5 hover:opacity-95 transition cursor-pointer shadow-xs"
            >
              <Shuffle size={14} /> {t('avatarRandom')}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              className="h-9 w-9 grid place-items-center rounded-xl btn-ghost cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          <div className="grid md:grid-cols-[240px_1fr] gap-5 sm:gap-6 items-start">
            {/* Left column: live avatar preview & direct save to profile */}
            <div className="flex flex-col items-center gap-4 md:sticky md:top-0">
              <div className="w-40 h-40 sm:w-48 sm:h-48 rounded-3xl border border-primary/12 bg-surface grid place-items-center shadow-sm p-3">
                <AvatarSvg
                  id="avatar-generator-preview"
                  config={draft}
                  initials={initials}
                  size={168}
                />
              </div>
            </div>

            {/* Right column: getavataaars.com controls */}
            <div className="space-y-3.5">
                {/* Avatar Style: Circle vs Transparent */}
                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                  <span className="text-[0.78rem] font-semibold text-primary/75">{t('avatarStyle')}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl bg-primary/12 border hairline p-0.5 gap-0.5">
                      {(
                        [
                          { id: 'circle', label: t('avatarCircle') },
                          { id: 'default', label: t('avatarTransparent') },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateAv({ avatarStyle: opt.id })}
                          className={`px-3 py-1.5 rounded-lg text-[0.76rem] font-semibold transition cursor-pointer ${
                            av.avatarStyle === opt.id
                              ? 'bg-primary text-on-primary shadow-sm'
                              : 'text-primary/80 hover:bg-surface'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {av.avatarStyle === 'circle' && (
                      <div className="flex flex-wrap gap-1.5">
                        {AVATAAARS_CIRCLE_COLORS.map((swatch) => {
                          const active = av.backgroundColor.toLowerCase() === swatch.value;
                          return (
                            <button
                              key={swatch.value}
                              type="button"
                              title={swatch.label}
                              aria-label={swatch.label}
                              onClick={() => updateAv({ backgroundColor: swatch.value })}
                              className={`h-6 w-6 rounded-full border-2 transition cursor-pointer ${
                                active ? 'border-primary scale-110' : 'border-primary/15'
                              }`}
                              style={{ backgroundColor: `#${swatch.value}` }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Top */}
                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                  <label className="text-[0.78rem] font-semibold text-primary/75" htmlFor="av-top">
                    {t('avatarTop')}
                  </label>
                  <select
                    id="av-top"
                    className="field-sm w-full"
                    value={av.top}
                    onChange={(e) => updateAv({ top: e.target.value })}
                  >
                    {AVATAAARS_TOP_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Hair Color / Hat Color */}
                {av.top !== 'noHair' && !isHatTop && (
                  <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                    <label
                      className="text-[0.78rem] font-semibold text-primary/75"
                      htmlFor="av-hair-color"
                    >
                      {t('avatarHairColor')}
                    </label>
                    <select
                      id="av-hair-color"
                      className="field-sm w-full"
                      value={av.hairColor}
                      onChange={(e) => updateAv({ hairColor: e.target.value })}
                    >
                      {AVATAAARS_HAIR_COLORS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {isHatTop && (
                  <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                    <label
                      className="text-[0.78rem] font-semibold text-primary/75"
                      htmlFor="av-hat-color"
                    >
                      {t('avatarHatColor')}
                    </label>
                    <select
                      id="av-hat-color"
                      className="field-sm w-full"
                      value={av.hatColor}
                      onChange={(e) => updateAv({ hatColor: e.target.value })}
                    >
                      {AVATAAARS_FABRIC_COLORS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Accessories */}
                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                  <label
                    className="text-[0.78rem] font-semibold text-primary/75"
                    htmlFor="av-accessories"
                  >
                    {t('avatarAccessories')}
                  </label>
                  <div className="flex flex-wrap sm:flex-nowrap gap-2 min-w-0">
                    <select
                      id="av-accessories"
                      className="field-sm flex-1 min-w-0"
                      value={av.accessories}
                      onChange={(e) => updateAv({ accessories: e.target.value })}
                    >
                      {AVATAAARS_ACCESSORIES_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {av.accessories !== 'blank' && av.accessories !== 'eyepatch' && (
                      <select
                        aria-label={t('avatarAccessories')}
                        className="field-sm w-full sm:w-32"
                        value={av.accessoriesColor}
                        onChange={(e) => updateAv({ accessoriesColor: e.target.value })}
                      >
                        {AVATAAARS_FABRIC_COLORS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Facial Hair */}
                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                  <label
                    className="text-[0.78rem] font-semibold text-primary/75"
                    htmlFor="av-facial-hair"
                  >
                    {t('avatarFacialHair')}
                  </label>
                  <select
                    id="av-facial-hair"
                    className="field-sm w-full"
                    value={av.facialHair}
                    onChange={(e) => updateAv({ facialHair: e.target.value })}
                  >
                    {AVATAAARS_FACIAL_HAIR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {av.facialHair !== 'blank' && (
                  <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                    <label
                      className="text-[0.78rem] font-semibold text-primary/75"
                      htmlFor="av-facial-color"
                    >
                      {t('avatarFacialHairColor')}
                    </label>
                    <select
                      id="av-facial-color"
                      className="field-sm w-full"
                      value={av.facialHairColor}
                      onChange={(e) => updateAv({ facialHairColor: e.target.value })}
                    >
                      {AVATAAARS_HAIR_COLORS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Clothes */}
                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                  <label
                    className="text-[0.78rem] font-semibold text-primary/75"
                    htmlFor="av-clothes"
                  >
                    {t('avatarClothes')}
                  </label>
                  <select
                    id="av-clothes"
                    className="field-sm w-full"
                    value={av.clothing}
                    onChange={(e) => updateAv({ clothing: e.target.value })}
                  >
                    {AVATAAARS_CLOTHES_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                  <label
                    className="text-[0.78rem] font-semibold text-primary/75"
                    htmlFor="av-clothes-color"
                  >
                    {t('avatarColorFabric')}
                  </label>
                  <select
                    id="av-clothes-color"
                    className="field-sm w-full"
                    value={av.clothesColor}
                    onChange={(e) => updateAv({ clothesColor: e.target.value })}
                  >
                    {AVATAAARS_FABRIC_COLORS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {av.clothing === 'graphicShirt' && (
                  <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                    <label
                      className="text-[0.78rem] font-semibold text-primary/75"
                      htmlFor="av-graphic"
                    >
                      {t('avatarGraphic')}
                    </label>
                    <select
                      id="av-graphic"
                      className="field-sm w-full"
                      value={av.clothingGraphic}
                      onChange={(e) => updateAv({ clothingGraphic: e.target.value })}
                    >
                      {AVATAAARS_GRAPHIC_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Eyes */}
                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                  <label
                    className="text-[0.78rem] font-semibold text-primary/75"
                    htmlFor="av-eyes"
                  >
                    {t('avatarEyes')}
                  </label>
                  <select
                    id="av-eyes"
                    className="field-sm w-full"
                    value={av.eyes}
                    onChange={(e) => updateAv({ eyes: e.target.value })}
                  >
                    {AVATAAARS_EYES_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Eyebrow */}
                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                  <label
                    className="text-[0.78rem] font-semibold text-primary/75"
                    htmlFor="av-eyebrow"
                  >
                    {t('avatarEyebrow')}
                  </label>
                  <select
                    id="av-eyebrow"
                    className="field-sm w-full"
                    value={av.eyebrows}
                    onChange={(e) => updateAv({ eyebrows: e.target.value })}
                  >
                    {AVATAAARS_EYEBROW_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Mouth */}
                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2">
                  <label
                    className="text-[0.78rem] font-semibold text-primary/75"
                    htmlFor="av-mouth"
                  >
                    {t('avatarMouth')}
                  </label>
                  <select
                    id="av-mouth"
                    className="field-sm w-full"
                    value={av.mouth}
                    onChange={(e) => updateAv({ mouth: e.target.value })}
                  >
                    {AVATAAARS_MOUTH_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Skin */}
                <div className="grid sm:grid-cols-[130px_1fr] items-center gap-2 pt-1">
                  <span className="text-[0.78rem] font-semibold text-primary/75">{t('avatarSkin')}</span>
                  <div className="flex flex-wrap gap-2">
                    {AVATAAARS_SKIN_OPTIONS.map((swatch) => {
                      const active = av.skinColor.toLowerCase() === swatch.value;
                      return (
                        <button
                          key={swatch.value}
                          type="button"
                          title={swatch.label}
                          aria-label={`${t('avatarSkin')} ${swatch.label}`}
                          onClick={() => updateAv({ skinColor: swatch.value })}
                          className={`h-8 w-8 rounded-full grid place-items-center border-2 transition cursor-pointer ${
                            active ? 'border-primary scale-110' : 'border-primary/15'
                          }`}
                          style={{ backgroundColor: `#${swatch.value}` }}
                        >
                          {active && <Check size={13} className="text-[#18203A]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
          </div>
        </div>

        <div className="shrink-0 bg-paper-blur border-t hairline px-5 py-3 pb-[calc(0.85rem+env(safe-area-inset-bottom,0px))] space-y-2">
          {saveError && (
            <p className="text-[0.78rem] font-medium text-secondary bg-secondary/10 rounded-xl px-3 py-1.5">
              {saveError}
            </p>
          )}
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-11 px-4 rounded-xl btn-secondary text-[0.84rem] font-semibold disabled:opacity-50 cursor-pointer"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveToProfile}
              className={`h-11 px-5 rounded-xl font-semibold text-[0.86rem] inline-flex items-center justify-center gap-2 disabled:opacity-70 active:scale-[0.99] transition cursor-pointer ${
                savedDone ? 'bg-[#2F8F72] text-white' : 'bg-primary text-on-primary'
              }`}
            >
              {saving && !savedDone ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
              {savedDone ? t('avatarSavedDone') : t('avatarSaveProfile')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
