import type { ThemeId } from '../types.ts';
import { isValidThemeId, THEME_SPECS, VALID_THEME_IDS, type ThemeSpec } from './themeIds.ts';

export type ThemeKind = 'solid' | 'gradient';

export interface ThemePalette {
  id: ThemeId;
  name: string;
  kind: ThemeKind;
  isDark: boolean;
  bgRgb: string;
  bgImageCss: string;
  primaryRgb: string;
  secondaryRgb: string;
  surfaceHex: string;
  surfaceSoftHex: string;
  fieldHex: string;
  hairlineCss: string;
  btnSecondaryBg: string;
  btnSecondaryHover: string;
  btnBorderCss: string;
  inkOnPrimaryHex: string;
  inkOnSecondaryHex: string;
  swatchBg: string;
  swatchPrimary: string;
  swatchSecondary: string;
  swatchPreviewCss: string;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return [r, g, b];
}

function rgbTupleToString([r, g, b]: [number, number, number]): string {
  return `${r} ${g} ${b}`;
}

function mixHex(hexA: string, hexB: string, weightB: number): string {
  const [ar, ag, ab] = hexToRgbTuple(hexA);
  const [br, bg, bb] = hexToRgbTuple(hexB);
  const wA = 1 - weightB;
  const r = Math.max(0, Math.min(255, Math.round(ar * wA + br * weightB)));
  const g = Math.max(0, Math.min(255, Math.round(ag * wA + bg * weightB)));
  const b = Math.max(0, Math.min(255, Math.round(ab * wA + bb * weightB)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
    .toString(16)
    .padStart(2, '0')}`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgbTuple(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function buildPaletteFromSpec(spec: ThemeSpec): ThemePalette {
  const baseBgHex = spec.stops[0];
  const bgTuple = hexToRgbTuple(baseBgHex);
  const primaryTuple = hexToRgbTuple(spec.primaryHex);
  const secondaryTuple = hexToRgbTuple(spec.secondaryHex);

  const bgRgb = rgbTupleToString(bgTuple);
  const primaryRgb = rgbTupleToString(primaryTuple);
  const secondaryRgb = rgbTupleToString(secondaryTuple);

  const isGrad = spec.kind === 'gradient';
  const angle = spec.angleDeg ?? 135;
  const bgImageCss = isGrad ? `linear-gradient(${angle}deg, ${spec.stops.join(', ')})` : 'none';
  const swatchPreviewCss = isGrad
    ? `linear-gradient(${angle}deg, ${spec.stops.join(', ')})`
    : baseBgHex;

  const surfaceHex = spec.isDark
    ? mixHex(baseBgHex, '#FFFFFF', isGrad ? 0.09 : 0.06)
    : mixHex(baseBgHex, '#FFFFFF', 0.78);
  const surfaceSoftHex = spec.isDark
    ? mixHex(baseBgHex, '#FFFFFF', 0.13)
    : '#FFFFFF';
  const fieldHex = spec.isDark
    ? mixHex(baseBgHex, '#000000', 0.22)
    : '#FFFFFF';

  const hairlineCss = spec.isDark
    ? `rgba(${primaryTuple[0]}, ${primaryTuple[1]}, ${primaryTuple[2]}, 0.19)`
    : `rgba(${primaryTuple[0]}, ${primaryTuple[1]}, ${primaryTuple[2]}, 0.14)`;

  const btnSecondaryBg = spec.isDark
    ? mixHex(baseBgHex, '#FFFFFF', 0.16)
    : mixHex(baseBgHex, spec.primaryHex, 0.08);
  const btnSecondaryHover = spec.isDark
    ? mixHex(baseBgHex, '#FFFFFF', 0.23)
    : mixHex(baseBgHex, spec.primaryHex, 0.14);
  const btnBorderCss = spec.isDark
    ? `rgba(${primaryTuple[0]}, ${primaryTuple[1]}, ${primaryTuple[2]}, 0.3)`
    : `rgba(${primaryTuple[0]}, ${primaryTuple[1]}, ${primaryTuple[2]}, 0.28)`;

  const inkOnPrimaryHex = relativeLuminance(spec.primaryHex) > 155 ? baseBgHex : '#FFFFFF';
  const inkOnSecondaryHex = relativeLuminance(spec.secondaryHex) > 175 ? '#12151E' : '#FFFFFF';

  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    isDark: spec.isDark,
    bgRgb,
    bgImageCss,
    primaryRgb,
    secondaryRgb,
    surfaceHex,
    surfaceSoftHex,
    fieldHex,
    hairlineCss,
    btnSecondaryBg,
    btnSecondaryHover,
    btnBorderCss,
    inkOnPrimaryHex,
    inkOnSecondaryHex,
    swatchBg: baseBgHex,
    swatchPrimary: spec.primaryHex,
    swatchSecondary: spec.secondaryHex,
    swatchPreviewCss,
  };
}

export const THEME_PALETTES: ThemePalette[] = THEME_SPECS.map(buildPaletteFromSpec);

export { VALID_THEME_IDS, isValidThemeId };

const THEME_STORAGE_KEY = 'examiner_theme_id';

export function getSavedThemeId(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && isValidThemeId(saved)) {
      return saved;
    }
  } catch {
    // Ignore
  }
  return 'paper';
}

export function getThemePalette(id: ThemeId | undefined): ThemePalette {
  if (!id) return THEME_PALETTES[0];
  return THEME_PALETTES.find((p) => p.id === id) || THEME_PALETTES[0];
}

export function applyTheme(id: ThemeId): ThemePalette {
  const palette = getThemePalette(id);
  const root = document.documentElement;
  root.style.removeProperty('--color-bg');
  root.style.removeProperty('--color-primary');
  root.style.removeProperty('--color-secondary');
  root.style.setProperty('--rgb-bg', palette.bgRgb);
  root.style.setProperty('--app-bg-image', palette.bgImageCss);
  root.style.setProperty('--rgb-primary', palette.primaryRgb);
  root.style.setProperty('--rgb-secondary', palette.secondaryRgb);
  root.style.setProperty('--color-surface', palette.surfaceHex);
  root.style.setProperty('--color-surface-soft', palette.surfaceSoftHex);
  root.style.setProperty('--color-field', palette.fieldHex);
  root.style.setProperty('--color-hairline', palette.hairlineCss);
  root.style.setProperty('--color-btn-secondary-bg', palette.btnSecondaryBg);
  root.style.setProperty('--color-btn-secondary-hover', palette.btnSecondaryHover);
  root.style.setProperty('--color-btn-border', palette.btnBorderCss);
  root.style.setProperty('--color-ink-on-primary', palette.inkOnPrimaryHex);
  root.style.setProperty('--color-ink-on-secondary', palette.inkOnSecondaryHex);
  root.dataset.theme = palette.id;
  if (palette.isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', palette.swatchBg);
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, palette.id);
  } catch {
    // Ignore
  }

  return palette;
}
