const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('videosStudio', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
  },
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
  },
  nativeFFmpeg: {
    status: () => ipcRenderer.invoke('native-ffmpeg:status'),
    open: () => ipcRenderer.invoke('native-ffmpeg:open'),
    write: (id, name, data) => ipcRenderer.invoke('native-ffmpeg:write', { id, name, data }),
    read: (id, name) => ipcRenderer.invoke('native-ffmpeg:read', { id, name }),
    delete: (id, name) => ipcRenderer.invoke('native-ffmpeg:delete', { id, name }),
    exec: (id, args, duration) => ipcRenderer.invoke('native-ffmpeg:exec', { id, args, duration }),
    cancel: (id) => ipcRenderer.invoke('native-ffmpeg:cancel', id),
    close: (id) => ipcRenderer.invoke('native-ffmpeg:close', id),
    onProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('native-ffmpeg:progress', handler);
      return () => ipcRenderer.removeListener('native-ffmpeg:progress', handler);
    },
  },
  ffmpeg: {
    readCoreAsset: (name) => ipcRenderer.invoke('ffmpeg:read-core-asset', name),
    reportSmokeTest: (result) => ipcRenderer.invoke('ffmpeg:smoke-result', result),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  },
  library: {
    importMedia: (options) => ipcRenderer.invoke('library:import', options),
    listMedia: (options) => ipcRenderer.invoke('library:list', options),
    deleteMedia: (options) => ipcRenderer.invoke('library:delete', options),
    setDefault: (options) => ipcRenderer.invoke('library:set-default', options),
    getDefaults: () => ipcRenderer.invoke('library:get-defaults'),
    reveal: (options) => ipcRenderer.invoke('library:reveal', options),
    open: (options) => ipcRenderer.invoke('library:open', options),
    readDataUrl: (options) => ipcRenderer.invoke('library:read-data-url', options),
    readBytes: (options) => ipcRenderer.invoke('library:read-bytes', options),
    writeBytes: (options) => ipcRenderer.invoke('library:write-bytes', options),
  },
});
