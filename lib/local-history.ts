export type LocalScreenshotMeta = {
  cupCount: number;
  lockedCount: number;
  suspiciousCount: number;
  confidence: number;
};

export type LocalScreenshotEntry = LocalScreenshotMeta & {
  id: string;
  createdAt: number;
  name: string;
  type: string;
  blob: Blob;
};

const DB_NAME = "water-sort-local";
const DB_VERSION = 1;
const STORE = "screenshots";
const MAX_ITEMS = 8;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function supported() {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!supported()) {
      reject(new Error("当前浏览器不支持本机截图历史"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本机截图历史"));
  });
}

function allEntries(db: IDBDatabase): Promise<LocalScreenshotEntry[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as LocalScreenshotEntry[]);
    request.onerror = () => reject(request.error ?? new Error("读取本机截图历史失败"));
  });
}

function removeIds(db: IDBDatabase, ids: string[]) {
  return new Promise<void>((resolve, reject) => {
    if (!ids.length) {
      resolve();
      return;
    }
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("清理本机截图历史失败"));
  });
}

async function prune(db: IDBDatabase) {
  const now = Date.now();
  const entries = (await allEntries(db)).sort((a, b) => b.createdAt - a.createdAt);
  const stale = entries.filter((entry, index) => now - entry.createdAt > MAX_AGE_MS || index >= MAX_ITEMS).map((entry) => entry.id);
  await removeIds(db, stale);
}

export async function saveLocalScreenshot(blob: Blob, meta: LocalScreenshotMeta, name = "淘特关卡截图") {
  const db = await openDb();
  try {
    await prune(db);
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry: LocalScreenshotEntry = {
      id,
      createdAt: Date.now(),
      name,
      type: blob.type || "image/jpeg",
      blob,
      ...meta,
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("保存本机截图历史失败"));
    });
    await prune(db);
    return id;
  } finally {
    db.close();
  }
}

export async function listLocalScreenshots() {
  const db = await openDb();
  try {
    await prune(db);
    return (await allEntries(db)).sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

export async function deleteLocalScreenshot(id: string) {
  const db = await openDb();
  try {
    await removeIds(db, [id]);
  } finally {
    db.close();
  }
}

export async function clearLocalScreenshots() {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("清空本机截图历史失败"));
    });
  } finally {
    db.close();
  }
}
