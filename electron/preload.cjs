const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('videosStudio', {
  library: {
    importMedia: (options) => ipcRenderer.invoke('library:import', options),
    listMedia: (options) => ipcRenderer.invoke('library:list', options),
    deleteMedia: (options) => ipcRenderer.invoke('library:delete', options),
    setDefault: (options) => ipcRenderer.invoke('library:set-default', options),
    getDefaults: () => ipcRenderer.invoke('library:get-defaults'),
    reveal: (options) => ipcRenderer.invoke('library:reveal', options),
    open: (options) => ipcRenderer.invoke('library:open', options),
  },
});
