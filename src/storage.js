const DB_NAME = 'videos-recorder-db';
const DB_VERSION = 1;
const CHUNKS_STORE = 'chunks';
const META_STORE = 'meta';
const META_KEY = 'recording';

let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const chunks = db.createObjectStore(CHUNKS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        chunks.createIndex('by_index', 'index', { unique: false });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function clearRecordingData() {
  const db = await openDb();
  const tx = db.transaction([CHUNKS_STORE, META_STORE], 'readwrite');
  tx.objectStore(CHUNKS_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await transactionDone(tx);
}

export async function saveChunk({ blob, index, sessionId }) {
  const db = await openDb();
  const tx = db.transaction(CHUNKS_STORE, 'readwrite');
  tx.objectStore(CHUNKS_STORE).add({
    blob,
    index,
    sessionId,
    createdAt: Date.now(),
  });
  await transactionDone(tx);
}

export async function getChunks() {
  const db = await openDb();
  const tx = db.transaction(CHUNKS_STORE, 'readonly');
  const store = tx.objectStore(CHUNKS_STORE);

  const rows = await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  await transactionDone(tx);
  return rows.sort((a, b) => a.index - b.index);
}

export async function setRecordingMeta(meta) {
  const db = await openDb();
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put({
    key: META_KEY,
    ...meta,
  });
  await transactionDone(tx);
}

export async function getRecordingMeta() {
  const db = await openDb();
  const tx = db.transaction(META_STORE, 'readonly');
  const store = tx.objectStore(META_STORE);

  const value = await new Promise((resolve, reject) => {
    const request = store.get(META_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });

  await transactionDone(tx);
  return value;
}
