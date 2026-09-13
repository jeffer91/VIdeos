const { app, BrowserWindow, session, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { fileURLToPath } = require('node:url');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (caught) {
  console.warn('electron-updater no está disponible. Videos Studio continuará sin actualizaciones automáticas en esta ejecución.', caught?.message || caught);
}

let mainWindow = null;
let viteServer = null;
let rendererUrl = null;
let updateInterval = null;

const APP_ID = 'com.jeffer91.videosstudio';
const CHANNEL_NAME = '11 Records';
const LIBRARY_CATEGORIES = new Set(['intros', 'transitions', 'endings', 'cta', 'memes', 'templates']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv']);
const MAX_LIBRARY_READ_BYTES = 1024 * 1024 * 1024;

function isTrustedRendererOrigin(value = '') {
  if (!value) return false;
  if (!app.isPackaged) {
    return /^http:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/|$)/i.test(value);
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return false;
    const target = fileURLToPath(parsed);
    return isInside(path.join(app.getAppPath(), 'dist'), target);
  } catch {
    return false;
  }
}

function isTrustedMediaRequest(webContents, requestingOrigin = '') {
  const currentUrl = webContents?.getURL?.() || '';
  return isTrustedRendererOrigin(requestingOrigin) || isTrustedRendererOrigin(currentUrl);
}

function configureMediaPermissions() {
  const currentSession = session.defaultSession;

  currentSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission !== 'media') return false;
    return isTrustedMediaRequest(webContents, requestingOrigin);
  });

  currentSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== 'media') {
      callback(false);
      return;
    }

    const requestingUrl = details?.requestingUrl || details?.securityOrigin || '';
    callback(isTrustedMediaRequest(webContents, requestingUrl));
  });
}

function normalizeClipboardText(value = '') {
  return String(value).replace(/\r\n?/g, '\n').normalize('NFC');
}

function assertTrustedIpc(event) {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  if (!isTrustedRendererOrigin(senderUrl)) throw new Error('Origen no autorizado para usar esta función.');
}

function configureClipboardIpc() {
  ipcMain.handle('clipboard:write-text', (event, value = '') => {
    assertTrustedIpc(event);

    const text = String(value ?? '');
    if (!text.trim()) throw new Error('No hay texto para copiar.');
    if (text.length > 1_000_000) throw new Error('El texto es demasiado grande para copiarlo.');

    clipboard.writeText(text, 'clipboard');
    const copied = clipboard.readText('clipboard');
    const verified = normalizeClipboardText(copied) === normalizeClipboardText(text);
    return { ok: true, length: text.length, verified };
  });
}

function libraryRoot() {
  if (!app.isPackaged) return path.join(app.getAppPath(), 'library');
  return path.join(app.getPath('documents'), 'Videos Studio', 'library');
}

function legacyLibraryRoot() {
  return path.join(path.dirname(process.execPath), 'library');
}

function safeSegment(value = '') {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

function libraryDirectory({ scope = 'global', projectId = '', category = 'intros' } = {}) {
  if (!LIBRARY_CATEGORIES.has(category)) throw new Error('Categoría de biblioteca no válida.');
  if (scope === 'project') {
    if (!projectId) throw new Error('Falta el proyecto para esta biblioteca.');
    return path.join(libraryRoot(), 'projects', safeSegment(projectId), category);
  }
  if (scope !== 'global') throw new Error('Ámbito de biblioteca no válido.');
  return path.join(libraryRoot(), 'global', category);
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function migrateLegacyLibrary() {
  if (!app.isPackaged) return;
  const source = legacyLibraryRoot();
  const destination = libraryRoot();
  if (path.resolve(source) === path.resolve(destination)) return;
  if (!(await pathExists(source))) {
    await ensureDirectory(destination);
    return;
  }

  await ensureDirectory(destination);
  try {
    await fs.cp(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: false,
      preserveTimestamps: true,
    });
  } catch (caught) {
    console.warn('No se pudo migrar completamente la biblioteca antigua:', caught);
  }
}

async function uniqueDestination(directory, sourcePath) {
  const parsed = path.parse(sourcePath);
  const base = safeSegment(parsed.name);
  const ext = parsed.ext.toLowerCase();
  let candidate = path.join(directory, `${base}${ext}`);
  let index = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(directory, `${base}-${index}${ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

async function listDirectory(options) {
  const directory = libraryDirectory(options);
  await ensureDirectory(directory);
  const rows = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const row of rows) {
    if (!row.isFile()) continue;
    const fullPath = path.join(directory, row.name);
    const stat = await fs.stat(fullPath);
    files.push({
      id: fullPath,
      name: row.name,
      path: fullPath,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      category: options.category,
      scope: options.scope || 'global',
      projectId: options.projectId || '',
    });
  }
  return files.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

async function readDefaults() {
  const file = path.join(libraryRoot(), 'defaults.json');
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    const clean = {};
    for (const [category, target] of Object.entries(value || {})) {
      if (!LIBRARY_CATEGORIES.has(category) || !target) continue;
      const root = libraryDirectory({ scope: 'global', category });
      if (!isInside(root, target)) continue;
      try {
        await fs.access(target);
        clean[category] = target;
      } catch {
        // Ignore stale defaults that point to deleted files.
      }
    }
    return clean;
  } catch {
    return {};
  }
}

async function writeDefaults(value) {
  await ensureDirectory(libraryRoot());
  await fs.writeFile(path.join(libraryRoot(), 'defaults.json'), JSON.stringify(value, null, 2), 'utf8');
}

function imageMimeType(filePath = '') {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return '';
}

function mediaMimeType(filePath = '') {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.mp4' || extension === '.m4v') return 'video/mp4';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.avi') return 'video/x-msvideo';
  if (extension === '.mkv') return 'video/x-matroska';
  return imageMimeType(filePath) || 'application/octet-stream';
}

function assertLibraryFile(target) {
  const resolved = path.resolve(String(target || ''));
  if (!resolved || !isInside(libraryRoot(), resolved) || resolved === path.resolve(libraryRoot())) {
    throw new Error('Archivo fuera de la biblioteca.');
  }
  return resolved;
}

function configureLibraryIpc() {
  ipcMain.handle('library:import', async (event, options = {}) => {
    assertTrustedIpc(event);
    const directory = libraryDirectory(options);
    await ensureDirectory(directory);
    const importingTemplates = options.category === 'templates';
    const response = await dialog.showOpenDialog(mainWindow, {
      title: importingTemplates ? 'Agregar fondos a Videos Studio' : 'Agregar video a la biblioteca',
      properties: ['openFile', 'multiSelections'],
      filters: importingTemplates
        ? [{ name: 'Imágenes de fondo', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
        : [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'] }],
    });
    if (response.canceled) return [];

    const imported = [];
    for (const sourcePath of response.filePaths) {
      if (importingTemplates && !IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) continue;
      const destination = await uniqueDestination(directory, sourcePath);
      await fs.copyFile(sourcePath, destination);
      const stat = await fs.stat(destination);
      imported.push({
        id: destination,
        name: path.basename(destination),
        path: destination,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        category: options.category,
        scope: options.scope || 'global',
        projectId: options.projectId || '',
      });
    }
    return imported;
  });

  ipcMain.handle('library:list', async (event, options = {}) => {
    assertTrustedIpc(event);
    return listDirectory(options);
  });

  ipcMain.handle('library:delete', async (event, options = {}) => {
    assertTrustedIpc(event);
    const directory = libraryDirectory(options);
    const target = path.resolve(String(options.path || ''));
    if (!target || !isInside(directory, target) || target === path.resolve(directory)) {
      throw new Error('Archivo fuera de la biblioteca.');
    }
    await fs.unlink(target);
    const defaults = await readDefaults();
    for (const key of Object.keys(defaults)) {
      if (path.resolve(defaults[key]) === target) delete defaults[key];
    }
    await writeDefaults(defaults);
    return true;
  });

  ipcMain.handle('library:set-default', async (event, options = {}) => {
    assertTrustedIpc(event);
    if (!LIBRARY_CATEGORIES.has(options.category)) throw new Error('Categoría no válida.');
    const defaults = await readDefaults();
    if (!options.path) {
      delete defaults[options.category];
      await writeDefaults(defaults);
      return defaults;
    }

    const root = libraryDirectory({ scope: 'global', category: options.category });
    const target = path.resolve(String(options.path));
    if (!isInside(root, target) || target === path.resolve(root)) throw new Error('El predeterminado debe pertenecer a la biblioteca global.');
    await fs.access(target);
    defaults[options.category] = target;
    await writeDefaults(defaults);
    return defaults;
  });

  ipcMain.handle('library:get-defaults', async (event) => {
    assertTrustedIpc(event);
    return readDefaults();
  });

  ipcMain.handle('library:read-data-url', async (event, options = {}) => {
    assertTrustedIpc(event);
    const target = assertLibraryFile(options.path);
    const mimeType = imageMimeType(target);
    if (!mimeType) throw new Error('El archivo solicitado no es una imagen compatible.');
    const data = await fs.readFile(target);
    return `data:${mimeType};base64,${data.toString('base64')}`;
  });

  ipcMain.handle('library:read-bytes', async (event, options = {}) => {
    assertTrustedIpc(event);
    const target = assertLibraryFile(options.path);
    const stat = await fs.stat(target);
    if (stat.size > MAX_LIBRARY_READ_BYTES) throw new Error('El recurso es demasiado grande para incluirlo en esta operación.');
    const data = await fs.readFile(target);
    return {
      name: path.basename(target),
      type: mediaMimeType(target),
      size: stat.size,
      data: new Uint8Array(data),
    };
  });

  ipcMain.handle('library:write-bytes', async (event, options = {}) => {
    assertTrustedIpc(event);
    const directory = libraryDirectory(options);
    await ensureDirectory(directory);
    const name = path.basename(String(options.name || 'recurso'));
    const extension = path.extname(name).toLowerCase();
    if (options.category === 'templates') {
      if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('El fondo restaurado no es una imagen compatible.');
    } else if (!VIDEO_EXTENSIONS.has(extension)) {
      throw new Error('El recurso restaurado no es un video compatible.');
    }
    const sourceName = path.join(directory, `${safeSegment(path.parse(name).name)}${extension}`);
    const destination = await uniqueDestination(directory, sourceName);
    const incoming = options.data;
    const data = Buffer.from(incoming instanceof ArrayBuffer ? new Uint8Array(incoming) : incoming || []);
    if (!data.length) throw new Error('El recurso restaurado está vacío.');
    if (data.length > MAX_LIBRARY_READ_BYTES) throw new Error('El recurso restaurado es demasiado grande.');
    await fs.writeFile(destination, data);
    const stat = await fs.stat(destination);
    return {
      id: destination,
      name: path.basename(destination),
      path: destination,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      category: options.category,
      scope: options.scope || 'global',
      projectId: options.projectId || '',
    };
  });

  ipcMain.handle('library:reveal', async (event, options = {}) => {
    assertTrustedIpc(event);
    const target = path.resolve(String(options.path || libraryRoot()));
    if (!isInside(libraryRoot(), target)) throw new Error('Ruta fuera de la biblioteca.');
    shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle('library:open', async (event, options = {}) => {
    assertTrustedIpc(event);
    const target = assertLibraryFile(options.path);
    const result = await shell.openPath(target);
    if (result) throw new Error(result);
    return true;
  });
}

function sendUpdateStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update:status', payload);
}

function configureUpdateIpc() {
  ipcMain.handle('app:get-info', (event) => {
    assertTrustedIpc(event);
    return {
      name: app.getName(),
      version: app.getVersion(),
      channel: CHANNEL_NAME,
      packaged: app.isPackaged,
      updaterAvailable: Boolean(autoUpdater),
      libraryPath: libraryRoot(),
    };
  });

  ipcMain.handle('update:check', async (event) => {
    assertTrustedIpc(event);
    if (!app.isPackaged) return { ok: false, reason: 'development' };
    if (!autoUpdater) return { ok: false, reason: 'updater-unavailable' };
    sendUpdateStatus({ state: 'checking' });
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, version: result?.updateInfo?.version || null };
    } catch (caught) {
      sendUpdateStatus({ state: 'error', message: caught.message || 'No se pudo comprobar la actualización.' });
      throw caught;
    }
  });

  ipcMain.handle('update:install', (event) => {
    assertTrustedIpc(event);
    if (!app.isPackaged) return { ok: false, reason: 'development' };
    if (!autoUpdater) return { ok: false, reason: 'updater-unavailable' };
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });
}

function configureAutoUpdater() {
  if (!app.isPackaged || !autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', (info) => sendUpdateStatus({ state: 'current', version: info.version }));
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus({
    state: 'downloading',
    percent: progress.percent,
    transferred: progress.transferred,
    total: progress.total,
  }));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (error) => sendUpdateStatus({
    state: 'error',
    message: error?.message || 'No se pudo actualizar Videos Studio.',
  }));

  const check = () => autoUpdater.checkForUpdates().catch((caught) => {
    console.warn('Auto update check failed:', caught);
  });

  setTimeout(check, 5000);
  updateInterval = setInterval(check, 4 * 60 * 60 * 1000);
}

async function startRenderer() {
  if (app.isPackaged) return null;

  const { createServer } = await import('vite');
  viteServer = await createServer({
    root: app.getAppPath(),
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false,
    },
  });

  await viteServer.listen();
  const localUrls = viteServer.resolvedUrls?.local || [];
  return localUrls[0] || 'http://127.0.0.1:5173/';
}

async function createWindow() {
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#F5F7FA',
    title: `Videos Studio · ${CHANNEL_NAME}`,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererOrigin(url)) event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  } else {
    await mainWindow.loadURL(rendererUrl);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  await migrateLegacyLibrary();
  configureMediaPermissions();
  configureLibraryIpc();
  configureClipboardIpc();
  configureUpdateIpc();
  rendererUrl = await startRenderer();
  await createWindow();
  configureAutoUpdater();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  if (viteServer) {
    void viteServer.close();
    viteServer = null;
  }
});
