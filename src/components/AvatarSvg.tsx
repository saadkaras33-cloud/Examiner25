import { useMemo } from 'react';
import { createAvatar } from '@dicebear/core';
import * as avataaars from '@dicebear/avataaars';
import type { Options as AvataaarsCoreOptions } from '@dicebear/avataaars';
import type { AvataaarsOptions, AvatarConfig } from '../types.ts';

export const AVATAR_BG_COLORS = [
  '#E25838',
  '#18203A',
  '#3F6C8F',
  '#2F8F72',
  '#7A6BC4',
  '#C08A2E',
];

export const AVATAR_ACCENT_COLORS = [
  '#FAF7F0',
  '#E25838',
  '#3F6C8F',
  '#2F8F72',
  '#7A6BC4',
  '#F5B864',
];

export const AVATAR_SKIN_TONES = [
  '#F6D6BD',
  '#E7B894',
  '#C98E66',
  '#9D6543',
  '#6B412A',
];

export interface LabeledOption {
  value: string;
  label: string;
}

export interface ColorSwatch {
  value: string; // hex without #
  label: string;
}

export const AVATAAARS_TOP_OPTIONS: LabeledOption[] = [
  { value: 'noHair', label: 'No Hair' },
  { value: 'hat', label: 'Hat' },
  { value: 'hijab', label: 'Hijab' },
  { value: 'turban', label: 'Turban' },
  { value: 'winterHat1', label: 'Winter Hat 1' },
  { value: 'winterHat02', label: 'Winter Hat 2' },
  { value: 'winterHat03', label: 'Winter Hat 3' },
  { value: 'winterHat04', label: 'Winter Hat 4' },
  { value: 'bigHair', label: 'Long Hair Big Hair' },
  { value: 'bob', label: 'Long Hair Bob' },
  { value: 'bun', label: 'Long Hair Bun' },
  { value: 'curly', label: 'Long Hair Curly' },
  { value: 'curvy', label: 'Long Hair Curvy' },
  { value: 'dreads', label: 'Long Hair Dreads' },
  { value: 'frida', label: 'Long Hair Frida' },
  { value: 'fro', label: 'Long Hair Fro' },
  { value: 'froBand', label: 'Long Hair Fro Band' },
  { value: 'longButNotTooLong', label: 'Long Hair Not Too Long' },
  { value: 'miaWallace', label: 'Long Hair Mia Wallace' },
  { value: 'shavedSides', label: 'Long Hair Shaved Sides' },
  { value: 'straight01', label: 'Long Hair Straight' },
  { value: 'straight02', label: 'Long Hair Straight 2' },
  { value: 'straightAndStrand', label: 'Long Hair Straight Strand' },
  { value: 'dreads01', label: 'Short Hair Dreads 01' },
  { value: 'dreads02', label: 'Short Hair Dreads 02' },
  { value: 'frizzle', label: 'Short Hair Frizzle' },
  { value: 'shaggy', label: 'Short Hair Shaggy' },
  { value: 'shaggyMullet', label: 'Short Hair Shaggy Mullet' },
  { value: 'shortCurly', label: 'Short Hair Short Curly' },
  { value: 'shortFlat', label: 'Short Hair Short Flat' },
  { value: 'shortRound', label: 'Short Hair Short Round' },
  { value: 'shortWaved', label: 'Short Hair Short Waved' },
  { value: 'sides', label: 'Short Hair Sides' },
  { value: 'theCaesar', label: 'Short Hair The Caesar' },
  { value: 'theCaesarAndSidePart', label: 'Short Hair Caesar Side Part' },
];

export const AVATAAARS_HAT_TOPS = new Set([
  'hat',
  'hijab',
  'turban',
  'winterHat1',
  'winterHat02',
  'winterHat03',
  'winterHat04',
]);

export const AVATAAARS_HAIR_COLORS: ColorSwatch[] = [
  { value: 'a55728', label: 'Auburn' },
  { value: '2c1b18', label: 'Black' },
  { value: 'b58143', label: 'Blonde' },
  { value: 'd6b370', label: 'Blonde Golden' },
  { value: '724133', label: 'Brown' },
  { value: '4a312c', label: 'Brown Dark' },
  { value: 'f59797', label: 'Pastel Pink' },
  { value: 'ecdcbf', label: 'Platinum' },
  { value: 'c93305', label: 'Red' },
  { value: 'e8e1e1', label: 'Silver Gray' },
];

export const AVATAAARS_ACCESSORIES_OPTIONS: LabeledOption[] = [
  { value: 'blank', label: 'Blank' },
  { value: 'kurt', label: 'Kurt' },
  { value: 'prescription01', label: 'Prescription 01' },
  { value: 'prescription02', label: 'Prescription 02' },
  { value: 'round', label: 'Round' },
  { value: 'sunglasses', label: 'Sunglasses' },
  { value: 'wayfarers', label: 'Wayfarers' },
  { value: 'eyepatch', label: 'Eyepatch' },
];

export const AVATAAARS_FACIAL_HAIR_OPTIONS: LabeledOption[] = [
  { value: 'blank', label: 'Blank' },
  { value: 'beardMedium', label: 'Beard Medium' },
  { value: 'beardLight', label: 'Beard Light' },
  { value: 'beardMajestic', label: 'Beard Majestic' },
  { value: 'moustacheFancy', label: 'Moustache Fancy' },
  { value: 'moustacheMagnum', label: 'Moustache Magnum' },
];

export const AVATAAARS_CLOTHES_OPTIONS: LabeledOption[] = [
  { value: 'blazerAndShirt', label: 'Blazer & Shirt' },
  { value: 'blazerAndSweater', label: 'Blazer & Sweater' },
  { value: 'collarAndSweater', label: 'Collar & Sweater' },
  { value: 'graphicShirt', label: 'Graphic Shirt' },
  { value: 'hoodie', label: 'Hoodie' },
  { value: 'overall', label: 'Overall' },
  { value: 'shirtCrewNeck', label: 'Shirt Crew Neck' },
  { value: 'shirtScoopNeck', label: 'Shirt Scoop Neck' },
  { value: 'shirtVNeck', label: 'Shirt V-Neck' },
];

export const AVATAAARS_GRAPHIC_OPTIONS: LabeledOption[] = [
  { value: 'bat', label: 'Bat' },
  { value: 'bear', label: 'Bear' },
  { value: 'cumbia', label: 'Cumbia' },
  { value: 'deer', label: 'Deer' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'hola', label: 'Hola' },
  { value: 'pizza', label: 'Pizza' },
  { value: 'resist', label: 'Resist' },
  { value: 'skull', label: 'Skull' },
  { value: 'skullOutline', label: 'Skull Outline' },
];

export const AVATAAARS_FABRIC_COLORS: ColorSwatch[] = [
  { value: '262e33', label: 'Black' },
  { value: '65c9ff', label: 'Blue 01' },
  { value: '5199e4', label: 'Blue 02' },
  { value: '25557c', label: 'Blue 03' },
  { value: 'e6e6e6', label: 'Gray 01' },
  { value: '929598', label: 'Gray 02' },
  { value: '3c4f5c', label: 'Heather' },
  { value: 'b1e2ff', label: 'Pastel Blue' },
  { value: 'a7ffc4', label: 'Pastel Green' },
  { value: 'ffafb9', label: 'Pastel Orange' },
  { value: 'ffffb1', label: 'Pastel Yellow' },
  { value: 'ff488e', label: 'Pink' },
  { value: 'ff5c5c', label: 'Red' },
  { value: 'ffffff', label: 'White' },
];

export const AVATAAARS_EYES_OPTIONS: LabeledOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'happy', label: 'Happy' },
  { value: 'wink', label: 'Wink' },
  { value: 'winkWacky', label: 'Wink Wacky' },
  { value: 'hearts', label: 'Hearts' },
  { value: 'surprised', label: 'Surprised' },
  { value: 'side', label: 'Side' },
  { value: 'squint', label: 'Squint' },
  { value: 'eyeRoll', label: 'Eye Roll' },
  { value: 'closed', label: 'Close' },
  { value: 'cry', label: 'Cry' },
  { value: 'xDizzy', label: 'Dizzy' },
];

export const AVATAAARS_EYEBROW_OPTIONS: LabeledOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'defaultNatural', label: 'Default Natural' },
  { value: 'flatNatural', label: 'Flat Natural' },
  { value: 'raisedExcited', label: 'Raised Excited' },
  { value: 'raisedExcitedNatural', label: 'Raised Excited Natural' },
  { value: 'upDown', label: 'Up Down' },
  { value: 'upDownNatural', label: 'Up Down Natural' },
  { value: 'sadConcerned', label: 'Sad Concerned' },
  { value: 'sadConcernedNatural', label: 'Sad Concerned Natural' },
  { value: 'frownNatural', label: 'Frown Natural' },
  { value: 'angry', label: 'Angry' },
  { value: 'angryNatural', label: 'Angry Natural' },
  { value: 'unibrowNatural', label: 'Unibrow Natural' },
];

export const AVATAAARS_MOUTH_OPTIONS: LabeledOption[] = [
  { value: 'smile', label: 'Smile' },
  { value: 'default', label: 'Default' },
  { value: 'twinkle', label: 'Twinkle' },
  { value: 'eating', label: 'Eating' },
  { value: 'grimace', label: 'Grimace' },
  { value: 'serious', label: 'Serious' },
  { value: 'concerned', label: 'Concerned' },
  { value: 'disbelief', label: 'Disbelief' },
  { value: 'sad', label: 'Sad' },
  { value: 'screamOpen', label: 'Scream Open' },
  { value: 'tongue', label: 'Tongue' },
  { value: 'vomit', label: 'Vomit' },
];

export const AVATAAARS_SKIN_OPTIONS: ColorSwatch[] = [
  { value: 'fd9841', label: 'Tanned' },
  { value: 'f8d25c', label: 'Yellow' },
  { value: 'ffdbb4', label: 'Pale' },
  { value: 'edb98a', label: 'Light' },
  { value: 'd08b5b', label: 'Brown' },
  { value: 'ae5d29', label: 'Dark Brown' },
  { value: '614335', label: 'Black' },
];

export const AVATAAARS_CIRCLE_COLORS: ColorSwatch[] = [
  { value: '65c9ff', label: 'Sky Blue' },
  { value: 'e25838', label: 'Coral' },
  { value: '2f8f72', label: 'Sage' },
  { value: '7a6bc4', label: 'Lavender' },
  { value: 'ffafb9', label: 'Blush' },
  { value: 'ffffb1', label: 'Butter' },
  { value: 'a7ffc4', label: 'Mint' },
  { value: '262e33', label: 'Charcoal' },
];

export function createDefaultAvataaars(): AvataaarsOptions {
  return {
    avatarStyle: 'circle',
    backgroundColor: '65c9ff',
    top: 'shortFlat',
    hairColor: '4a312c',
    hatColor: '3c4f5c',
    accessories: 'prescription02',
    accessoriesColor: '262e33',
    facialHair: 'blank',
    facialHairColor: '4a312c',
    clothing: 'hoodie',
    clothesColor: '25557c',
    clothingGraphic: 'diamond',
    eyes: 'default',
    eyebrows: 'defaultNatural',
    mouth: 'smile',
    skinColor: 'edb98a',
  };
}

export function randomAvataaars(): AvataaarsOptions {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const hairColor = pick(AVATAAARS_HAIR_COLORS).value;
  return {
    avatarStyle: 'circle',
    backgroundColor: pick(AVATAAARS_CIRCLE_COLORS).value,
    top: pick(AVATAAARS_TOP_OPTIONS).value,
    hairColor,
    hatColor: pick(AVATAAARS_FABRIC_COLORS).value,
    accessories:
      Math.random() > 0.55
        ? pick(AVATAAARS_ACCESSORIES_OPTIONS.filter((a) => a.value !== 'blank')).value
        : 'blank',
    accessoriesColor: pick(AVATAAARS_FABRIC_COLORS).value,
    facialHair:
      Math.random() > 0.65
        ? pick(AVATAAARS_FACIAL_HAIR_OPTIONS.filter((f) => f.value !== 'blank')).value
        : 'blank',
    facialHairColor: hairColor,
    clothing: pick(AVATAAARS_CLOTHES_OPTIONS).value,
    clothesColor: pick(AVATAAARS_FABRIC_COLORS).value,
    clothingGraphic: pick(AVATAAARS_GRAPHIC_OPTIONS).value,
    eyes: pick(AVATAAARS_EYES_OPTIONS).value,
    eyebrows: pick(AVATAAARS_EYEBROW_OPTIONS).value,
    mouth: pick(AVATAAARS_MOUTH_OPTIONS).value,
    skinColor: pick(AVATAAARS_SKIN_OPTIONS).value,
  };
}

export function renderAvataaarsSvgString(av: AvataaarsOptions): string {
  const options: AvataaarsCoreOptions = {
    style: [av.avatarStyle === 'default' ? 'default' : 'circle'],
    backgroundColor:
      av.avatarStyle === 'circle' ? [av.backgroundColor || '65c9ff'] : ['transparent'],
    skinColor: [av.skinColor || 'edb98a'],
    hairColor: [av.hairColor || '4a312c'],
    hatColor: [av.hatColor || '3c4f5c'],
    clothing: [av.clothing as NonNullable<AvataaarsCoreOptions['clothing']>[number]],
    clothesColor: [av.clothesColor || '25557c'],
    clothingGraphic: [
      av.clothingGraphic as NonNullable<AvataaarsCoreOptions['clothingGraphic']>[number],
    ],
    eyes: [av.eyes as NonNullable<AvataaarsCoreOptions['eyes']>[number]],
    eyebrows: [av.eyebrows as NonNullable<AvataaarsCoreOptions['eyebrows']>[number]],
    mouth: [av.mouth as NonNullable<AvataaarsCoreOptions['mouth']>[number]],
    topProbability: av.top === 'noHair' ? 0 : 100,
    top:
      av.top === 'noHair'
        ? undefined
        : [av.top as NonNullable<AvataaarsCoreOptions['top']>[number]],
    accessoriesProbability: av.accessories === 'blank' ? 0 : 100,
    accessories:
      av.accessories === 'blank'
        ? undefined
        : [av.accessories as NonNullable<AvataaarsCoreOptions['accessories']>[number]],
    accessoriesColor: [av.accessoriesColor || '262e33'],
    facialHairProbability: av.facialHair === 'blank' ? 0 : 100,
    facialHair:
      av.facialHair === 'blank'
        ? undefined
        : [av.facialHair as NonNullable<AvataaarsCoreOptions['facialHair']>[number]],
    facialHairColor: [av.facialHairColor || av.hairColor || '4a312c'],
  };
  return createAvatar(avataaars, options).toString();
}

export function createDefaultAvatar(): AvatarConfig {
  return {
    style: 'avataaars',
    seed: 17,
    bgColor: '#65C9FF',
    accentColor: '#FAF7F0',
    skinTone: '#EDB98A',
    hairStyle: 1,
    expression: 0,
    glasses: true,
    avataaars: createDefaultAvataaars(),
  };
}

export function randomAvatarConfig(currentStyle?: AvatarConfig['style']): AvatarConfig {
  const style = currentStyle || 'avataaars';
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const bgColor = pick(AVATAR_BG_COLORS);
  const accentOptions = AVATAR_ACCENT_COLORS.filter((c) => c !== bgColor);
  return {
    style,
    seed: Math.floor(Math.random() * 10000),
    bgColor,
    accentColor: pick(accentOptions),
    skinTone: pick(AVATAR_SKIN_TONES),
    hairStyle: Math.floor(Math.random() * 5),
    expression: Math.floor(Math.random() * 3),
    glasses: Math.random() > 0.35,
    avataaars: randomAvataaars(),
  };
}

interface AvatarSvgProps {
  config?: AvatarConfig;
  initials?: string;
  size?: number;
  className?: string;
  id?: string;
}

export default function AvatarSvg({
  config,
  size = 40,
  className = '',
  id,
}: AvatarSvgProps) {
  const cfg = config || createDefaultAvatar();
  const avOptions = cfg.avataaars || createDefaultAvataaars();
  const avataaarsKey = JSON.stringify(avOptions);

  const avataaarsDataUri = useMemo(() => {
    const svg = renderAvataaarsSvgString(avOptions);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, [avataaarsKey]);

  return (
    <img
      id={id}
      src={avataaarsDataUri}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`inline-block shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
