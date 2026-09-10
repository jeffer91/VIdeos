const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('videosStudio', {
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
