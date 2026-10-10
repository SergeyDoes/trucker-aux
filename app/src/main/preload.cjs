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
  // The cab's keys and controller buttons (main/controls.js): the bindings, a combination
  // pressed (ids, or null), the controllers' names, the actions as they fire, warnings.
  setControls: (bindings) => ipcRenderer.invoke('controls:set', bindings),
  captureControl: () => ipcRenderer.invoke('controls:capture'),
  cancelCapture: () => ipcRenderer.invoke('controls:cancel'),
  controlNames: () => ipcRenderer.invoke('controls:names'),
  onControl: (listener) => ipcRenderer.on('controls:action', (_event, action) => listener(action)),
  onControlWarning: (listener) => ipcRenderer.on('controls:warning', (_event, message) => listener(message)),
  // The voice (main/voice.js): started ahead, and a phrase as WAV bytes (or null).
  warmVoice: () => ipcRenderer.invoke('voice:warm'),
  speak: (text) => ipcRenderer.invoke('voice:speak', text),
});
