import type { ChatThemeConfig } from '../types.ts';
import { getThemePalette } from '../utils/themes.ts';

interface StickerBackgroundProps {
  theme?: ChatThemeConfig;
  className?: string;
}

export default function StickerBackground({ theme, className = '' }: StickerBackgroundProps) {
  if (!theme || theme.mode !== 'theme' || !theme.themeId) {
    return null;
  }

  const palette = getThemePalette(theme.themeId);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}
      style={{
        backgroundColor: palette.swatchBg,
        backgroundImage: palette.bgImageCss === 'none' ? undefined : palette.bgImageCss,
        backgroundSize: 'cover',
      }}
    >
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `radial-gradient(${palette.swatchSecondary} 1px, transparent 1px)`,
          backgroundSize: '18px 18px',
        }}
      />
    </div>
  );
}
