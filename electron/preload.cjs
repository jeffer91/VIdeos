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
  },
});
