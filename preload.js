const { contextBridge, ipcRenderer } = require('electron');
const call = (c) => (...a) => ipcRenderer.invoke(c, ...a);

contextBridge.exposeInMainWorld('api', {
  find: call('find'), openFile: call('openFile'), openDir: call('openDir'), list: call('list'),
  read: call('read'), write: call('write'), saveAs: call('saveAs'), tmp: call('tmp'), rm: call('rm'), runner: call('runner'),
  run: call('run'), stdin: call('stdin'), kill: call('kill'), drracket: call('drracket'),
  on: (ch, fn) => { if (['menu', 'proc', 'open-path'].includes(ch)) ipcRenderer.on(ch, (_e, ...a) => fn(...a)); },
});
