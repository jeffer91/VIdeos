const VISUAL_DB_NAME = 'videos-studio-visuals-db';
const VISUAL_DB_VERSION = 1;
const ASSETS_STORE = 'assets';
const SETTINGS_STORE = 'settings';

let dbPromise;

function openVisualDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(VISUAL_DB_NAME, VISUAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        const assets = db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
        assets.createIndex('by_project', 'projectId', { unique: false });
        assets.createIndex('by_project_slide', ['projectId', 'slideNumber'], { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function settingsKey(projectId, slideNumber) {
  return `${projectId}:${Number(slideNumber)}`;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() || `visual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function listVisualAssets(projectId, slideNumber) {
  if (!projectId || !slideNumber) return [];
  const db = await openVisualDb();
  const tx = db.transaction(ASSETS_STORE, 'readonly');
  const store = tx.objectStore(ASSETS_STORE);
  const rows = (await requestValue(store.index('by_project_slide').getAll([projectId, Number(slideNumber)]))) || [];
  await transactionDone(tx);
  return rows.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

export async function addVisualFiles(projectId, slideNumber, files = []) {
  if (!projectId || !slideNumber) throw new Error('Falta el proyecto o la diapositiva.');
  const accepted = [...files].filter((file) => file?.size > 0 && String(file.type || '').startsWith('image/'));
  if (!accepted.length) return [];

  const current = await listVisualAssets(projectId, slideNumber);
  let order = current.reduce((max, item) => Math.max(max, Number(item.order) || 0), 0) + 1;
  const rows = accepted.map((file) => ({
    id: newId(),
    projectId,
    slideNumber: Number(slideNumber),
    name: file.name || `imagen-${order}`,
    type: file.type || 'image/jpeg',
    size: Number(file.size) || 0,
    blob: file,
    order: order++,
    createdAt: Date.now(),
  }));

  const db = await openVisualDb();
  const tx = db.transaction(ASSETS_STORE, 'readwrite');
  const store = tx.objectStore(ASSETS_STORE);
  rows.forEach((row) => store.put(row));
  await transactionDone(tx);
  return rows;
}

export async function deleteVisualAsset(id) {
  if (!id) return;
  const db = await openVisualDb();
  const tx = db.transaction(ASSETS_STORE, 'readwrite');
  tx.objectStore(ASSETS_STORE).delete(id);
  await transactionDone(tx);
}

export async function reorderVisualAssets(projectId, slideNumber, orderedIds = []) {
  const rows = await listVisualAssets(projectId, slideNumber);
  const rank = new Map(orderedIds.map((id, index) => [id, index + 1]));
  const db = await openVisualDb();
  const tx = db.transaction(ASSETS_STORE, 'readwrite');
  const store = tx.objectStore(ASSETS_STORE);
  rows.forEach((row, index) => store.put({ ...row, order: rank.get(row.id) || index + 1 }));
  await transactionDone(tx);
}

export async function getVisualSettings(projectId, slideNumber) {
  if (!projectId || !slideNumber) return { fit: 'cover', transition: 'fade' };
  const db = await openVisualDb();
  const tx = db.transaction(SETTINGS_STORE, 'readonly');
  const row = await requestValue(tx.objectStore(SETTINGS_STORE).get(settingsKey(projectId, slideNumber)));
  await transactionDone(tx);
  return {
    fit: row?.fit === 'contain' ? 'contain' : 'cover',
    transition: row?.transition === 'cut' ? 'cut' : 'fade',
  };
}

export async function setVisualSettings(projectId, slideNumber, settings = {}) {
  if (!projectId || !slideNumber) return;
  const db = await openVisualDb();
  const tx = db.transaction(SETTINGS_STORE, 'readwrite');
  tx.objectStore(SETTINGS_STORE).put({
    key: settingsKey(projectId, slideNumber),
    projectId,
    slideNumber: Number(slideNumber),
    fit: settings.fit === 'contain' ? 'contain' : 'cover',
    transition: settings.transition === 'cut' ? 'cut' : 'fade',
    updatedAt: Date.now(),
  });
  await transactionDone(tx);
}

export async function getVisualCountsBySlide(projectId) {
  if (!projectId) return {};
  const db = await openVisualDb();
  const tx = db.transaction(ASSETS_STORE, 'readonly');
  const rows = (await requestValue(tx.objectStore(ASSETS_STORE).index('by_project').getAll(projectId))) || [];
  await transactionDone(tx);
  return rows.reduce((counts, row) => {
    const key = Number(row.slideNumber);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export async function pruneVisualAssets(projectId, validSlideNumbers = []) {
  if (!projectId) return 0;
  const valid = new Set(validSlideNumbers.map(Number));
  const db = await openVisualDb();

  const readTx = db.transaction([ASSETS_STORE, SETTINGS_STORE], 'readonly');
  const assetRows = (await requestValue(readTx.objectStore(ASSETS_STORE).index('by_project').getAll(projectId))) || [];
  const settingRows = (await requestValue(readTx.objectStore(SETTINGS_STORE).getAll())) || [];
  await transactionDone(readTx);

  const staleAssets = assetRows.filter((row) => !valid.has(Number(row.slideNumber)));
  const staleSettings = settingRows.filter(
    (row) => row?.projectId === projectId && !valid.has(Number(row.slideNumber)),
  );
  if (!staleAssets.length && !staleSettings.length) return 0;

  const writeTx = db.transaction([ASSETS_STORE, SETTINGS_STORE], 'readwrite');
  const assetStore = writeTx.objectStore(ASSETS_STORE);
  const settingsStore = writeTx.objectStore(SETTINGS_STORE);
  staleAssets.forEach((row) => assetStore.delete(row.id));
  staleSettings.forEach((row) => settingsStore.delete(row.key));
  await transactionDone(writeTx);
  return staleAssets.length + staleSettings.length;
}
