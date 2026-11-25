import 'dotenv/config';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import { format } from 'date-fns';
import { VALID_THEME_IDS } from './src/utils/themeIds.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(__dirname, 'data');
const EXAMS_FILE = path.join(DATA_DIR, 'exams.json');
const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MUSIC_FILE = path.join(DATA_DIR, 'music.json');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const SCAN_CACHE_FILE = path.join(DATA_DIR, 'scan-cache.json');
const SCAN_COOLDOWN_FILE = path.join(DATA_DIR, 'scan-cooldowns.json');
const FIREBASE_CONFIG_FILE = path.resolve(__dirname, 'firebase-applet-config.json');
const SECRET_FILE = path.join(DATA_DIR, '.session_secret');
const SESSION_COOKIE = 'examiner_session';
const VALID_THEMES = VALID_THEME_IDS;
const VALID_LANGUAGES = new Set(['en', 'ar', 'genz', 'fr', 'arz']);
const SCAN_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCAN_CACHE_MAX_ENTRIES = 150;

interface StoredExam {
  id: string;
  workspaceId: string;
  subject: string;
  type: 'monthly' | 'final' | 'midterm' | 'quiz' | 'practical' | 'oral' | 'other';
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  material: string;
  topics: string[];
  notes: string;
  sourceChatKey?: string;
  createdAt: string;
}

interface StoredLesson {
  id: string;
  workspaceId: string;
  subject: string;
  title: string;
  notes: string;
  completed: boolean;
  examId?: string;
  createdAt: string;
}

interface StoredUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  authProvider?: 'email' | 'google';
  photoUrl?: string;
  avatar?: Record<string, unknown>;
  themeId?: string;
  language?: string;
  savedMusic?: unknown[];
  createdAt: string;
}

interface StoredChatTheme {
  mode: 'default' | 'theme';
  themeId?: string;
}

interface StoredChatMember {
  userId: string;
  displayName: string;
  email?: string;
  avatar?: Record<string, unknown>;
  role: 'owner' | 'member';
  joinedAt: string;
}

interface StoredChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: Record<string, unknown>;
  kind: 'text' | 'exam' | 'system';
  text: string;
  exam?: {
    subject: string;
    type: StoredExam['type'];
    date: string;
    startTime: string;
    endTime: string;
    room: string;
    material: string;
    topics: string[];
    notes: string;
  };
  decisions?: Record<string, 'accepted' | 'refused'>;
  createdAt: string;
}

interface StoredPrivateChat {
  id: string;
  secretCode: string;
  groupName: string;
  schoolName: string;
  grade: string;
  className: string;
  avatarImage?: string;
  backgroundMusic?: Record<string, unknown> | null;
  theme: StoredChatTheme;
  ownerId: string;
  members: StoredChatMember[];
  messages: StoredChatMessage[];
  createdAt: string;
  updatedAt: string;
}

let cachedSessionSecret: string | null = null;
function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSessionSecret) return cachedSessionSecret;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) {
        cachedSessionSecret = existing;
        return existing;
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, generated, 'utf8');
    cachedSessionSecret = generated;
    return generated;
  } catch {
    cachedSessionSecret = 'examiner_fallback_session_secret_key';
    return cachedSessionSecret;
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback), 'utf8');
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile<T>(filePath: string, data: T): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function hashPassword(password: string, salt?: string): string {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 32).toString('hex');
  return `${actualSalt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, original] = storedHash.split(':');
  if (!salt || !original) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(original, 'hex'), Buffer.from(candidate, 'hex'));
}

function parseCookies(req: express.Request | http.IncomingMessage): Record<string, string> {
  const rawHeader =
    'header' in req && typeof req.header === 'function'
      ? req.header('cookie')
      : req.headers?.cookie;
  const header = Array.isArray(rawHeader) ? rawHeader.join('; ') : rawHeader;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function signSessionToken(userId: string): string {
  const mac = crypto.createHmac('sha256', getSessionSecret()).update(userId).digest('hex');
  return `${userId}.${mac}`;
}

function verifySessionToken(token: string | undefined): string | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx <= 0) return null;
  const userId = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!userId || !sig) return null;
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(userId).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
      ? userId
      : null;
  } catch {
    return null;
  }
}

function isHttpsRequest(req: express.Request): boolean {
  return req.secure || req.header('x-forwarded-proto') === 'https';
}

function setSessionCookie(req: express.Request, res: express.Response, userId: string): void {
  const token = encodeURIComponent(signSessionToken(userId));
  const secureFlags = isHttpsRequest(req) ? 'SameSite=None; Secure' : 'SameSite=Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; ${secureFlags}`
  );
}

function clearSessionCookie(req: express.Request, res: express.Response): void {
  const secureFlags = isHttpsRequest(req) ? 'SameSite=None; Secure' : 'SameSite=Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; ${secureFlags}`
  );
}

function dedupeSavedMusic(list: unknown[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const key = String(rec.id || rec.spotifyUrl || rec.embedUrl || rec.audioUrl || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out.slice(0, 120);
}

function getWorkspaceSavedMusic(workspaceId: string, userMusic?: unknown[]): Record<string, unknown>[] {
  const store = readJsonFile<Record<string, unknown[]>>(MUSIC_FILE, {});
  const stored = Array.isArray(store[workspaceId]) ? store[workspaceId] : [];
  const profile = Array.isArray(userMusic) ? userMusic : [];
  return dedupeSavedMusic([...stored, ...profile]);
}

function setWorkspaceSavedMusic(workspaceId: string, tracks: unknown[]): Record<string, unknown>[] {
  const clean = dedupeSavedMusic(tracks);
  const store = readJsonFile<Record<string, unknown[]>>(MUSIC_FILE, {});
  store[workspaceId] = clean;
  writeJsonFile(MUSIC_FILE, store);
  const users = readJsonFile<StoredUser[]>(USERS_FILE, []);
  const idx = users.findIndex((u) => u.id === workspaceId);
  if (idx !== -1) {
    users[idx].savedMusic = clean;
    writeJsonFile(USERS_FILE, users);
  }
  return clean;
}

function toPublicUser(u: StoredUser) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    authProvider: u.authProvider || 'email',
    photoUrl: u.photoUrl,
    avatar: u.avatar,
    themeId: u.themeId && VALID_THEMES.has(u.themeId) ? u.themeId : 'paper',
    language: u.language && VALID_LANGUAGES.has(u.language) ? u.language : 'en',
    savedMusic: getWorkspaceSavedMusic(u.id, u.savedMusic),
  };
}

function getFirebaseClientConfig(): { apiKey: string; oAuthClientId: string } {
  try {
    const fbCfg = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf8')) as {
      apiKey?: string;
      oAuthClientId?: string;
    };
    return {
      apiKey: String(fbCfg.apiKey || '').trim(),
      oAuthClientId: String(fbCfg.oAuthClientId || '').trim(),
    };
  } catch {
    return { apiKey: '', oAuthClientId: '' };
  }
}

function getFirebaseApiKey(): string {
  return getFirebaseClientConfig().apiKey;
}

function getFirebaseOAuthClientId(): string {
  return getFirebaseClientConfig().oAuthClientId;
}

interface VerifiedFirebaseIdentity {
  localId: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
}

const firebaseTokenCache = new Map<
  string,
  { expiresAt: number; user: VerifiedFirebaseIdentity }
>();

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseIdentity | null> {
  const cleanToken = String(idToken || '').trim();
  if (!cleanToken) return null;
  const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
  const cached = firebaseTokenCache.get(tokenHash);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.user;
  }

  const firebaseApiKey = getFirebaseApiKey();
  if (!firebaseApiKey) return null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5500);
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: cleanToken }),
        signal: ctrl.signal,
      }
    );
    clearTimeout(timer);
    if (!lookupRes.ok) return null;
    const lookupBody = (await lookupRes.json().catch(() => ({}))) as {
      users?: Array<{
        localId?: string;
        email?: string;
        displayName?: string;
        photoUrl?: string;
      }>;
    };
    const fbUser = lookupBody.users?.[0];
    if (!fbUser?.email) return null;
    const verified: VerifiedFirebaseIdentity = {
      localId: String(fbUser.localId || '').trim(),
      email: fbUser.email.trim().toLowerCase(),
      displayName: fbUser.displayName ? String(fbUser.displayName).trim() : undefined,
      photoUrl: fbUser.photoUrl ? String(fbUser.photoUrl).trim() : undefined,
    };
    firebaseTokenCache.set(tokenHash, {
      expiresAt: Date.now() + 10 * 60 * 1000,
      user: verified,
    });
    return verified;
  } catch {
    return null;
  }
}

async function verifyGoogleCredentialOnServer(opts: {
  idToken?: string;
  googleIdToken?: string;
  googleAccessToken?: string;
  requestUri?: string;
}): Promise<VerifiedFirebaseIdentity | null> {
  const firebaseIdToken = String(opts.idToken || '').trim();
  if (firebaseIdToken) {
    const fbUser = await verifyFirebaseIdToken(firebaseIdToken);
    if (fbUser) return fbUser;
  }

  const googleIdToken = String(opts.googleIdToken || '').trim();
  const googleAccessToken = String(opts.googleAccessToken || '').trim();
  if (!googleIdToken && !googleAccessToken) return null;

  const { apiKey, oAuthClientId } = getFirebaseClientConfig();
  const safeRequestUri =
    opts.requestUri && /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/.test(opts.requestUri)
      ? opts.requestUri
      : 'http://localhost';

  // 1) Try Firebase Identity Toolkit accounts:signInWithIdp so the account links natively to Firebase Auth
  if (apiKey) {
    try {
      const postBody = googleIdToken
        ? `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`
        : `access_token=${encodeURIComponent(googleAccessToken)}&providerId=google.com`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5500);
      const idpRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postBody,
            requestUri: safeRequestUri,
            returnIdpCredential: true,
            returnSecureToken: true,
          }),
          signal: ctrl.signal,
        }
      );
      clearTimeout(timer);
      if (idpRes.ok) {
        const body = (await idpRes.json().catch(() => ({}))) as {
          localId?: string;
          email?: string;
          emailVerified?: boolean;
          displayName?: string;
          fullName?: string;
          photoUrl?: string;
        };
        if (body.email && body.emailVerified !== false) {
          return {
            localId: String(body.localId || '').trim(),
            email: body.email.trim().toLowerCase(),
            displayName: String(body.displayName || body.fullName || '').trim() || undefined,
            photoUrl: body.photoUrl ? String(body.photoUrl).trim() : undefined,
          };
        }
      }
    } catch {
      // Fall through to direct Google OAuth verification
    }
  }

  // 2) Fallback: Direct Google OAuth2 tokeninfo verification with strict audience & email_verified enforcement
  if (googleIdToken) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5500);
      const infoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(googleIdToken)}`,
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (infoRes.ok) {
        const info = (await infoRes.json().catch(() => ({}))) as {
          aud?: string;
          azp?: string;
          sub?: string;
          email?: string;
          email_verified?: string | boolean;
          name?: string;
          picture?: string;
          exp?: string | number;
        };
        const expMs = Number(info.exp || 0) * 1000;
        const audMatches =
          !oAuthClientId || info.aud === oAuthClientId || info.azp === oAuthClientId;
        const isVerified = info.email_verified === true || info.email_verified === 'true';
        if (
          audMatches &&
          isVerified &&
          info.email &&
          info.email.includes('@') &&
          (!expMs || expMs > Date.now() - 30000)
        ) {
          return {
            localId: String(info.sub || '').trim(),
            email: info.email.trim().toLowerCase(),
            displayName: info.name ? String(info.name).trim() : undefined,
            photoUrl: info.picture ? String(info.picture).trim() : undefined,
          };
        }
      }
    } catch {
      return null;
    }
  }

  if (googleAccessToken) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5500);
      const infoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(googleAccessToken)}`,
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (!infoRes.ok) return null;
      const info = (await infoRes.json().catch(() => ({}))) as {
        aud?: string;
        azp?: string;
        sub?: string;
        email?: string;
        email_verified?: string | boolean;
        expires_in?: string | number;
      };
      const audMatches =
        !oAuthClientId || info.aud === oAuthClientId || info.azp === oAuthClientId;
      if (!audMatches || Number(info.expires_in || 0) <= 0) return null;

      const userCtrl = new AbortController();
      const userTimer = setTimeout(() => userCtrl.abort(), 5500);
      const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${googleAccessToken}` },
        signal: userCtrl.signal,
      });
      clearTimeout(userTimer);
      if (!userRes.ok) return null;
      const profile = (await userRes.json().catch(() => ({}))) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      };
      if (!profile.email || !profile.email_verified) return null;
      return {
        localId: String(profile.sub || info.sub || '').trim(),
        email: profile.email.trim().toLowerCase(),
        displayName: profile.name ? String(profile.name).trim() : undefined,
        photoUrl: profile.picture ? String(profile.picture).trim() : undefined,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function getBearerToken(req: express.Request): string {
  const rawAuth = req.header('authorization') || '';
  const match = rawAuth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function stableUserIdForEmail(email: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return `usr_${hash}`;
}

function upsertFirebaseStoredUser(
  fbUser: VerifiedFirebaseIdentity,
  defaults?: {
    preferredId?: string;
    themeId?: string;
    language?: string;
    guestWorkspaceId?: string;
  }
): StoredUser {
  const email = fbUser.email.trim().toLowerCase();
  const users = readJsonFile<StoredUser[]>(USERS_FILE, []);
  let idx = users.findIndex((u) => u.email === email);

  if (idx === -1) {
    const safePreferred =
      defaults?.preferredId && /^[a-zA-Z0-9_-]{4,64}$/.test(defaults.preferredId)
        ? defaults.preferredId
        : stableUserIdForEmail(email);
    const newUser: StoredUser = {
      id: safePreferred,
      email,
      displayName: String(fbUser.displayName || '').trim() || email.split('@')[0],
      passwordHash: '',
      authProvider: 'google',
      photoUrl: fbUser.photoUrl || undefined,
      themeId: defaults?.themeId && VALID_THEMES.has(defaults.themeId) ? defaults.themeId : 'paper',
      language:
        defaults?.language && VALID_LANGUAGES.has(defaults.language) ? defaults.language : 'en',
      savedMusic: [],
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    idx = users.length - 1;
    writeJsonFile(USERS_FILE, users);

    const guestWorkspaceId = defaults?.guestWorkspaceId;
    if (guestWorkspaceId && guestWorkspaceId !== newUser.id) {
      const exams = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
      let examsChanged = false;
      for (const ex of exams) {
        if (ex.workspaceId === guestWorkspaceId) {
          ex.workspaceId = newUser.id;
          examsChanged = true;
        }
      }
      if (examsChanged) writeJsonFile(EXAMS_FILE, exams);

      const lessons = readJsonFile<StoredLesson[]>(LESSONS_FILE, []);
      let lessonsChanged = false;
      for (const ls of lessons) {
        if (ls.workspaceId === guestWorkspaceId) {
          ls.workspaceId = newUser.id;
          lessonsChanged = true;
        }
      }
      if (lessonsChanged) writeJsonFile(LESSONS_FILE, lessons);

      const guestMusic = getWorkspaceSavedMusic(guestWorkspaceId);
      if (guestMusic.length > 0) {
        setWorkspaceSavedMusic(newUser.id, guestMusic);
        users[idx].savedMusic = guestMusic;
      }
    }
  } else {
    let changed = false;
    if (fbUser.photoUrl && !users[idx].photoUrl) {
      users[idx].photoUrl = fbUser.photoUrl;
      changed = true;
    }
    if (fbUser.displayName && !users[idx].displayName) {
      users[idx].displayName = fbUser.displayName;
      changed = true;
    }
    if (changed) writeJsonFile(USERS_FILE, users);
  }

  return users[idx];
}

function getAuthenticatedUser(req: express.Request): StoredUser | null {
  const users = readJsonFile<StoredUser[]>(USERS_FILE, []);
  const cookies = parseCookies(req);
  const cookieUserId = verifySessionToken(cookies[SESSION_COOKIE]);
  if (cookieUserId) {
    const found = users.find((u) => u.id === cookieUserId);
    if (found) return found;
  }
  const header = req.header('x-workspace-id');
  if (header && typeof header === 'string' && header.trim()) {
    const found = users.find((u) => u.id === header.trim());
    if (found) return found;
  }
  return null;
}

async function resolveOrRehydrateUser(req: express.Request): Promise<StoredUser | null> {
  const direct = getAuthenticatedUser(req);
  if (direct) return direct;

  const bearer = getBearerToken(req);
  if (bearer) {
    const fbUser = await verifyFirebaseIdToken(bearer);
    if (fbUser) {
      const headerWs = req.header('x-workspace-id')?.trim();
      return upsertFirebaseStoredUser(fbUser, {
        preferredId: headerWs && headerWs !== 'default' ? headerWs : undefined,
      });
    }
  }

  return null;
}

function getWorkspaceId(req: express.Request): string {
  const cookies = parseCookies(req);
  const cookieUserId = verifySessionToken(cookies[SESSION_COOKIE]);
  const header = req.header('x-workspace-id');
  if (header && typeof header === 'string' && header.trim()) {
    return header.trim().slice(0, 64);
  }
  if (cookieUserId) {
    return cookieUserId;
  }
  return 'default';
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const VALID_TYPES = new Set(['monthly', 'final', 'midterm', 'quiz', 'practical', 'oral', 'other']);

function sanitizeTopics(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((t) => String(t || '').trim())
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function sanitizeExamPayload(body: Record<string, unknown>) {
  const typeVal = String(body.type || 'other').toLowerCase();
  return {
    subject: String(body.subject || 'Untitled exam').trim(),
    type: (VALID_TYPES.has(typeVal) ? typeVal : 'other') as StoredExam['type'],
    date: String(body.date || '').trim(),
    startTime: String(body.startTime || '').slice(0, 5),
    endTime: String(body.endTime || '').slice(0, 5),
    room: String(body.room || '').trim(),
    material: String(body.material || '').trim(),
    topics: sanitizeTopics(body.topics),
    notes: String(body.notes || '').trim(),
  };
}

function sanitizeLessonPayload(body: Record<string, unknown>) {
  return {
    subject: String(body.subject || 'General').trim(),
    title: String(body.title || '').trim(),
    notes: String(body.notes || '').trim(),
    completed: Boolean(body.completed),
    examId: typeof body.examId === 'string' && body.examId.trim() ? body.examId.trim() : undefined,
  };
}

function buildExtractorPrompt(pageContext?: string): string {
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const todayDay = format(new Date(), 'EEEE');
  const pageNote = pageContext
    ? `\nFOCUS RANGE: Extract items appearing on ${pageContext}. Still use page 1 / document headers for the year, month, semester, course names, and column meanings.\n`
    : '';
  return `You are an accurate multilingual exam-schedule and study-syllabus reader for a student.
Read the document natively in whatever language(s) it uses (Arabic, English, French, Spanish, German, Turkish, Russian, Chinese, Japanese, Korean, Hindi, Urdu, Persian, Hebrew, Italian, Portuguese, etc., including bilingual or right-to-left tables).
If an image or photo is rotated, sideways, landscape, or slightly skewed, read it accurately regardless of orientation. Carefully read both large headings and small print (footnotes, room codes, chapter/page ranges, merged timetable cells, and split rows).${pageNote}

Extract TWO connected things:
1. "exams": Real examinations (finals, midterms, monthly exams/tests, quizzes, practical/lab exams, orals, resits, rescheduled exams — in any language).
   For each exam extract:
   - "subject": concise course/subject name (keep in the document's original language).
   - "date": Gregorian ISO YYYY-MM-DD (ASCII digits). Normalize any numeral system (0-9, ٠-٩, ۰-۹, CJK) and convert dd/mm/yyyy, dd-mm-yyyy, localized month names, or Hijri/Coptic dates into Gregorian YYYY-MM-DD. If year is omitted, use the nearest year that is today or later. NEVER invent a date; if genuinely missing (e.g. a syllabus-only sheet), use "".
   - "startTime" / "endTime": 24-hour ASCII HH:MM; "" if not stated.
   - "room": room/hall/building ("" if not stated).
   - "type": one of "monthly", "final", "midterm", "quiz", "practical", "oral", "other". Classify monthly tests/exams (e.g. Monthly Exam, October/November Test, اختبار شهري, امتحان شهري, اختبار الشهر, تقويم شهري, contrôle mensuel, devoir mensuel) as "monthly"; mid-semester/mid-term (e.g. Midterm, نصفي, منتصف الفصل) as "midterm"; end-of-term/final (e.g. Final, نهائي, آخر العام) as "final".
   - "material": textbooks, page ranges, slide sets, or allowed materials mentioned for this exam ("" if not stated).
   - "topics": REQUIRED whenever lessons, chapters, units, or topics for this exam are stated anywhere in the document (in a "Topics / Syllabus / Lessons Included / المقرر / الدروس المقررة" column, row, footnote, or paired sheet). Put each included lesson, chapter, or unit as a clean entry in this array ([] only if zero included lessons/topics exist for this exam).
   - "notes": short helpful detail such as seat/group info or missing-date note ("" if none).

2. "lessons": Every study lesson, chapter, unit, or lecture topic included in each exam or listed in a syllabus, study guide, distribution sheet, or lesson checklist — EVEN if the document contains no exam dates at all.
   - "subject": course/subject name in the document's original language matching the corresponding exam's "subject".
   - "title": concise lesson, chapter, or topic name in the document's original language.
   - "notes": optional chapter/page reference or brief detail ("" if none).
   - "examType": if tied to a specific exam period ("monthly", "midterm", "final", "quiz", "practical", "oral"), specify it; otherwise "".

IMPORTANT RULES:
- Return ONLY a valid JSON object matching { "exams": [...], "lessons": [...], "ignored": [...] }.
- Treat equivalent level/section names for the same course — such as "English AL" and "English AL A" (or "English A.L. A", "English (AL) A") — as the SAME subject, and keep one consistent "subject" string across both "exams" and "lessons".
- ALWAYS connect each exam strictly to ONLY its own included lessons: put ONLY the lessons/chapters/units covered by that specific exam into its "topics" array (do not dump unrelated lessons from the rest of the subject into an exam's "topics"), and include each distinct lesson in "lessons" with matching "subject".
- If the document is only a syllabus or lesson list with no exam dates, return "exams": [] and put all lessons in "lessons". If it is only a schedule with no topics listed, extract "exams" and leave "lessons": [].
- Preserve the document's ORIGINAL language and script (do not translate non-English subjects or lessons into English).
- Do NOT put holidays, semester start/end dates, registration/withdrawal deadlines, fee notices, or non-academic announcements into "exams" or "lessons"; list skipped items briefly in "ignored".
- Do NOT invent lessons out of room numbers, exam rules, or dates. Only extract genuine study lessons/topics.

Today is ${todayIso} (${todayDay}). Use it only to resolve relative dates like "next Tuesday" or omitted years.`;
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '100mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req, res) => {
    const found = await resolveOrRehydrateUser(req);
    if (!found) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    setSessionCookie(req, res, found.id);
    res.json({ user: toPublicUser(found) });
  });

  app.post('/api/auth/session-sync', async (req, res) => {
    const found = await resolveOrRehydrateUser(req);
    if (found) {
      setSessionCookie(req, res, found.id);
      res.json({ user: toPublicUser(found) });
      return;
    }
    const idToken = String(req.body?.idToken || '').trim();
    if (idToken) {
      const fbUser = await verifyFirebaseIdToken(idToken);
      if (fbUser) {
        const upserted = upsertFirebaseStoredUser(fbUser, {
          preferredId: typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : undefined,
        });
        setSessionCookie(req, res, upserted.id);
        res.json({ user: toPublicUser(upserted) });
        return;
      }
    }
    res.status(401).json({ error: 'Not signed in.' });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/signup', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.displayName || '').trim();
    const requestedTheme = String(req.body?.themeId || '').trim();
    const requestedLang = String(req.body?.language || '').trim();
    const guestWorkspaceId =
      typeof req.body?.guestWorkspaceId === 'string' ? req.body.guestWorkspaceId.trim() : '';

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Enter a valid email address.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const users = readJsonFile<StoredUser[]>(USERS_FILE, []);
    if (users.some((u) => u.email === email)) {
      res.status(409).json({ error: 'An account with that email already exists.' });
      return;
    }

    const user: StoredUser = {
      id: stableUserIdForEmail(email),
      email,
      displayName: displayName || email.split('@')[0],
      passwordHash: hashPassword(password),
      themeId: VALID_THEMES.has(requestedTheme) ? requestedTheme : 'paper',
      language: VALID_LANGUAGES.has(requestedLang) ? requestedLang : 'en',
      savedMusic: [],
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    writeJsonFile(USERS_FILE, users);

    // Migrate any earlier guest workspace exams, lessons, & saved music into this account
    if (guestWorkspaceId && guestWorkspaceId !== user.id) {
      const exams = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
      let examsChanged = false;
      for (const ex of exams) {
        if (ex.workspaceId === guestWorkspaceId) {
          ex.workspaceId = user.id;
          examsChanged = true;
        }
      }
      if (examsChanged) {
        writeJsonFile(EXAMS_FILE, exams);
      }

      const lessons = readJsonFile<StoredLesson[]>(LESSONS_FILE, []);
      let lessonsChanged = false;
      for (const ls of lessons) {
        if (ls.workspaceId === guestWorkspaceId) {
          ls.workspaceId = user.id;
          lessonsChanged = true;
        }
      }
      if (lessonsChanged) {
        writeJsonFile(LESSONS_FILE, lessons);
      }

      const guestMusic = getWorkspaceSavedMusic(guestWorkspaceId);
      if (guestMusic.length > 0) {
        setWorkspaceSavedMusic(user.id, guestMusic);
        user.savedMusic = guestMusic;
      }
    }

    setSessionCookie(req, res, user.id);
    res.status(201).json({
      user: toPublicUser(user),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      res.status(400).json({ error: 'Enter your email and password.' });
      return;
    }

    const users = readJsonFile<StoredUser[]>(USERS_FILE, []);
    const idx = users.findIndex((u) => u.email === email);
    if (idx === -1) {
      res.status(404).json({ error: 'No account found with that email.' });
      return;
    }
    const found = users[idx];
    if (!found.passwordHash) {
      res.status(400).json({
        error: 'This account uses Google Sign-In. Click Continue with Google.',
      });
      return;
    }
    if (!verifyPassword(password, found.passwordHash)) {
      res.status(401).json({ error: 'Incorrect password. Try again.' });
      return;
    }

    setSessionCookie(req, res, found.id);
    res.json({
      user: toPublicUser(users[idx]),
    });
  });

  const googleHandoffStore = new Map<
    string,
    {
      fbUser: VerifiedFirebaseIdentity;
      googleIdToken?: string;
      googleAccessToken?: string;
      themeId?: string;
      language?: string;
      guestWorkspaceId?: string;
      createdAt: number;
      deliveredAt?: number;
    }
  >();

  function pruneGoogleHandoffs() {
    const now = Date.now();
    const pendingCutoff = now - 5 * 60 * 1000;
    const deliveredCutoff = now - 25 * 1000;
    for (const [k, v] of googleHandoffStore.entries()) {
      if (v.createdAt < pendingCutoff || (v.deliveredAt && v.deliveredAt < deliveredCutoff)) {
        googleHandoffStore.delete(k);
      }
    }
  }

  app.post('/api/auth/google', async (req, res) => {
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
    const googleIdToken =
      typeof req.body?.googleIdToken === 'string' ? req.body.googleIdToken.trim() : '';
    const googleAccessToken =
      typeof req.body?.googleAccessToken === 'string' ? req.body.googleAccessToken.trim() : '';
    const requestedTheme = String(req.body?.themeId || '').trim();
    const requestedLang = String(req.body?.language || '').trim();
    const guestWorkspaceId =
      typeof req.body?.guestWorkspaceId === 'string' ? req.body.guestWorkspaceId.trim() : '';

    if (!idToken && !googleIdToken && !googleAccessToken) {
      res.status(400).json({ error: 'Missing Google authentication token.' });
      return;
    }

    if (!getFirebaseApiKey() && !getFirebaseOAuthClientId()) {
      res.status(503).json({ error: 'Google Sign-In is not configured on the server.' });
      return;
    }

    try {
      const fbUser = await verifyGoogleCredentialOnServer({
        idToken,
        googleIdToken,
        googleAccessToken,
        requestUri: req.header('origin') || undefined,
      });
      if (!fbUser) {
        res.status(401).json({ error: 'Could not verify Google account.' });
        return;
      }

      const stored = upsertFirebaseStoredUser(fbUser, {
        themeId: requestedTheme,
        language: requestedLang,
        guestWorkspaceId,
      });

      setSessionCookie(req, res, stored.id);
      res.json({ user: toPublicUser(stored) });
    } catch {
      res.status(502).json({ error: 'Could not reach Google verification service.' });
    }
  });

  app.post('/api/auth/google/handoff', async (req, res) => {
    const nonce = String(req.body?.nonce || '').trim();
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
    const googleIdToken =
      typeof req.body?.googleIdToken === 'string' ? req.body.googleIdToken.trim() : '';
    const googleAccessToken =
      typeof req.body?.googleAccessToken === 'string' ? req.body.googleAccessToken.trim() : '';

    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(nonce) || (!idToken && !googleIdToken && !googleAccessToken)) {
      res.status(400).json({ error: 'Invalid Google sign-in handoff request.' });
      return;
    }

    const fbUser = await verifyGoogleCredentialOnServer({
      idToken,
      googleIdToken,
      googleAccessToken,
      requestUri: req.header('origin') || undefined,
    });
    if (!fbUser) {
      res.status(401).json({ error: 'Could not verify Google token for handoff.' });
      return;
    }

    pruneGoogleHandoffs();
    googleHandoffStore.set(nonce, {
      fbUser,
      googleIdToken: googleIdToken || undefined,
      googleAccessToken: googleAccessToken || undefined,
      themeId: typeof req.body?.themeId === 'string' ? req.body.themeId.trim() : undefined,
      language: typeof req.body?.language === 'string' ? req.body.language.trim() : undefined,
      guestWorkspaceId:
        typeof req.body?.guestWorkspaceId === 'string'
          ? req.body.guestWorkspaceId.trim()
          : undefined,
      createdAt: Date.now(),
    });
    res.json({ ok: true });
  });

  app.get('/api/auth/google/handoff/:nonce', async (req, res) => {
    const nonce = String(req.params.nonce || '').trim();
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(nonce)) {
      res.status(400).json({ status: 'invalid' });
      return;
    }

    pruneGoogleHandoffs();
    const entry = googleHandoffStore.get(nonce);
    if (!entry) {
      res.json({ status: 'pending' });
      return;
    }

    entry.deliveredAt = entry.deliveredAt || Date.now();
    const themeOverride =
      typeof req.query.themeId === 'string' ? req.query.themeId.trim() : entry.themeId;
    const langOverride =
      typeof req.query.language === 'string' ? req.query.language.trim() : entry.language;
    const guestOverride =
      typeof req.query.guestWorkspaceId === 'string'
        ? req.query.guestWorkspaceId.trim()
        : entry.guestWorkspaceId;

    const stored = upsertFirebaseStoredUser(entry.fbUser, {
      themeId: themeOverride,
      language: langOverride,
      guestWorkspaceId: guestOverride,
    });
    setSessionCookie(req, res, stored.id);
    res.json({
      status: 'ready',
      user: toPublicUser(stored),
      googleIdToken: entry.googleIdToken || null,
      googleAccessToken: entry.googleAccessToken || null,
    });
  });

  app.patch('/api/auth/profile', async (req, res) => {
    const authed = await resolveOrRehydrateUser(req);
    const targetId = authed?.id || getWorkspaceId(req);
    const users = readJsonFile<StoredUser[]>(USERS_FILE, []);
    let idx = users.findIndex((u) => u.id === targetId);
    if (idx === -1) {
      const bodyEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (targetId && targetId !== 'default' && bodyEmail.includes('@')) {
        const emailIdx = users.findIndex((u) => u.email === bodyEmail);
        if (emailIdx !== -1) {
          idx = emailIdx;
        } else {
          users.push({
            id: targetId,
            email: bodyEmail,
            displayName:
              typeof req.body?.displayName === 'string' && req.body.displayName.trim()
                ? req.body.displayName.trim().slice(0, 80)
                : bodyEmail.split('@')[0],
            passwordHash: '',
            authProvider: req.body?.authProvider === 'google' ? 'google' : 'email',
            themeId: 'paper',
            language: 'en',
            savedMusic: [],
            createdAt: new Date().toISOString(),
          });
          idx = users.length - 1;
        }
      } else {
        res.status(404).json({ error: 'Profile not found.' });
        return;
      }
    }
    if (typeof req.body?.displayName === 'string' && req.body.displayName.trim()) {
      users[idx].displayName = req.body.displayName.trim().slice(0, 80);
    }
    if (req.body?.avatar && typeof req.body.avatar === 'object') {
      users[idx].avatar = req.body.avatar;
    }
    if (typeof req.body?.themeId === 'string' && VALID_THEMES.has(req.body.themeId.trim())) {
      users[idx].themeId = req.body.themeId.trim();
    }
    if (typeof req.body?.language === 'string' && VALID_LANGUAGES.has(req.body.language.trim())) {
      users[idx].language = req.body.language.trim();
    }
    if (Array.isArray(req.body?.savedMusic)) {
      const merged = dedupeSavedMusic(req.body.savedMusic);
      users[idx].savedMusic = merged;
      const store = readJsonFile<Record<string, unknown[]>>(MUSIC_FILE, {});
      store[users[idx].id] = merged;
      writeJsonFile(MUSIC_FILE, store);
    }
    writeJsonFile(USERS_FILE, users);
    setSessionCookie(req, res, users[idx].id);
    res.json({
      user: toPublicUser(users[idx]),
    });
  });

  // Saved Study Music Persistence & Custom Audio Uploads
  app.get('/api/music', async (req, res) => {
    const authed = await resolveOrRehydrateUser(req);
    const workspaceId = authed?.id || getWorkspaceId(req);
    const tracks = getWorkspaceSavedMusic(workspaceId, authed?.savedMusic);
    res.json({ tracks });
  });

  app.put('/api/music', async (req, res) => {
    const authed = await resolveOrRehydrateUser(req);
    const workspaceId = authed?.id || getWorkspaceId(req);
    const incoming = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
    const tracks = setWorkspaceSavedMusic(workspaceId, incoming);
    res.json({ tracks });
  });

  const AUDIO_EXT_MIME: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
  };

  app.post('/api/audio/upload', async (req, res) => {
    const authed = await resolveOrRehydrateUser(req);
    const workspaceId = authed?.id || getWorkspaceId(req);
    const rawName = String(req.body?.filename || 'audio.mp3').trim();
    const rawMime = String(req.body?.mimeType || '').trim().toLowerCase();
    const dataBase64 = String(req.body?.dataBase64 || '').trim();
    const customTitle = String(req.body?.title || '').trim();
    const saveToApp = Boolean(req.body?.saveToApp);

    if (!dataBase64) {
      res.status(400).json({ error: 'Missing audio data.' });
      return;
    }

    const cleanBase64 = dataBase64.includes(',') ? dataBase64.split(',').pop() || '' : dataBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length === 0) {
      res.status(400).json({ error: 'Audio file is empty.' });
      return;
    }
    if (buffer.length > 16 * 1024 * 1024) {
      res.status(413).json({ error: 'Audio file must be 15 MB or smaller.' });
      return;
    }

    const parsedExt = path.extname(rawName).toLowerCase();
    const mimeFromExt = AUDIO_EXT_MIME[parsedExt];
    const extFromMime = Object.entries(AUDIO_EXT_MIME).find(([, m]) => m === rawMime)?.[0];
    if (!rawMime.startsWith('audio/') && !mimeFromExt) {
      res.status(400).json({ error: 'Select a valid audio file (MP3, WAV, M4A, OGG, etc.).' });
      return;
    }

    const finalExt = mimeFromExt ? parsedExt : extFromMime || '.mp3';
    const finalMime = rawMime.startsWith('audio/') ? rawMime : mimeFromExt || 'audio/mpeg';
    const trackId = createId('aud');
    const storedFilename = `${trackId}${finalExt}`;

    if (!fs.existsSync(AUDIO_DIR)) {
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(AUDIO_DIR, storedFilename), buffer);

    const baseTitle =
      customTitle || rawName.replace(/\.[^.]+$/, '').trim() || 'Uploaded audio';
    const track = {
      id: trackId,
      title: baseTitle.slice(0, 120),
      subtitle: 'Custom audio',
      kind: 'custom' as const,
      audioUrl: `/api/audio/${storedFilename}`,
      mimeType: finalMime,
      savedAt: new Date().toISOString(),
    };

    if (saveToApp && workspaceId) {
      const existing = getWorkspaceSavedMusic(workspaceId, authed?.savedMusic);
      setWorkspaceSavedMusic(workspaceId, [track, ...existing]);
    }

    res.status(201).json({ track });
  });

  app.get('/api/audio/:filename', (req, res) => {
    const safeName = path.basename(String(req.params.filename || '')).replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeName) {
      res.status(400).end();
      return;
    }
    const filePath = path.join(AUDIO_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Audio file not found.' });
      return;
    }

    const stat = fs.statSync(filePath);
    const total = stat.size;
    const ext = path.extname(safeName).toLowerCase();
    const contentType = AUDIO_EXT_MIME[ext] || 'audio/mpeg';
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
        if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && start < total) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', String(end - start + 1));
          fs.createReadStream(filePath, { start, end }).pipe(res);
          return;
        }
      }
    }

    res.setHeader('Content-Length', String(total));
    fs.createReadStream(filePath).pipe(res);
  });

  app.delete('/api/auth/account', (req, res) => {
    const authed = getAuthenticatedUser(req);
    const workspaceId = authed?.id || getWorkspaceId(req);
    const users = readJsonFile<StoredUser[]>(USERS_FILE, []);
    writeJsonFile(
      USERS_FILE,
      users.filter((u) => u.id !== workspaceId)
    );
    const exams = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
    writeJsonFile(
      EXAMS_FILE,
      exams.filter((e) => e.workspaceId !== workspaceId)
    );
    const lessons = readJsonFile<StoredLesson[]>(LESSONS_FILE, []);
    writeJsonFile(
      LESSONS_FILE,
      lessons.filter((l) => l.workspaceId !== workspaceId)
    );
    const musicStore = readJsonFile<Record<string, unknown[]>>(MUSIC_FILE, {});
    if (workspaceId in musicStore) {
      delete musicStore[workspaceId];
      writeJsonFile(MUSIC_FILE, musicStore);
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Exams CRUD
  app.get('/api/exams', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const all = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
    const normalized = all
      .filter((e) => e.workspaceId === workspaceId)
      .map((e) => ({
        ...e,
        material: e.material || '',
        topics: Array.isArray(e.topics) ? e.topics : [],
      }));
    res.json({ exams: normalized });
  });

  app.post('/api/exams', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const clean = sanitizeExamPayload(req.body || {});
    if (!clean.subject) {
      res.status(400).json({ error: 'Give the exam a subject name.' });
      return;
    }
    if (!clean.date) {
      res.status(400).json({ error: 'Pick the exam date.' });
      return;
    }
    const exam: StoredExam = {
      id: createId('ex'),
      workspaceId,
      ...clean,
      createdAt: new Date().toISOString(),
    };
    const all = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
    all.push(exam);
    writeJsonFile(EXAMS_FILE, all);
    res.status(201).json({ exam });
  });

  app.post('/api/exams/batch', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const items = Array.isArray(req.body?.exams) ? req.body.exams : [];
    if (items.length === 0) {
      res.status(400).json({ error: 'No exams provided.' });
      return;
    }
    const all = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
    const inserted: StoredExam[] = [];
    for (const raw of items) {
      const clean = sanitizeExamPayload(raw || {});
      if (!clean.date) continue;
      const exam: StoredExam = {
        id: createId('ex'),
        workspaceId,
        ...clean,
        createdAt: new Date().toISOString(),
      };
      all.push(exam);
      inserted.push(exam);
    }
    writeJsonFile(EXAMS_FILE, all);
    res.status(201).json({ exams: inserted });
  });

  app.post('/api/exams/sync', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const items = Array.isArray(req.body?.exams) ? req.body.exams : [];
    const all = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
    let changed = false;
    const synced: StoredExam[] = [];

    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Record<string, unknown>;
      const rawId = typeof rec.id === 'string' ? rec.id.trim() : '';
      const safeId = /^[a-zA-Z0-9_-]{2,128}$/.test(rawId) ? rawId : createId('ex');
      const clean = sanitizeExamPayload(rec);
      if (!clean.date || !clean.subject) continue;

      const existingIdx = all.findIndex((e) => e.id === safeId && e.workspaceId === workspaceId);
      if (existingIdx === -1) {
        const exam: StoredExam = {
          id: safeId,
          workspaceId,
          ...clean,
          ...(typeof rec.sourceChatKey === 'string' && rec.sourceChatKey.trim()
            ? { sourceChatKey: rec.sourceChatKey.trim().slice(0, 160) }
            : {}),
          createdAt:
            typeof rec.createdAt === 'string' && rec.createdAt
              ? rec.createdAt
              : new Date().toISOString(),
        };
        all.push(exam);
        synced.push(exam);
        changed = true;
      } else {
        synced.push(all[existingIdx]);
      }
    }

    if (changed) {
      writeJsonFile(EXAMS_FILE, all);
    }
    const workspaceExams = all
      .filter((e) => e.workspaceId === workspaceId)
      .map((e) => ({
        ...e,
        material: e.material || '',
        topics: Array.isArray(e.topics) ? e.topics : [],
      }));
    res.json({ exams: workspaceExams, syncedCount: synced.length });
  });

  app.put('/api/exams/:id', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const { id } = req.params;
    const all = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
    const index = all.findIndex((e) => e.id === id && e.workspaceId === workspaceId);
    const clean = sanitizeExamPayload(req.body || {});
    if (index === -1) {
      if (!clean.date) {
        res.status(400).json({ error: 'Pick the exam date.' });
        return;
      }
      const safeId = /^[a-zA-Z0-9_-]{2,128}$/.test(id) ? id : createId('ex');
      const created: StoredExam = {
        id: safeId,
        workspaceId,
        ...clean,
        ...(typeof req.body?.sourceChatKey === 'string' && req.body.sourceChatKey.trim()
          ? { sourceChatKey: req.body.sourceChatKey.trim().slice(0, 160) }
          : {}),
        createdAt:
          typeof req.body?.createdAt === 'string' && req.body.createdAt
            ? req.body.createdAt
            : new Date().toISOString(),
      };
      all.push(created);
      writeJsonFile(EXAMS_FILE, all);
      res.json({ exam: created });
      return;
    }
    all[index] = {
      ...all[index],
      ...clean,
    };
    writeJsonFile(EXAMS_FILE, all);
    res.json({ exam: all[index] });
  });

  app.delete('/api/exams/:id', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const { id } = req.params;
    const all = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
    const next = all.filter((e) => !(e.id === id && e.workspaceId === workspaceId));
    if (next.length !== all.length) {
      writeJsonFile(EXAMS_FILE, next);
    }
    res.json({ ok: true });
  });

  // Study Centre Lessons Checklist CRUD
  app.get('/api/lessons', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const all = readJsonFile<StoredLesson[]>(LESSONS_FILE, []);
    res.json({ lessons: all.filter((l) => l.workspaceId === workspaceId) });
  });

  app.post('/api/lessons', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const clean = sanitizeLessonPayload(req.body || {});
    if (!clean.title) {
      res.status(400).json({ error: 'Give the lesson a title.' });
      return;
    }
    const lesson: StoredLesson = {
      id: createId('ls'),
      workspaceId,
      ...clean,
      createdAt: new Date().toISOString(),
    };
    const all = readJsonFile<StoredLesson[]>(LESSONS_FILE, []);
    all.push(lesson);
    writeJsonFile(LESSONS_FILE, all);
    res.status(201).json({ lesson });
  });

  app.post('/api/lessons/batch', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const items = Array.isArray(req.body?.lessons) ? req.body.lessons : [];
    if (items.length === 0) {
      res.status(400).json({ error: 'No lessons provided.' });
      return;
    }
    const all = readJsonFile<StoredLesson[]>(LESSONS_FILE, []);
    const inserted: StoredLesson[] = [];
    for (const raw of items) {
      const clean = sanitizeLessonPayload(raw || {});
      if (!clean.title) continue;
      const lesson: StoredLesson = {
        id: createId('ls'),
        workspaceId,
        ...clean,
        createdAt: new Date().toISOString(),
      };
      all.push(lesson);
      inserted.push(lesson);
    }
    writeJsonFile(LESSONS_FILE, all);
    res.status(201).json({ lessons: inserted });
  });

  app.post('/api/lessons/sync', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const items = Array.isArray(req.body?.lessons) ? req.body.lessons : [];
    const all = readJsonFile<StoredLesson[]>(LESSONS_FILE, []);
    let changed = false;

    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Record<string, unknown>;
      const rawId = typeof rec.id === 'string' ? rec.id.trim() : '';
      const safeId = /^[a-zA-Z0-9_-]{2,128}$/.test(rawId) ? rawId : createId('ls');
      const clean = sanitizeLessonPayload(rec);
      if (!clean.title) continue;

      const idx = all.findIndex((l) => l.id === safeId && l.workspaceId === workspaceId);
      if (idx === -1) {
        all.push({
          id: safeId,
          workspaceId,
          ...clean,
          createdAt:
            typeof rec.createdAt === 'string' && rec.createdAt
              ? rec.createdAt
              : new Date().toISOString(),
        });
        changed = true;
      }
    }

    if (changed) {
      writeJsonFile(LESSONS_FILE, all);
    }
    res.json({ lessons: all.filter((l) => l.workspaceId === workspaceId) });
  });

  app.patch('/api/lessons/:id', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const { id } = req.params;
    const all = readJsonFile<StoredLesson[]>(LESSONS_FILE, []);
    const idx = all.findIndex((l) => l.id === id && l.workspaceId === workspaceId);
    if (idx === -1) {
      const clean = sanitizeLessonPayload(req.body || {});
      if (!clean.title) {
        res.status(404).json({ error: 'Lesson not found.' });
        return;
      }
      const safeId = /^[a-zA-Z0-9_-]{2,128}$/.test(id) ? id : createId('ls');
      const created: StoredLesson = {
        id: safeId,
        workspaceId,
        ...clean,
        createdAt: new Date().toISOString(),
      };
      all.push(created);
      writeJsonFile(LESSONS_FILE, all);
      res.json({ lesson: created });
      return;
    }
    const existing = all[idx];
    all[idx] = {
      ...existing,
      subject:
        typeof req.body?.subject === 'string' && req.body.subject.trim()
          ? req.body.subject.trim()
          : existing.subject,
      title:
        typeof req.body?.title === 'string' && req.body.title.trim()
          ? req.body.title.trim()
          : existing.title,
      notes: typeof req.body?.notes === 'string' ? req.body.notes.trim() : existing.notes,
      completed:
        typeof req.body?.completed === 'boolean' ? req.body.completed : existing.completed,
      examId: typeof req.body?.examId === 'string' ? req.body.examId : existing.examId,
    };
    writeJsonFile(LESSONS_FILE, all);
    res.json({ lesson: all[idx] });
  });

  app.delete('/api/lessons/:id', (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const { id } = req.params;
    const all = readJsonFile<StoredLesson[]>(LESSONS_FILE, []);
    const next = all.filter((l) => !(l.id === id && l.workspaceId === workspaceId));
    if (next.length !== all.length) {
      writeJsonFile(LESSONS_FILE, next);
    }
    res.json({ ok: true });
  });

  // Spotify Link Extractor (Songs, Albums, Playlists)
  function parseSpotifyIdentifier(rawInput: string): {
    kind: 'track' | 'album' | 'playlist';
    id: string;
  } | null {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) return null;

    const uriMatch = trimmed.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)$/i);
    if (uriMatch) {
      return {
        kind: uriMatch[1].toLowerCase() as 'track' | 'album' | 'playlist',
        id: uriMatch[2],
      };
    }

    try {
      const normalizedUrl = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
      const url = new URL(normalizedUrl);
      if (!url.hostname.endsWith('spotify.com')) return null;
      const parts = url.pathname
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean);
      const filtered = parts[0]?.startsWith('intl-') ? parts.slice(1) : parts;
      const cleanParts = filtered[0] === 'embed' ? filtered.slice(1) : filtered;
      const kind = cleanParts[0]?.toLowerCase();
      const id = cleanParts[1];
      if ((kind === 'track' || kind === 'album' || kind === 'playlist') && id && /^[A-Za-z0-9]+$/.test(id)) {
        return { kind, id };
      }
    } catch {
      return null;
    }
    return null;
  }

  function decodeHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function parseYouTubeDurationSeconds(lengthText?: string): number | null {
    if (!lengthText) return null;
    const parts = lengthText.trim().split(':').map((p) => Number(p));
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  const CURRENT_SPOTIFY_MATCH_VERSION = 2;
  const ytMatchCache = new Map<string, string[]>();

  function normalizeYouTubeMatchText(raw: string): string {
    return String(raw || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const VARIANT_EXCLUSION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
    { label: 'remix', regex: /\b(?:re[\s-]*mix(?:es|ed|ing)?|rmx|rework|bootleg|flip)\b/i },
    { label: 'mashup', regex: /\b(?:mash[\s-]*up|megamix|dj\s*mix)\b/i },
    { label: 'sped up', regex: /\b(?:sped[\s-]*up|speed[\s-]*up|fast\s*version)\b/i },
    { label: 'slowed', regex: /\b(?:slowed(?:\s*(?:\+|and|&)?\s*reverb)?|slow[\s-]*down)\b/i },
    { label: 'reverb', regex: /\b(?:reverb\s*version|\+\s*reverb)\b/i },
    { label: 'nightcore', regex: /\b(?:night[\s-]*core|day[\s-]*core)\b/i },
    { label: '8d', regex: /\b(?:8d\s*audio|3d\s*audio|bass[\s-]*boost(?:ed)?)\b/i },
    { label: 'cover', regex: /\b(?:cover|karaoke|tribute)\b/i },
    { label: 'instrumental', regex: /\b(?:instrumental\s*(?:only|version)|acapella|a\s*capella)\b/i },
    { label: 'live', regex: /(?:\[(?:live|concert)[^\]]*\]|\((?:live|concert)[^)]*\)|\blive\s+(?:at|from|performance|session|concert)\b)/i },
    { label: 'extended', regex: /\b(?:extended\s*mix|club\s*mix|radio\s*mix|dub\s*mix|trap\s*remix|phonk\s*remix|lofi\s*remix|drill\s*remix|house\s*remix|techno\s*remix)\b/i },
    { label: 'tiktok', regex: /\b(?:tiktok\s*(?:version|edit|remix)|1\s*hour|looped)\b/i },
    { label: 'parody', regex: /\b(?:parody|tutorial|reaction|piano\s*cover|guitar\s*cover|violin\s*cover)\b/i },
    { label: 'arabic_variant', regex: /(?:ريمكس|معدل|بطيء|مسرع|تبطيء|تسريع|كوفر)/i },
  ];

  function isDisallowedMusicVariant(
    candidateTitle: string,
    candidateChannel: string,
    targetTitle: string,
    targetArtist: string
  ): boolean {
    const targetCombined = `${targetTitle} ${targetArtist}`;
    const candidateCombined = `${candidateTitle} ${candidateChannel}`;
    for (const rule of VARIANT_EXCLUSION_PATTERNS) {
      if (rule.regex.test(candidateCombined) && !rule.regex.test(targetCombined)) {
        return true;
      }
    }
    return false;
  }

  function extractYtRunsText(field: unknown): string {
    if (!field || typeof field !== 'object') return '';
    const rec = field as { simpleText?: unknown; runs?: Array<{ text?: unknown }> };
    if (typeof rec.simpleText === 'string') return rec.simpleText;
    if (Array.isArray(rec.runs)) {
      return rec.runs.map((r) => (typeof r?.text === 'string' ? r.text : '')).join('');
    }
    return '';
  }

  async function searchYouTubeVideoRenderers(searchQuery: string) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5500);
    try {
      const r = await fetch(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`,
        {
          signal: ctrl.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        }
      );
      if (!r.ok) return [];
      const html = await r.text();
      const dataMatch = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
      if (!dataMatch?.[1]) return [];
      const json = JSON.parse(dataMatch[1]) as {
        contents?: {
          twoColumnSearchResultsRenderer?: {
            primaryContents?: {
              sectionListRenderer?: {
                contents?: Array<{
                  itemSectionRenderer?: {
                    contents?: Array<{
                      videoRenderer?: Record<string, unknown>;
                    }>;
                  };
                }>;
              };
            };
          };
        };
      };

      const sections =
        json?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
          ?.contents || [];
      const out: Array<{
        videoId: string;
        title: string;
        channel: string;
        durSec: number;
      }> = [];
      for (const sec of sections) {
        const items = sec?.itemSectionRenderer?.contents || [];
        for (const it of items) {
          const vr = it?.videoRenderer;
          const videoId = typeof vr?.videoId === 'string' ? vr.videoId : '';
          if (!videoId) continue;
          const lengthText = extractYtRunsText(vr?.lengthText);
          const durSec = parseYouTubeDurationSeconds(lengthText);
          if (durSec === null || durSec < 35 || durSec > 1200) continue;
          const title = extractYtRunsText(vr?.title);
          const channel =
            extractYtRunsText(vr?.ownerText) ||
            extractYtRunsText(vr?.longBylineText) ||
            extractYtRunsText(vr?.shortBylineText);
          out.push({ videoId, title, channel, durSec });
          if (out.length >= 20) return out;
        }
      }
      return out;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveYouTubeMatches(
    trackTitle: string,
    artist?: string,
    expectedDurationMs?: number
  ): Promise<string[]> {
    const cleanTitle = trackTitle.trim();
    const cleanArtist = /^(spotify|album|playlist|custom audio|saved audio)/i.test(
      (artist || '').trim()
    )
      ? ''
      : (artist || '').trim();
    if (!cleanTitle) return [];
    const cacheKey = `v2|${cleanTitle.toLowerCase()}|${cleanArtist.toLowerCase()}`;
    const cached = ytMatchCache.get(cacheKey);
    if (cached) return cached;

    const expectedSec =
      typeof expectedDurationMs === 'number' && expectedDurationMs > 0
        ? expectedDurationMs > 1500
          ? expectedDurationMs / 1000
          : expectedDurationMs
        : null;

    const normTargetTitle = normalizeYouTubeMatchText(cleanTitle);
    const primaryArtist = cleanArtist.split(',')[0].trim();
    const normArtist = normalizeYouTubeMatchText(primaryArtist);
    const titleTokens = normTargetTitle.split(' ').filter((w) => w.length >= 3);

    const scoreCandidate = (cand: {
      videoId: string;
      title: string;
      channel: string;
      durSec: number;
    }): number | null => {
      if (isDisallowedMusicVariant(cand.title, cand.channel, cleanTitle, cleanArtist)) {
        return null;
      }
      const normYtTitle = normalizeYouTubeMatchText(cand.title);
      const normYtChannel = normalizeYouTubeMatchText(cand.channel);
      const diff = expectedSec !== null ? Math.abs(cand.durSec - expectedSec) : 0;
      if (expectedSec !== null && diff > Math.max(50, expectedSec * 0.4)) {
        return null;
      }

      let score = 0;
      if (/\s-\s*topic$/i.test(cand.channel.trim())) score += 60;
      if (normYtTitle.includes('official audio')) score += 35;
      else if (normYtTitle.includes('official lyric')) score += 25;
      else if (normYtTitle.includes('lyrics') || normYtTitle.includes('audio')) score += 15;
      else if (normYtTitle.includes('official music video') || normYtTitle.includes('official video')) {
        score += 12;
      }

      if (normTargetTitle && normYtTitle.includes(normTargetTitle)) {
        score += 45;
      } else if (titleTokens.length > 0) {
        const matchedWords = titleTokens.filter((w) => normYtTitle.includes(w)).length;
        if (matchedWords === 0) score -= 25;
        else score += Math.round((matchedWords / titleTokens.length) * 30);
      }

      if (normArtist && (normYtChannel.includes(normArtist) || normYtTitle.includes(normArtist))) {
        score += 40;
      }

      if (expectedSec !== null) {
        score -= Math.min(35, diff * 1.1);
      }
      return score;
    };

    try {
      const baseQuery = cleanArtist
        ? `${cleanTitle} ${primaryArtist} official audio`
        : `${cleanTitle} official audio`;
      let rawCandidates = await searchYouTubeVideoRenderers(baseQuery);

      let scored = rawCandidates
        .map((cand) => ({ videoId: cand.videoId, score: scoreCandidate(cand) }))
        .filter((x): x is { videoId: string; score: number } => x.score !== null);

      // If most initial results were remixes/sped-up/slowed/covers, query again with explicit exclusions
      if (scored.length < 2) {
        const cleanQuery = cleanArtist
          ? `${cleanTitle} ${primaryArtist} -remix -"sped up" -slowed -reverb -nightcore -cover -mashup`
          : `${cleanTitle} -remix -"sped up" -slowed -reverb -nightcore -cover -mashup`;
        const extraCandidates = await searchYouTubeVideoRenderers(cleanQuery);
        const merged = [...rawCandidates];
        const seen = new Set(merged.map((m) => m.videoId));
        for (const c of extraCandidates) {
          if (!seen.has(c.videoId)) {
            seen.add(c.videoId);
            merged.push(c);
          }
        }
        rawCandidates = merged;
        scored = rawCandidates
          .map((cand) => ({ videoId: cand.videoId, score: scoreCandidate(cand) }))
          .filter((x): x is { videoId: string; score: number } => x.score !== null);
      }

      scored.sort((a, b) => b.score - a.score);
      const ids = Array.from(new Set(scored.map((c) => c.videoId))).slice(0, 4);
      if (ids.length > 0) {
        ytMatchCache.set(cacheKey, ids);
      }
      return ids;
    } catch {
      return [];
    }
  }

  app.post('/api/spotify/resolve-track', async (req, res) => {
    const title = String(req.body?.title || '').trim();
    const artist = String(req.body?.artist || '').trim();
    const durationMs =
      typeof req.body?.durationMs === 'number' ? req.body.durationMs : undefined;
    if (!title) {
      res.status(400).json({ error: 'Missing track title.' });
      return;
    }
    const videoIds = await resolveYouTubeMatches(title, artist, durationMs);
    res.json({
      videoId: videoIds[0] || null,
      videoIds,
    });
  });

  const lyricsCache = new Map<
    string,
    {
      syncedLyrics: string | null;
      plainLyrics: string | null;
      instrumental: boolean;
      trackName?: string;
      artistName?: string;
    }
  >();

  app.post('/api/spotify/lyrics', async (req, res) => {
    const rawTitle = String(req.body?.title || '').trim();
    const rawArtist = String(req.body?.artist || '').trim();
    const durationSec =
      typeof req.body?.durationMs === 'number' && req.body.durationMs > 0
        ? Math.round(req.body.durationMs / 1000)
        : undefined;

    if (!rawTitle) {
      res.json({ syncedLyrics: null, plainLyrics: null, instrumental: false });
      return;
    }

    const cleanTitle = rawTitle
      .replace(/\s*[-–—]\s*(remaster(ed)?|live|acoustic|radio edit|feat\..*|ft\..*)/gi, '')
      .replace(/\s*\((feat\.|ft\.|with|remaster|explicit|clean)[^)]*\)/gi, '')
      .trim();
    const cleanArtist = /^(spotify|album|playlist|custom audio|saved audio)/i.test(rawArtist)
      ? ''
      : rawArtist.split(',')[0].trim();

    const cacheKey = `${cleanTitle.toLowerCase()}|${cleanArtist.toLowerCase()}`;
    const cached = lyricsCache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const empty = { syncedLyrics: null, plainLyrics: null, instrumental: false };
    try {
      const headers = { 'User-Agent': 'ExaminerStudyApp/1.0 (https://examiner.app)' };
      if (cleanTitle && cleanArtist) {
        const params = new URLSearchParams({
          track_name: cleanTitle,
          artist_name: cleanArtist,
        });
        if (durationSec && durationSec > 20) {
          params.set('duration', String(durationSec));
        }
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const r = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
          signal: ctrl.signal,
          headers,
        }).catch(() => null);
        clearTimeout(t);
        if (r && r.ok) {
          const data = (await r.json().catch(() => null)) as {
            syncedLyrics?: string;
            plainLyrics?: string;
            instrumental?: boolean;
            trackName?: string;
            artistName?: string;
          } | null;
          if (data && (data.syncedLyrics || data.plainLyrics || data.instrumental)) {
            const payload = {
              syncedLyrics: data.syncedLyrics || null,
              plainLyrics: data.plainLyrics || null,
              instrumental: Boolean(data.instrumental),
              trackName: data.trackName,
              artistName: data.artistName,
            };
            lyricsCache.set(cacheKey, payload);
            res.json(payload);
            return;
          }
        }
      }

      const searchQ = cleanArtist ? `${cleanTitle} ${cleanArtist}` : cleanTitle;
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), 5000);
      const r2 = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(searchQ)}`,
        { signal: ctrl2.signal, headers }
      ).catch(() => null);
      clearTimeout(t2);
      if (r2 && r2.ok) {
        const list = (await r2.json().catch(() => [])) as Array<{
          syncedLyrics?: string;
          plainLyrics?: string;
          instrumental?: boolean;
          trackName?: string;
          artistName?: string;
        }>;
        const best =
          Array.isArray(list) && list.length > 0
            ? list.find((item) => Boolean(item.syncedLyrics)) ||
              list.find((item) => Boolean(item.plainLyrics)) ||
              list[0]
            : null;
        if (best && (best.syncedLyrics || best.plainLyrics || best.instrumental)) {
          const payload = {
            syncedLyrics: best.syncedLyrics || null,
            plainLyrics: best.plainLyrics || null,
            instrumental: Boolean(best.instrumental),
            trackName: best.trackName,
            artistName: best.artistName,
          };
          lyricsCache.set(cacheKey, payload);
          res.json(payload);
          return;
        }
      }

      lyricsCache.set(cacheKey, empty);
      res.json(empty);
    } catch {
      res.json(empty);
    }
  });

  app.post('/api/spotify/extract', async (req, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Paste a Spotify song, album, or playlist link.' });
      return;
    }

    let resolvedUrl = rawUrl;
    if (/spotify\.link|spoti\.fi/i.test(rawUrl)) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const redirectRes = await fetch(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`, {
          method: 'GET',
          redirect: 'follow',
          signal: ctrl.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        clearTimeout(timer);
        if (redirectRes.url) {
          resolvedUrl = redirectRes.url;
        }
      } catch {
        // Continue with rawUrl if redirect fails
      }
    }

    const parsed = parseSpotifyIdentifier(resolvedUrl);
    if (!parsed) {
      res.status(400).json({
        error: 'Enter a valid Spotify link for a song (track), album, or playlist.',
      });
      return;
    }

    const { kind, id } = parsed;
    const spotifyUrl = `https://open.spotify.com/${kind}/${id}`;
    const embedUrl = `https://open.spotify.com/embed/${kind}/${id}?utm_source=generator`;

    let title =
      kind === 'track' ? 'Spotify Track' : kind === 'album' ? 'Spotify Album' : 'Spotify Playlist';
    let subtitle =
      kind === 'track' ? 'Spotify song' : kind === 'album' ? 'Spotify album' : 'Spotify playlist';
    let thumbnailUrl: string | undefined;
    let previewUrl: string | undefined;
    let durationMs: number | undefined;
    const tracks: Array<{
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
    }> = [];

    const oembedPromise = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const r = await fetch(
          `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`,
          { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        clearTimeout(t);
        if (!r.ok) return null;
        return (await r.json()) as { title?: string; thumbnail_url?: string };
      } catch {
        return null;
      }
    })();

    const embedHtmlPromise = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
          signal: ctrl.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        clearTimeout(t);
        if (!r.ok) return '';
        return await r.text();
      } catch {
        return '';
      }
    })();

    const [oembed, embedHtml] = await Promise.all([oembedPromise, embedHtmlPromise]);

    if (oembed?.title) {
      title = oembed.title;
    }
    if (oembed?.thumbnail_url) {
      thumbnailUrl = oembed.thumbnail_url;
    }

    if (embedHtml) {
      const nextDataMatch = embedHtml.match(
        /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
      );
      if (nextDataMatch?.[1]) {
        try {
          const nextJson = JSON.parse(nextDataMatch[1]) as {
            props?: {
              pageProps?: {
                state?: {
                  data?: {
                    entity?: Record<string, unknown>;
                  };
                };
              };
            };
          };
          const entity = nextJson?.props?.pageProps?.state?.data?.entity;
          if (entity) {
            if (typeof entity.name === 'string' && entity.name.trim()) {
              title = entity.name.trim();
            } else if (typeof entity.title === 'string' && entity.title.trim()) {
              title = entity.title.trim();
            }

            if (typeof entity.subtitle === 'string' && entity.subtitle.trim()) {
              subtitle = entity.subtitle.trim();
            } else if (Array.isArray(entity.artists) && entity.artists.length > 0) {
              const artistNames = entity.artists
                .map((a) => (a && typeof a === 'object' ? String((a as Record<string, unknown>).name || '') : ''))
                .filter(Boolean);
              if (artistNames.length > 0) subtitle = artistNames.join(', ');
            }

            if (typeof entity.duration === 'number') {
              durationMs = entity.duration;
            }

            const audioPrev = entity.audioPreview as { url?: string } | undefined;
            if (audioPrev?.url && typeof audioPrev.url === 'string') {
              previewUrl = audioPrev.url;
            }

            if (!thumbnailUrl && entity.coverArt && typeof entity.coverArt === 'object') {
              const sources = (entity.coverArt as { sources?: Array<{ url?: string }> }).sources;
              if (Array.isArray(sources) && sources[0]?.url) {
                thumbnailUrl = sources[0].url;
              }
            }

            const rawList = Array.isArray(entity.trackList) ? entity.trackList : [];
            for (const item of rawList.slice(0, 50)) {
              if (!item || typeof item !== 'object') continue;
              const rec = item as Record<string, unknown>;
              const tTitle = String(rec.title || rec.name || '').trim();
              if (!tTitle) continue;
              const tArtist = String(rec.subtitle || '').trim() || subtitle;
              const uri = typeof rec.uri === 'string' ? rec.uri : '';
              const trackIdMatch = uri.match(/spotify:track:([A-Za-z0-9]+)/i);
              const tId = trackIdMatch?.[1];
              const itemPreview = (rec.audioPreview as { url?: string } | undefined)?.url;
              tracks.push({
                id: tId,
                title: tTitle,
                artist: tArtist,
                durationMs: typeof rec.duration === 'number' ? rec.duration : undefined,
                previewUrl: typeof itemPreview === 'string' ? itemPreview : undefined,
                spotifyUrl: tId ? `https://open.spotify.com/track/${tId}` : undefined,
                embedUrl: tId
                  ? `https://open.spotify.com/embed/track/${tId}?utm_source=generator`
                  : undefined,
              });
            }
          }
        } catch {
          // Ignore malformed __NEXT_DATA__ and use fallback metadata
        }
      }

      if (!thumbnailUrl) {
        const ogImg = embedHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
        if (ogImg?.[1]) thumbnailUrl = decodeHtmlEntities(ogImg[1]);
      }
    }

    let youtubeVideoIds: string[] = [];
    if (kind === 'track') {
      youtubeVideoIds = await resolveYouTubeMatches(title, subtitle, durationMs);
    } else if (tracks.length > 0) {
      const firstIds = await resolveYouTubeMatches(
        tracks[0].title,
        tracks[0].artist,
        tracks[0].durationMs
      );
      if (firstIds.length > 0) {
        tracks[0].youtubeVideoIds = firstIds;
        tracks[0].youtubeVideoId = firstIds[0];
        tracks[0].matchVersion = CURRENT_SPOTIFY_MATCH_VERSION;
      }
    }

    if ((kind === 'album' || kind === 'playlist') && tracks.length > 0) {
      const kindLabel = kind === 'album' ? 'Album' : 'Playlist';
      subtitle = `${kindLabel} · ${tracks.length} tracks`;
    }

    res.json({
      track: {
        id: `spotify_${kind}_${id}`,
        title,
        subtitle,
        kind: 'spotify',
        spotifyKind: kind,
        spotifyId: id,
        spotifyUrl,
        embedUrl,
        thumbnailUrl,
        previewUrl,
        durationMs,
        youtubeVideoId: youtubeVideoIds[0],
        youtubeVideoIds: youtubeVideoIds.length > 0 ? youtubeVideoIds : undefined,
        matchVersion: youtubeVideoIds.length > 0 ? CURRENT_SPOTIFY_MATCH_VERSION : undefined,
        tracks: tracks.length > 0 ? tracks : undefined,
        savedAt: new Date().toISOString(),
      },
    });
  });

  // Document Scanner (all languages, any number of PDF pages, high-res micro-to-macro reading)
  const SCAN_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      exams: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            date: { type: Type.STRING },
            startTime: { type: Type.STRING },
            endTime: { type: Type.STRING },
            room: { type: Type.STRING },
            type: { type: Type.STRING },
            material: { type: Type.STRING },
            topics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            notes: { type: Type.STRING },
          },
          required: ['subject', 'type', 'topics'],
        },
      },
      lessons: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            title: { type: Type.STRING },
            notes: { type: Type.STRING },
            examType: { type: Type.STRING },
          },
          required: ['subject', 'title'],
        },
      },
      ignored: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
    },
    required: ['exams', 'lessons'],
  };

  interface CachedScanEntry {
    exams: unknown[];
    lessons: unknown[];
    ignored: unknown[];
    totalPages?: number;
    cachedAt: number;
  }

  function getCachedScanResult(cacheKey: string): CachedScanEntry | null {
    const cache = readJsonFile<Record<string, CachedScanEntry>>(SCAN_CACHE_FILE, {});
    const entry = cache[cacheKey];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > SCAN_CACHE_TTL_MS) {
      delete cache[cacheKey];
      writeJsonFile(SCAN_CACHE_FILE, cache);
      return null;
    }
    return entry;
  }

  function setCachedScanResult(
    cacheKey: string,
    result: { exams: unknown[]; lessons: unknown[]; ignored: unknown[]; totalPages?: number }
  ) {
    if (result.exams.length === 0 && result.lessons.length === 0) return;
    const cache = readJsonFile<Record<string, CachedScanEntry>>(SCAN_CACHE_FILE, {});
    const now = Date.now();
    cache[cacheKey] = {
      exams: result.exams,
      lessons: result.lessons,
      ignored: result.ignored,
      totalPages: result.totalPages,
      cachedAt: now,
    };
    const entries = Object.entries(cache)
      .filter(([, v]) => now - v.cachedAt <= SCAN_CACHE_TTL_MS)
      .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
      .slice(0, SCAN_CACHE_MAX_ENTRIES);
    writeJsonFile(SCAN_CACHE_FILE, Object.fromEntries(entries));
  }

  function extractErrorText(err: unknown): string {
    if (err instanceof Error) return err.message || '';
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err || '');
    } catch {
      return String(err || '');
    }
  }

  const modelCooldownUntil = new Map<string, number>(
    Object.entries(readJsonFile<Record<string, number>>(SCAN_COOLDOWN_FILE, {})).filter(
      ([, until]) => typeof until === 'number' && until > Date.now()
    )
  );

  function saveModelCooldowns() {
    const out: Record<string, number> = {};
    const now = Date.now();
    for (const [m, until] of modelCooldownUntil.entries()) {
      if (until > now) out[m] = until;
    }
    try {
      writeJsonFile(SCAN_COOLDOWN_FILE, out);
    } catch {
      // Non-fatal
    }
  }

  function isModelOnCooldown(model: string): boolean {
    const until = modelCooldownUntil.get(model);
    if (!until) return false;
    if (Date.now() >= until) {
      modelCooldownUntil.delete(model);
      saveModelCooldowns();
      return false;
    }
    return true;
  }

  function isDailyQuotaError(err: unknown): boolean {
    const msg = extractErrorText(err).toLowerCase();
    return (
      msg.includes('generaterequestsperday') ||
      msg.includes('requests per day') ||
      msg.includes('per_day') ||
      msg.includes('perday')
    );
  }

  function recordModelCooldownIfExhausted(model: string, err: unknown): void {
    if (!isDailyQuotaError(err)) return;
    const raw = extractErrorText(err);
    const match = raw.match(/retryDelay["']?\s*:\s*["']?(\d+)s/i);
    const parsedSec = match?.[1] ? Number(match[1]) : 3600;
    const cooldownMs = Math.min(Math.max(parsedSec, 60), 6 * 60 * 60) * 1000;
    modelCooldownUntil.set(model, Date.now() + cooldownMs);
    saveModelCooldowns();
  }

  function isTransientScanError(err: unknown): boolean {
    if (err instanceof SyntaxError) return true;
    if (isDailyQuotaError(err)) return false;
    const msg = extractErrorText(err).toLowerCase();
    // Never waste another full timeout cycle retrying timeouts; immediately fail over to the backup model.
    if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('deadline_exceeded')) {
      return false;
    }
    return (
      msg.includes('429') ||
      msg.includes('resource_exhausted') ||
      msg.includes('quota') ||
      msg.includes('rate limit') ||
      msg.includes('503') ||
      msg.includes('unavailable') ||
      msg.includes('high demand') ||
      msg.includes('overloaded') ||
      msg.includes('500') ||
      msg.includes('internal') ||
      msg.includes('econnreset') ||
      msg.includes('fetch failed') ||
      msg.includes('socket')
    );
  }

  function isSchemaOrParseFailure(err: unknown): boolean {
    if (err instanceof SyntaxError) return true;
    const msg = extractErrorText(err).toLowerCase();
    return (
      msg.includes('invalid_argument') ||
      msg.includes('schema') ||
      msg.includes('unexpected token') ||
      msg.includes('json')
    );
  }

  function getScanHttpStatus(err: unknown): number {
    const msg = extractErrorText(err).toLowerCase();
    if (msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota')) {
      return 429;
    }
    if (msg.includes('503') || msg.includes('unavailable') || msg.includes('high demand')) {
      return 503;
    }
    return 502;
  }

  function formatScanErrorMessage(err: unknown, fallback = 'Failed to scan document.'): string {
    if (err instanceof SyntaxError) {
      return 'The document could not be read cleanly as a schedule. Try a clearer photo or PDF.';
    }
    if (isDailyQuotaError(err)) {
      return 'Daily free AI scan quota is temporarily reached. Please try again later.';
    }
    let raw = extractErrorText(err).trim();
    // Unwrap serialized Gemini JSON error envelopes like {"error":{"code":503,"message":"...","status":"UNAVAILABLE"}}
    for (let depth = 0; depth < 3 && raw.startsWith('{'); depth++) {
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string; code?: number }; message?: string };
        if (parsed?.error?.message) {
          raw = `${parsed.error.code || ''} ${parsed.error.status || ''} ${parsed.error.message}`.trim();
        } else if (parsed?.message) {
          raw = String(parsed.message).trim();
        } else {
          break;
        }
      } catch {
        break;
      }
    }
    const lower = raw.toLowerCase();
    if (lower.includes('daily free ai scan quota')) {
      return raw;
    }
    if (
      lower.includes('503') ||
      lower.includes('unavailable') ||
      lower.includes('high demand') ||
      lower.includes('overloaded')
    ) {
      return 'The scanner service is temporarily busy right now. Wait a few seconds and tap Try again.';
    }
    if (
      lower.includes('429') ||
      lower.includes('resource_exhausted') ||
      lower.includes('quota') ||
      lower.includes('rate limit')
    ) {
      return 'Scanner rate limit reached for a moment. Wait a few seconds and tap Try again.';
    }
    if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('deadline_exceeded')) {
      return 'The scan took too long on this file. Try uploading a clearer photo or fewer pages at once.';
    }
    if (
      lower.includes('api_key') ||
      lower.includes('permission_denied') ||
      lower.includes('access_token_scope') ||
      lower.includes('403')
    ) {
      return 'Scanner authentication is not active on the server right now.';
    }
    if (lower.includes('mime') || lower.includes('unsupported') || lower.includes('unable to process input')) {
      return 'This file format could not be read. Try exporting as PDF, JPG, or PNG.';
    }
    if (!raw || raw.startsWith('{') || raw.length > 180) {
      return fallback;
    }
    return raw;
  }

  function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise
        .then((val) => {
          clearTimeout(timer);
          resolve(val);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: unknown) {
        lastError = err;
        if (attempt === maxRetries || !isTransientScanError(err)) {
          throw err;
        }
        const delays = [900, 1900, 3200];
        const base = delays[attempt] ?? 3200;
        const delayMs = base + Math.floor(Math.random() * 450);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastError;
  }

  const inFlightScans = new Map<
    string,
    Promise<{ exams: unknown[]; lessons: unknown[]; ignored: unknown[]; totalPages?: number }>
  >();

  function normalizeSubjectKey(s: string): string {
    const cleaned = foldDigitsToAscii(s)
      .toLowerCase()
      .replace(/\badvanced\s+level\b/gi, ' al ')
      .replace(/\bordinary\s+level\b/gi, ' ol ')
      .replace(/\ba\s*[./-]\s*l\b/gi, ' al ')
      .replace(/\bo\s*[./-]\s*l\b/gi, ' ol ')
      .replace(/\ba\s+l\b/gi, ' al ')
      .replace(/\bo\s+l\b/gi, ' ol ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (!cleaned) return '';
    const noise = new Set([
      'exam', 'exams', 'final', 'finals', 'midterm', 'midterms', 'mid', 'term',
      'test', 'tests', 'quiz', 'quizzes', 'assessment', 'monthly',
      'امتحان', 'امتحانات', 'اختبار', 'اختبارات', 'نهائي', 'نصفي', 'شهري', 'مادة', 'مقرر',
    ]);
    const tokens = cleaned.split(/\s+/).filter((t) => t && !noise.has(t));
    const collapsed: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const cur = tokens[i];
      const next = tokens[i + 1];
      if ((cur === 'al' || cur === 'ol') && next === 'a') {
        collapsed.push(cur);
        i++;
        continue;
      }
      collapsed.push(cur);
    }
    return collapsed.join(' ');
  }

  function scanSubjectsMatch(a: string, b: string): boolean {
    const keyA = normalizeSubjectKey(a);
    const keyB = normalizeSubjectKey(b);
    if (!keyA || !keyB) return keyA === keyB;
    if (keyA === keyB) return true;
    const tokA = keyA.split(' ');
    const tokB = keyB.split(' ');
    const setA = new Set(tokA);
    const setB = new Set(tokB);
    if ((setA.has('al') && setB.has('ol')) || (setA.has('ol') && setB.has('al'))) return false;
    const secOf = (toks: string[]) => {
      for (let i = 0; i < toks.length; i++) {
        if (toks[i] === 'al' || toks[i] === 'ol') {
          const nxt = toks[i + 1];
          return nxt && /^[b-z2-9]$/.test(nxt) ? `${toks[i]}:${nxt}` : `${toks[i]}:a`;
        }
      }
      return null;
    };
    const sA = secOf(tokA);
    const sB = secOf(tokB);
    if (sA && sB && sA !== sB) return false;
    return ` ${keyA} `.includes(` ${keyB} `) || ` ${keyB} `.includes(` ${keyA} `);
  }

  function foldDigitsToAscii(raw: unknown): string {
    return String(raw || '')
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
  }

  function normalizeExtractedIsoDate(raw: unknown): string {
    const cleaned = foldDigitsToAscii(raw).trim();
    if (!cleaned) return '';
    // YYYY-MM-DD or YYYY/M/D or YYYY.M.D
    const ymd = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (ymd) {
      const y = Number(ymd[1]);
      const m = Number(ymd[2]);
      const d = Number(ymd[3]);
      if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dmy) {
      let d = Number(dmy[1]);
      let m = Number(dmy[2]);
      const y = Number(dmy[3]);
      if (m > 12 && d <= 12) {
        const swap = d;
        d = m;
        m = swap;
      }
      if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    const parsed = new Date(cleaned);
    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000 && parsed.getFullYear() <= 2100) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return '';
  }

  function normalizeExtracted24hTime(raw: unknown): string {
    const cleaned = foldDigitsToAscii(raw).trim();
    if (!cleaned) return '';
    const match = cleaned.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm|ص|م)?/i);
    if (!match) return '';
    let h = Number(match[1]);
    const m = Number(match[2]);
    const period = (match[3] || '').toLowerCase();
    if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59 || h > 23) return '';
    if ((period === 'pm' || period === 'م') && h < 12) h += 12;
    if ((period === 'am' || period === 'ص') && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const SCAN_LESSON_STOPWORDS = new Set([
    'the', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'a', 'an',
    'unit', 'lesson', 'chapter', 'ch', 'part', 'section', 'module', 'topic', 'week',
    'درس', 'الدرس', 'وحدة', 'الوحدة', 'فصل', 'الفصل', 'باب', 'الباب', 'في', 'من', 'على', 'و',
  ]);

  function areScanTopicsEquivalent(a: string, b: string): boolean {
    const clean = (s: string) =>
      foldDigitsToAscii(s)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    const na = clean(a);
    const nb = clean(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const tokA = na.split(/\s+/).filter(Boolean);
    const tokB = nb.split(/\s+/).filter(Boolean);
    const numsA = tokA.filter((t) => /^\d+$/.test(t));
    const numsB = tokB.filter((t) => /^\d+$/.test(t));
    if (numsA.length > 0 && numsB.length > 0 && numsA.join(',') !== numsB.join(',')) {
      return false;
    }
    if (` ${na} `.includes(` ${nb} `) || ` ${nb} `.includes(` ${na} `)) return true;
    const coreA = tokA.filter((t) => !SCAN_LESSON_STOPWORDS.has(t));
    const coreB = tokB.filter((t) => !SCAN_LESSON_STOPWORDS.has(t));
    const setA = new Set(coreA.length > 0 ? coreA : tokA);
    const setB = new Set(coreB.length > 0 ? coreB : tokB);
    let overlap = 0;
    for (const t of setA) {
      if (setB.has(t)) overlap++;
    }
    const unionSize = new Set([...setA, ...setB]).size;
    return unionSize > 0 && overlap / unionSize >= 0.7;
  }

  function splitScanMultiLessonText(raw: string): string[] {
    const cleaned = String(raw || '').trim();
    if (!cleaned) return [];
    let prepped = cleaned;
    const numbered = prepped.match(/(?:^|\s)\d{1,2}\s*[.)]\s+/g);
    if (numbered && numbered.length >= 2) {
      prepped = prepped.replace(/(?:^|\s)\d{1,2}\s*[.)]\s+/g, '\n');
    }
    const primary = prepped
      .split(/\r?\n+|[;؛•▪▫●◦|]+|(?<!\d),|,(?!\d{3}(?!\d))|[،]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const expanded: string[] = [];
    if (primary.length >= 2) {
      const m0 = primary[0].match(
        /^(lessons?|units?|chapters?|ch\.?|parts?|sections?|modules?|topics?|lectures?|دروس|درس|وحدات|وحدة|فصول|فصل)\s+(\d+)$/i
      );
      if (m0 && primary.slice(1).every((c) => /^\d+$/.test(c))) {
        const prefix = m0[1].replace(/s$/i, '');
        for (let i = 0; i < primary.length; i++) {
          expanded.push(`${prefix} ${i === 0 ? m0[2] : primary[i]}`);
        }
      }
    }
    const chunks = expanded.length > 0 ? expanded : primary;
    const out: string[] = [];
    const lessonRefRe =
      /^(?:lesson|lessons|unit|units|chapter|chapters|ch\.?|part|parts|section|sections|module|modules|topic|topics|week|weeks|lecture|lectures|lec\.?|درس|دروس|الدرس|وحدة|وحدات|فصل|فصول|باب|محاضرة|محاضرات)\b/i;
    for (const chunk of chunks) {
      const sec = chunk
        .split(/\s+(?:&|\+|\/|-|–|—)\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (
        sec.length >= 3 ||
        (sec.length === 2 && sec.every((s) => lessonRefRe.test(s) || /\d+$/.test(s)))
      ) {
        for (const p of sec) {
          if (!out.some((e) => areScanTopicsEquivalent(e, p))) out.push(p);
        }
      } else if (!out.some((e) => areScanTopicsEquivalent(e, chunk))) {
        out.push(chunk);
      }
    }
    return out;
  }

  function normalizeExtractedScanData(
    parsed: { exams: unknown[]; lessons: unknown[]; ignored: unknown[]; totalPages?: number },
    scope: 'all' | 'assessments' = 'all'
  ) {
    const rawExams = Array.isArray(parsed.exams) ? parsed.exams : [];
    const rawLessons = Array.isArray(parsed.lessons) ? parsed.lessons : [];

    const normalizedLessons: Array<{
      subject: string;
      title: string;
      notes: string;
      examType: string;
    }> = [];
    for (const raw of rawLessons) {
      if (!raw || typeof raw !== 'object') continue;
      const l = raw as Record<string, unknown>;
      const subject = String(l.subject || 'General').trim() || 'General';
      const rawTitle = String(l.title || l.lesson || l.topic || l.name || '').trim();
      const notes = String(l.notes || '').trim();
      const examType = String(l.examType || '').trim().toLowerCase();
      for (const part of splitScanMultiLessonText(rawTitle)) {
        const exists = normalizedLessons.some(
          (cur) => scanSubjectsMatch(cur.subject, subject) && areScanTopicsEquivalent(cur.title, part)
        );
        if (!exists) {
          normalizedLessons.push({ subject, title: part, notes, examType });
        }
      }
    }

    const normalizeExamType = (rawType: unknown, textHint: string): string => {
      const lower = String(rawType || '').toLowerCase().trim();
      const combined = `${lower} ${textHint}`.toLowerCase();
      if (VALID_TYPES.has(lower) && lower !== 'other') {
        if (scope === 'assessments' && lower === 'quiz') return 'monthly';
        return lower;
      }
      if (/mid-?term|نصفي|منتصف|partiel/.test(combined)) return 'midterm';
      if (/final|نهائي|آخر العام/.test(combined)) return 'final';
      if (/month|شهري|شهر|mensuel/.test(combined)) return 'monthly';
      if (/practical|lab|عملي/.test(combined)) return 'practical';
      if (/oral|شفوي|شفهي/.test(combined)) return 'oral';
      if (scope === 'assessments') return 'monthly';
      if (/quiz|قصير/.test(combined)) return 'quiz';
      return 'other';
    };

    const normalizedExams = rawExams
      .filter((ex): ex is Record<string, unknown> => Boolean(ex && typeof ex === 'object'))
      .map((ex) => {
        const subject = String(ex.subject || ex.name || ex.course || ex.title || '').trim();
        const material = String(ex.material || '').trim();
        const notes = String(ex.notes || '').trim();
        const type = normalizeExamType(ex.type, `${subject} ${notes}`);
        const topicInputs = Array.isArray(ex.topics)
          ? ex.topics.map((t) => String(t || ''))
          : typeof ex.topics === 'string'
          ? [ex.topics]
          : [];
        const dedupedTopics: string[] = [];
        for (const tpInput of topicInputs) {
          for (const part of splitScanMultiLessonText(tpInput)) {
            if (!dedupedTopics.some((cur) => areScanTopicsEquivalent(cur, part))) {
              dedupedTopics.push(part);
            }
          }
        }
        return {
          subject: subject || 'Untitled exam',
          date: normalizeExtractedIsoDate(ex.date),
          startTime: normalizeExtracted24hTime(ex.startTime || ex.time),
          endTime: normalizeExtracted24hTime(ex.endTime),
          room: String(ex.room || ex.hall || '').trim(),
          type,
          material,
          topics: dedupedTopics,
          notes,
        };
      });

    // Cross-link lessons <-> exam.topics bidirectionally
    for (const ex of normalizedExams) {
      const subKey = normalizeSubjectKey(ex.subject);
      if (!subKey) continue;
      const sameSubjectExamCount = normalizedExams.filter((other) =>
        scanSubjectsMatch(other.subject, ex.subject)
      ).length;

      if (ex.topics.length === 0) {
        const matched = normalizedLessons.filter((l) => {
          if (!scanSubjectsMatch(l.subject, ex.subject)) return false;
          if (l.examType && l.examType !== ex.type) return false;
          return l.examType === ex.type || sameSubjectExamCount === 1;
        });
        if (matched.length > 0) {
          const deduped: string[] = [];
          for (const m of matched) {
            if (!deduped.some((cur) => areScanTopicsEquivalent(cur, m.title))) {
              deduped.push(m.title);
            }
          }
          ex.topics = deduped;
        }
      }

      for (const topic of ex.topics) {
        const exists = normalizedLessons.some(
          (l) =>
            scanSubjectsMatch(l.subject, ex.subject) &&
            areScanTopicsEquivalent(l.title, topic)
        );
        if (!exists) {
          normalizedLessons.push({
            subject: ex.subject,
            title: topic,
            notes: ex.material ? `Material: ${ex.material}` : '',
            examType: ex.type,
          });
        }
      }
    }

    return {
      exams: normalizedExams,
      lessons: normalizedLessons.map(({ subject, title, notes }) => ({ subject, title, notes })),
      ignored: Array.isArray(parsed.ignored) ? parsed.ignored : [],
      ...(typeof parsed.totalPages === 'number' ? { totalPages: parsed.totalPages } : {}),
    };
  }

  function isCoherentExtractedText(text: string): boolean {
    const clean = String(text || '').trim();
    if (clean.length < 2) return false;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(clean)) return false;
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;
    let validWords = 0;
    for (const w of words) {
      // Reject PDF subsetted-font glyph runs such as "fytdiyddirrsttyrxu"
      if (/[bcdfghjklmnpqrstvwxz]{6,}/i.test(w)) return false;
      const alphaOnly = w.replace(/[^a-zA-Z]/g, '');
      if (alphaOnly.length >= 10) {
        const strictVowelCount = (alphaOnly.match(/[aeiou]/gi) || []).length;
        if (strictVowelCount / alphaOnly.length < 0.18) {
          return false;
        }
      }
      if (/^[\p{L}\p{N}][\p{L}\p{N}.,:;()[\]/&+'"\-–—]*$/u.test(w)) {
        validWords++;
      }
    }
    return validWords > 0 && validWords / words.length >= 0.65;
  }

  function decodePdfLiteralString(raw: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch !== '\\') {
        bytes.push(raw.charCodeAt(i) & 0xff);
        continue;
      }
      const next = raw[++i];
      if (next === undefined) break;
      if (next === 'n') bytes.push(10);
      else if (next === 'r') bytes.push(13);
      else if (next === 't') bytes.push(9);
      else if (next === 'b') bytes.push(8);
      else if (next === 'f') bytes.push(12);
      else if (next === '(' || next === ')' || next === '\\') bytes.push(next.charCodeAt(0));
      else if (/[0-7]/.test(next)) {
        let oct = next;
        for (let k = 0; k < 2 && /[0-7]/.test(raw[i + 1] || ''); k++) {
          oct += raw[++i];
        }
        bytes.push(parseInt(oct, 8) & 0xff);
      } else {
        bytes.push(next.charCodeAt(0) & 0xff);
      }
    }
    const buf = Buffer.from(bytes);
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      let out = '';
      for (let i = 2; i + 1 < buf.length; i += 2) {
        out += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
      }
      return out;
    }
    const nonPrintable = buf.filter((b) => (b < 32 && b !== 9 && b !== 10 && b !== 13) || b === 127).length;
    if (nonPrintable > 0) return '';
    return buf.toString('utf8');
  }

  function decodePdfHexString(rawHex: string): string {
    const clean = rawHex.replace(/\s+/g, '');
    if (clean.length < 2) return '';
    const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
    const buf = Buffer.from(padded, 'hex');
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      let out = '';
      for (let i = 2; i + 1 < buf.length; i += 2) {
        out += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
      }
      return out;
    }
    // Reject CID/glyph index streams (<001F002A...>) containing null/control bytes or non-ASCII encodings
    if (buf.some((b) => b < 32 && b !== 9 && b !== 10 && b !== 13)) {
      return '';
    }
    if (buf.some((b) => b > 126)) {
      return '';
    }
    return buf.toString('ascii');
  }

  function extractReadableTextFromPdfBuffer(pdfBytes: Buffer): string {
    const rawPdf = pdfBytes.toString('latin1');
    const chunks: string[] = [];
    const streamRe = /stream\r?\n([\s\S]*?)\r?\n?endstream/g;
    let match: RegExpExecArray | null;
    while ((match = streamRe.exec(rawPdf)) !== null && chunks.length < 300) {
      const streamLatin = match[1];
      let content = '';
      try {
        const rawBuf = Buffer.from(streamLatin, 'latin1');
        try {
          content = zlib.inflateSync(rawBuf).toString('latin1');
        } catch {
          content = streamLatin;
        }
      } catch {
        continue;
      }
      if (!/\bT[jJ*']\b/.test(content) && !content.includes('BT')) continue;
      // Skip streams using custom CID / ToUnicode identity glyph mappings when parsing fallback text
      const lines: string[] = [];
      let currentLine = '';
      const opRe =
        /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|')|<([0-9A-Fa-f\s]+)>\s*(?:Tj|')|\[([\s\S]*?)\]\s*TJ|\bT[D*]\b|\bET\b/g;
      let op: RegExpExecArray | null;
      while ((op = opRe.exec(content)) !== null) {
        if (op[1] !== undefined) {
          currentLine += decodePdfLiteralString(op[1]);
        } else if (op[2] !== undefined) {
          currentLine += decodePdfHexString(op[2]);
        } else if (op[3] !== undefined) {
          const innerRe =
            /\(([^()\\]*(?:\\.[^()\\]*)*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
          let inner: RegExpExecArray | null;
          while ((inner = innerRe.exec(op[3])) !== null) {
            if (inner[1] !== undefined) {
              currentLine += decodePdfLiteralString(inner[1]);
            } else if (inner[2] !== undefined) {
              currentLine += decodePdfHexString(inner[2]);
            } else if (inner[3] !== undefined && Number(inner[3]) < -120) {
              currentLine += ' ';
            }
          }
        } else {
          const trimmed = currentLine.replace(/\s+/g, ' ').trim();
          if (trimmed && isCoherentExtractedText(trimmed)) {
            lines.push(trimmed);
          }
          currentLine = '';
        }
      }
      const trailing = currentLine.replace(/\s+/g, ' ').trim();
      if (trailing && isCoherentExtractedText(trailing)) {
        lines.push(trailing);
      }
      if (lines.length > 0) chunks.push(lines.join('\n'));
    }
    return chunks.join('\n').slice(0, 120000);
  }

  function parseDeterministicScheduleDocuments(
    docs: Array<{ name: string; text: string }>,
    scope: 'all' | 'assessments',
    existingExams: Array<{ subject: string; date: string; type: string }> = []
  ): { exams: unknown[]; lessons: unknown[]; ignored: unknown[] } | null {
    const MONTHS: Record<string, number> = {
      jan: 1, january: 1,
      feb: 2, february: 2,
      mar: 3, march: 3,
      apr: 4, april: 4,
      may: 5,
      jun: 6, june: 6,
      jul: 7, july: 7,
      aug: 8, august: 8,
      sep: 9, sept: 9, september: 9,
      oct: 10, october: 10,
      nov: 11, november: 11,
      dec: 12, december: 12,
    };

    const detectExamType = (text: string, fallback: string): string => {
      const low = text.toLowerCase();
      if (/mid-?term|نصفي|منتصف|partiel/.test(low)) return 'midterm';
      if (/final|نهائي|آخر العام/.test(low)) return 'final';
      if (/month|شهري|شهر|mensuel/.test(low)) return 'monthly';
      if (/practical|lab|عملي/.test(low)) return 'practical';
      if (/oral|شفوي|شفهي/.test(low)) return 'oral';
      if (/quiz|قصير/.test(low)) return scope === 'assessments' ? 'monthly' : 'quiz';
      return fallback;
    };

    const extractInlineDate = (rawLine: string): { date: string; matched: string } | null => {
      const line = foldDigitsToAscii(rawLine);
      const ymd = line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
      if (ymd) {
        const y = Number(ymd[1]);
        const m = Number(ymd[2]);
        const d = Number(ymd[3]);
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          return {
            date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
            matched: ymd[0],
          };
        }
      }
      const dmy = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
      if (dmy) {
        let d = Number(dmy[1]);
        let m = Number(dmy[2]);
        const y = Number(dmy[3]);
        if (m > 12 && d <= 12) [d, m] = [m, d];
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          return {
            date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
            matched: dmy[0],
          };
        }
      }
      const dMonY = line.match(
        /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[,\s]+(20\d{2}))?\b/i
      );
      if (dMonY) {
        const d = Number(dMonY[1]);
        const m = MONTHS[dMonY[2].toLowerCase()];
        const y = dMonY[3] ? Number(dMonY[3]) : new Date().getFullYear();
        if (m && d >= 1 && d <= 31) {
          return {
            date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
            matched: dMonY[0],
          };
        }
      }
      const monDY = line.match(
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:[,\s]+(20\d{2}))?\b/i
      );
      if (monDY) {
        const m = MONTHS[monDY[1].toLowerCase()];
        const d = Number(monDY[2]);
        const y = monDY[3] ? Number(monDY[3]) : new Date().getFullYear();
        if (m && d >= 1 && d <= 31) {
          return {
            date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
            matched: monDY[0],
          };
        }
      }
      return null;
    };

    const exams: Array<{
      subject: string;
      date: string;
      startTime: string;
      endTime: string;
      room: string;
      type: string;
      material: string;
      topics: string[];
      notes: string;
    }> = [];
    const lessons: Array<{ subject: string; title: string; notes: string; examType: string }> = [];
    const ignored: string[] = [];

    for (const doc of docs) {
      const lines = foldDigitsToAscii(doc.text)
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      let docDefaultType = detectExamType(`${doc.name} ${lines.slice(0, 4).join(' ')}`, scope === 'assessments' ? 'monthly' : 'other');
      let currentSectionSubject = '';
      let currentSectionType = docDefaultType;
      let inLessonsSection = /included\s+lessons?|syllabus|covered\s+topics|الدروس\s+المقررة/i.test(
        `${doc.name} ${lines.slice(0, 3).join(' ')}`
      );

      for (const line of lines) {
        if (!isCoherentExtractedText(line)) continue;
        if (/^(included\s+lessons?|syllabus|covered\s+topics|monthly\s+exams?|mid-?term\s+exams?|final\s+exams?|exam\s+schedule|timetable)[:\s-]*$/i.test(line)) {
          docDefaultType = detectExamType(line, docDefaultType);
          currentSectionType = docDefaultType;
          if (/included\s+lessons?|syllabus|covered\s+topics|الدروس/i.test(line)) {
            inLessonsSection = true;
          }
          continue;
        }

        const dateInfo = extractInlineDate(line);
        const timeMatches = Array.from(line.matchAll(/(\d{1,2}:\d{2}(?:\s*(?:am|pm|ص|م))?)/gi)).map((m) =>
          normalizeExtracted24hTime(m[1])
        );
        const roomMatch = line.match(/\b((?:room|hall|lab|class|auditorium|قاعة|معمل|فصل)\s*[:#-]?\s*[A-Za-z0-9\u0600-\u06FF-]{1,15})/i);
        const topicsMatch = line.match(/(?:topics?|included\s+lessons?|lessons?|chapters?|units?|material|الدروس(?:\s+المقررة)?)\s*[:|-]\s*(.+)$/i);

        if (dateInfo) {
          let cleaned = line
            .replace(dateInfo.matched, ' ')
            .replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/gi, ' ')
            .replace(/\b(?:at|on|from|to)\b/gi, ' ');
          for (const tm of line.matchAll(/\d{1,2}:\d{2}(?:\s*(?:am|pm|ص|م))?/gi)) {
            cleaned = cleaned.replace(tm[0], ' ');
          }
          if (roomMatch?.[1]) cleaned = cleaned.replace(roomMatch[1], ' ');
          if (topicsMatch?.[0]) cleaned = cleaned.replace(topicsMatch[0], ' ');

          const examType = detectExamType(line, docDefaultType);
          const subjectRaw = cleaned
            .replace(/\b(?:monthly|mid-?term|final|quiz|practical|oral|exam|test|assessment|شهري|نصفي|نهائي|امتحان|اختبار)\b/gi, ' ')
            .replace(/^[\s|,:;–—-]+|[\s|,:;–—-]+$/g, '')
            .replace(/\s{2,}/g, ' ')
            .split(/\s*[|–—]\s*/)[0]
            ?.trim();

          if (subjectRaw && subjectRaw.length >= 2 && isCoherentExtractedText(subjectRaw)) {
            const topics = topicsMatch?.[1]
              ? topicsMatch[1]
                  .split(/[,،;]+/)
                  .map((t) => t.trim())
                  .filter((t) => t.length >= 2 && isCoherentExtractedText(t))
              : [];
            exams.push({
              subject: subjectRaw,
              date: dateInfo.date,
              startTime: timeMatches[0] || '',
              endTime: timeMatches[1] || '',
              room: roomMatch?.[1]?.trim() || '',
              type: examType,
              material: '',
              topics,
              notes: '',
            });
            currentSectionSubject = subjectRaw;
            currentSectionType = examType;
            continue;
          }
        }

        // Handle "Subject: lesson 1, lesson 2, lesson 3" or "Subject - Included Lessons:"
        const colonIdx = line.indexOf(':');
        if (colonIdx > 1 && colonIdx < 48) {
          const left = line
            .slice(0, colonIdx)
            .replace(/[-–—]\s*(included\s+lessons?|lessons?|topics?)$/i, '')
            .trim();
          const right = line.slice(colonIdx + 1).trim();
          const leftLooksLikeHeader = !/^(topics?|lessons?|included|material|notes|room|time|date)$/i.test(left);
          if (
            leftLooksLikeHeader &&
            left.length >= 2 &&
            left.length <= 45 &&
            isCoherentExtractedText(left)
          ) {
            currentSectionSubject = left;
            currentSectionType = detectExamType(left, docDefaultType);
            if (right && isCoherentExtractedText(right)) {
              const items = right
                .split(/[,،;]+/)
                .map((x) => x.trim())
                .filter((x) => x.length >= 2 && isCoherentExtractedText(x));
              for (const title of items) {
                lessons.push({
                  subject: currentSectionSubject,
                  title,
                  notes: '',
                  examType: currentSectionType,
                });
              }
            }
            continue;
          }
        }

        // Bulleted lesson under current subject heading
        if (currentSectionSubject && /^[-*•▪◦]\s+/.test(line)) {
          const title = line.replace(/^[-*•▪◦]+\s*/, '').trim();
          if (title.length >= 2 && isCoherentExtractedText(title)) {
            lessons.push({
              subject: currentSectionSubject,
              title,
              notes: '',
              examType: currentSectionType,
            });
          }
          continue;
        }

        if (
          inLessonsSection &&
          line.length > 1 &&
          line.length <= 45 &&
          !/[,،]/.test(line) &&
          isCoherentExtractedText(line)
        ) {
          currentSectionSubject = line.replace(/[:\-–—]+$/, '').trim();
          currentSectionType = detectExamType(line, docDefaultType);
        } else if (
          line.length > 0 &&
          line.length < 100 &&
          exams.length === 0 &&
          lessons.length === 0 &&
          isCoherentExtractedText(line)
        ) {
          ignored.push(line);
        }
      }
    }

    // If lessons matched existing calendar assessments and no exam entry was extracted for them, attach an exam update entry
    if (exams.length === 0 && lessons.length > 0 && existingExams.length > 0) {
      const grouped = new Map<string, { subject: string; date: string; type: string; topics: string[] }>();
      for (const ls of lessons) {
        const match = existingExams.find((ex) => scanSubjectsMatch(ex.subject, ls.subject));
        if (match && match.date) {
          const gKey = `${match.subject}|${match.date}|${match.type}`;
          const cur = grouped.get(gKey) || {
            subject: match.subject,
            date: match.date,
            type: match.type || 'monthly',
            topics: [],
          };
          if (!cur.topics.includes(ls.title)) cur.topics.push(ls.title);
          grouped.set(gKey, cur);
        }
      }
      for (const entry of grouped.values()) {
        exams.push({
          subject: entry.subject,
          date: entry.date,
          startTime: '',
          endTime: '',
          room: '',
          type: entry.type,
          material: '',
          topics: entry.topics,
          notes: '',
        });
      }
    }

    if (exams.length === 0 && lessons.length === 0) {
      return null;
    }

    return {
      exams,
      lessons,
      ignored: ignored.slice(0, 12),
    };
  }

  function parseScanJson(rawText: string) {
    let cleaned = String(rawText || '{}').trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      cleaned = fenceMatch[1].trim();
    }
    let parsed: {
      exams?: unknown[];
      lessons?: unknown[];
      ignored?: unknown[];
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } else {
        throw new SyntaxError('No JSON object found in scanner output');
      }
    }
    return {
      exams: Array.isArray(parsed?.exams) ? parsed.exams : [],
      lessons: Array.isArray(parsed?.lessons) ? parsed.lessons : [],
      ignored: Array.isArray(parsed?.ignored) ? parsed.ignored : [],
    };
  }

  function buildModelConfig(
    model: string,
    useSchema: boolean,
    thinkingOverride?: ThinkingLevel
  ) {
    const config: {
      thinkingConfig?: { thinkingLevel: ThinkingLevel };
      responseMimeType: string;
      responseSchema?: typeof SCAN_RESPONSE_SCHEMA;
    } = {
      responseMimeType: 'application/json',
    };
    if (model === 'gemini-4-hydrogen') {
      config.thinkingConfig = {
        thinkingLevel: thinkingOverride ?? ThinkingLevel.LOW,
      };
    } else if (model === 'gemini-3.1-flash-lite') {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.MEDIUM };
    }
    if (useSchema) {
      config.responseSchema = SCAN_RESPONSE_SCHEMA;
    }
    return config;
  }

  async function scanMediaPartWithModel(
    ai: GoogleGenAI,
    model: string,
    contentPart:
      | { inlineData: { mimeType: string; data: string } }
      | { fileData: { fileUri: string; mimeType: string } }
      | { text: string },
    pageContext: string | undefined,
    timeoutMs: number,
    options?: { maxRetries?: number; useSchema?: boolean }
  ) {
    const maxRetries = options?.maxRetries ?? 1;
    const useSchema = options?.useSchema ?? true;
    return callWithRetry(async () => {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: {
            parts: [
              contentPart,
              {
                text: buildExtractorPrompt(pageContext),
              },
            ],
          },
          config: buildModelConfig(model, useSchema),
        }),
        timeoutMs,
        'Document scan timed out while reading. Please try again.'
      );
      return parseScanJson(response.text ?? '{}');
    }, maxRetries);
  }

  async function scanMediaPart(
    ai: GoogleGenAI,
    mediaPart:
      | { inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string; mimeType: string }; text?: string },
    pageContext?: string
  ) {
    const cleanPart = mediaPart.fileData
      ? { fileData: mediaPart.fileData }
      : mediaPart.text
      ? { text: mediaPart.text }
      : { inlineData: mediaPart.inlineData! };

    let primaryErr: unknown = null;
    let primaryEmpty = false;
    if (!isModelOnCooldown('gemini-4-hydrogen')) {
      try {
        const res = await scanMediaPartWithModel(
          ai,
          'gemini-4-hydrogen',
          cleanPart,
          pageContext,
          32000,
          { maxRetries: 1, useSchema: true }
        );
        if (res.exams.length > 0 || res.lessons.length > 0) {
          return res;
        }
        primaryEmpty = true;
      } catch (err) {
        primaryErr = err;
        console.error('[scan] primary model failed:', extractErrorText(err).slice(0, 300));
        recordModelCooldownIfExhausted('gemini-4-hydrogen', err);
      }
    }

    try {
      const liteRes = await scanMediaPartWithModel(
        ai,
        'gemini-3.1-flash-lite',
        cleanPart,
        pageContext,
        42000,
        { maxRetries: 1, useSchema: true }
      );
      if (liteRes.exams.length > 0 || liteRes.lessons.length > 0) {
        return liteRes;
      }
      // Both returned empty with strict schema; try once without schema
      const schemaFallbackModel = isModelOnCooldown('gemini-4-hydrogen')
        ? 'gemini-3.1-flash-lite'
        : 'gemini-4-hydrogen';
      return await scanMediaPartWithModel(
        ai,
        schemaFallbackModel,
        cleanPart,
        pageContext,
        42000,
        { maxRetries: 0, useSchema: false }
      );
    } catch (liteErr) {
      console.error('[scan] fallback model failed:', extractErrorText(liteErr).slice(0, 300));
      recordModelCooldownIfExhausted('gemini-3.1-flash-lite', liteErr);
      if (isSchemaOrParseFailure(primaryErr) || isSchemaOrParseFailure(liteErr) || primaryEmpty) {
        const schemaFallbackModel = isModelOnCooldown('gemini-4-hydrogen')
          ? 'gemini-3.1-flash-lite'
          : 'gemini-4-hydrogen';
        return await scanMediaPartWithModel(
          ai,
          schemaFallbackModel,
          cleanPart,
          pageContext,
          42000,
          { maxRetries: 0, useSchema: false }
        );
      }
      if (isModelOnCooldown('gemini-4-hydrogen') || isDailyQuotaError(primaryErr)) {
        const liteMsg = extractErrorText(liteErr).toLowerCase();
        if (liteMsg.includes('503') || liteMsg.includes('unavailable') || liteMsg.includes('high demand')) {
          throw new Error(
            'Daily free AI scan quota (20 requests/day) is reached and the free backup model is temporarily busy. Please try again shortly or add exams manually.'
          );
        }
      }
      throw liteErr;
    }
  }

  app.post('/api/scan', async (req, res) => {
    const authUser = await resolveOrRehydrateUser(req);
    const workspaceHeader = req.header('x-workspace-id')?.trim();
    const hasWorkspace = Boolean(workspaceHeader && workspaceHeader !== 'default');
    if (!authUser && !hasWorkspace) {
      res.status(401).json({
        error: 'Please sign up or sign in first.',
      });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    const { mimeType, data } = req.body || {};
    if (!mimeType || !data || typeof data !== 'string') {
      res.status(400).json({ error: 'Missing document payload.' });
      return;
    }

    const cleanMime = String(mimeType).toLowerCase().trim();
    const allowedScanMimes = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
    ]);
    if (!allowedScanMimes.has(cleanMime) && !cleanMime.startsWith('text/')) {
      res.status(400).json({
        error: 'Unsupported file format. Please upload PDF, image (JPG, PNG, WEBP, HEIC), or plain text/CSV.',
      });
      return;
    }
    const fileHash = crypto.createHash('sha256').update(data).digest('hex');
    const cacheKey = `v3:${cleanMime}:${fileHash}`;

    const cached = getCachedScanResult(cacheKey);
    if (cached) {
      res.json({
        exams: cached.exams,
        lessons: cached.lessons,
        ignored: cached.ignored,
        totalPages: cached.totalPages,
      });
      return;
    }

    const runScan = async (): Promise<{
      exams: unknown[];
      lessons: unknown[];
      ignored: unknown[];
      totalPages?: number;
    }> => {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      if (cleanMime === 'application/pdf') {
        const pdfBytes = Buffer.from(data, 'base64');
        let totalPages = 0;
        try {
          const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
          totalPages = doc.getPageCount();
        } catch {
          totalPages = 0;
        }

        // Prefer Files API for very large PDFs (>14MB or >30 pages), using intact original PDF bytes
        let uploadedFileName: string | null = null;
        let filePart: { fileData: { fileUri: string; mimeType: string } } | null = null;
        const needsLargeUpload = pdfBytes.length > 14 * 1024 * 1024 || totalPages > 30;

        if (needsLargeUpload) {
          try {
            const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
            let uploaded = await withTimeout(
              ai.files.upload({
                file: pdfBlob,
                config: { mimeType: 'application/pdf' },
              }),
              25000,
              'File upload timed out.'
            );
            uploadedFileName = uploaded.name || null;
            for (let attempt = 0; attempt < 20 && uploaded.state === 'PROCESSING'; attempt++) {
              await new Promise((r) => setTimeout(r, 1000));
              if (uploaded.name) {
                uploaded = await withTimeout(
                  ai.files.get({ name: uploaded.name }),
                  10000,
                  'File status check timed out.'
                );
              }
            }
            if (uploaded.uri && (!uploaded.state || uploaded.state === 'ACTIVE')) {
              filePart = {
                fileData: {
                  fileUri: uploaded.uri,
                  mimeType: uploaded.mimeType || 'application/pdf',
                },
              };
            }
          } catch {
            filePart = null;
          }
        }

        try {
          const mediaPart = filePart ?? { inlineData: { mimeType: cleanMime, data } };

          // Single clean pass for standard PDFs (<= 30 pages) preserves full layout & context while conserving quota
          if (totalPages <= 30) {
            const result = await scanMediaPart(ai, mediaPart);
            return { ...result, totalPages: totalPages || undefined };
          }

          // Multi-page pass using the SAME intact PDF so page 1 headers/year stay visible to every batch
          const pagesPerPass = 25;
          const allExams: Record<string, unknown>[] = [];
          const allLessons: Record<string, unknown>[] = [];
          const allIgnored: string[] = [];
          const seenExamKeys = new Set<string>();
          const seenLessonKeys = new Set<string>();

          for (let start = 1; start <= totalPages; start += pagesPerPass) {
            const end = Math.min(start + pagesPerPass - 1, totalPages);
            const passResult = await scanMediaPart(
              ai,
              mediaPart,
              `pages ${start}–${end} (of ${totalPages} total pages)`
            );
            for (const ex of passResult.exams as Record<string, unknown>[]) {
              const key = `${String(ex?.subject || '').trim().toLowerCase()}|${String(ex?.date || '').trim()}|${String(ex?.startTime || '').trim()}|${String(ex?.type || '').trim()}`;
              if (!seenExamKeys.has(key)) {
                seenExamKeys.add(key);
                allExams.push(ex);
              }
            }
            for (const ls of passResult.lessons as Record<string, unknown>[]) {
              const key = `${String(ls?.subject || '').trim().toLowerCase()}|${String(ls?.title || '').trim().toLowerCase()}`;
              if (!seenLessonKeys.has(key)) {
                seenLessonKeys.add(key);
                allLessons.push(ls);
              }
            }
            for (const line of passResult.ignored) {
              if (typeof line === 'string' && line.trim()) {
                allIgnored.push(line.trim());
              }
            }
          }

          return {
            exams: allExams,
            lessons: allLessons,
            ignored: Array.from(new Set(allIgnored)),
            totalPages,
          };
        } finally {
          if (uploadedFileName) {
            ai.files.delete({ name: uploadedFileName }).catch(() => {});
          }
        }
      }

      if (cleanMime.startsWith('text/')) {
        const decodedText = Buffer.from(data, 'base64').toString('utf8').slice(0, 120000);
        return scanMediaPart(ai, {
          text: `DOCUMENT TEXT:\n${decodedText}`,
        });
      }

      return scanMediaPart(ai, {
        inlineData: { mimeType: cleanMime, data },
      });
    };

    const runWithDeterministicFallback = async () => {
      try {
        return await runScan();
      } catch (err) {
        const status = getScanHttpStatus(err);
        if (status === 429 || status === 503) {
          let readableText = '';
          if (cleanMime.startsWith('text/')) {
            readableText = Buffer.from(data, 'base64').toString('utf8').slice(0, 120000);
          } else if (cleanMime === 'application/pdf') {
            readableText = extractReadableTextFromPdfBuffer(Buffer.from(data, 'base64'));
          }
          if (readableText.trim()) {
            const parsed = parseDeterministicScheduleDocuments(
              [{ name: String(req.body?.name || 'document'), text: readableText }],
              'all'
            );
            if (parsed) return parsed;
          }
        }
        throw err;
      }
    };

    let scanPromise = inFlightScans.get(cacheKey);
    if (!scanPromise) {
      scanPromise = runWithDeterministicFallback()
        .then((result) => normalizeExtractedScanData(result, 'all'))
        .then((result) => {
          setCachedScanResult(cacheKey, result);
          return result;
        })
        .finally(() => {
          inFlightScans.delete(cacheKey);
        });
      inFlightScans.set(cacheKey, scanPromise);
    }

    try {
      const result = await scanPromise;
      res.json(result);
    } catch (err: unknown) {
      const status = getScanHttpStatus(err);
      if (status === 429 || status === 503) {
        console.warn('[scan] upstream unavailable:', extractErrorText(err).slice(0, 220));
      } else {
        console.error('[scan] route error:', extractErrorText(err).slice(0, 300));
      }
      res.status(status).json({
        error: formatScanErrorMessage(err, 'Failed to scan document. Please try again.'),
      });
    }
  });

  // Correlated Multi-File Scanner: connects schedules + syllabi across multiple uploaded files in one Gemini pass
  app.post('/api/scan-correlated', async (req, res) => {
    const authUser = await resolveOrRehydrateUser(req);
    const workspaceHeader = req.header('x-workspace-id')?.trim();
    const hasWorkspace = Boolean(workspaceHeader && workspaceHeader !== 'default');
    if (!authUser && !hasWorkspace) {
      res.status(401).json({
        error: 'Please sign up or sign in first.',
      });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
    if (rawFiles.length === 0) {
      res.status(400).json({ error: 'Attach at least one file to scan.' });
      return;
    }

    const files = rawFiles
      .slice(0, 12)
      .filter(
        (f: unknown): f is { name?: string; mimeType: string; data: string } =>
          Boolean(
            f &&
              typeof f === 'object' &&
              typeof (f as { mimeType?: unknown }).mimeType === 'string' &&
              typeof (f as { data?: unknown }).data === 'string' &&
              (f as { data: string }).data.trim().length > 0
          )
      );

    if (files.length === 0) {
      res.status(400).json({ error: 'Missing valid file payloads.' });
      return;
    }

    const allowedCorrelatedImageMimes = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
    ]);
    for (const f of files) {
      const m = String(f.mimeType).toLowerCase().trim();
      if (!allowedCorrelatedImageMimes.has(m) && !m.startsWith('text/')) {
        res.status(400).json({
          error: `Unsupported file format (${f.name || m}). Please upload PDF, image (JPG, PNG, WEBP, HEIC), or plain text/CSV.`,
        });
        return;
      }
    }

    const rawExistingExams: unknown[] = Array.isArray(req.body?.existingExams)
      ? req.body.existingExams
      : [];
    const existingExams: Array<{ subject: string; date: string; type: string }> = rawExistingExams
      .slice(0, 40)
      .filter(
        (ex: unknown): ex is { subject?: unknown; date?: unknown; type?: unknown } =>
          Boolean(ex && typeof ex === 'object' && typeof (ex as { subject?: unknown }).subject === 'string')
      )
      .map((ex: { subject?: unknown; date?: unknown; type?: unknown }) => ({
        subject: String(ex.subject || '').trim().slice(0, 100),
        date: normalizeExtractedIsoDate(ex.date),
        type: String(ex.type || 'monthly').toLowerCase().trim(),
      }))
      .filter((ex: { subject: string }) => Boolean(ex.subject));

    const hash = crypto.createHash('sha256');
    for (const f of files) {
      hash.update(String(f.name || '')).update('|').update(f.mimeType).update('|').update(f.data);
    }
    if (existingExams.length > 0) {
      const sortedContext = existingExams
        .map((e) => `${e.subject}|${e.date}|${e.type}`)
        .sort()
        .join(';');
      hash.update('||existing||').update(sortedContext);
    }
    const cacheKey = `v3:correlated:${hash.digest('hex')}`;

    const cached = getCachedScanResult(cacheKey);
    if (cached) {
      res.json({
        exams: cached.exams,
        lessons: cached.lessons,
        ignored: cached.ignored,
        totalPages: cached.totalPages,
      });
      return;
    }

    const runCorrelatedScan = async () => {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const uploadedFileNames: string[] = [];
      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
        | { fileData: { fileUri: string; mimeType: string } }
      > = [];

      try {
        let totalInlineBytes = 0;
        let totalPdfPages = 0;

        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const safeName = String(f.name || `Document ${i + 1}`).trim().slice(0, 120);
          const cleanMime = String(f.mimeType).trim();

          if (cleanMime.startsWith('text/')) {
            const decodedText = Buffer.from(f.data, 'base64').toString('utf8').slice(0, 90000);
            parts.push({
              text: `--- FILE ${i + 1}: ${safeName} (TEXT) ---\n${decodedText}`,
            });
          } else if (cleanMime === 'application/pdf') {
            const pdfBytes = Buffer.from(f.data, 'base64');
            let pageCount = 0;
            try {
              const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
              pageCount = doc.getPageCount();
              totalPdfPages += pageCount;
            } catch {
              pageCount = 0;
            }
            parts.push({
              text: `--- FILE ${i + 1}: ${safeName} (PDF${pageCount > 0 ? `, ${pageCount} pages` : ''}) ---`,
            });
            let usedFilesApi = false;
            const shouldUploadViaFilesApi =
              pdfBytes.length > 6 * 1024 * 1024 ||
              pageCount > 20 ||
              totalInlineBytes + pdfBytes.length > 12 * 1024 * 1024;
            if (shouldUploadViaFilesApi) {
              try {
                const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                let uploaded = await withTimeout(
                  ai.files.upload({
                    file: pdfBlob,
                    config: { mimeType: 'application/pdf' },
                  }),
                  25000,
                  'File upload timed out.'
                );
                if (uploaded.name) uploadedFileNames.push(uploaded.name);
                for (let attempt = 0; attempt < 20 && uploaded.state === 'PROCESSING'; attempt++) {
                  await new Promise((r) => setTimeout(r, 1000));
                  if (uploaded.name) {
                    uploaded = await withTimeout(
                      ai.files.get({ name: uploaded.name }),
                      10000,
                      'File status check timed out.'
                    );
                  }
                }
                if (uploaded.uri && (!uploaded.state || uploaded.state === 'ACTIVE')) {
                  parts.push({
                    fileData: {
                      fileUri: uploaded.uri,
                      mimeType: uploaded.mimeType || 'application/pdf',
                    },
                  });
                  usedFilesApi = true;
                }
              } catch {
                usedFilesApi = false;
              }
            }
            if (!usedFilesApi) {
              totalInlineBytes += pdfBytes.length;
              parts.push({ inlineData: { mimeType: 'application/pdf', data: f.data } });
            }
          } else {
            const imgBytesLen = Math.floor((f.data.length * 3) / 4);
            parts.push({ text: `--- FILE ${i + 1}: ${safeName} (IMAGE) ---` });
            let usedFilesApi = false;
            if (imgBytesLen > 5 * 1024 * 1024 || totalInlineBytes + imgBytesLen > 12 * 1024 * 1024) {
              try {
                const imgBuf = Buffer.from(f.data, 'base64');
                const imgBlob = new Blob([imgBuf], { type: cleanMime });
                let uploaded = await withTimeout(
                  ai.files.upload({
                    file: imgBlob,
                    config: { mimeType: cleanMime },
                  }),
                  20000,
                  'Image upload timed out.'
                );
                if (uploaded.name) uploadedFileNames.push(uploaded.name);
                for (let attempt = 0; attempt < 15 && uploaded.state === 'PROCESSING'; attempt++) {
                  await new Promise((r) => setTimeout(r, 800));
                  if (uploaded.name) {
                    uploaded = await withTimeout(
                      ai.files.get({ name: uploaded.name }),
                      8000,
                      'Image status check timed out.'
                    );
                  }
                }
                if (uploaded.uri && (!uploaded.state || uploaded.state === 'ACTIVE')) {
                  parts.push({
                    fileData: {
                      fileUri: uploaded.uri,
                      mimeType: uploaded.mimeType || cleanMime,
                    },
                  });
                  usedFilesApi = true;
                }
              } catch {
                usedFilesApi = false;
              }
            }
            if (!usedFilesApi) {
              totalInlineBytes += imgBytesLen;
              parts.push({ inlineData: { mimeType: cleanMime, data: f.data } });
            }
          }
        }

        const existingExamsContext =
          existingExams.length > 0
            ? `\n- EXISTING STUDENT CALENDAR ASSESSMENTS (match syllabus/included-lesson sheets to these exact subjects, dates, and types whenever a sheet omits dates; treat course variants like "English AL" and "English AL A" as the SAME subject and reuse the saved subject spelling below):\n${existingExams
                .map((e) => `  * ${e.subject} | ${e.type}${e.date ? ` | ${e.date}` : ''}`)
                .join('\n')}`
            : '';

        const correlationInstruction = `${buildExtractorPrompt()}

CORRELATED MONTHLY / MID-TERM / FINAL EXAM SCANNER INSTRUCTIONS:
You have been given ${files.length} uploaded file(s) above as ONE connected academic packet for the student's Monthly, Mid-Term & Final Exams calendar.
- Read EVERY page of EVERY uploaded file carefully${totalPdfPages > 0 ? ` (${totalPdfPages} total PDF pages across attachments)` : ''}.
- Cross-reference subjects, assessment periods (monthly / midterm / final), dates, rooms, and included lessons/chapters ACROSS ALL FILES together. Treat subject aliases like "English AL" and "English AL A" as the same subject.
- If one file contains exam dates/times/rooms (e.g. a monthly/midterm/final timetable) and another file contains covered lessons, chapters, textbook pages, or syllabus distribution for the SAME subject/exam, MERGE them into ONE complete exam entry in "exams" with the date/time/room PLUS the combined "material" and ONLY that exam's included "topics".
- If a file only lists included lessons/topics for an assessment (without exam dates), match it against any existing assessment listed below (or extract those lessons into "lessons" with the matching "subject" and "examType" plus an "exams" entry carrying the matched existing date/type and ONLY that exam's included "topics") so included lessons attach directly to the student's exam cards.
- Classify monthly tests/exams ("Monthly", "اختبار شهري", "امتحان شهري", "شهر", "تقويم شهري", month-named tests) as type "monthly", mid-semester as "midterm", and end-of-term as "final". If an exam in this assessments packet has no explicit label, classify it as "monthly" unless it is clearly midterm or final.
- Also extract EVERY lesson, chapter, unit, or topic covered across all files into the "lessons" checklist array with matching "subject", concise "title", "examType" (monthly/midterm/final if clear), and optional "notes" so the student's Study Centre checklist connects directly to every assessment.${existingExamsContext}`;

        parts.push({ text: correlationInstruction });

        const invokeModel = async (
          model: string,
          timeoutMs: number,
          options?: { maxRetries?: number; useSchema?: boolean }
        ) =>
          callWithRetry(async () => {
            const response = await withTimeout(
              ai.models.generateContent({
                model,
                contents: { parts },
                config: buildModelConfig(
                  model,
                  options?.useSchema ?? true,
                  ThinkingLevel.MEDIUM
                ),
              }),
              timeoutMs,
              'Correlated scan timed out while connecting files. Please try again.'
            );
            const parsed = parseScanJson(response.text ?? '{}');
            return {
              ...parsed,
              ...(totalPdfPages > 0 ? { totalPages: totalPdfPages } : {}),
            };
          }, options?.maxRetries ?? 1);

        let primaryErr: unknown = null;
        let primaryEmpty = false;
        if (!isModelOnCooldown('gemini-4-hydrogen')) {
          try {
            const res = await invokeModel('gemini-4-hydrogen', 42000, {
              maxRetries: 1,
              useSchema: true,
            });
            if (res.exams.length > 0 || res.lessons.length > 0) {
              return res;
            }
            primaryEmpty = true;
          } catch (err) {
            primaryErr = err;
            console.error('[scan-correlated] primary model failed:', extractErrorText(err).slice(0, 300));
            recordModelCooldownIfExhausted('gemini-4-hydrogen', err);
          }
        }

        try {
          const liteRes = await invokeModel('gemini-3.1-flash-lite', 45000, {
            maxRetries: 1,
            useSchema: true,
          });
          if (liteRes.exams.length > 0 || liteRes.lessons.length > 0) {
            return liteRes;
          }
          const schemaFallbackModel = isModelOnCooldown('gemini-4-hydrogen')
            ? 'gemini-3.1-flash-lite'
            : 'gemini-4-hydrogen';
          return await invokeModel(schemaFallbackModel, 45000, {
            maxRetries: 0,
            useSchema: false,
          });
        } catch (liteErr) {
          console.error('[scan-correlated] fallback model failed:', extractErrorText(liteErr).slice(0, 300));
          recordModelCooldownIfExhausted('gemini-3.1-flash-lite', liteErr);
          if (isSchemaOrParseFailure(primaryErr) || isSchemaOrParseFailure(liteErr) || primaryEmpty) {
            const schemaFallbackModel = isModelOnCooldown('gemini-4-hydrogen')
              ? 'gemini-3.1-flash-lite'
              : 'gemini-4-hydrogen';
            return await invokeModel(schemaFallbackModel, 45000, {
              maxRetries: 0,
              useSchema: false,
            });
          }
          if (isModelOnCooldown('gemini-4-hydrogen') || isDailyQuotaError(primaryErr)) {
            const liteMsg = extractErrorText(liteErr).toLowerCase();
            if (liteMsg.includes('503') || liteMsg.includes('unavailable') || liteMsg.includes('high demand')) {
              throw new Error(
                'Daily free AI scan quota (20 requests/day) is reached and the free backup model is temporarily busy. Please try again shortly or add exams manually.'
              );
            }
          }
          throw liteErr;
        }
      } finally {
        for (const fname of uploadedFileNames) {
          ai.files.delete({ name: fname }).catch(() => {});
        }
      }
    };

    const runCorrelatedWithFallback = async () => {
      try {
        return await runCorrelatedScan();
      } catch (err) {
        const status = getScanHttpStatus(err);
        if (status === 429 || status === 503) {
          const textDocs: Array<{ name: string; text: string }> = [];
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const cleanMime = String(f.mimeType).toLowerCase().trim();
            const safeName = String(f.name || `Document ${i + 1}`).trim();
            if (cleanMime.startsWith('text/')) {
              const decoded = Buffer.from(f.data, 'base64').toString('utf8').slice(0, 90000);
              if (decoded.trim()) textDocs.push({ name: safeName, text: decoded });
            } else if (cleanMime === 'application/pdf') {
              const extracted = extractReadableTextFromPdfBuffer(Buffer.from(f.data, 'base64'));
              if (extracted.trim()) textDocs.push({ name: safeName, text: extracted });
            }
          }
          if (textDocs.length > 0) {
            const parsed = parseDeterministicScheduleDocuments(textDocs, 'assessments', existingExams);
            if (parsed) return parsed;
          }
        }
        throw err;
      }
    };

    let scanPromise = inFlightScans.get(cacheKey);
    if (!scanPromise) {
      scanPromise = runCorrelatedWithFallback()
        .then((result) => normalizeExtractedScanData(result, 'assessments'))
        .then((result) => {
          setCachedScanResult(cacheKey, result);
          return result;
        })
        .finally(() => {
          inFlightScans.delete(cacheKey);
        });
      inFlightScans.set(cacheKey, scanPromise);
    }

    try {
      const result = await scanPromise;
      res.json(result);
    } catch (err: unknown) {
      const status = getScanHttpStatus(err);
      if (status === 429 || status === 503) {
        console.warn('[scan-correlated] upstream unavailable:', extractErrorText(err).slice(0, 220));
      } else {
        console.error('[scan-correlated] route error:', extractErrorText(err).slice(0, 300));
      }
      res.status(status).json({
        error: formatScanErrorMessage(
          err,
          'Could not connect and read those files right now. Please try again.'
        ),
      });
    }
  });

  // Safe image CORS proxy for song poster color extraction & clean preview loading
  app.get('/api/image-proxy', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl.startsWith('https://')) {
      res.status(400).end();
      return;
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      res.status(400).end();
      return;
    }
    const allowedHost =
      /(?:^|\.)(scdn\.co|spotifycdn\.com|googleusercontent\.com|ggpht\.com|ytimg\.com)$/i.test(
        parsedUrl.hostname
      );
    if (!allowedHost) {
      res.status(403).end();
      return;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const upstream = await fetch(parsedUrl.toString(), {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'ExaminerApp/1.0' },
      });
      clearTimeout(timer);
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }
      const ctype = upstream.headers.get('content-type') || 'image/jpeg';
      if (!ctype.startsWith('image/')) {
        res.status(415).end();
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > 6 * 1024 * 1024) {
        res.status(413).end();
        return;
      }
      res.setHeader('Content-Type', ctype);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch {
      res.status(502).end();
    }
  });

  // Private Chats with Secret Codes & Exam-Only Sharing
  const userSockets = new Map<string, Set<WebSocket>>();

  function registerUserSocket(userId: string, ws: WebSocket) {
    let set = userSockets.get(userId);
    if (!set) {
      set = new Set();
      userSockets.set(userId, set);
    }
    set.add(ws);
  }

  function unregisterUserSocket(userId: string, ws: WebSocket) {
    const set = userSockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) userSockets.delete(userId);
  }

  function broadcastChatRoom(chat: StoredPrivateChat, eventType = 'chat:updated') {
    const payload = JSON.stringify({ type: eventType, chat });
    for (const member of chat.members) {
      const sockets = userSockets.get(member.userId);
      if (!sockets) continue;
      for (const client of sockets) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(payload);
          } catch {
            // Ignore closed socket errors
          }
        }
      }
    }
  }

  function generateSecretCode(existingCodes: Set<string>): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let attempt = 0; attempt < 30; attempt++) {
      let part = '';
      for (let i = 0; i < 6; i++) {
        part += chars[Math.floor(Math.random() * chars.length)];
      }
      const code = `EXM-${part}`;
      if (!existingCodes.has(code)) return code;
    }
    return `EXM-${Date.now().toString(36).slice(-6).toUpperCase()}`;
  }

  function sanitizeChatTheme(raw: unknown): StoredChatTheme {
    if (!raw || typeof raw !== 'object') {
      return { mode: 'default' };
    }
    const obj = raw as Record<string, unknown>;
    if (obj.mode === 'theme' && typeof obj.themeId === 'string') {
      const cleanId = obj.themeId.trim();
      if (VALID_THEMES.has(cleanId)) {
        return {
          mode: 'theme',
          themeId: cleanId,
        };
      }
    }
    return { mode: 'default' };
  }

  app.get('/api/chats', (req, res) => {
    const authUser = getAuthenticatedUser(req);
    const userId = authUser?.id || getWorkspaceId(req);
    const all = readJsonFile<StoredPrivateChat[]>(CHATS_FILE, []);
    const mine = all
      .filter((c) => c.members.some((m) => m.userId === userId))
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
    res.json({ chats: mine });
  });

  app.post('/api/chats', (req, res) => {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Please sign in first.' });
      return;
    }

    const schoolName = String(req.body?.schoolName || '').trim().slice(0, 120);
    const grade = String(req.body?.grade || '').trim().slice(0, 80);
    const className = String(req.body?.className || '').trim().slice(0, 80);
    const rawGroupName = String(req.body?.groupName || '').trim().slice(0, 120);

    if (!schoolName) {
      res.status(400).json({ error: 'Enter the school name.' });
      return;
    }
    if (!grade) {
      res.status(400).json({ error: 'Enter the grade.' });
      return;
    }

    const groupName = rawGroupName || grade;
    const avatarImage =
      typeof req.body?.avatarImage === 'string' && req.body.avatarImage.startsWith('data:image/')
        ? req.body.avatarImage
        : undefined;
    const backgroundMusic =
      req.body?.backgroundMusic && typeof req.body.backgroundMusic === 'object'
        ? (req.body.backgroundMusic as Record<string, unknown>)
        : null;
    const theme = sanitizeChatTheme(req.body?.theme);

    const all = readJsonFile<StoredPrivateChat[]>(CHATS_FILE, []);
    const existingCodes = new Set(all.map((c) => c.secretCode.toUpperCase()));
    const secretCode = generateSecretCode(existingCodes);
    const nowIso = new Date().toISOString();
    const chatId = createId('chat');

    const chat: StoredPrivateChat = {
      id: chatId,
      secretCode,
      groupName,
      schoolName,
      grade,
      className,
      avatarImage,
      backgroundMusic,
      theme,
      ownerId: authUser.id,
      members: [
        {
          userId: authUser.id,
          displayName: authUser.displayName || authUser.email.split('@')[0],
          email: authUser.email,
          avatar: authUser.avatar,
          role: 'owner',
          joinedAt: nowIso,
        },
      ],
      messages: [
        {
          id: createId('msg'),
          chatId,
          senderId: authUser.id,
          senderName: authUser.displayName || authUser.email.split('@')[0],
          kind: 'system',
          text: `${authUser.displayName || 'Creator'} created "${groupName}" · Secret code: ${secretCode}`,
          createdAt: nowIso,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    all.unshift(chat);
    writeJsonFile(CHATS_FILE, all);
    broadcastChatRoom(chat, 'chat:created');
    res.status(201).json({ chat });
  });

  app.post('/api/chats/join', (req, res) => {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Please sign in first.' });
      return;
    }

    const rawCode = String(req.body?.secretCode || '').trim().toUpperCase();
    const compactCode = rawCode.replace(/[^A-Z0-9]/g, '');
    if (!compactCode) {
      res.status(400).json({ error: 'Enter the secret chat code.' });
      return;
    }

    const all = readJsonFile<StoredPrivateChat[]>(CHATS_FILE, []);
    const idx = all.findIndex((c) => {
      const candidate = c.secretCode.toUpperCase();
      return candidate === rawCode || candidate.replace(/[^A-Z0-9]/g, '') === compactCode;
    });

    if (idx === -1) {
      res.status(404).json({ error: 'No private chat found with that secret code.' });
      return;
    }

    const chat = all[idx];
    const alreadyMember = chat.members.some((m) => m.userId === authUser.id);
    if (!alreadyMember) {
      const nowIso = new Date().toISOString();
      chat.members.push({
        userId: authUser.id,
        displayName: authUser.displayName || authUser.email.split('@')[0],
        email: authUser.email,
        avatar: authUser.avatar,
        role: 'member',
        joinedAt: nowIso,
      });
      chat.messages.push({
        id: createId('msg'),
        chatId: chat.id,
        senderId: authUser.id,
        senderName: authUser.displayName || authUser.email.split('@')[0],
        kind: 'system',
        text: `${authUser.displayName || authUser.email.split('@')[0]} joined with secret code.`,
        createdAt: nowIso,
      });
      chat.updatedAt = nowIso;
      writeJsonFile(CHATS_FILE, all);
      broadcastChatRoom(chat);
    }

    res.json({ chat });
  });

  app.patch('/api/chats/:id', (req, res) => {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Please sign in first.' });
      return;
    }

    const all = readJsonFile<StoredPrivateChat[]>(CHATS_FILE, []);
    const idx = all.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Private chat not found.' });
      return;
    }
    const chat = all[idx];
    if (!chat.members.some((m) => m.userId === authUser.id)) {
      res.status(403).json({ error: 'You are not a member of this chat.' });
      return;
    }

    if (typeof req.body?.schoolName === 'string' && req.body.schoolName.trim()) {
      chat.schoolName = req.body.schoolName.trim().slice(0, 120);
    }
    if (typeof req.body?.grade === 'string' && req.body.grade.trim()) {
      chat.grade = req.body.grade.trim().slice(0, 80);
    }
    if (typeof req.body?.className === 'string') {
      chat.className = req.body.className.trim().slice(0, 80);
    }
    if (typeof req.body?.groupName === 'string') {
      chat.groupName = req.body.groupName.trim().slice(0, 120) || chat.grade;
    }
    if (req.body?.avatarImage === null) {
      chat.avatarImage = undefined;
    } else if (
      typeof req.body?.avatarImage === 'string' &&
      req.body.avatarImage.startsWith('data:image/')
    ) {
      chat.avatarImage = req.body.avatarImage;
    }
    if ('backgroundMusic' in (req.body || {})) {
      chat.backgroundMusic =
        req.body.backgroundMusic && typeof req.body.backgroundMusic === 'object'
          ? (req.body.backgroundMusic as Record<string, unknown>)
          : null;
    }
    if (req.body?.theme && typeof req.body.theme === 'object') {
      chat.theme = sanitizeChatTheme(req.body.theme);
    }
    if (req.body?.regenerateCode === true) {
      const existingCodes = new Set(all.map((c) => c.secretCode.toUpperCase()));
      chat.secretCode = generateSecretCode(existingCodes);
    }

    chat.updatedAt = new Date().toISOString();
    writeJsonFile(CHATS_FILE, all);
    broadcastChatRoom(chat);
    res.json({ chat });
  });

  app.post('/api/chats/:id/leave', (req, res) => {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Please sign in first.' });
      return;
    }

    const all = readJsonFile<StoredPrivateChat[]>(CHATS_FILE, []);
    const idx = all.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Private chat not found.' });
      return;
    }
    const chat = all[idx];
    const remaining = chat.members.filter((m) => m.userId !== authUser.id);
    if (remaining.length === 0) {
      all.splice(idx, 1);
      writeJsonFile(CHATS_FILE, all);
      res.json({ ok: true, deleted: true });
      return;
    }
    chat.members = remaining;
    if (chat.ownerId === authUser.id) {
      chat.ownerId = remaining[0].userId;
      remaining[0].role = 'owner';
    }
    chat.updatedAt = new Date().toISOString();
    writeJsonFile(CHATS_FILE, all);
    broadcastChatRoom(chat);
    res.json({ ok: true, deleted: false });
  });

  app.post('/api/chats/:id/messages', (req, res) => {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Please sign in first.' });
      return;
    }

    const all = readJsonFile<StoredPrivateChat[]>(CHATS_FILE, []);
    const idx = all.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Private chat not found.' });
      return;
    }
    const chat = all[idx];
    if (!chat.members.some((m) => m.userId === authUser.id)) {
      res.status(403).json({ error: 'You are not a member of this chat.' });
      return;
    }

    const kind = req.body?.kind === 'exam' ? 'exam' : 'text';
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    const nowIso = new Date().toISOString();

    if (kind !== 'exam') {
      res.status(400).json({
        error: 'Private groups are for sharing exams only. Text messages are disabled.',
      });
      return;
    }

    const cleanExam = sanitizeExamPayload((req.body?.exam || {}) as Record<string, unknown>);
    if (!cleanExam.subject) {
      res.status(400).json({ error: 'Give the exam a subject name.' });
      return;
    }
    if (!cleanExam.date) {
      res.status(400).json({ error: 'Pick the exam date.' });
      return;
    }

    const msg: StoredChatMessage = {
      id: createId('msg'),
      chatId: chat.id,
      senderId: authUser.id,
      senderName: authUser.displayName || authUser.email.split('@')[0],
      senderAvatar: authUser.avatar,
      kind: 'exam',
      text: text || `Shared exam: ${cleanExam.subject}`,
      exam: cleanExam,
      decisions: {},
      createdAt: nowIso,
    };
    chat.messages.push(msg);
    chat.updatedAt = nowIso;
    writeJsonFile(CHATS_FILE, all);
    broadcastChatRoom(chat);
    res.status(201).json({ chat, message: msg });
  });

  app.post('/api/chats/:id/messages/:messageId/respond', (req, res) => {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Please sign in first.' });
      return;
    }

    const decision =
      req.body?.decision === 'accepted'
        ? 'accepted'
        : req.body?.decision === 'refused'
        ? 'refused'
        : null;
    if (!decision) {
      res.status(400).json({ error: 'Decision must be accepted or refused.' });
      return;
    }

    const all = readJsonFile<StoredPrivateChat[]>(CHATS_FILE, []);
    const idx = all.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Private chat not found.' });
      return;
    }
    const chat = all[idx];
    if (!chat.members.some((m) => m.userId === authUser.id)) {
      res.status(403).json({ error: 'You are not a member of this chat.' });
      return;
    }

    const msg = chat.messages.find((m) => m.id === req.params.messageId && m.kind === 'exam');
    if (!msg || !msg.exam) {
      res.status(404).json({ error: 'Shared exam message not found.' });
      return;
    }

    if (!msg.decisions) msg.decisions = {};
    msg.decisions[authUser.id] = decision;

    let addedExam: StoredExam | null = null;
    if (decision === 'accepted') {
      const exams = readJsonFile<StoredExam[]>(EXAMS_FILE, []);
      const sourceChatKey = `${chat.id}:${msg.id}`;
      const existing = exams.find(
        (ex) => ex.workspaceId === authUser.id && ex.sourceChatKey === sourceChatKey
      );
      if (existing) {
        addedExam = existing;
      } else {
        addedExam = {
          id: createId('ex'),
          workspaceId: authUser.id,
          ...msg.exam,
          sourceChatKey,
          createdAt: new Date().toISOString(),
        };
        exams.push(addedExam);
        writeJsonFile(EXAMS_FILE, exams);
      }
    }

    chat.updatedAt = new Date().toISOString();
    writeJsonFile(CHATS_FILE, all);
    broadcastChatRoom(chat);
    res.json({ chat, addedExam });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/chats' });

  wss.on('connection', (ws, req) => {
    try {
      const cookies = parseCookies(req);
      const cookieUserId = verifySessionToken(cookies[SESSION_COOKIE]);
      const urlObj = new URL(req.url || '/ws/chats', `http://${req.headers.host || 'localhost'}`);
      const queryUserId = urlObj.searchParams.get('userId')?.trim() || '';
      const userId = cookieUserId || queryUserId;

      if (!userId) {
        ws.close(1008, 'Missing user session');
        return;
      }

      registerUserSocket(userId, ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw || '{}')) as { type?: string };
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore malformed WS frames
      }
    });

      ws.on('close', () => {
        unregisterUserSocket(userId, ws);
      });
    } catch {
      ws.close();
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Examiner server listening on http://localhost:${PORT}`);
  });
}

createServer();
