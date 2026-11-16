import type { SavedAudio } from "./types";

const DB_NAME = "mediapark-audio";
const FILES = "files";
const PROJECT = "project";

export type StoredFile = { id: string; name: string; blob: Blob };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is not available"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PROJECT)) db.createObjectStore(PROJECT);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Storage was blocked")); };
  });
}

export const saveFile = (file: StoredFile) => run(FILES, "readwrite", (s) => s.put(file)).then(() => undefined);
export const deleteFile = (id: string) => run(FILES, "readwrite", (s) => s.delete(id)).then(() => undefined);
export const saveAudioProject = (saved: SavedAudio) => run(PROJECT, "readwrite", (s) => s.put(saved, "current")).then(() => undefined);

export async function loadAudio(): Promise<{ files: StoredFile[]; project: SavedAudio | null } | null> {
  try {
    const files = (await run<StoredFile[]>(FILES, "readonly", (s) => s.getAll())) ?? [];
    const project = (await run<SavedAudio>(PROJECT, "readonly", (s) => s.get("current"))) ?? null;
    return { files, project };
  } catch {
    return null;
  }
}

export async function clearAudio(): Promise<void> {
  await run(FILES, "readwrite", (s) => s.clear());
  await run(PROJECT, "readwrite", (s) => s.clear());
}
