const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aux', {
  load: () => ipcRenderer.invoke('store:load'),
  saveLayouts: (store) => ipcRenderer.invoke('store:save-layouts', store),
  saveSettings: (settings) => ipcRenderer.invoke('store:save-settings', settings),
  onPose: (listener) => ipcRenderer.on('pose', (_event, pose) => listener(pose)),
  // { collection, warnings } whenever presets/ changes (main/collection.js).
  onCollection: (listener) => ipcRenderer.on('collection', (_event, collection) => listener(collection)),
  // Asks where (Save As) and writes [{ fileName, data }]: one file, or a folder named name.
  exportPresets: (files, name) => ipcRenderer.invoke('collection:export', files, name),
  // Asks for preset files (Open) and reads them: { entries, warnings } or { canceled }.
  importPresets: () => ipcRenderer.invoke('collection:import'),
});
