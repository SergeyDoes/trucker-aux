const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('engineCheck', {
  done: (result) => ipcRenderer.send('engine-check:done', result),
});
