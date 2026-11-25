export interface ThemeSpec {
  id: string;
  name: string;
  kind: 'solid' | 'gradient';
  isDark: boolean;
  stops: [string, string] | [string, string, string];
  primaryHex: string;
  secondaryHex: string;
  angleDeg?: number;
}

// 50 Solid Themes + 50 Gradient Themes = 100 Themes Total
export const THEME_SPECS: ThemeSpec[] = [
  // === 50 SOLID THEMES (First 6 preserve classic IDs) ===
  { id: 'paper', name: 'Warm Paper', kind: 'solid', isDark: false, stops: ['#FAF7F0', '#FAF7F0'], primaryHex: '#18203A', secondaryHex: '#E25838' },
  { id: 'sage', name: 'Botanical Sage', kind: 'solid', isDark: false, stops: ['#F3F7F4', '#F3F7F4'], primaryHex: '#16342B', secondaryHex: '#2F8F72' },
  { id: 'ocean', name: 'Coastal Ink', kind: 'solid', isDark: false, stops: ['#F2F6FA', '#F2F6FA'], primaryHex: '#122C4A', secondaryHex: '#2B7AB8' },
  { id: 'plum', name: 'Studio Plum', kind: 'solid', isDark: false, stops: ['#F8F4F8', '#F8F4F8'], primaryHex: '#301C42', secondaryHex: '#9354C4' },
  { id: 'midnight', name: 'Midnight Slate', kind: 'solid', isDark: true, stops: ['#111521', '#111521'], primaryHex: '#EEF1F8', secondaryHex: '#E86C4D' },
  { id: 'espresso', name: 'Night Espresso', kind: 'solid', isDark: true, stops: ['#1C1816', '#1C1816'], primaryHex: '#F5EFE8', secondaryHex: '#E39A42' },

  // Light Solid Themes (22 more -> 26 Light Solids)
  { id: 'solid-ivory-linen', name: 'Ivory Linen', kind: 'solid', isDark: false, stops: ['#FBF8F3', '#FBF8F3'], primaryHex: '#29211B', secondaryHex: '#C26D3A' },
  { id: 'solid-rose-petal', name: 'Rose Petal', kind: 'solid', isDark: false, stops: ['#FDF3F5', '#FDF3F5'], primaryHex: '#3E1B26', secondaryHex: '#D84B78' },
  { id: 'solid-buttercream', name: 'Buttercream', kind: 'solid', isDark: false, stops: ['#FEF9EC', '#FEF9EC'], primaryHex: '#332914', secondaryHex: '#D98218' },
  { id: 'solid-mint-frost', name: 'Mint Frost', kind: 'solid', isDark: false, stops: ['#EFF9F5', '#EFF9F5'], primaryHex: '#10352A', secondaryHex: '#1C9B74' },
  { id: 'solid-sky-mist', name: 'Sky Mist', kind: 'solid', isDark: false, stops: ['#EFF6FC', '#EFF6FC'], primaryHex: '#122B49', secondaryHex: '#2684D9' },
  { id: 'solid-lavender-cloud', name: 'Lavender Cloud', kind: 'solid', isDark: false, stops: ['#F5F2FC', '#F5F2FC'], primaryHex: '#2A1D4D', secondaryHex: '#7A54D8' },
  { id: 'solid-peach-cream', name: 'Peach Cream', kind: 'solid', isDark: false, stops: ['#FFF4EE', '#FFF4EE'], primaryHex: '#3F2016', secondaryHex: '#E46338' },
  { id: 'solid-matcha-milk', name: 'Matcha Milk', kind: 'solid', isDark: false, stops: ['#F3F8EE', '#F3F8EE'], primaryHex: '#223618', secondaryHex: '#5D9B32' },
  { id: 'solid-glacier-white', name: 'Glacier White', kind: 'solid', isDark: false, stops: ['#F4F8FB', '#F4F8FB'], primaryHex: '#182433', secondaryHex: '#0F8B9C' },
  { id: 'solid-blush-sand', name: 'Blush Sand', kind: 'solid', isDark: false, stops: ['#FAF2EE', '#FAF2EE'], primaryHex: '#3B231E', secondaryHex: '#C95450' },
  { id: 'solid-periwinkle-tint', name: 'Periwinkle Tint', kind: 'solid', isDark: false, stops: ['#F1F4FD', '#F1F4FD'], primaryHex: '#1C244B', secondaryHex: '#4E67E6' },
  { id: 'solid-pistachio-cream', name: 'Pistachio Cream', kind: 'solid', isDark: false, stops: ['#F2F7F0', '#F2F7F0'], primaryHex: '#1D3321', secondaryHex: '#439652' },
  { id: 'solid-lemon-chiffon', name: 'Lemon Chiffon', kind: 'solid', isDark: false, stops: ['#FCFBE9', '#FCFBE9'], primaryHex: '#333114', secondaryHex: '#C99612' },
  { id: 'solid-lilac-chalk', name: 'Lilac Chalk', kind: 'solid', isDark: false, stops: ['#F9F1FB', '#F9F1FB'], primaryHex: '#391944', secondaryHex: '#B649C9' },
  { id: 'solid-seafoam-whisper', name: 'Seafoam Whisper', kind: 'solid', isDark: false, stops: ['#EEF9F8', '#EEF9F8'], primaryHex: '#0E3436', secondaryHex: '#15989B' },
  { id: 'solid-apricot-milk', name: 'Apricot Milk', kind: 'solid', isDark: false, stops: ['#FFF5E9', '#FFF5E9'], primaryHex: '#3C2312', secondaryHex: '#DF7422' },
  { id: 'solid-stone-paper', name: 'Stone Paper', kind: 'solid', isDark: false, stops: ['#F3F4F6', '#F3F4F6'], primaryHex: '#1F242D', secondaryHex: '#4E6280' },
  { id: 'solid-cherry-blossom', name: 'Cherry Blossom', kind: 'solid', isDark: false, stops: ['#FEF1F6', '#FEF1F6'], primaryHex: '#41182A', secondaryHex: '#E0427E' },
  { id: 'solid-oat-latte', name: 'Oat Latte', kind: 'solid', isDark: false, stops: ['#F6F1EA', '#F6F1EA'], primaryHex: '#2E241C', secondaryHex: '#A6693B' },
  { id: 'solid-powder-blue', name: 'Powder Blue', kind: 'solid', isDark: false, stops: ['#EDF4FA', '#EDF4FA'], primaryHex: '#14293D', secondaryHex: '#2C75B8' },
  { id: 'solid-coral-pearl', name: 'Coral Pearl', kind: 'solid', isDark: false, stops: ['#FFF2F0', '#FFF2F0'], primaryHex: '#401D1A', secondaryHex: '#E25546' },
  { id: 'solid-silver-birch', name: 'Silver Birch', kind: 'solid', isDark: false, stops: ['#F5F6F8', '#F5F6F8'], primaryHex: '#1C222B', secondaryHex: '#5A67D8' },

  // Dark Solid Themes (22 more -> 24 Dark Solids)
  { id: 'solid-obsidian-ink', name: 'Obsidian Ink', kind: 'solid', isDark: true, stops: ['#0D1017', '#0D1017'], primaryHex: '#ECEFF7', secondaryHex: '#5E8BFF' },
  { id: 'solid-velvet-navy', name: 'Velvet Navy', kind: 'solid', isDark: true, stops: ['#0F1A2E', '#0F1A2E'], primaryHex: '#EBF2FF', secondaryHex: '#4DB5FF' },
  { id: 'solid-deep-emerald', name: 'Deep Emerald', kind: 'solid', isDark: true, stops: ['#0D211B', '#0D211B'], primaryHex: '#E6F5EE', secondaryHex: '#35C996' },
  { id: 'solid-dark-amethyst', name: 'Dark Amethyst', kind: 'solid', isDark: true, stops: ['#1A1228', '#1A1228'], primaryHex: '#F3EBFF', secondaryHex: '#BA78FF' },
  { id: 'solid-burgundy-noir', name: 'Burgundy Noir', kind: 'solid', isDark: true, stops: ['#241117', '#241117'], primaryHex: '#FCECF0', secondaryHex: '#F2648B' },
  { id: 'solid-smoked-charcoal', name: 'Smoked Charcoal', kind: 'solid', isDark: true, stops: ['#16181C', '#16181C'], primaryHex: '#F1F3F5', secondaryHex: '#F08C42' },
  { id: 'solid-forest-shadow', name: 'Forest Shadow', kind: 'solid', isDark: true, stops: ['#131E16', '#131E16'], primaryHex: '#ECF5EE', secondaryHex: '#73CF5D' },
  { id: 'solid-abyssal-teal', name: 'Abyssal Teal', kind: 'solid', isDark: true, stops: ['#0C1D22', '#0C1D22'], primaryHex: '#E4F7FA', secondaryHex: '#2CCCD3' },
  { id: 'solid-indigo-night', name: 'Indigo Night', kind: 'solid', isDark: true, stops: ['#141630', '#141630'], primaryHex: '#EDEFFF', secondaryHex: '#808CFF' },
  { id: 'solid-crimson-slate', name: 'Crimson Slate', kind: 'solid', isDark: true, stops: ['#211316', '#211316'], primaryHex: '#FCEEEF', secondaryHex: '#F25F5C' },
  { id: 'solid-mahogany-dark', name: 'Mahogany Dark', kind: 'solid', isDark: true, stops: ['#231713', '#231713'], primaryHex: '#FAF0EB', secondaryHex: '#EA8D52' },
  { id: 'solid-graphite-blue', name: 'Graphite Blue', kind: 'solid', isDark: true, stops: ['#161D29', '#161D29'], primaryHex: '#EAF0F9', secondaryHex: '#63A4FF' },
  { id: 'solid-plum-velvet', name: 'Plum Velvet', kind: 'solid', isDark: true, stops: ['#201324', '#201324'], primaryHex: '#F9ECFC', secondaryHex: '#DF6EEB' },
  { id: 'solid-olive-nocturne', name: 'Olive Nocturne', kind: 'solid', isDark: true, stops: ['#191D13', '#191D13'], primaryHex: '#F2F5EA', secondaryHex: '#B6CC46' },
  { id: 'solid-copper-night', name: 'Copper Night', kind: 'solid', isDark: true, stops: ['#1E1612', '#1E1612'], primaryHex: '#F9EFE9', secondaryHex: '#EB8F48' },
  { id: 'solid-cobalt-shadow', name: 'Cobalt Shadow', kind: 'solid', isDark: true, stops: ['#101933', '#101933'], primaryHex: '#EBF1FF', secondaryHex: '#4F95FF' },
  { id: 'solid-cocoa-matte', name: 'Cocoa Matte', kind: 'solid', isDark: true, stops: ['#1F1918', '#1F1918'], primaryHex: '#F6F0EE', secondaryHex: '#D8966C' },
  { id: 'solid-pine-noir', name: 'Pine Noir', kind: 'solid', isDark: true, stops: ['#0E1B18', '#0E1B18'], primaryHex: '#E8F4F1', secondaryHex: '#3FD1A5' },
  { id: 'solid-onyx-gold', name: 'Onyx Gold', kind: 'solid', isDark: true, stops: ['#141412', '#141412'], primaryHex: '#F7F4E9', secondaryHex: '#EAB338' },
  { id: 'solid-rosewood-dark', name: 'Rosewood Dark', kind: 'solid', isDark: true, stops: ['#24141C', '#24141C'], primaryHex: '#FCEDF4', secondaryHex: '#EE6FA3' },
  { id: 'solid-arctic-night', name: 'Arctic Night', kind: 'solid', isDark: true, stops: ['#101822', '#101822'], primaryHex: '#EBF4FC', secondaryHex: '#56C2F5' },
  { id: 'solid-void-black', name: 'Void Black', kind: 'solid', isDark: true, stops: ['#090A0D', '#090A0D'], primaryHex: '#F4F6FA', secondaryHex: '#22D3EE' },

  // === 50 GRADIENT THEMES (25 Light Gradients + 25 Dark Gradients) ===
  // Light Gradients
  { id: 'grad-sunrise-peach', name: 'Sunrise Peach', kind: 'gradient', isDark: false, stops: ['#FFF2EB', '#FFE0D4', '#FFF7E8'], primaryHex: '#3A1F18', secondaryHex: '#DF5C37', angleDeg: 135 },
  { id: 'grad-aurora-mint', name: 'Aurora Mint', kind: 'gradient', isDark: false, stops: ['#E7FAF3', '#E3F3FC', '#F2FBF6'], primaryHex: '#13362F', secondaryHex: '#1B9A77', angleDeg: 135 },
  { id: 'grad-lavender-silk', name: 'Lavender Silk', kind: 'gradient', isDark: false, stops: ['#F2ECFF', '#FCECF6', '#EEF3FF'], primaryHex: '#2C1D4A', secondaryHex: '#8450D4', angleDeg: 135 },
  { id: 'grad-ocean-breeze', name: 'Ocean Breeze', kind: 'gradient', isDark: false, stops: ['#E4F2FE', '#E7FAF8', '#F2F7FF'], primaryHex: '#132C47', secondaryHex: '#227CC9', angleDeg: 135 },
  { id: 'grad-rosewater-glow', name: 'Rosewater Glow', kind: 'gradient', isDark: false, stops: ['#FFEBF1', '#FFF3EA', '#FCEAF6'], primaryHex: '#3E1B28', secondaryHex: '#D94B7C', angleDeg: 135 },
  { id: 'grad-golden-morning', name: 'Golden Morning', kind: 'gradient', isDark: false, stops: ['#FFF8DF', '#FFEBD2', '#FFFDF2'], primaryHex: '#362712', secondaryHex: '#D88218', angleDeg: 135 },
  { id: 'grad-matcha-sky', name: 'Matcha Sky', kind: 'gradient', isDark: false, stops: ['#EDF8E8', '#E5F6F5', '#F7FBF2'], primaryHex: '#1D361D', secondaryHex: '#469A4A', angleDeg: 135 },
  { id: 'grad-periwinkle-dawn', name: 'Periwinkle Dawn', kind: 'gradient', isDark: false, stops: ['#EAEFFF', '#F3EAFF', '#EDF5FF'], primaryHex: '#1D254C', secondaryHex: '#5064E2', angleDeg: 135 },
  { id: 'grad-apricot-blush', name: 'Apricot Blush', kind: 'gradient', isDark: false, stops: ['#FFEDE0', '#FFE4EC', '#FFF8F0'], primaryHex: '#3E201C', secondaryHex: '#E06247', angleDeg: 135 },
  { id: 'grad-glacier-prism', name: 'Glacier Prism', kind: 'gradient', isDark: false, stops: ['#E8F7FC', '#EDF2FF', '#F3FBFE'], primaryHex: '#14293F', secondaryHex: '#168DAD', angleDeg: 135 },
  { id: 'grad-lilac-mist', name: 'Lilac Mist', kind: 'gradient', isDark: false, stops: ['#F7EBFE', '#EAEFFD', '#FFF2F9'], primaryHex: '#331D46', secondaryHex: '#9C4ED4', angleDeg: 145 },
  { id: 'grad-warm-terracotta', name: 'Warm Terracotta', kind: 'gradient', isDark: false, stops: ['#FCECE5', '#FAF4E4', '#F8E7DF'], primaryHex: '#3A2118', secondaryHex: '#C95A3A', angleDeg: 135 },
  { id: 'grad-pistachio-breeze', name: 'Pistachio Breeze', kind: 'gradient', isDark: false, stops: ['#ECF9ED', '#F7F9E6', '#EBF6F1'], primaryHex: '#1C3420', secondaryHex: '#3F9650', angleDeg: 130 },
  { id: 'grad-cotton-candy', name: 'Cotton Candy', kind: 'gradient', isDark: false, stops: ['#E8F4FF', '#FCE8F6', '#F4EEFF'], primaryHex: '#281F44', secondaryHex: '#D04F99', angleDeg: 135 },
  { id: 'grad-champagne-sand', name: 'Champagne Sand', kind: 'gradient', isDark: false, stops: ['#FBF4E9', '#F4E9DF', '#FCF9F3'], primaryHex: '#31251B', secondaryHex: '#B6723B', angleDeg: 135 },
  { id: 'grad-eucalyptus-dew', name: 'Eucalyptus Dew', kind: 'gradient', isDark: false, stops: ['#E7F5F2', '#EEF5EB', '#F2FAF8'], primaryHex: '#15342E', secondaryHex: '#2A8F7C', angleDeg: 135 },
  { id: 'grad-cherry-sorbet', name: 'Cherry Sorbet', kind: 'gradient', isDark: false, stops: ['#FFE6EE', '#FFDED8', '#FFF2F5'], primaryHex: '#421926', secondaryHex: '#DF456E', angleDeg: 135 },
  { id: 'grad-celestial-pearl', name: 'Celestial Pearl', kind: 'gradient', isDark: false, stops: ['#EDF3FB', '#F4EEFA', '#EAF7FA'], primaryHex: '#1C263F', secondaryHex: '#4E6AD2', angleDeg: 135 },
  { id: 'grad-honey-lemon', name: 'Honey Lemon', kind: 'gradient', isDark: false, stops: ['#FEF7D6', '#FBEFD8', '#FFFBE8'], primaryHex: '#352B12', secondaryHex: '#CF8A15', angleDeg: 135 },
  { id: 'grad-spring-fern', name: 'Spring Fern', kind: 'gradient', isDark: false, stops: ['#E5F7E8', '#DCF4F0', '#F3FAF1'], primaryHex: '#153421', secondaryHex: '#25975E', angleDeg: 135 },
  { id: 'grad-blossom-haze', name: 'Blossom Haze', kind: 'gradient', isDark: false, stops: ['#FBEAF5', '#FDEEE6', '#F2EEFF'], primaryHex: '#3A1D36', secondaryHex: '#C84E97', angleDeg: 140 },
  { id: 'grad-fjord-frost', name: 'Fjord Frost', kind: 'gradient', isDark: false, stops: ['#E4F3F8', '#E9EDF9', '#F2F9FB'], primaryHex: '#14293B', secondaryHex: '#237CB4', angleDeg: 135 },
  { id: 'grad-mango-cream', name: 'Mango Cream', kind: 'gradient', isDark: false, stops: ['#FFF0D9', '#FFE5DA', '#FFF9EC'], primaryHex: '#3C2312', secondaryHex: '#DF6D26', angleDeg: 135 },
  { id: 'grad-orchid-linen', name: 'Orchid Linen', kind: 'gradient', isDark: false, stops: ['#F5EBFA', '#FBEFF3', '#FAF7F0'], primaryHex: '#341D3F', secondaryHex: '#A74DC2', angleDeg: 135 },
  { id: 'grad-aqua-sparkle', name: 'Aqua Sparkle', kind: 'gradient', isDark: false, stops: ['#E2FAF8', '#E7F0FF', '#F2FCFB'], primaryHex: '#113038', secondaryHex: '#1393AC', angleDeg: 135 },

  // Dark Gradients (25)
  { id: 'grad-midnight-aurora', name: 'Midnight Aurora', kind: 'gradient', isDark: true, stops: ['#0D1824', '#0E292B', '#17162E'], primaryHex: '#ECFAFB', secondaryHex: '#34E2B8', angleDeg: 135 },
  { id: 'grad-cosmic-indigo', name: 'Cosmic Indigo', kind: 'gradient', isDark: true, stops: ['#0F132C', '#1D1538', '#111A36'], primaryHex: '#EDF0FF', secondaryHex: '#7A8CFF', angleDeg: 135 },
  { id: 'grad-nebula-plum', name: 'Nebula Plum', kind: 'gradient', isDark: true, stops: ['#1D102A', '#2B142C', '#151326'], primaryHex: '#F9ECFF', secondaryHex: '#DA6BF2', angleDeg: 135 },
  { id: 'grad-crimson-dusk', name: 'Crimson Dusk', kind: 'gradient', isDark: true, stops: ['#241019', '#2E1814', '#16121C'], primaryHex: '#FCEEEF', secondaryHex: '#F56476', angleDeg: 135 },
  { id: 'grad-obsidian-teal', name: 'Obsidian Teal', kind: 'gradient', isDark: true, stops: ['#0B171D', '#10282C', '#0F1522'], primaryHex: '#E8F7FA', secondaryHex: '#2ED3D8', angleDeg: 135 },
  { id: 'grad-solar-eclipse', name: 'Solar Eclipse', kind: 'gradient', isDark: true, stops: ['#181214', '#2C1B12', '#17151D'], primaryHex: '#FAF0E6', secondaryHex: '#F29D38', angleDeg: 135 },
  { id: 'grad-velvet-ocean', name: 'Velvet Ocean', kind: 'gradient', isDark: true, stops: ['#0C172B', '#112540', '#13172C'], primaryHex: '#EBF4FF', secondaryHex: '#4EA6FF', angleDeg: 135 },
  { id: 'grad-emerald-night', name: 'Emerald Night', kind: 'gradient', isDark: true, stops: ['#0B1C16', '#122E21', '#0E191B'], primaryHex: '#E9F7F0', secondaryHex: '#3CD496', angleDeg: 135 },
  { id: 'grad-cyber-violet', name: 'Cyber Violet', kind: 'gradient', isDark: true, stops: ['#141028', '#25143B', '#0E1B30'], primaryHex: '#F1EDFF', secondaryHex: '#B66DFF', angleDeg: 135 },
  { id: 'grad-sunset-noir', name: 'Sunset Noir', kind: 'gradient', isDark: true, stops: ['#21111C', '#2B191A', '#1B1428'], primaryHex: '#FCEFF4', secondaryHex: '#F2785C', angleDeg: 135 },
  { id: 'grad-arctic-abyss', name: 'Arctic Abyss', kind: 'gradient', isDark: true, stops: ['#0C1520', '#13273A', '#101824'], primaryHex: '#EBF4FC', secondaryHex: '#5AC4FA', angleDeg: 135 },
  { id: 'grad-mocha-satin', name: 'Mocha Satin', kind: 'gradient', isDark: true, stops: ['#1D1614', '#2A1F1A', '#191418'], primaryHex: '#F8EFEA', secondaryHex: '#E39A54', angleDeg: 135 },
  { id: 'grad-rose-eclipse', name: 'Rose Eclipse', kind: 'gradient', isDark: true, stops: ['#22111B', '#2E162B', '#181122'], primaryHex: '#FCECF6', secondaryHex: '#F26CA7', angleDeg: 135 },
  { id: 'grad-neon-matrix', name: 'Neon Matrix', kind: 'gradient', isDark: true, stops: ['#091713', '#102A1D', '#0B1618'], primaryHex: '#EAFAF1', secondaryHex: '#3FE07E', angleDeg: 135 },
  { id: 'grad-astral-blue', name: 'Astral Blue', kind: 'gradient', isDark: true, stops: ['#0E1428', '#152242', '#181432'], primaryHex: '#ECF2FF', secondaryHex: '#639CFF', angleDeg: 135 },
  { id: 'grad-magenta-haze', name: 'Magenta Haze', kind: 'gradient', isDark: true, stops: ['#1E1026', '#30142C', '#161329'], primaryHex: '#FBECFA', secondaryHex: '#EC64B8', angleDeg: 140 },
  { id: 'grad-jade-midnight', name: 'Jade Midnight', kind: 'gradient', isDark: true, stops: ['#0D1D1A', '#132C2E', '#111824'], primaryHex: '#E8F7F4', secondaryHex: '#36D4B7', angleDeg: 135 },
  { id: 'grad-amber-shadow', name: 'Amber Shadow', kind: 'gradient', isDark: true, stops: ['#1C1510', '#2B1E11', '#1A1415'], primaryHex: '#FAF1E4', secondaryHex: '#ECA63A', angleDeg: 135 },
  { id: 'grad-royal-velvet', name: 'Royal Velvet', kind: 'gradient', isDark: true, stops: ['#12122A', '#221740', '#11162C'], primaryHex: '#EEF0FF', secondaryHex: '#8E7BFF', angleDeg: 135 },
  { id: 'grad-blood-moon', name: 'Blood Moon', kind: 'gradient', isDark: true, stops: ['#1F0E12', '#2E1418', '#17111A'], primaryHex: '#FDECEE', secondaryHex: '#F45D5D', angleDeg: 135 },
  { id: 'grad-stormy-fjord', name: 'Stormy Fjord', kind: 'gradient', isDark: true, stops: ['#111822', '#192636', '#161E29'], primaryHex: '#ECF2F9', secondaryHex: '#62A8EA', angleDeg: 135 },
  { id: 'grad-moss-shadow', name: 'Moss Shadow', kind: 'gradient', isDark: true, stops: ['#141B12', '#1F2B17', '#131A18'], primaryHex: '#EFF6EA', secondaryHex: '#8CD44C', angleDeg: 135 },
  { id: 'grad-twilight-plum', name: 'Twilight Plum', kind: 'gradient', isDark: true, stops: ['#1A1226', '#281834', '#16172C'], primaryHex: '#F5EEFC', secondaryHex: '#C474F0', angleDeg: 135 },
  { id: 'grad-starlight-obsidian', name: 'Starlight Obsidian', kind: 'gradient', isDark: true, stops: ['#0A0D16', '#131B2E', '#121022'], primaryHex: '#EDF2FF', secondaryHex: '#58B4FF', angleDeg: 135 },
  { id: 'grad-ember-glow', name: 'Ember Glow', kind: 'gradient', isDark: true, stops: ['#1D1112', '#2D1913', '#191318'], primaryHex: '#FCEFE9', secondaryHex: '#F2784B', angleDeg: 135 },
];

export const THEME_IDS_LIST: string[] = THEME_SPECS.map((t) => t.id);
export const VALID_THEME_IDS = new Set<string>(THEME_IDS_LIST);

export function isValidThemeId(id: unknown): id is string {
  return typeof id === 'string' && VALID_THEME_IDS.has(id.trim());
}
