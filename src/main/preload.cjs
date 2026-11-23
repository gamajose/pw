// Preload: expõe para a interface apenas uma API mínima e controlada.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set([
  'state',
  'notify',
  'foreground',
  'sync-paused',
  'theme',
  'sync:log',
  'memory:values',
  'navigate',
  'forja:update',
  'map:coords',
  'updater:status',
]);

function cleanError(err) {
  // O Electron prefixa erros de ipc com "Error invoking remote method 'rpc': Error: ".
  const msg = String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  return new Error(msg);
}

contextBridge.exposeInMainWorld('pw', {
  call: (method, ...args) => ipcRenderer.invoke('rpc', method, ...args).catch((err) => Promise.reject(cleanError(err))),
  on: (event, cb) => {
    if (!EVENTS.has(event)) throw new Error('Evento não permitido: ' + event);
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
