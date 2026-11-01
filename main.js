const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

let win, ready = false, queue = [];
const procs = new Map();

/* ---------- Racket discovery ---------- */
function findRacket(override) {
  const cands = [];
  if (override) {
    cands.push(fs.existsSync(override) && fs.statSync(override).isDirectory() ? path.join(override, 'bin', 'racket') : override);
  }
  try {
    fs.readdirSync('/Applications').filter((n) => /^Racket/i.test(n)).sort().reverse()
      .forEach((n) => cands.push(path.join('/Applications', n, 'bin', 'racket')));
  } catch (_) {}
  cands.push('/opt/homebrew/bin/racket', '/usr/local/bin/racket', '/usr/bin/racket');
  for (const bin of cands) {
    if (!fs.existsSync(bin)) continue;
    let version = '';
    try { version = cp.execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 }).trim(); } catch (_) { continue; }
    const root = path.dirname(path.dirname(bin));
    const dr = path.join(root, 'DrRacket.app');
    return { bin, version, drracket: fs.existsSync(dr) ? dr : null };
  }
  return null;
}

/* ---------- window ---------- */
const send = (c, ...a) => win && ready && win.webContents.send(c, ...a);
const menu = (cmd) => () => send('menu', cmd);

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 560,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#221824',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    ready = true;
    queue.forEach((f) => send('open-path', f)); queue = [];
  });
  win.on('closed', () => { win = null; ready = false; procs.forEach((p) => p.kill()); });
}

app.on('open-file', (e, p) => { e.preventDefault(); if (ready) send('open-path', p); else queue.push(p); });

app.whenReady().then(() => {
  const read = (p) => ({ path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8') });

  ipcMain.handle('find', (_e, override) => findRacket(override));
  ipcMain.handle('openFile', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths.map(read);
  });
  ipcMain.handle('openDir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('list', (_e, dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.') && d.name !== 'compiled' && d.name !== 'node_modules')
        .map((d) => ({ name: d.name, dir: d.isDirectory(), path: path.join(dir, d.name) }))
        .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
    } catch (_) { return []; }
  });
  ipcMain.handle('read', (_e, p) => read(p));
  ipcMain.handle('write', (_e, p, text) => { fs.writeFileSync(p, text, 'utf8'); return p; });
  ipcMain.handle('saveAs', async (_e, name, text) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, text, 'utf8'); return r.filePath;
  });
  ipcMain.handle('tmp', (_e, dirHint, text) => {
    const dir = dirHint && fs.existsSync(dirHint) ? dirHint : os.tmpdir();
    const p = path.join(dir, `.rstudio-run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.rkt`);
    fs.writeFileSync(p, text, 'utf8'); return p;
  });
  ipcMain.handle('rm', (_e, p) => { try { fs.unlinkSync(p); } catch (_) {} });
  let runnerPath = null;
  ipcMain.handle('runner', () => {
    if (!runnerPath || !fs.existsSync(runnerPath)) {
      runnerPath = path.join(os.tmpdir(), 'racket-studio-runner.rkt');
      fs.writeFileSync(runnerPath, fs.readFileSync(path.join(__dirname, 'runner.rkt'), 'utf8'));
    }
    return runnerPath;
  });

  ipcMain.handle('run', (_e, id, bin, args, cwd, env) => {
    const p = cp.spawn(bin, args, { cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(), env: { ...process.env, ...env } });
    procs.set(id, p);
    p.stdout.on('data', (d) => send('proc', { id, type: 'out', data: d.toString() }));
    p.stderr.on('data', (d) => send('proc', { id, type: 'err', data: d.toString() }));
    p.on('error', (err) => send('proc', { id, type: 'err', data: String(err) + '\n' }));
    p.on('close', (code) => { procs.delete(id); send('proc', { id, type: 'exit', code }); });
  });
  ipcMain.handle('stdin', (_e, id, text) => { const p = procs.get(id); if (p) p.stdin.write(text); });
  ipcMain.handle('kill', (_e, id) => { const p = procs.get(id); if (p) p.kill(); });
  ipcMain.handle('drracket', (_e, appPath, file) => { cp.spawn('open', ['-a', appPath, file], { detached: true }).unref(); });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [
      { label: 'New File', accelerator: 'CmdOrCtrl+N', click: menu('new') },
      { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: menu('open') },
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: menu('openDir') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: menu('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: menu('saveAs') },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: menu('close') },
    ] },
    { role: 'editMenu' },
    { label: 'Racket', submenu: [
      { label: 'Run', accelerator: 'CmdOrCtrl+R', click: menu('run') },
      { label: 'Stop', accelerator: 'CmdOrCtrl+.', click: menu('stop') },
      { label: 'Check Syntax', accelerator: 'CmdOrCtrl+Shift+K', click: menu('check') },
      { label: 'Stepper', accelerator: 'CmdOrCtrl+Shift+E', click: menu('step') },
      { type: 'separator' },
      { label: 'Open in DrRacket (Stepper, Debugger…)', click: menu('drracket') },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: menu('settings') },
    ] },
    { label: 'View', submenu: [
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: menu('side') },
      { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+J', click: menu('panel') },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
    ] },
    { role: 'windowMenu' },
  ]));

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
