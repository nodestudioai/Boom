// Puente mínimo entre las ventanas y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

const allowed = (c) => typeof c === 'string' && (c.startsWith('boom:') || c.startsWith('engine:'));

contextBridge.exposeInMainWorld('boom', {
  invoke: (channel, ...args) =>
    allowed(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error('canal no permitido')),
  send: (channel, ...args) => { if (allowed(channel)) ipcRenderer.send(channel, ...args); },
  on: (channel, fn) => { if (allowed(channel)) ipcRenderer.on(channel, (_e, ...args) => fn(...args)); },
});
