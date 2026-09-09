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

function configureMediaPermissions() {
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) =>
      permission === 'media' && isTrustedRendererOrigin(requestingOrigin),
  );

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestingUrl = details?.requestingUrl || webContents?.getURL?.() || '';
      callback(permission === 'media' && isTrustedRendererOrigin(requestingUrl));
    },
  );
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
    width: 1480,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    title: 'Videos Recorder',
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
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
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
