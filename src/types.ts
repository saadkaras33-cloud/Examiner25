export type ExamType =
  | 'monthly'
  | 'final'
  | 'midterm'
  | 'quiz'
  | 'practical'
  | 'oral'
  | 'other';

export interface Exam {
  id: string;
  subject: string;
  type: ExamType;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM or ""
  endTime: string; // HH:MM or ""
  room: string;
  material: string;
  topics: string[];
  notes: string;
  sourceChatKey?: string;
  createdAt?: string;
}

export interface ExamInput {
  subject: string;
  type: ExamType;
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  material?: string;
  topics?: string[];
  notes: string;
}

export interface LessonItem {
  id: string;
  subject: string;
  title: string;
  notes: string;
  completed: boolean;
  examId?: string;
  createdAt?: string;
}

export interface LessonInput {
  subject: string;
  title: string;
  notes?: string;
  completed?: boolean;
  examId?: string;
}

export type AvatarStyle = 'avataaars';

export interface AvataaarsOptions {
  avatarStyle: 'circle' | 'default';
  backgroundColor: string;
  top: string;
  hairColor: string;
  hatColor: string;
  accessories: string;
  accessoriesColor: string;
  facialHair: string;
  facialHairColor: string;
  clothing: string;
  clothesColor: string;
  clothingGraphic: string;
  eyes: string;
  eyebrows: string;
  mouth: string;
  skinColor: string;
}

export interface AvatarConfig {
  style: AvatarStyle;
  seed: number;
  bgColor: string;
  accentColor: string;
  skinTone: string;
  hairStyle: number;
  expression: number;
  glasses: boolean;
  avataaars?: AvataaarsOptions;
}

export type LanguageId = 'en' | 'ar' | 'genz' | 'fr' | 'arz';

export interface SpotifyTrackItem {
  id?: string;
  title: string;
  artist: string;
  durationMs?: number;
  previewUrl?: string;
  spotifyUrl?: string;
  embedUrl?: string;
  youtubeVideoId?: string;
  youtubeVideoIds?: string[];
  matchVersion?: number;
}

export interface SavedMusicTrack {
  id: string;
  title: string;
  subtitle: string;
  kind: 'spotify' | 'custom';
  spotifyKind?: 'track' | 'album' | 'playlist';
  spotifyId?: string;
  spotifyUrl?: string;
  embedUrl?: string;
  audioUrl?: string;
  mimeType?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  durationMs?: number;
  youtubeVideoId?: string;
  youtubeVideoIds?: string[];
  matchVersion?: number;
  tracks?: SpotifyTrackItem[];
  savedAt?: string;
}

export type ThemeId = string;

export interface UserProfile {
  id?: string;
  displayName: string;
  email: string;
  isGuest?: boolean;
  authProvider?: 'email' | 'google';
  photoUrl?: string;
  avatar?: AvatarConfig;
  themeId?: ThemeId;
  language?: LanguageId;
  savedMusic?: SavedMusicTrack[];
}

export interface ChatThemeConfig {
  mode: 'default' | 'theme';
  themeId?: ThemeId;
}

export interface ChatMember {
  userId: string;
  displayName: string;
  email?: string;
  avatar?: AvatarConfig;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface SharedExamPayload {
  subject: string;
  type: ExamType;
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  material: string;
  topics: string[];
  notes: string;
}

export type ExamDecision = 'accepted' | 'refused';

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: AvatarConfig;
  kind: 'exam' | 'system' | 'text';
  text: string;
  exam?: SharedExamPayload;
  decisions?: Record<string, ExamDecision>;
  createdAt: string;
}

export interface PrivateChatRoom {
  id: string;
  secretCode: string;
  groupName: string;
  schoolName: string;
  grade: string;
  className: string;
  avatarImage?: string;
  backgroundMusic?: SavedMusicTrack | null;
  theme: ChatThemeConfig;
  ownerId: string;
  members: ChatMember[];
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ScannedExamDraft extends ExamInput {
  _id: string;
  _selected: boolean;
  _dup: boolean;
  material: string;
  topics: string[];
}

export interface ScannedLessonDraft {
  _id: string;
  _selected: boolean;
  _dup: boolean;
  subject: string;
  title: string;
  notes: string;
}
