import type { Media, SavedProject } from "./types";

const DB_NAME = "mediapark-studio";
const MEDIA = "media";
const PROJECT = "project";

type StoredMedia = Omit<Media, "url">;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is not available"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PROJECT)) db.createObjectStore(PROJECT);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(request?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Storage was blocked")); };
  });
}

export async function saveMedia(media: Media): Promise<void> {
  const { url: _url, ...stored } = media;
  void _url;
  await run(MEDIA, "readwrite", (s) => s.put(stored));
}

export async function deleteMedia(id: string): Promise<void> {
  await run(MEDIA, "readwrite", (s) => s.delete(id));
}

export async function saveProject(saved: SavedProject): Promise<void> {
  await run(PROJECT, "readwrite", (s) => s.put(saved, "current"));
}

export async function loadAll(): Promise<{ media: StoredMedia[]; project: SavedProject | null } | null> {
  try {
    const media = (await run<StoredMedia[]>(MEDIA, "readonly", (s) => s.getAll())) ?? [];
    const project = (await run<SavedProject>(PROJECT, "readonly", (s) => s.get("current"))) ?? null;
    return { media, project };
  } catch {
    return null;
  }
}

export async function clearAll(): Promise<void> {
  await run(MEDIA, "readwrite", (s) => s.clear());
  await run(PROJECT, "readwrite", (s) => s.clear());
}
