const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

let mainWindow = null;
let viteServer = null;
let rendererUrl = null;

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
    width: 1380,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    title: 'Videos · Grabador local',
    webPreferences: {
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
