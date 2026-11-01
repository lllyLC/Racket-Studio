const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const baseName = (p) => p.split('/').pop();
const dirOf = (p) => (p ? p.slice(0, p.lastIndexOf('/')) : '');

const LANGS = [
  ['Schreibe Dein Programm! – Anfänger', 'deinprogramm/sdp/beginner'],
  ['Schreibe Dein Programm! – Vanilla', 'deinprogramm/sdp/vanilla'],
  ['Schreibe Dein Programm! – Fortgeschritten', 'deinprogramm/sdp/intermediate'],
  ['Schreibe Dein Programm! – Fortgeschritten mit Lambda', 'deinprogramm/sdp/intermediate-lambda'],
  ['Schreibe Dein Programm! – Fortgeschrittene Sprache', 'deinprogramm/sdp/advanced'],
  ['HtDP – Beginning Student', 'htdp/bsl'],
  ['HtDP – Beginning Student with List Abbreviations', 'htdp/bsl+'],
  ['HtDP – Intermediate Student', 'htdp/isl'],
  ['HtDP – Intermediate Student with Lambda', 'htdp/isl+'],
  ['HtDP – Advanced Student', 'htdp/asl'],
  ['Racket', 'racket'],
  ['Racket Base', 'racket/base'],
  ['Scheme (legacy)', 'scheme'],
  ['R5RS', 'r5rs'],
  ['Typed Racket', 'typed/racket'],
];

const S = Object.assign({ racket: '', lang: 'deinprogramm/sdp/beginner', tp: '', custom: '', size: 14, report: true }, JSON.parse(localStorage.getItem('rs') || '{}'));
const saveSettings = () => localStorage.setItem('rs', JSON.stringify(S));

let ed, tabs = [], cur = null, rk = null, folder = null, nid = 1, panelTab = 'out';
let runJob = null;   // { id, tab, base, offset, tmp, errText, kind }
let replJob = null;  // same shape, interactive process
const jobs = new Map();

/* =============== editor setup =============== */
function setupMonaco() {
  const base = new URL('../node_modules/monaco-editor/min/', location.href).href;
  window.MonacoEnvironment = {
    getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${base}'};importScripts('${base}vs/base/worker/workerMain.js');`),
  };
  require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
  require(['vs/editor/editor.main'], () => {
    monaco.languages.register({ id: 'racket', extensions: ['.rkt', '.scm', '.ss', '.rktl', '.rktd'] });
    monaco.languages.setLanguageConfiguration('racket', {
      comments: { lineComment: ';', blockComment: ['#|', '|#'] },
      brackets: [['(', ')'], ['[', ']'], ['{', '}']],
      autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' }, { open: '"', close: '"', notIn: ['string', 'comment'] }],
      surroundingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '"', close: '"' }],
    });
    monaco.languages.setMonarchTokensProvider('racket', {
      keywords: ['define', 'define-values', 'define-struct', 'define-record-procedure', 'define-syntax', 'define-syntax-rule', 'lambda', 'λ', 'cond', 'else', 'if', 'and', 'or', 'not', 'let', 'let*', 'letrec', 'local', 'begin', 'set!', 'quote', 'quasiquote', 'unquote', 'when', 'unless', 'case', 'match', 'struct', 'require', 'provide', 'module', 'for', 'for/list', 'for/fold', 'check-expect', 'check-within', 'check-error', 'check-satisfied', 'check-member-of', 'check-range', 'check-property', 'signature', ':', '->'],
      tokenizer: {
        root: [
          [/^#lang.*$|^#reader.*$/, 'meta'],
          [/;.*$/, 'comment'],
          [/#\|/, 'comment', '@block'],
          [/"(?:[^"\\]|\\.)*"/, 'string'],
          [/#[tTfF]\b|#\\\w+/, 'constant'],
          [/[+-]?\d+(?:[./]\d+)?(?:[eE][+-]?\d+)?(?=[\s()\[\]{}";]|$)/, 'number'],
          [/[()\[\]{}]/, '@brackets'],
          [/[^\s()\[\]{}";]+/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        ],
        block: [[/\|#/, 'comment', '@pop'], [/[^|]+/, 'comment'], [/\|/, 'comment']],
      },
    });
    monaco.editor.defineTheme('rs', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment', foreground: 'b794f6' }, { token: 'meta', foreground: 'f0b9d2', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'e07ba6' }, { token: 'number', foreground: 'd98cff' },
        { token: 'string', foreground: '8fe3a8' }, { token: 'constant', foreground: 'f0b9d2' },
        { token: 'identifier', foreground: 'f3eaf0' }, { token: 'delimiter.parenthesis', foreground: 'c9b3c0' },
      ],
      colors: {
        'editor.background': '#1c1420', 'editor.foreground': '#f3eaf0', 'editor.lineHighlightBackground': '#ffffff0d',
        'editor.selectionBackground': '#e07ba655', 'editorCursor.foreground': '#e07ba6',
        'editorLineNumber.foreground': '#8f6f80', 'editorLineNumber.activeForeground': '#e07ba6',
        'editorBracketMatch.background': '#e07ba633', 'editorBracketMatch.border': '#e07ba6',
        'editorWidget.background': '#2e1b33', 'minimap.background': '#1c1420', 'scrollbarSlider.background': '#e07ba633',
      },
    });
    ed = monaco.editor.create($('#ed'), {
      theme: 'rs', model: null, automaticLayout: true, fontSize: S.size,
      fontFamily: '"SF Mono", Menlo, Monaco, monospace', minimap: { enabled: true }, scrollBeyondLastLine: false,
      bracketPairColorization: { enabled: true }, renderWhitespace: 'selection', smoothScrolling: true,
    });
    ed.onDidChangeCursorPosition((e) => { $('#sPos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`; });
    boot();
  });
}

/* =============== tabs =============== */
const SAMPLE = `;; Neues Programm
(: square-circumference (real -> real))
(check-expect (square-circumference 1) 4)
(check-expect (square-circumference 4) 16)
(define square-circumference
  (lambda (a)
    (* 4 a)))
`;
function newTab(path, name, text) {
  const ex = path && tabs.find((t) => t.path === path);
  if (ex) return activate(ex);
  const t = { id: nid++, path, name, lang: S.lang, dirty: false, model: monaco.editor.createModel(text, 'racket') };
  t.model.onDidChangeContent(() => { if (!t.dirty) { t.dirty = true; renderTabs(); } });
  tabs.push(t); activate(t);
}
function activate(t) {
  cur = t; ed.setModel(t ? t.model : null);
  renderTabs(); syncLang(); if (t) ed.focus();
}
async function closeTab(t) {
  if (t.dirty && !confirm(`Close ${t.name} without saving?`)) return;
  const k = tabs.indexOf(t); tabs.splice(k, 1); t.model.dispose();
  if (cur === t) activate(tabs[Math.min(k, tabs.length - 1)] || null); else renderTabs();
}
function renderTabs() {
  const el = $('#tabs'); el.innerHTML = '';
  tabs.forEach((t) => {
    const d = document.createElement('div');
    d.className = 'tab' + (t === cur ? ' sel' : '') + (t.dirty ? ' dirty' : '');
    d.innerHTML = `<span>${esc(t.name)}</span><span class="x"><span>✕</span></span>`;
    d.onclick = () => activate(t);
    d.querySelector('.x').onclick = (e) => { e.stopPropagation(); closeTab(t); };
    el.append(d);
  });
  $('#title').textContent = cur ? `${cur.name}${cur.dirty ? ' ●' : ''} — Racket Studio` : 'Racket Studio';
}
const hasHeader = (text) => /^\s*(#lang|#reader)/m.test(text.split('\n').slice(0, 12).join('\n'));
function langList() { return S.custom ? [['Custom: ' + S.custom, S.custom], ...LANGS] : LANGS; }
function syncLang() {
  const sel = $('#lang');
  sel.innerHTML = langList().map(([n, v]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
  if (!cur) { sel.disabled = true; $('#sLang').textContent = ''; return; }
  const own = hasHeader(cur.model.getValue());
  sel.value = cur.lang; sel.disabled = own;
  sel.title = own ? 'This file declares its own language (#lang / #reader)' : 'Language level';
  $('#sLang').textContent = own ? 'Language: from file' : (langList().find(([, v]) => v === cur.lang) || [cur.lang])[0];
}
$('#lang').onchange = (e) => { cur.lang = e.target.value; S.lang = cur.lang; saveSettings(); syncLang(); };

/* =============== files =============== */
async function save(t = cur, as = false) {
  if (!t) return false;
  const text = t.model.getValue();
  let p = t.path;
  if (!p || as) p = await api.saveAs(t.name.endsWith('.rkt') ? t.name : t.name + '.rkt', text);
  else await api.write(p, text);
  if (!p) return false;
  t.path = p; t.name = baseName(p); t.dirty = false; renderTabs(); return true;
}
async function openFiles() { (await api.openFile()).forEach((f) => newTab(f.path, f.name, f.text)); }
async function openPath(p) { const f = await api.read(p); newTab(f.path, f.name, f.text); }
async function openFolder() { const d = await api.openDir(); if (d) { folder = d; renderTree(); } }
async function renderTree() {
  $('#folderName').textContent = folder ? baseName(folder).toUpperCase() : 'EXPLORER';
  const root = $('#tree'); root.innerHTML = '';
  if (!folder) {
    root.innerHTML = '<div class="muted">No folder opened.</div><div class="btn" id="bOpenDir">Open Folder</div>';
    $('#bOpenDir').onclick = openFolder; return;
  }
  await fill(root, folder, 0);
}
async function fill(host, dir, depth) {
  for (const e of await api.list(dir)) {
    const row = document.createElement('div');
    row.className = 'ti'; row.style.paddingLeft = 10 + depth * 14 + 'px';
    row.innerHTML = `<span class="ic">${e.dir ? '▸' : '·'}</span><span>${esc(e.name)}</span>`;
    host.append(row);
    if (e.dir) {
      const kids = document.createElement('div'); kids.hidden = true; host.append(kids);
      let loaded = false;
      row.onclick = async () => {
        kids.hidden = !kids.hidden; row.querySelector('.ic').textContent = kids.hidden ? '▸' : '▾';
        if (!loaded) { loaded = true; await fill(kids, e.path, depth + 1); }
      };
    } else row.onclick = () => openPath(e.path);
  }
}

/* =============== panel =============== */
function showPanel(p) {
  panelTab = p; $('#panel').classList.remove('hide');
  document.querySelectorAll('#ptabs [data-p]').forEach((d) => d.classList.toggle('on', d.dataset.p === p));
  $('#out').classList.toggle('on', p === 'out'); $('#replwrap').classList.toggle('on', p === 'repl'); $('#prob').classList.toggle('on', p === 'prob'); $('#stepwrap').classList.toggle('on', p === 'step');
  if (p === 'repl') $('#rin').focus();
}
document.querySelectorAll('#ptabs [data-p]').forEach((d) => (d.onclick = () => showPanel(d.dataset.p)));
$('#pClear').onclick = () => { $('#out').innerHTML = ''; $('#repl').innerHTML = ''; };
function put(id, text, cls) {
  const pre = $(id), s = document.createElement('span');
  if (cls) s.className = cls; s.textContent = text; pre.append(s); pre.scrollTop = pre.scrollHeight;
}

/* =============== running Racket =============== */
async function ensureRacket() {
  if (rk) return true;
  rk = await api.find(S.racket);
  $('#sRk').textContent = rk ? rk.version : 'Racket not found';
  if (!rk) {
    showPanel('out');
    put('#out', 'Could not find a Racket installation.\nInstall it from https://racket-lang.org (the full distribution includes all teachpacks), or set its folder in Settings (⌘,).\n', 'err');
  }
  return !!rk;
}
// Returns the file Racket should run, adding a #lang line (and teachpack requires) when the file has none.
async function prepare(t) {
  const text = t.model.getValue();
  if (hasHeader(text)) {
    if (t.path && !t.dirty) return { file: t.path, tmp: null, offset: 0 };
    return { file: await api.tmp(dirOf(t.path), text), tmp: true, offset: 0 };
  }
  const tps = S.tp.split(/[\s,]+/).filter(Boolean);
  const head = `#lang ${t.lang}\n` + (tps.length ? `(require ${tps.join(' ')}) ` : '');
  return { file: await api.tmp(dirOf(t.path), head + text), tmp: true, offset: 1 };
}
function fixText(job, s) {
  const re = new RegExp(reEsc(job.base) + ':(\\d+)(:\\d+)?', 'g');
  return s.split(job.file).join(job.tab.name).replace(re, (_m, l, c) => `${job.tab.name}:${Math.max(1, +l - job.offset)}${c || ''}`);
}
async function start(kind, opt = {}) {
  if (!cur || !(await ensureRacket())) return;
  const t = cur;
  monaco.editor.setModelMarkers(t.model, 'racket', []); $('#prob').innerHTML = '';
  const prep = await prepare(t);
  const id = nid++;
  const job = { id, tab: t, kind, file: prep.file, base: baseName(prep.file), tmp: prep.tmp, offset: prep.offset, errText: '' };
  jobs.set(id, job);
  const env = { PP_FILE: prep.file };
  let args;
  if (kind === 'run') {
    args = [prep.file];
    if (S.report !== false && !opt.plain) { args = [await api.runner(), prep.file]; job.runner = true; job.buf = ''; job.tests = []; }
    stop(false, true); runJob = job; showPanel('out'); $('#out').innerHTML = ''; $('#sTests').textContent = '';
  }
  if (kind === 'check') { args = ['-e', '(dynamic-require (list (quote file) (getenv "PP_FILE")) (void))']; showPanel('out'); $('#out').innerHTML = ''; runJob = job; }
  if (kind === 'repl') {
    args = ['-i', '-e', '(require racket/enter)', '-e', '(eval (list (quote enter!) (list (quote file) (getenv "PP_FILE"))))'];
    replJob = job; $('#repl').innerHTML = '';
  }
  const target = kind === 'repl' ? '#repl' : '#out';
  put(target, `$ racket ${kind === 'check' ? '(check syntax) ' : ''}${t.name}  [${hasHeader(t.model.getValue()) ? 'language from file' : t.lang}]\n`, 'dim');
  await api.run(id, rk.bin, args, dirOf(t.path) || undefined, env);
  return job;
}
const run = () => start('run');
const check = () => start('check');
function stop(report = true, quiet = false) {
  [runJob, replJob].forEach((j) => { if (j && !(quiet && j === replJob && false)) api.kill(j.id); });
  if (report && (runJob || replJob)) put('#out', '\n■ Stopped\n', 'dim');
}
function markFromError(job) {
  const m = job.errText.match(new RegExp(reEsc(job.base) + ':(\\d+):(\\d+)'));
  if (!m) return;
  const line = Math.max(1, +m[1] - job.offset), col = +m[2] + 1;
  const msg = fixText(job, job.errText).split('\n').find((l) => l.trim()) || 'Error';
  const model = job.tab.model, max = model.getLineCount();
  monaco.editor.setModelMarkers(model, 'racket', [{
    severity: monaco.MarkerSeverity.Error, message: msg, startLineNumber: Math.min(line, max), startColumn: col,
    endLineNumber: Math.min(line, max), endColumn: model.getLineMaxColumn(Math.min(line, max)),
  }]);
  const d = document.createElement('div'); d.className = 'prob';
  d.innerHTML = `<span class="err">✖</span> ${esc(msg)} <span class="dim">[${esc(job.tab.name)}:${line}:${col}]</span>`;
  d.onclick = () => { activate(job.tab); ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: col }); };
  $('#prob').append(d);
  document.querySelector('#ptabs [data-p="prob"]').textContent = 'Problems (1)';
}
function fmtTest(job, r) {
  const ok = r.passed, n = job.tests.length, line = Math.max(1, r.line - job.offset);
  put('#out', `${ok ? '✓' : '✗'} Test ${n}  ·  line ${line}  ·  ${r.kind}   ${ok ? '#t' : '#f'}\n`, ok ? 'you' : 'err');
  put('#out', `    tested:   ${r.expr}\n    expected: ${r.expected}\n    returned: ${r.actual}\n`);
}
function runnerLine(job, line) {
  if (!line.startsWith('\u001eRS:')) return put('#out', fixText(job, line + '\n'));
  let r; try { r = JSON.parse(line.slice(4)); } catch (_) { return; }
  if (r.type === 'note') put('#out', r.text + '\n', 'dim');
  if (r.type === 'test') { job.tests.push(r); fmtTest(job, r); }
  if (r.type === 'summary') {
    const all = r.passed === r.total;
    put('#out', r.total ? `\nTests: ${r.passed} of ${r.total} passed — ${all ? 'all #t' : (r.total - r.passed) + ' failed (#f)'}\n` : '\nNo tests found.\n', all ? 'you' : 'err');
    $('#sTests').textContent = r.total ? `Tests ${r.passed}/${r.total} ${all ? '✓' : '✗'}` : '';
  }
}
function markFails(job) {
  const model = job.tab.model, max = model.getLineCount();
  monaco.editor.setModelMarkers(model, 'racket', job.tests.filter((r) => !r.passed).map((r) => {
    const l = Math.min(max, Math.max(1, r.line - job.offset));
    return { severity: monaco.MarkerSeverity.Warning, message: `Test failed: expected ${r.expected}, returned ${r.actual}`, startLineNumber: l, startColumn: 1, endLineNumber: l, endColumn: model.getLineMaxColumn(l) };
  }));
}
api.on('proc', (m) => {
  const job = jobs.get(m.id); if (!job) return;
  const target = job.kind === 'repl' ? '#repl' : '#out';
  if (m.type === 'out') {
    if (job.runner) { job.buf += m.data; const ls = job.buf.split('\n'); job.buf = ls.pop(); ls.forEach((l) => runnerLine(job, l)); }
    else put(target, fixText(job, m.data));
  }
  if (m.type === 'err') { job.errText += m.data; if (!/RS-RUNNER-FAIL/.test(m.data)) put(target, fixText(job, m.data), 'err'); }
  if (m.type === 'exit') {
    if (job.runner && job.buf) runnerLine(job, job.buf);
    if (job.tmp) api.rm(job.file);
    jobs.delete(m.id);
    if (runJob === job) runJob = null; if (replJob === job) replJob = null;
    if (job.runner && m.code === 99) {
      put('#out', '\n(Test report unavailable for this program, running normally instead.)\n', 'dim');
      start('run', { plain: true }); return;
    }
    put(target, `\n[process finished${m.code ? ' with exit code ' + m.code : ''}]\n`, 'dim');
    if (job.errText && job.kind !== 'repl') markFromError(job);
    else if (job.runner) markFails(job);
    if (job.kind === 'check' && !job.errText) put('#out', '✓ Syntax OK\n', 'you');
  }
});
$('#rin').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const v = e.target.value; e.target.value = '';
  if (!replJob) { if (!(await start('repl'))) return; await new Promise((r) => setTimeout(r, 400)); }
  put('#repl', '> ' + v + '\n', 'you'); api.stdin(replJob.id, v + '\n');
});

/* =============== settings, toolbar, menu =============== */
function openSettings() {
  $('#setRk').value = S.racket; $('#setTp').value = S.tp; $('#setCu').value = S.custom; $('#setFs').value = S.size; $('#setRep').checked = S.report !== false;
  $('#modal').classList.add('on');
}
$('#setCancel').onclick = () => $('#modal').classList.remove('on');
$('#setOk').onclick = () => {
  S.racket = $('#setRk').value.trim(); S.tp = $('#setTp').value.trim(); S.custom = $('#setCu').value.trim(); S.size = +$('#setFs').value || 14; S.report = $('#setRep').checked;
  saveSettings(); rk = null; ed.updateOptions({ fontSize: S.size }); syncLang(); ensureRacket();
  $('#modal').classList.remove('on');
};
$('#bStep').onclick = () => stepProgram(); $('#bRun').onclick = run; $('#bCheck').onclick = check; $('#bStop').onclick = () => stop();
$('#aRun').onclick = run; $('#aSet').onclick = openSettings;
$('#aExp').onclick = () => $('#side').classList.toggle('hide');

async function openInDrRacket() {
  if (!cur || !(await ensureRacket())) return;
  if (!rk.drracket) return (showPanel('out'), put('#out', 'DrRacket.app was not found next to your Racket installation.\n', 'err'));
  if (!cur.path || cur.dirty) { if (!(await save())) return; }
  api.drracket(rk.drracket, cur.path);
}
const newFile = () => newTab(null, `Untitled-${nid}.rkt`, SAMPLE);
api.on('menu', (c) => ({
  new: newFile, open: openFiles, openDir: openFolder, save: () => save(), saveAs: () => save(cur, true),
  close: () => cur && closeTab(cur), run, stop: () => stop(), check, step: stepProgram, drracket: openInDrRacket, settings: openSettings,
  side: () => $('#side').classList.toggle('hide'), panel: () => $('#panel').classList.toggle('hide'),
}[c] || (() => {}))());
api.on('open-path', openPath);

async function boot() {
  syncLang(); renderTree(); newFile(); ensureRacket();
}
/* =============== stepper =============== */
let stp = { steps: [], i: 0, error: null };
function stepProgram() {
  if (!cur) return;
  stp = Object.assign({ i: 0 }, Stepper.run(cur.model.getValue()));
  showPanel('step'); renderStep();
}
function renderStep() {
  const { steps, i, error } = stp, body = $('#stepbody');
  const html = (t) => esc(t).replace(/\u0001/g, '<span class="hi">').replace(/\u0003/g, '<span class="res">').replace(/[\u0002\u0004]/g, '</span>');
  $('#sInfo').textContent = steps.length ? `Step ${i + 1} of ${steps.length}` : '';
  if (!steps.length) { body.innerHTML = error ? `<div class="err" style="color:#ff9aa8">${esc(error)}</div>` : '<div class="lbl">Nothing to step: the program has no expressions or tests to evaluate.</div>'; return; }
  const s = steps[i];
  body.innerHTML = `<div class="lbl">${esc(s.title)}</div><div class="lbl">Before</div><pre>${html(s.before)}</pre><div class="lbl">After</div><pre>${html(s.after)}</pre>` +
    (error && i === steps.length - 1 ? `<div style="color:#ff9aa8">Stepper stopped: ${esc(error)}</div>` : '');
}
const goStep = (k) => { stp.i = Math.max(0, Math.min(stp.steps.length - 1, k)); renderStep(); };
$('#sFirst').onclick = () => goStep(0); $('#sPrev').onclick = () => goStep(stp.i - 1);
$('#sNext').onclick = () => goStep(stp.i + 1); $('#sLast').onclick = () => goStep(stp.steps.length - 1);

setupMonaco();
