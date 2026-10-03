const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lienzo', {
  state: () => ipcRenderer.invoke('state'),
  add: (kind) => ipcRenderer.invoke('add', kind),
  remove: (kind, id) => ipcRenderer.invoke('remove', kind, id),
  select: (kind, id) => ipcRenderer.invoke('select', kind, id),
  option: (key, value) => ipcRenderer.invoke('option', key, value),
  connect: () => ipcRenderer.invoke('connect'),
  hide: () => ipcRenderer.invoke('hide'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
});
