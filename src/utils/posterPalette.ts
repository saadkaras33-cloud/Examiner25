import type { ThemeId } from '../types.ts';
import { applyTheme, getThemePalette } from './themes.ts';

export interface PosterPalette {
  rawPrimaryRgb: [number, number, number];
  rawSecondaryRgb: [number, number, number];
}

const paletteCache = new Map<string, PosterPalette>();

function clampChannel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) {
    const v = clampChannel(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clampChannel(hue2rgb(p, q, h + 1 / 3) * 255),
    clampChannel(hue2rgb(p, q, h) * 255),
    clampChannel(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function calibrateAccentForTheme(
  rgb: [number, number, number],
  isDarkTheme: boolean
): { accentRgb: string; inkOnAccentHex: string } {
  const [h, s] = rgbToHsl(rgb);
  const boostedSat = Math.max(0.45, Math.min(0.88, s * 1.15));
  const targetL = isDarkTheme ? 0.64 : 0.42;
  let adjusted = hslToRgb([h, boostedSat, targetL]);

  // Verify perceived brightness contrast against theme base
  let luma = relativeLuminance(adjusted);
  if (!isDarkTheme && luma > 122) {
    adjusted = hslToRgb([h, boostedSat, 0.36]);
  } else if (isDarkTheme && luma < 138) {
    adjusted = hslToRgb([h, boostedSat, 0.68]);
  }
  luma = relativeLuminance(adjusted);

  return {
    accentRgb: `${adjusted[0]} ${adjusted[1]} ${adjusted[2]}`,
    inkOnAccentHex: luma > 158 ? '#0E121B' : '#FFFFFF',
  };
}

function resolveProxyUrl(thumbnailUrl: string): string {
  const trimmed = thumbnailUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:') || trimmed.startsWith('/') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return `/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

export async function extractPosterPalette(thumbnailUrl: string): Promise<PosterPalette | null> {
  const clean = thumbnailUrl.trim();
  if (!clean) return null;
  const cached = paletteCache.get(clean);
  if (cached) return cached;

  const src = resolveProxyUrl(clean);
  if (!src) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const finish = (result: PosterPalette | null) => {
      if (result) {
        paletteCache.set(clean, result);
      }
      resolve(result);
    };

    const timeout = window.setTimeout(() => finish(null), 6500);

    img.onerror = () => {
      window.clearTimeout(timeout);
      finish(null);
    };

    img.onload = () => {
      window.clearTimeout(timeout);
      try {
        const size = 28;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        const buckets = new Map<
          string,
          { rSum: number; gSum: number; bSum: number; score: number; hue: number; sat: number }
        >();

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 140) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (luma < 18 || luma > 240) continue;

          // Quantize into 16x16x16 color cells and favor chromatic vibrant pixels
          const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
          const weight = 1 + sat * 4.5;
          const [hue] = rgbToHsl([r, g, b]);
          const existing = buckets.get(key);
          if (existing) {
            existing.rSum += r * weight;
            existing.gSum += g * weight;
            existing.bSum += b * weight;
            existing.score += weight;
          } else {
            buckets.set(key, {
              rSum: r * weight,
              gSum: g * weight,
              bSum: b * weight,
              score: weight,
              hue,
              sat,
            });
          }
        }

        if (buckets.size === 0) {
          finish(null);
          return;
        }

        const ranked = Array.from(buckets.values()).sort((a, b) => b.score - a.score);
        const top = ranked[0];
        const rawPrimaryRgb: [number, number, number] = [
          clampChannel(top.rSum / top.score),
          clampChannel(top.gSum / top.score),
          clampChannel(top.bSum / top.score),
        ];

        // Pick a contrasting secondary cluster separated in hue or brightness
        const second =
          ranked.find((cand) => {
            const hueDist = Math.min(
              Math.abs(cand.hue - top.hue),
              1 - Math.abs(cand.hue - top.hue)
            );
            return hueDist > 0.14 && cand.score >= top.score * 0.16;
          }) || ranked[Math.min(1, ranked.length - 1)];

        const rawSecondaryRgb: [number, number, number] = [
          clampChannel(second.rSum / second.score),
          clampChannel(second.gSum / second.score),
          clampChannel(second.bSum / second.score),
        ];

        finish({ rawPrimaryRgb, rawSecondaryRgb });
      } catch {
        finish(null);
      }
    };

    img.src = src;
  });
}

export function applyPosterThemePalette(
  palette: PosterPalette | null,
  themeId: ThemeId
): void {
  const base = applyTheme(themeId);
  const root = document.documentElement;

  if (!palette) {
    root.style.removeProperty('--rgb-poster-a');
    root.style.removeProperty('--rgb-poster-b');
    delete root.dataset.posterActive;
    return;
  }

  const { accentRgb, inkOnAccentHex } = calibrateAccentForTheme(
    palette.rawPrimaryRgb,
    base.isDark
  );
  const [ar, ag, ab] = palette.rawPrimaryRgb;
  const [br, bg, bb] = palette.rawSecondaryRgb;

  root.style.setProperty('--rgb-secondary', accentRgb);
  root.style.setProperty('--color-ink-on-secondary', inkOnAccentHex);
  root.style.setProperty('--rgb-poster-a', `${ar} ${ag} ${ab}`);
  root.style.setProperty('--rgb-poster-b', `${br} ${bg} ${bb}`);
  root.dataset.posterActive = 'true';
}
