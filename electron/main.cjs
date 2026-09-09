const { app, BrowserWindow, session, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

let mainWindow = null;
let viteServer = null;
let rendererUrl = null;

const LIBRARY_CATEGORIES = new Set(['intros', 'transitions', 'endings', 'cta', 'memes']);

function isTrustedRendererOrigin(value = '') {
  return (
    value.startsWith('http://127.0.0.1:') ||
    value.startsWith('http://localhost:') ||
    value.startsWith('file://')
  );
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

function libraryRoot() {
  const base = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
  return path.join(base, 'library');
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
  return path.join(libraryRoot(), 'global', category);
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
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
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

async function writeDefaults(value) {
  await ensureDirectory(libraryRoot());
  await fs.writeFile(path.join(libraryRoot(), 'defaults.json'), JSON.stringify(value, null, 2), 'utf8');
}

function configureLibraryIpc() {
  ipcMain.handle('library:import', async (_event, options = {}) => {
    const directory = libraryDirectory(options);
    await ensureDirectory(directory);
    const response = await dialog.showOpenDialog(mainWindow, {
      title: 'Agregar video a la biblioteca',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (response.canceled) return [];

    const imported = [];
    for (const sourcePath of response.filePaths) {
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

  ipcMain.handle('library:list', async (_event, options = {}) => listDirectory(options));

  ipcMain.handle('library:delete', async (_event, options = {}) => {
    const directory = libraryDirectory(options);
    const target = path.resolve(String(options.path || ''));
    const allowedRoot = path.resolve(directory);
    if (!target.startsWith(`${allowedRoot}${path.sep}`)) throw new Error('Archivo fuera de la biblioteca.');
    await fs.unlink(target);
    const defaults = await readDefaults();
    for (const key of Object.keys(defaults)) {
      if (defaults[key] === target) delete defaults[key];
    }
    await writeDefaults(defaults);
    return true;
  });

  ipcMain.handle('library:set-default', async (_event, options = {}) => {
    if (!LIBRARY_CATEGORIES.has(options.category)) throw new Error('Categoría no válida.');
    const defaults = await readDefaults();
    defaults[options.category] = options.path || '';
    await writeDefaults(defaults);
    return defaults;
  });

  ipcMain.handle('library:get-defaults', async () => readDefaults());

  ipcMain.handle('library:reveal', async (_event, options = {}) => {
    const target = options.path || libraryRoot();
    shell.showItemInFolder(target);
    return true;
  });
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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    title: 'Videos Studio',
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
  configureMediaPermissions();
  configureLibraryIpc();
  rendererUrl = await startRenderer();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (viteServer) {
    void viteServer.close();
    viteServer = null;
  }
});
