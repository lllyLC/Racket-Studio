/* Racket Studio stepper: a substitution stepper for a subset of the teaching languages. */
(function () {
  const M1 = '\u0001', M2 = '\u0002', M3 = '\u0003', M4 = '\u0004';
  const Y = (v) => ({ t: 'y', v });
  const N = (v, x) => ({ t: 'n', v, x: !!x });
  const B = (v) => ({ t: 'b', v });
  const S = (v) => ({ t: 's', v });

  /* ---------- reader ---------- */
  function atom(w) {
    if (/^#(t|true)$/.test(w)) return B(true);
    if (/^#(f|false)$/.test(w)) return B(false);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return N(parseFloat(w), w.includes('.'));
    return Y(w);
  }
  function read(src) {
    let i = 0; const out = [];
    const ws = () => {
      for (;;) {
        while (i < src.length && /\s/.test(src[i])) i++;
        if (src[i] === ';') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (src.startsWith('#|', i)) { const k = src.indexOf('|#', i); i = k < 0 ? src.length : k + 2; continue; }
        if (src.startsWith('#lang', i) || src.startsWith('#reader', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
        return;
      }
    };
    const one = () => {
      ws(); const c = src[i];
      if (c === ')' || c === ']') throw new Error('unexpected )');
      if (c === '(' || c === '[') {
        i++; const l = [];
        for (;;) { ws(); if (i >= src.length) throw new Error('missing )'); if (src[i] === ')' || src[i] === ']') { i++; return l; } l.push(one()); }
      }
      if (c === "'") { i++; return [Y('quote'), one()]; }
      if (c === '"') {
        let j = i + 1;
        while (src[j] !== '"') { if (j >= src.length) throw new Error('unterminated string'); if (src[j] === '\\') j++; j++; }
        const s = JSON.parse(src.slice(i, j + 1)); i = j + 1; return S(s);
      }
      let j = i; while (j < src.length && !/[\s()\[\]";]/.test(src[j])) j++;
      const w = src.slice(i, j); i = j; return atom(w);
    };
    for (;;) { ws(); if (i >= src.length) break; out.push(one()); }
    return out;
  }

  /* ---------- printer (with highlight markers) ---------- */
  function show(e, hi, a, b) {
    let s;
    if (e.t === 'n') s = e.x ? '#i' + e.v : String(e.v);
    else if (e.t === 's') s = JSON.stringify(e.v);
    else if (e.t === 'b') s = e.v ? '#true' : '#false';
    else if (e.t === 'y') s = e.v;
    else if (e.length === 2 && e[0].v === 'quote') s = "'" + show(e[1], hi, a, b);
    else s = '(' + e.map((x) => show(x, hi, a, b)).join(' ') + ')';
    return e === hi ? a + s + b : s;
  }
  const plain = (e) => show(e, null, '', '');

  /* ---------- helpers ---------- */
  const isLam = (e) => Array.isArray(e) && e.length === 3 && (e[0].v === 'lambda' || e[0].v === 'λ');
  function sub(e, n, v) {
    if (e.t === 'y') return e.v === n ? v : e;
    if (!Array.isArray(e)) return e;
    if (e[0] && e[0].v === 'quote') return e;
    if (isLam(e) && e[1].some((p) => p.v === n)) return e;
    return e.map((x) => sub(x, n, v));
  }
  const items = (e) => (e.t === 'y' && e.v === 'empty' ? [] : Array.isArray(e) && e[0].v === 'list' ? e.slice(1) : null);
  const mk = (l) => (l.length ? [Y('list'), ...l] : Y('empty'));

  /* ---------- primitives ---------- */
  const nums = (a, n) => a.forEach((x) => { if (x.t !== 'n') throw new Error(`${n}: expects a number, given ${plain(x)}`); });
  const inex = (a) => a.some((x) => x.x);
  const arith = (f) => (a, n) => { nums(a, n); return N(a.map((x) => x.v).reduce(f), inex(a)); };
  const cmp = (f) => (a, n) => { nums(a, n); return B(a.every((x, i) => i === 0 || f(a[i - 1].v, x.v))); };
  const un = (f) => (a, n) => { nums(a, n); const r = f(a[0].v); return N(r, inex(a) || !Number.isInteger(r)); };
  const lst = (x, n) => { const l = items(x); if (!l) throw new Error(`${n}: expects a list, given ${plain(x)}`); return l; };
  const PRIMS = {
    '+': arith((p, q) => p + q), '*': arith((p, q) => p * q),
    '-': (a, n) => (a.length === 1 ? (nums(a, n), N(-a[0].v, a[0].x)) : arith((p, q) => p - q)(a, n)),
    '/': (a, n) => { nums(a, n); if (a.slice(1).some((x) => x.v === 0)) throw new Error('/: division by zero'); const r = a.map((x) => x.v).reduce((p, q) => p / q); return N(r, inex(a) || !Number.isInteger(r)); },
    '=': cmp((p, q) => p === q), '<': cmp((p, q) => p < q), '>': cmp((p, q) => p > q), '<=': cmp((p, q) => p <= q), '>=': cmp((p, q) => p >= q),
    sqrt: (a, n) => { nums(a, n); if (a[0].v < 0) throw new Error('sqrt: negative numbers are not supported by this stepper'); const r = Math.sqrt(a[0].v); return N(r, a[0].x || !Number.isInteger(r)); },
    expt: (a, n) => { nums(a, n); return N(Math.pow(a[0].v, a[1].v), inex(a) || !Number.isInteger(Math.pow(a[0].v, a[1].v))); },
    abs: un(Math.abs), sqr: un((v) => v * v), add1: un((v) => v + 1), sub1: un((v) => v - 1),
    floor: un(Math.floor), ceiling: un(Math.ceil), round: un(Math.round),
    min: arith(Math.min), max: arith(Math.max),
    quotient: arith((p, q) => Math.trunc(p / q)), remainder: arith((p, q) => p % q), modulo: arith((p, q) => ((p % q) + q) % q),
    'zero?': (a) => B(a[0].v === 0), 'positive?': (a) => B(a[0].v > 0), 'negative?': (a) => B(a[0].v < 0),
    'even?': (a) => B(a[0].v % 2 === 0), 'odd?': (a) => B(Math.abs(a[0].v % 2) === 1),
    not: (a, n) => { if (a[0].t !== 'b') throw new Error('not: expected a boolean'); return B(!a[0].v); },
    'number?': (a) => B(a[0].t === 'n'), 'string?': (a) => B(a[0].t === 's'), 'boolean?': (a) => B(a[0].t === 'b'),
    'equal?': (a) => B(plain(a[0]) === plain(a[1])), 'string=?': (a) => B(a[0].v === a[1].v),
    'string-append': (a) => S(a.map((x) => x.v).join('')), 'string-length': (a) => N(a[0].v.length),
    'number->string': (a) => S(String(a[0].v)),
    'empty?': (a) => B(items(a[0]) !== null && items(a[0]).length === 0), 'cons?': (a) => B(items(a[0]) !== null && items(a[0]).length > 0),
    cons: (a) => mk([a[0], ...lst(a[1], 'cons')]),
    first: (a) => { const l = lst(a[0], 'first'); if (!l.length) throw new Error('first: expects a non-empty list'); return l[0]; },
    rest: (a) => { const l = lst(a[0], 'rest'); if (!l.length) throw new Error('rest: expects a non-empty list'); return mk(l.slice(1)); },
    length: (a) => N(lst(a[0], 'length').length), reverse: (a) => mk(lst(a[0], 'reverse').slice().reverse()),
    append: (a) => mk(a.flatMap((x) => lst(x, 'append'))),
  };

  /* ---------- engine ---------- */
  function run(text) {
    const funcs = new Map(), consts = new Map(), steps = [];
    const isVal = (e) => {
      if (e.t === 'n' || e.t === 's' || e.t === 'b') return true;
      if (e.t === 'y') return e.v === 'empty' || funcs.has(e.v) || !!PRIMS[e.v];
      if (!e.length) return false;
      return isLam(e) || e[0].v === 'quote' || (e[0].v === 'list' && e.slice(1).every(isVal));
    };
    function step(e) {
      if (isVal(e)) return null;
      if (e.t === 'y') {
        if (consts.has(e.v)) { const v = consts.get(e.v); return { e: v, b: e, a: v }; }
        throw new Error(e.v + ': this variable is not defined');
      }
      if (!Array.isArray(e) || !e.length) throw new Error('expected a function call or special form');
      const h = e[0].v;
      const rep = (i, s) => { const n = e.slice(); n[i] = s.e; return { e: n, b: s.b, a: s.a }; };
      const done = (r) => ({ e: r, b: e, a: r });
      if (h === 'cond') {
        const cl = e[1]; if (!cl) throw new Error('cond: all question results were false');
        const q = cl[0];
        if (q.t === 'y' && q.v === 'else') return done(cl[1]);
        const s = step(q);
        if (s) { const n = e.slice(); n[1] = [s.e, cl[1]]; return { e: n, b: s.b, a: s.a }; }
        if (q.t !== 'b') throw new Error('cond: question result is not true or false: ' + plain(q));
        return done(q.v ? cl[1] : [e[0], ...e.slice(2)]);
      }
      if (h === 'if') {
        const s = step(e[1]); if (s) return rep(1, s);
        if (e[1].t !== 'b') throw new Error('if: question result is not true or false: ' + plain(e[1]));
        return done(e[1].v ? e[2] : e[3]);
      }
      if (h === 'and' || h === 'or') {
        const args = e.slice(1); if (!args.length) return done(B(h === 'and'));
        const s = step(args[0]); if (s) return rep(1, s);
        const v = args[0]; if (v.t !== 'b') throw new Error(`${h}: question result is not true or false: ${plain(v)}`);
        if (args.length === 1) return done(v);
        return done(v.v === (h === 'or') ? v : [e[0], ...args.slice(1)]);
      }
      if (h === 'check-expect' || h === 'check-within') {
        for (let i = 1; i < e.length; i++) { const s = step(e[i]); if (s) return rep(i, s); }
        const [, a, b, t] = e;
        const ok = h === 'check-within' && a.t === 'n' && b.t === 'n' ? Math.abs(a.v - b.v) <= t.v : plain(a) === plain(b);
        return done(B(ok));
      }
      for (let i = 0; i < e.length; i++) {
        if (i === 0 && e[0].t === 'y') continue;
        const s = step(e[i]); if (s) return rep(i, s);
      }
      const args = e.slice(1);
      if (e[0].t === 'y') {
        const f = funcs.get(e[0].v);
        if (f) {
          if (f.p.length !== args.length) throw new Error(`${e[0].v}: expects ${f.p.length} argument(s), but found ${args.length}`);
          return done(f.p.reduce((bd, p, k) => sub(bd, p, args[k]), f.b));
        }
        if (PRIMS[e[0].v]) return done(PRIMS[e[0].v](args, e[0].v));
        throw new Error(e[0].v + ': this function is not defined');
      }
      if (isLam(e[0])) return done(e[0][1].reduce((bd, p, k) => sub(bd, p.v, args[k]), e[0][2]));
      throw new Error('function call: expected a function after the open parenthesis');
    }
    function evalSeq(f, title) {
      let c = f;
      for (let n = 0; n < 3000; n++) {
        const s = step(c); if (!s) return c;
        steps.push({ title, before: show(c, s.b, M1, M2), after: show(s.e, s.a, M3, M4) });
        c = s.e;
      }
      throw new Error('stopped after 3000 steps (infinite loop?)');
    }
    const SKIP = new Set([':', 'require', 'signature', 'check-property', 'check-satisfied', 'check-member-of', 'check-range', 'check-error']);
    let error = null;
    try {
      for (const f of read(text)) {
        if (!Array.isArray(f)) { evalSeq(f, 'Expression'); continue; }
        const h = f[0] && f[0].v;
        if (SKIP.has(h)) continue;
        if (h === 'define-struct' || h === 'define-record-type') throw new Error(h + ' is not supported by this stepper yet');
        if (h === 'define') {
          if (Array.isArray(f[1])) { funcs.set(f[1][0].v, { p: f[1].slice(1).map((x) => x.v), b: f[2] }); continue; }
          if (isLam(f[2])) { funcs.set(f[1].v, { p: f[2][1].map((x) => x.v), b: f[2][2] }); continue; }
          consts.set(f[1].v, evalSeq(f[2], 'define ' + f[1].v));
          continue;
        }
        evalSeq(f, plain(f).slice(0, 60));
      }
    } catch (e) { error = e.message; }
    return { steps, error };
  }
  window.Stepper = { run };
})();
