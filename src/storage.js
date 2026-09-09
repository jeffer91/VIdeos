const DB_NAME = 'videos-recorder-db';
const DB_VERSION = 2;
const CHUNKS_STORE = 'chunks';
const META_STORE = 'meta';
const PROJECTS_STORE = 'projects';
const TAKES_STORE = 'takes';
const RECORDING_META_KEY = 'recording';
const ACTIVE_PROJECT_KEY = 'active-project';

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

      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(TAKES_STORE)) {
        const takes = db.createObjectStore(TAKES_STORE, { keyPath: 'key' });
        takes.createIndex('by_project', 'projectId', { unique: false });
        takes.createIndex('by_slide', ['projectId', 'slideNumber'], { unique: true });
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

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

function takeKey(projectId, slideNumber) {
  return `${projectId}:${slideNumber}`;
}

export async function clearRecordingData() {
  const db = await openDb();
  const tx = db.transaction([CHUNKS_STORE, META_STORE], 'readwrite');
  tx.objectStore(CHUNKS_STORE).clear();
  tx.objectStore(META_STORE).delete(RECORDING_META_KEY);
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
  const rows = (await requestValue(tx.objectStore(CHUNKS_STORE).getAll())) || [];
  await transactionDone(tx);
  return rows.sort((a, b) => a.index - b.index);
}

export async function setRecordingMeta(meta) {
  const db = await openDb();
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put({
    key: RECORDING_META_KEY,
    ...meta,
  });
  await transactionDone(tx);
}

export async function getRecordingMeta() {
  const db = await openDb();
  const tx = db.transaction(META_STORE, 'readonly');
  const value = await requestValue(tx.objectStore(META_STORE).get(RECORDING_META_KEY));
  await transactionDone(tx);
  return value;
}

export async function saveProject(project) {
  const db = await openDb();
  const tx = db.transaction([PROJECTS_STORE, META_STORE], 'readwrite');
  tx.objectStore(PROJECTS_STORE).put({
    ...project,
    updatedAt: Date.now(),
  });
  tx.objectStore(META_STORE).put({ key: ACTIVE_PROJECT_KEY, projectId: project.id });
  await transactionDone(tx);
}

export async function getProject(projectId) {
  if (!projectId) return null;
  const db = await openDb();
  const tx = db.transaction(PROJECTS_STORE, 'readonly');
  const value = await requestValue(tx.objectStore(PROJECTS_STORE).get(projectId));
  await transactionDone(tx);
  return value;
}

export async function getActiveProject() {
  const db = await openDb();
  const tx = db.transaction([META_STORE, PROJECTS_STORE], 'readonly');
  const active = await requestValue(tx.objectStore(META_STORE).get(ACTIVE_PROJECT_KEY));
  const project = active?.projectId
    ? await requestValue(tx.objectStore(PROJECTS_STORE).get(active.projectId))
    : null;
  await transactionDone(tx);
  return project;
}

export async function setActiveProject(projectId) {
  const db = await openDb();
  const tx = db.transaction(META_STORE, 'readwrite');
  if (projectId) tx.objectStore(META_STORE).put({ key: ACTIVE_PROJECT_KEY, projectId });
  else tx.objectStore(META_STORE).delete(ACTIVE_PROJECT_KEY);
  await transactionDone(tx);
}

export async function saveSlideTake(projectId, slideNumber, take) {
  const db = await openDb();
  const tx = db.transaction(TAKES_STORE, 'readwrite');
  tx.objectStore(TAKES_STORE).put({
    key: takeKey(projectId, slideNumber),
    projectId,
    slideNumber,
    ...take,
    updatedAt: Date.now(),
  });
  await transactionDone(tx);
}

export async function getSlideTake(projectId, slideNumber) {
  const db = await openDb();
  const tx = db.transaction(TAKES_STORE, 'readonly');
  const value = await requestValue(tx.objectStore(TAKES_STORE).get(takeKey(projectId, slideNumber)));
  await transactionDone(tx);
  return value;
}

export async function getProjectTakes(projectId) {
  if (!projectId) return [];
  const db = await openDb();
  const tx = db.transaction(TAKES_STORE, 'readonly');
  const store = tx.objectStore(TAKES_STORE);
  let rows;

  if (store.indexNames.contains('by_project')) {
    rows = (await requestValue(store.index('by_project').getAll(projectId))) || [];
  } else {
    rows = ((await requestValue(store.getAll())) || []).filter((take) => take.projectId === projectId);
  }

  await transactionDone(tx);
  return rows.sort((a, b) => a.slideNumber - b.slideNumber);
}

export async function deleteSlideTake(projectId, slideNumber) {
  const db = await openDb();
  const tx = db.transaction(TAKES_STORE, 'readwrite');
  tx.objectStore(TAKES_STORE).delete(takeKey(projectId, slideNumber));
  await transactionDone(tx);
}
