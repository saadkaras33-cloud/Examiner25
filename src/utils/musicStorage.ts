import type { SavedMusicTrack } from '../types.ts';

const DB_NAME = 'examiner_audio_db';
const DB_VERSION = 1;
const STORE_NAME = 'local_tracks';

const SPOTIFY_CACHE_PREFIX = 'examiner_saved_music_';
const SPLIT_URL_PREFIX = 'examiner_spotify_split_url_';

export const DEFAULT_SPOTIFY_EMBED_URL =
  'https://open.spotify.com/embed/playlist/37i9dQZF1DX8Uebhn9wzrS?utm_source=generator';

export interface StoredLocalAudioRecord {
  id: string;
  workspaceId: string;
  title: string;
  subtitle: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open audio database'));
  });
}

export async function saveLocalAudioTrack(record: StoredLocalAudioRecord): Promise<void> {
  try {
    const db = await openAudioDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save audio track'));
    });
    db.close();
  } catch {
    // Fallback silently if storage quota or IndexedDB is unavailable
  }
}

export async function loadAllLocalAudioTracks(
  workspaceId: string
): Promise<StoredLocalAudioRecord[]> {
  try {
    const db = await openAudioDb();
    const records = await new Promise<StoredLocalAudioRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('workspaceId');
      const req = index.getAll(workspaceId);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error('Could not load saved audio tracks'));
    });
    db.close();
    return records.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function deleteLocalAudioTrack(id: string): Promise<void> {
  try {
    const db = await openAudioDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not remove audio track'));
    });
    db.close();
  } catch {
    // Ignore cleanup errors
  }
}

export function getSavedSpotifyTracks(workspaceId: string): SavedMusicTrack[] {
  try {
    const raw = localStorage.getItem(`${SPOTIFY_CACHE_PREFIX}${workspaceId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setSavedSpotifyTracks(workspaceId: string, tracks: SavedMusicTrack[]): void {
  try {
    localStorage.setItem(`${SPOTIFY_CACHE_PREFIX}${workspaceId}`, JSON.stringify(tracks));
  } catch {
    // Ignore storage errors
  }
}

export function getSavedSpotifySplitUrl(workspaceId: string): string {
  try {
    return localStorage.getItem(`${SPLIT_URL_PREFIX}${workspaceId}`) || DEFAULT_SPOTIFY_EMBED_URL;
  } catch {
    return DEFAULT_SPOTIFY_EMBED_URL;
  }
}

export function setSavedSpotifySplitUrl(workspaceId: string, url: string): void {
  try {
    localStorage.setItem(`${SPLIT_URL_PREFIX}${workspaceId}`, url);
  } catch {
    // Ignore storage errors
  }
}
