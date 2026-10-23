'use strict';
/* AI Trading Lab dashboard. Static: reads data/ written by lab/export.py.
   Every data string reaches the DOM through textContent / createTextNode; LLM markdown
   goes only through marked -> DOMPurify (allowlist) as a DOM fragment, never innerHTML. */
(() => {
  const DATA = 'data/';
  const DAY = 864e5;
  const MINUS = '−';
  const NONE = '—';

  // Defaults until summary.json supplies team_rules from lab/team.py.
  let VOTE = { Buy: 2, Overweight: 1, Hold: 0, Underweight: -1, Sell: -2 };
  let CUTS = [[1.5, 'Buy'], [0.5, 'Overweight'], [-0.5, 'Hold'], [-1.5, 'Underweight']];

  const RATING = {
    Buy: { label: 'Buy', short: 'Buy', cls: 'r-buy' },
    Overweight: { label: 'Overweight', short: 'OW', cls: 'r-ow' },
    Hold: { label: 'Hold', short: 'Hold', cls: 'r-hold' },
    Underweight: { label: 'Underweight', short: 'UW', cls: 'r-uw' },
    Sell: { label: 'Sell', short: 'Sell', cls: 'r-sell' },
    REVIEW: { label: 'Review', short: 'Rev', cls: 'r-review' },
    failed: { label: 'Failed', short: 'Fail', cls: 'r-failed' },
  };
  const SCALE = ['Sell', 'Underweight', 'Hold', 'Overweight', 'Buy'];
  const DIRECTIONAL = new Set(['Buy', 'Overweight', 'Underweight', 'Sell']);
  const NAMES = { grok: 'Grok', deepseek: 'DeepSeek', kimi: 'Kimi', glm: 'GLM', minimax: 'MiniMax', qwen: 'Qwen',
    claude: 'Claude', gpt: 'GPT', gemini: 'Gemini', team: 'Team' };
  // Fixed name -> palette slot so an AI keeps its color as arms are added or paused.
  const SLOT_ORDER = ['grok', 'deepseek', 'kimi', 'glm', 'minimax', 'qwen', 'claude', 'gpt', 'gemini'];
  const ANALYSTS = [
    ['market_report', 'Market analyst (price and technicals)'],
    ['sentiment_report', 'Social sentiment analyst'],
    ['news_report', 'News analyst'],
    ['fundamentals_report', 'Fundamentals analyst'],
  ];
  const PURIFY = {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'hr', 'sup', 'sub'],
    ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan', 'align', 'start'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = {
    summary: null, cap: 10000, arms: [], ranked: [], byName: new Map(), bench: [], benchLine: [],
    decisions: new Map(), trades: new Map(), runs: new Map(), callDates: [], selected: null, reasonToken: 0,
  };

  /* ---------- DOM helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
    for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : String(k));
    return el;
  }
  const $ = id => document.getElementById(id);

  /* ---------- formatting ---------- */
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const num = v => (isNum(v) ? v : null);
  const arr = v => (Array.isArray(v) ? v : []);
  const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const signOf = (r, s) => (r > 0 ? '+' + s : r < 0 ? MINUS + s : s);
  function money(v, dp = 0) { return isNum(v) ? (v < 0 ? MINUS : '') + (dp ? usd2 : usd0).format(Math.abs(v)) : NONE; }
  function smoney(v, dp = 0) {
    if (!isNum(v)) return NONE;
    const r = Number(v.toFixed(dp));
    return signOf(r, (dp ? usd2 : usd0).format(Math.abs(r)));
  }
  function pct(v, dp = 1, signed = true) {
    if (!isNum(v)) return NONE;
    const r = Number((v * 100).toFixed(dp));
    const s = Math.abs(r).toFixed(dp) + '%';
    return signed ? signOf(r, s) : (r < 0 ? MINUS : '') + s;
  }
  function pts(v, dp = 1) {
    if (!isNum(v)) return NONE;
    const r = Number((v * 100).toFixed(dp));
    return signOf(r, Math.abs(r).toFixed(dp) + ' pts');
  }
  const tone = v => (isNum(v) ? (v > 1e-12 ? 'pos' : v < -1e-12 ? 'neg' : '') : '');
  const compact = v => (isNum(v) ? compactFmt.format(v) : NONE);
  const lev = v => (isNum(v) ? v.toFixed(2) + '×' : NONE);
  function qty(v) {
    if (!isNum(v)) return NONE;
    const a = Math.abs(v);
    const dp = a >= 100 ? 1 : a >= 1 ? 2 : 4;
    return (v < 0 ? MINUS : '') + a.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function duration(secs) {
    if (!isNum(secs)) return NONE;
    const m = Math.floor(secs / 60), s = Math.round(secs % 60);
    return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
  }
  const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;
  function dayT(s) {
    const m = typeof s === 'string' ? DAY_RE.exec(s) : null;
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const dfLong = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const dfShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const dfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const dfStamp = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const fmtDay = s => (isNaN(dayT(s)) ? NONE : dfLong.format(dayT(s)));
  const fmtDayShort = s => (isNaN(dayT(s)) ? NONE : dfShort.format(dayT(s)));
  const fmtDayWeek = s => (isNaN(dayT(s)) ? NONE : dfWeek.format(dayT(s)));
  const nameOf = n => NAMES[n] || n.charAt(0).toUpperCase() + n.slice(1);
  const ratingKey = r => (r == null ? 'failed' : RATING[r] ? r : 'REVIEW');

  /* ---------- data ---------- */
  async function getJSON(path) {
    const res = await fetch(DATA + path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }
  const tryJSON = (path, fallback) => getJSON(path).catch(() => fallback);
  const armFile = (name, ...parts) => ['arms', name, ...parts].map(encodeURIComponent).join('/');

  function toSeries(rows) {
    return arr(rows)
      .filter(p => p && isDay(p.date) && isNum(p.equity))
      .map(p => ({ t: dayT(p.date), date: p.date, v: p.equity, gross: num(p.gross) }))
      .sort((a, b) => a.t - b.t);
  }

  function normalize(sum) {
    S.summary = sum;
    if (sum.team_rules && sum.team_rules.vote && Array.isArray(sum.team_rules.cuts)) {
      VOTE = sum.team_rules.vote;
      CUTS = sum.team_rules.cuts;
    }
    S.cap = num(sum.start_capital) ?? 10000;
    S.bench = toSeries(sum.benchmark && sum.benchmark.series);
    const startT = dayT(sum.start_date);
    S.benchLine = S.bench.length && !isNaN(startT) && S.bench[0].t > startT
      ? [{ t: startT, date: sum.start_date, v: S.cap }, ...S.bench] : S.bench;
    let extra = SLOT_ORDER.length;
    S.arms = arr(sum.arms).filter(a => a && typeof a.name === 'string' && a.name).map(a => {
      const team = a.provider === 'consensus';
      let cls = 'c-team', dashed = false;
      if (!team) {
        let i = SLOT_ORDER.indexOf(a.name.toLowerCase());
        if (i < 0) i = extra++;
        cls = `c${(i % 8) + 1}`;
        dashed = i >= 8;
      }
      const series = toSeries(a.series);
      return {
        ...a, team, cls, dashed, display: nameOf(a.name), series,
        equity: num(a.equity) ?? S.cap, ret: num(a.return) ?? 0,
        busts: arr(a.busts), positions: arr(a.positions), pending: arr(a.pending),
        ratings: a.ratings && typeof a.ratings === 'object' ? a.ratings : {},
      };
    });
    for (const a of S.arms) {
      S.byName.set(a.name, a);
      const v = vsSpy(a);
      a.spyRet = v ? v.spyRet : null;
      a.excess = v ? a.ret - v.spyRet : null;
    }
    S.ranked = [...S.arms].sort((x, y) => y.ret - x.ret || x.display.localeCompare(y.display));
  }

  function spyAt(t) {
    let lo = 0, hi = S.bench.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (S.bench[mid].t <= t) { best = S.bench[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return best ? best.v : S.cap; // before SPY's first open the benchmark is still cash
  }
  function vsSpy(a) {
    if (!S.bench.length || !a.series.length) return null;
    return { spyRet: spyAt(a.series[a.series.length - 1].t) / spyAt(a.series[0].t) - 1 };
  }

  const hasActivity = () => S.arms.some(a => a.series.length) || [...S.decisions.values()].some(d => d.length);

  /* ---------- tooltip (shared, fixed-position) ---------- */
  const tip = {
    el: null,
    show(anchor, content) {
      const el = this.el || (this.el = $('tip'));
      el.replaceChildren(...content);
      el.hidden = false;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth, ht = el.offsetHeight;
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(8, Math.min(left, innerWidth - w - 8));
      let top = r.top - ht - 8;
      if (top < 60) top = r.bottom + 8;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    },
    hide() { if (this.el) this.el.hidden = true; },
  };
  function attachTip(el, build) {
    const on = () => tip.show(el, build());
    el.addEventListener('pointerenter', on);
    el.addEventListener('focus', on);
    el.addEventListener('pointerleave', () => tip.hide());
    el.addEventListener('blur', () => tip.hide());
  }
  addEventListener('scroll', () => tip.hide(), { passive: true });
  const tipLine = (label, value, cls) => h('div', { class: 'tip-line' }, h('span', null, label), h('b', { class: cls || null }, value));

  /* ---------- small shared pieces ---------- */
  function keyDot(a) {
    return h('span', { class: `key-dot ${a.cls}${a.team ? ' team' : ''}${a.dashed ? ' dashed' : ''}`, 'aria-hidden': 'true' });
  }
  function chip(rating) {
    const k = ratingKey(rating);
    const meta = RATING[k];
    const label = k === 'REVIEW' && rating && rating !== 'REVIEW' ? String(rating) : meta.label;
    return h('span', { class: `chip ${meta.cls}` },
      k === 'REVIEW' ? h('span', { class: 'ico warn', 'aria-hidden': 'true' }, '?') : null,
      k === 'failed' ? h('span', { class: 'ico crit', 'aria-hidden': 'true' }, '!') : null, label);
  }
  function hitMark(hit) {
    if (hit === true) return h('span', { class: 'hitmark hit' }, h('span', { class: 'ico good', 'aria-hidden': 'true' }, '✓'), 'Hit');
    if (hit === false) return h('span', { class: 'hitmark miss' }, h('span', { class: 'ico crit', 'aria-hidden': 'true' }, '✕'), 'Miss');
    return null;
  }
  function modelsLine(a) {
    if (a.team) return typeof a.deep === 'string' && a.deep ? a.deep : 'Weighted vote of the AIs';
    const deep = typeof a.deep === 'string' ? a.deep : '', quick = typeof a.quick === 'string' ? a.quick : '';
    return deep && quick && deep !== quick ? `${deep} / ${quick}` : deep || quick;
  }
  function modelsTitle(a) {
    if (a.team) return [a.deep, a.quick].filter(x => typeof x === 'string' && x).join('; ');
    return `Deep model (research and portfolio managers): ${a.deep || NONE}. Quick model (analysts, debaters, trader): ${a.quick || NONE}.`;
  }
  function table(head, rows, opts = {}) {
    const t = h('table', { class: `tbl ${opts.cls || ''}` });
    t.append(h('thead', null, h('tr', null, head.map(c => h('th', { class: c.num ? 'num' : null, scope: 'col' }, c.label)))));
    t.append(h('tbody', null, rows));
    if (opts.foot) t.append(h('tfoot', null, opts.foot));
    return h('div', { class: 'scroll-x' }, t);
  }
  const td = (content, cls) => h('td', { class: cls || null }, content);
  const numTd = (text, toneCls) => h('td', { class: `num ${toneCls || ''}` }, text);
  function moreRows(all, size, renderRows, host) {
    let shown = 0;
    const tbody = host.querySelector('tbody');
    const row = h('div', { class: 'more-row' });
    const btn = h('button', { type: 'button', class: 'btn small' });
    row.append(btn);
    const step = () => {
      const next = all.slice(shown, shown + size);
      tbody.append(...renderRows(next));
      shown += next.length;
      const left = all.length - shown;
      btn.textContent = `Show ${Math.min(size, left)} more (${int.format(left)} remaining)`;
      row.hidden = left <= 0;
    };
    btn.addEventListener('click', step);
    step();
    return row;
  }
  function clamp(node) {
    const box = h('div', { class: 'clamp' }, node);
    const btn = h('button', { type: 'button', class: 'link-btn more-btn', 'aria-expanded': 'false', hidden: true }, 'Show all');
    btn.addEventListener('click', () => {
      const open = box.classList.toggle('open');
      btn.textContent = open ? 'Show less' : 'Show all';
      btn.setAttribute('aria-expanded', String(open));
    });
    requestAnimationFrame(() => {
      if (box.scrollHeight > box.clientHeight + 8) { box.classList.add('cut'); btn.hidden = false; }
    });
    return h('div', null, box, btn);
  }

  /* ---------- markdown (untrusted LLM text) ---------- */
  let purifyHooked = false;
  function md(text) {
    const div = h('div', { class: 'md' });
    const src = typeof text === 'string' ? text : text == null ? '' : JSON.stringify(text, null, 2);
    if (!src.trim()) { div.append(h('p', { class: 'muted' }, 'Not recorded.')); return div; }
    const { marked, DOMPurify } = window;
    if (marked && typeof marked.parse === 'function' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
      try {
        if (!purifyHooked) {
          DOMPurify.addHook('afterSanitizeAttributes', node => {
            if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer nofollow'); }
          });
          purifyHooked = true;
        }
        div.append(DOMPurify.sanitize(marked.parse(src, { gfm: true, breaks: true, async: false }), PURIFY));
        return div;
      } catch (e) { div.replaceChildren(); }
    }
    div.classList.add('plain');
    div.textContent = src;
    return div;
  }
  function splitTurns(text, roles) {
    const src = typeof text === 'string' ? text : '';
    const re = new RegExp(`(^|\\n)[ \\t]*\\**(${roles.join('|')}) Analyst:\\**[ \\t]*`, 'g');
    const marks = [...src.matchAll(re)];
    if (!marks.length) return src.trim() ? [{ role: null, body: src.trim() }] : [];
    const turns = [];
    const lead = src.slice(0, marks[0].index).trim();
    if (lead) turns.push({ role: null, body: lead });
    marks.forEach((m, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
      turns.push({ role: m[2], body: src.slice(m.index + m[0].length, end).trim() });
    });
    return turns;
  }

  /* ---------- line chart (hand-rolled SVG; crosshair + tooltip) ---------- */
  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / Math.max(1, count);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const f = raw / mag;
    const step = (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * mag;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = a; v <= b + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return { lo: a, hi: b, step, ticks };
  }
  function dayTicks(t0, t1, max) {
    const span = (t1 - t0) / DAY;
    const step = [1, 2, 3, 7, 14, 28, 56, 91, 182].find(s => span / s <= max) || Math.ceil(span / max / 30) * 30;
    const out = [];
    for (let t = t0; t <= t1 + 1; t += step * DAY) out.push(t);
    return out;
  }
  const moneyTick = step => v => (step >= 1000 ? `$${(v / 1000).toFixed(0)}K` : step >= 100 ? `$${(v / 1000).toFixed(1)}K` : usd0.format(v));
  const levTick = step => v => v.toFixed(step < 0.5 ? 2 : 1) + '×';

  function valueAt(s, t) {
    const p = s.points;
    let lo = 0, hi = p.length - 1, best = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (p[m].t <= t) { best = m; lo = m + 1; } else hi = m - 1; }
    if (best < 0) return null;
    const pt = p[best];
    if (pt.t !== t && t - pt.t > 4 * DAY) return null;
    return { v: pt.v, exact: pt.t === t, date: pt.t };
  }

  function lineChart(host, cfg) {
    const api = { hidden: new Set(), emph: null };
    host.classList.add('chart');
    const holder = h('div', { class: 'chart-svg' });
    holder.style.minHeight = `${innerWidth < 640 ? cfg.heightNarrow || Math.round(cfg.height * 0.8) : cfg.height}px`;
    const tipEl = h('div', { class: 'chart-tip', hidden: true });
    host.replaceChildren(holder, tipEl);
    let width = 0, svg = null, geo = null, idx = null;

    const ro = new ResizeObserver(() => {
      const w = Math.floor(holder.clientWidth);
      if (w > 0 && w !== width) { width = w; draw(); }
    });
    ro.observe(holder);
    host.dispose = () => ro.disconnect();

    function draw() {
      const vis = cfg.series.filter(s => s.points.length && !api.hidden.has(s.id));
      const narrow = width < 560;
      const H = narrow ? cfg.heightNarrow || Math.round(cfg.height * 0.8) : cfg.height;
      const allT = cfg.series.flatMap(s => s.points.map(p => p.t));
      let t0 = cfg.xDomain ? cfg.xDomain[0] : Math.min(...allT);
      let t1 = cfg.xDomain ? cfg.xDomain[1] : Math.max(...allT);
      if (!(t1 > t0)) { t0 -= DAY; t1 += DAY; }
      let vals = vis.flatMap(s => s.points.map(p => p.v)).concat((cfg.refs || []).map(r => r.v));
      if (!vals.length) vals = [0, 1];
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (cfg.yMin != null) lo = Math.min(lo, cfg.yMin);
      if (hi - lo < 1e-9) { const p = Math.abs(hi) * 0.01 || 1; lo -= p; hi += p; }
      const pad = (hi - lo) * 0.06;
      if (cfg.yMin == null || lo > cfg.yMin) lo -= pad;
      hi += pad;
      const yt = niceTicks(lo, hi, Math.max(3, Math.round((H - 40) / 52)));
      const yFmt = cfg.yTick(yt.step);
      const yLabels = yt.ticks.map(yFmt);
      const ml = Math.ceil(Math.max(...yLabels.map(s => s.length)) * 6.8 + 12);
      const labels = cfg.endLabels && !narrow && vis.length > 0;
      const mr = labels ? Math.min(150, 28 + Math.max(...vis.map(s => s.label.length)) * 7) : 14;
      const mt = 10, mb = 26;
      const pw = Math.max(20, width - ml - mr), ph = H - mt - mb;
      const x = t => ml + ((t - t0) / (t1 - t0)) * pw;
      const y = v => mt + (1 - (v - yt.lo) / (yt.hi - yt.lo)) * ph;

      svg = sv('svg', { viewBox: `0 0 ${width} ${H}`, width, height: H, role: 'img', 'aria-label': cfg.aria });
      const grid = sv('g');
      yt.ticks.forEach((v, i) => {
        grid.append(sv('line', { class: 'grid', x1: ml, x2: ml + pw, y1: Math.round(y(v)) + 0.5, y2: Math.round(y(v)) + 0.5 }));
        grid.append(sv('text', { x: ml - 8, y: y(v) + 4, 'text-anchor': 'end' }, yLabels[i]));
      });
      grid.append(sv('line', { class: 'axis', x1: ml, x2: ml + pw, y1: mt + ph + 0.5, y2: mt + ph + 0.5 }));
      const uniq = new Set(allT);
      const xt = uniq.size === 1 ? [...uniq] : dayTicks(t0, t1, Math.max(2, Math.floor(pw / (narrow ? 56 : 86))));
      for (const t of xt) {
        if (t < t0 || t > t1) continue;
        const X = x(t);
        const anchor = X - ml < 22 ? 'start' : ml + pw - X < 22 ? 'end' : 'middle';
        grid.append(sv('text', { x: X, y: mt + ph + 18, 'text-anchor': anchor }, dfShort.format(t)));
      }
      const refLabels = sv('g');
      for (const r of cfg.refs || []) {
        const Y = Math.round(y(r.v)) + 0.5;
        grid.append(sv('line', { class: 'ref', x1: ml, x2: ml + pw, y1: Y, y2: Y }));
        if (r.label) refLabels.append(sv('text', { class: 'ref-label', x: ml + pw - 8, 'text-anchor': 'end', y: Y - 10 < mt + 4 ? Y + 14 : Y - 6 }, r.label));
      }
      svg.append(grid);

      const layer = sv('g');
      for (const s of vis) {
        const g = sv('g', { class: `ser ${s.cls}${s.dashed ? ' dashed' : ''}`, 'data-id': s.id });
        const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
        if (cfg.area && s.points.length > 1) {
          const base = y(Math.max(yt.lo, cfg.yMin ?? yt.lo)).toFixed(1);
          g.append(sv('path', { class: 'area', d: `${d}L${x(s.points[s.points.length - 1].t).toFixed(1)},${base}L${x(s.points[0].t).toFixed(1)},${base}Z` }));
        }
        if (s.points.length > 1) g.append(sv('path', { class: 'line', d }));
        for (const bt of s.bustT || []) {
          const v = valueAt(s, bt);
          if (v) g.append(sv('circle', { class: 'bust', cx: x(bt), cy: y(v.v), r: 5 }));
        }
        const last = s.points[s.points.length - 1];
        g.append(sv('circle', { class: 'dot', cx: x(last.t), cy: y(last.v), r: 4 }));
        layer.append(g);
      }
      svg.append(layer, refLabels);

      if (labels) {
        const items = vis.map(s => {
          const last = s.points[s.points.length - 1];
          return { s, yEnd: y(last.v), xEnd: x(last.t), yl: y(last.v) };
        }).sort((a, b) => a.yl - b.yl);
        const gap = 15, top = mt + 4, bottom = mt + ph;
        for (let i = 0; i < items.length; i++) items[i].yl = Math.max(items[i].yl, i ? items[i - 1].yl + gap : top);
        for (let i = items.length - 1; i >= 0; i--) items[i].yl = Math.min(items[i].yl, i < items.length - 1 ? items[i + 1].yl - gap : bottom);
        const lx = ml + pw + 12;
        const lab = sv('g');
        for (const it of items) {
          if (Math.abs(it.yl - it.yEnd) > 2 || lx - it.xEnd > 14) {
            lab.append(sv('path', { class: 'leader', 'data-id': it.s.id, d: `M${it.xEnd + 6},${it.yEnd}L${lx - 10},${it.yl}L${lx - 4},${it.yl}` }));
          }
          const tx = sv('text', { class: 'end-label', 'data-id': it.s.id, x: lx, y: it.yl + 4 }, it.s.label);
          tx.addEventListener('pointerenter', () => setEmph(it.s.id));
          tx.addEventListener('pointerleave', () => setEmph(null));
          lab.append(tx);
        }
        svg.append(lab);
      }

      const dates = [...new Set(vis.flatMap(s => s.points.map(p => p.t)))].sort((a, b) => a - b);
      const hover = sv('g');
      const hit = sv('rect', { class: 'hit', x: ml, y: mt, width: pw, height: ph, tabindex: dates.length ? 0 : null,
        'aria-label': `${cfg.aria}. Use the left and right arrow keys to read values by date.` });
      svg.append(hover, hit);
      geo = { x, y, ml, pw, mt, ph, dates, vis, hover, width };
      if (idx != null && idx >= dates.length) idx = null;

      const pick = e => {
        const r = svg.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * width;
        const t = t0 + ((px - ml) / pw) * (t1 - t0);
        let best = 0;
        for (let i = 1; i < dates.length; i++) if (Math.abs(dates[i] - t) < Math.abs(dates[best] - t)) best = i;
        showAt(best);
      };
      hit.addEventListener('pointermove', pick);
      hit.addEventListener('pointerdown', pick);
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('focus', () => showAt(idx ?? dates.length - 1));
      hit.addEventListener('blur', hideTip);
      hit.addEventListener('keydown', e => {
        if (!dates.length) return;
        const cur = idx ?? dates.length - 1;
        const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: dates.length - 1 }[e.key];
        if (e.key === 'Escape') { hideTip(); return; }
        if (next == null) return;
        e.preventDefault();
        showAt(Math.max(0, Math.min(dates.length - 1, next)));
      });

      holder.replaceChildren(svg);
      holder.style.minHeight = '';
      applyEmph();
    }

    function showAt(i) {
      if (!geo || !geo.dates.length) return;
      idx = i;
      const t = geo.dates[i];
      const X = geo.x(t);
      geo.hover.replaceChildren(sv('line', { class: 'xhair', x1: Math.round(X) + 0.5, x2: Math.round(X) + 0.5, y1: geo.mt, y2: geo.mt + geo.ph }));
      const rows = [];
      for (const s of geo.vis) {
        const v = valueAt(s, t);
        if (!v) continue;
        if (v.exact) {
          const g = sv('g', { class: `${s.cls}` });
          g.append(sv('circle', { class: 'dot', cx: X, cy: geo.y(v.v), r: 4 }));
          geo.hover.append(g);
        }
        rows.push({ s, v });
      }
      rows.sort((a, b) => b.v.v - a.v.v);
      tipEl.replaceChildren(h('div', { class: 'tip-head' }, dfWeek.format(t)),
        ...rows.map(({ s, v }) => h('div', { class: 'tip-row' },
          h('span', { class: `key-line ${s.cls}${s.dashed ? ' dashed' : ''}${s.team ? ' team' : ''}` }),
          h('b', null, cfg.tipFmt(v.v)),
          h('span', null, s.label + (v.exact ? '' : ` (${dfShort.format(v.date)})`) + ((s.bustT || []).includes(t) ? ', bust' : '')))));
      tipEl.hidden = false;
      const w = tipEl.offsetWidth;
      let left = X + 14;
      if (left + w > geo.width) left = X - 14 - w;
      tipEl.style.left = `${Math.max(0, left)}px`;
      tipEl.style.top = `${geo.mt}px`;
    }
    function hideTip() { tipEl.hidden = true; if (geo) geo.hover.replaceChildren(); }
    function applyEmph() {
      if (!svg) return;
      for (const el of svg.querySelectorAll('[data-id]')) el.classList.toggle('dim', api.emph != null && el.getAttribute('data-id') !== api.emph);
    }
    function setEmph(id) { api.emph = id; applyEmph(); }
    api.setEmph = setEmph;
    api.setHidden = (id, hide) => { if (hide) api.hidden.add(id); else api.hidden.delete(id); draw(); };
    return api;
  }

  function legend(series, chart) {
    const row = h('div', { class: 'legend', role: 'group', 'aria-label': 'Series (select to show or hide)' });
    for (const s of series) {
      const btn = h('button', { type: 'button', class: 'lg-item', 'aria-pressed': 'true' },
        h('span', { class: `key-line ${s.cls}${s.dashed ? ' dashed' : ''}${s.team ? ' team' : ''}`, 'aria-hidden': 'true' }), s.label);
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', String(!on));
        chart.setHidden(s.id, on);
      });
      const em = () => chart.setEmph(s.id), un = () => chart.setEmph(null);
      btn.addEventListener('pointerenter', em);
      btn.addEventListener('pointerleave', un);
      btn.addEventListener('focus', em);
      btn.addEventListener('blur', un);
      row.append(btn);
    }
    return row;
  }

  function dataTableToggle(series, fmt) {
    const box = h('div', { class: 'chart-table', hidden: true });
    const btn = h('button', { type: 'button', class: 'btn small', 'aria-expanded': 'false' }, 'Show data table');
    btn.addEventListener('click', () => {
      const open = box.hidden;
      if (open && !box.firstChild) {
        const dates = [...new Set(series.flatMap(s => s.points.map(p => p.t)))].sort((a, b) => b - a);
        const maps = series.map(s => new Map(s.points.map(p => [p.t, p.v])));
        const t = h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Date'), series.map(s => h('th', { class: 'num', scope: 'col' }, s.label)))),
          h('tbody', null, dates.map(d => h('tr', null, h('td', null, dfLong.format(d)),
            maps.map(m => numTd(m.has(d) ? fmt(m.get(d)) : NONE))))));
        box.append(t);
      }
      box.hidden = !open;
      btn.textContent = open ? 'Hide data table' : 'Show data table';
      btn.setAttribute('aria-expanded', String(open));
    });
    return { btn, box };
  }

  function disposeCharts(root) { for (const c of root.querySelectorAll('.chart')) c.dispose && c.dispose(); }

  const armSeries = a => ({ id: a.name, label: a.display, cls: a.cls, dashed: a.dashed, team: a.team,
    points: a.series, bustT: a.busts.map(b => dayT(b.date)).filter(t => !isNaN(t)) });
  const benchSeries = () => ({ id: '__spy', label: benchName(), cls: 'c-bench', dashed: false, points: S.benchLine });
  const benchName = () => (S.summary.benchmark && typeof S.summary.benchmark.ticker === 'string' ? S.summary.benchmark.ticker : 'SPY');
  function labDomain() {
    const ts = S.arms.flatMap(a => a.series.map(p => p.t)).concat(S.benchLine.map(p => p.t));
    return ts.length ? [Math.min(...ts), Math.max(...ts)] : null;
  }

  /* ---------- header + notices ---------- */
  function renderHeader() {
    const sum = S.summary;
    const llm = S.arms.filter(a => !a.team).length;
    const team = S.arms.some(a => a.team);
    const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    $('lede').textContent = `${words[llm] || llm} AI models each run a ${money(S.cap)} paper portfolio with the TradingAgents multi-agent framework`
      + (team ? ', and a separate "team" portfolio trades their weighted vote' : '')
      + `. No real money is traded: fills are simulated at the first market open after each decision. Started ${fmtDay(sum.start_date)}.`;
    const gen = typeof sum.generated_at === 'string' ? new Date(sum.generated_at) : null;
    const up = $('updated');
    if (gen && !isNaN(gen)) {
      up.textContent = `Updated ${dfStamp.format(gen)} ET`;
      const ageDays = Math.floor((Date.now() - gen.getTime()) / DAY);
      if (ageDays >= 4) up.append(` (${ageDays} days ago)`);
      $('foot-meta').textContent = `Data updated ${dfStamp.format(gen)} ET. No cookies, analytics or tracking.`;
    } else up.textContent = 'Update time not recorded';
  }

  function renderNotices() {
    const box = $('notice');
    box.replaceChildren();
    const sessions = S.bench.length;
    const anySeries = S.arms.some(a => a.series.length);
    if (!hasActivity()) {
      box.append(h('div', { class: 'card empty' },
        h('h3', null, 'No decisions yet'),
        h('p', null, `Each AI makes its first calls after the market close on ${fmtDay(S.summary.start_date)}. `
          + 'Results, positions and reasoning appear here after that run.')));
      return;
    }
    if (anySeries && !S.arms.some(a => a.trades > 0)) {
      box.append(h('div', { class: 'notice' }, h('strong', null, 'First decisions are in. '),
        'Orders fill at the next market open, so portfolio values start to move after that.'));
    } else if (sessions < 20) {
      box.append(h('div', { class: 'notice' }, h('strong', null, `Early results: ${sessions} trading session${sessions === 1 ? '' : 's'} so far. `),
        'Returns over a few weeks are mostly noise, and a hit rate needs dozens of graded calls before it says much. The number of graded calls (n) is shown next to every rate.'));
    }
    const gen = new Date(S.summary.generated_at);
    const age = Math.floor((Date.now() - gen.getTime()) / DAY);
    if (!isNaN(age) && age >= 4) {
      box.append(h('div', { class: 'notice' }, h('strong', null, `Last update was ${age} days ago. `), 'The daily run may be paused.'));
    }
  }

  /* ---------- leaderboard ---------- */
  function kpi(label, value, sub, key) {
    return h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, key || null, label),
      h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
  }

  function renderKpis() {
    const box = $('kpis');
    box.replaceChildren();
    if (!S.arms.length) return;
    const top = S.ranked[0];
    const level = S.ranked.every(a => Math.abs(a.equity - top.equity) < 0.005);
    box.append(level
      ? kpi('Highest portfolio value', money(top.equity), 'All portfolios level so far')
      : kpi('Highest portfolio value', money(top.equity), `${top.display}, ${pct(top.ret)} since start`, keyDot(top)));
    if (S.bench.length) {
      const last = S.bench[S.bench.length - 1];
      box.append(kpi(`${benchName()} buy-and-hold`, money(last.v), `${pct(last.v / S.cap - 1)} since ${fmtDayShort(S.bench[0].date)} open`));
    } else {
      box.append(kpi(`${benchName()} buy-and-hold`, money(S.cap), 'Bought at the first open after the start'));
    }
    const compared = S.arms.filter(a => a.excess != null);
    if (compared.length) {
      box.append(kpi(`Ahead of ${benchName()}`, `${compared.filter(a => a.excess > 0).length} of ${compared.length}`,
        'portfolios with a higher return over the same dates'));
    }
    const decisions = S.arms.reduce((n, a) => n + (num(a.decisions) || 0), 0);
    box.append(kpi('Trading sessions', int.format(S.bench.length), `since ${fmtDay(S.summary.start_date)}; ${int.format(decisions)} decisions`));
    const llm = S.arms.filter(a => !a.team);
    const g1 = llm.reduce((n, a) => n + (num(a.graded_1d) || 0), 0), h1 = llm.reduce((n, a) => n + (num(a.hits_1d) || 0), 0);
    const g5 = llm.reduce((n, a) => n + (num(a.graded) || 0), 0), h5 = llm.reduce((n, a) => n + (num(a.hits) || 0), 0);
    box.append(kpi(`Calls that beat ${benchName()}`, g1 ? pct(h1 / g1, 0, false) : NONE,
      `next session, all AIs, n=${int.format(g1)}` + (g5 ? `; 5 sessions: ${pct(h5 / g5, 0, false)}, n=${int.format(g5)}` : '')));
  }

  function hitCell(hits, graded) {
    const g = num(graded) || 0;
    if (!g) return h('td', { class: 'num' }, h('span', { class: 'lown' }, NONE), h('span', { class: 'sub' }, 'n=0'));
    return h('td', { class: 'num', title: `${hits} of ${g} graded calls beat ${benchName()} in the called direction` },
      pct((num(hits) || 0) / g, 0, false), h('span', { class: 'sub' }, `${int.format(hits || 0)} of ${int.format(g)}`));
  }

  function renderBoard() {
    const maxAbs = Math.max(0.005, ...S.arms.map(a => Math.abs(a.ret)));
    const b = benchName();
    const head1 = h('tr', null,
      h('th', { rowspan: 2, scope: 'col' }, '#'),
      h('th', { rowspan: 2, scope: 'col', class: 'sticky' }, 'AI'),
      h('th', { rowspan: 2, class: 'num', scope: 'col' }, 'Value'),
      h('th', { rowspan: 2, class: 'num', scope: 'col' }, 'Return'),
      h('th', { rowspan: 2, class: 'num', scope: 'col', title: `Return minus ${b}'s return over the same dates` }, `vs ${b}`),
      h('th', { rowspan: 2, class: 'num wrap-th', scope: 'col' }, 'Max drawdown'),
      h('th', { rowspan: 2, class: 'num wrap-th', scope: 'col', title: 'Average gross exposure divided by equity' }, 'Avg leverage'),
      h('th', { colspan: 2, class: 'group', scope: 'colgroup' }, 'Graded next session'),
      h('th', { colspan: 2, class: 'group', scope: 'colgroup' }, 'Graded after 5 sessions'),
      h('th', { rowspan: 2, class: 'num', scope: 'col' }, 'Trades'),
      h('th', { rowspan: 2, class: 'num', scope: 'col', title: 'Times the portfolio lost its whole stake and restarted' }, 'Busts'),
      h('th', { rowspan: 2, class: 'num', scope: 'col', title: 'LLM tokens, input plus output' }, 'Tokens'));
    const head2 = h('tr', null,
      h('th', { class: 'num', scope: 'col' }, 'Hit rate'), h('th', { class: 'num', scope: 'col' }, 'Avg signed alpha'),
      h('th', { class: 'num', scope: 'col' }, 'Hit rate'), h('th', { class: 'num', scope: 'col' }, 'Avg signed alpha'));
    const rankOf = a => 1 + S.ranked.filter(o => o.equity - a.equity > 0.005).length;
    const rows = S.ranked.map((a, i) => {
      const w = (Math.abs(a.ret) / maxAbs) * 50;
      const bar = h('span', { class: 'ret-bar', 'aria-hidden': 'true' });
      if (Math.abs(a.ret) > 1e-9) {
        const fill = h('i', { class: a.ret > 0 ? 'up' : 'down' });
        fill.style.width = `${w}%`;
        if (a.ret > 0) fill.style.left = '50%'; else fill.style.right = '50%';
        bar.append(fill);
      }
      const nameBtn = h('button', { type: 'button', class: 'who-name', title: `Open ${a.display}'s portfolio and decisions` }, a.display);
      nameBtn.addEventListener('click', () => selectArm(a.name, { scroll: true }));
      const busts = a.busts.length;
      const tokens = (num(a.tokens_in) || 0) + (num(a.tokens_out) || 0);
      return h('tr', { class: i === 0 ? 'first' : null },
        h('td', { class: 'rank num' }, String(rankOf(a))),
        h('td', { class: 'sticky' }, h('div', { class: 'who' }, keyDot(a), h('div', null,
          nameBtn, a.team ? h('span', { class: 'pill' }, 'Ensemble') : null, a.enabled === false ? h('span', { class: 'pill' }, 'Paused') : null,
          h('span', { class: 'who-models', title: modelsTitle(a) }, modelsLine(a))))),
        numTd(money(a.equity)),
        h('td', { class: `num` }, h('span', { class: 'ret' }, bar, h('span', { class: tone(a.ret) }, pct(a.ret)))),
        numTd(pts(a.excess), tone(a.excess)),
        numTd(pct(num(a.max_drawdown), 1)),
        numTd(lev(num(a.avg_gross))),
        hitCell(a.hits_1d, a.graded_1d), numTd(pct(num(a.avg_earned_1d), 2), tone(num(a.avg_earned_1d))),
        hitCell(a.hits, a.graded), numTd(pct(num(a.avg_earned), 2), tone(num(a.avg_earned))),
        numTd(int.format(num(a.trades) || 0)),
        h('td', { class: 'num', title: busts ? a.busts.map(x => `${fmtDay(x.date)}: ${money(num(x.equity))}`).join('; ') : null },
          busts ? h('span', { class: 'hitmark miss' }, h('span', { class: 'ico crit', 'aria-hidden': 'true' }, '!'), String(busts)) : h('span', { class: 'lown' }, '0')),
        h('td', { class: 'num', title: a.team ? null : `${int.format(num(a.tokens_in) || 0)} in, ${int.format(num(a.tokens_out) || 0)} out` },
          a.team ? h('span', { class: 'lown' }, NONE) : compact(tokens)));
    });
    $('board').replaceChildren(h('table', { class: 'tbl board' }, h('thead', null, head1, head2), h('tbody', null, rows)));
    $('board-note').textContent = `Hit rate: share of directional calls (Buy, Overweight, Underweight, Sell) that beat ${b} in the called direction; `
      + `n is how many have been graded. Signed alpha: the asset's return minus ${b}'s over the same window, counted positive when the call's direction was right, averaged over graded calls. `
      + `A bust resets a portfolio to ${money(S.cap)}; value and return then cover the current stake only.`;
  }

  /* ---------- equity overview ---------- */
  function renderEquity() {
    const card = $('equity-card');
    disposeCharts(card);
    const withData = S.ranked.filter(a => a.series.length);
    $('equity-sub').textContent = `Each portfolio's value at the daily close, against ${money(S.cap)} put into ${benchName()} at the first open and held (gray). The straight line at ${money(S.cap)} marks the starting value.`;
    if (!withData.length) {
      card.replaceChildren(h('p', { class: 'empty-inline' }, `The value history starts with the first run after the close on ${fmtDay(S.summary.start_date)}.`));
      return;
    }
    if (withData.every(a => a.series.length < 2)) {
      card.replaceChildren(h('p', { class: 'empty-inline' }, `Every portfolio is at ${money(S.cap)} so far. The first orders fill at the next market open; the chart starts after the following close.`));
      return;
    }
    const series = withData.map(armSeries);
    if (S.benchLine.length) series.push(benchSeries());
    const host = h('div');
    card.replaceChildren(host);
    const chart = lineChart(host, {
      series, height: 360, heightNarrow: 280, endLabels: true, xDomain: labDomain(),
      yTick: moneyTick, tipFmt: v => money(v), refs: [{ v: S.cap }],
      aria: `Line chart of portfolio value over time for ${series.length} series`,
    });
    card.prepend(legend(series, chart));
    const { btn, box } = dataTableToggle(series, v => money(v));
    const foot = h('div', { class: 'chart-foot' },
      h('span', null, S.arms.some(a => a.busts.length) ? 'Hollow marker: the portfolio lost its stake and restarted. ' : '',
        'Hover or tap the chart for values; select a name to hide it.'), btn);
    card.append(foot, box);
  }

  /* ---------- latest calls ---------- */
  function renderCallsSection() {
    const dates = new Set();
    for (const d of S.decisions.values()) for (const r of d) if (isDay(r.date)) dates.add(r.date);
    S.callDates = [...dates].sort().reverse();
    const sel = $('calls-date');
    sel.replaceChildren(...S.callDates.map(d => h('option', { value: d }, fmtDayWeek(d))));
    $('calls-date-field').hidden = S.callDates.length < 2;
    sel.onchange = () => renderMatrix(sel.value);
    renderMatrix(S.callDates[0] || null);
    renderWeightsCard($('weights-card'));
  }

  function cellTip(a, ticker, date, rec) {
    const out = [h('div', { class: 'tip-head' }, `${a.display} on ${ticker}, ${fmtDay(date)}`)];
    if (!rec) { out.push(h('div', null, 'No call recorded for this date.')); return out; }
    const k = ratingKey(rec.rating);
    out.push(tipLine('Call', RATING[k].label));
    if (a.team && isNum(rec.consensus)) out.push(tipLine('Weighted vote', signedNum(rec.consensus)));
    if (isNum(rec.alpha_1d)) out.push(tipLine('Alpha, next session', `${pct(rec.alpha_1d, 2)} ${rec.hit_1d ? '(hit)' : '(miss)'}`));
    if (isNum(rec.alpha)) out.push(tipLine('Alpha, 5 sessions', `${pct(rec.alpha, 2)} ${rec.hit ? '(hit)' : '(miss)'}`));
    if (DIRECTIONAL.has(rec.rating) && !isNum(rec.alpha_1d)) out.push(h('div', { class: 'tip-note' }, 'Not graded yet.'));
    if (k === 'failed' && typeof rec.error === 'string') out.push(h('div', { class: 'tip-note' }, rec.error.slice(0, 160)));
    out.push(h('div', { class: 'tip-note' }, a.team ? 'Select to see the vote.' : 'Select to read the reasoning.'));
    return out;
  }
  const signedNum = v => signOf(Number(v.toFixed(2)), Math.abs(v).toFixed(2));

  function renderMatrix(date) {
    const card = $('calls-card');
    if (!date) {
      card.replaceChildren(h('p', { class: 'empty-inline' }, `No calls yet. The first decisions post after the market close on ${fmtDay(S.summary.start_date)}.`));
      return;
    }
    const universe = arr(S.summary.universe).filter(t => typeof t === 'string');
    const extra = new Set();
    for (const d of S.decisions.values()) for (const r of d) if (r.date === date && typeof r.ticker === 'string' && !universe.includes(r.ticker)) extra.add(r.ticker);
    const tickers = [...universe, ...extra];
    const lookup = a => {
      const m = new Map();
      for (const r of S.decisions.get(a.name) || []) if (r.date === date) m.set(r.ticker, r);
      return m;
    };
    const row = a => {
      const m = lookup(a);
      return h('tr', null, h('th', { scope: 'row' }, h('div', { class: 'who' }, keyDot(a), a.team ? 'Team vote' : a.display)),
        tickers.map(t => {
          const rec = m.get(t);
          const k = rec ? ratingKey(rec.rating) : null;
          const meta = k ? RATING[k] : null;
          if (!rec) return h('td', null, h('span', { class: 'cell r-none', title: `${a.display}: no call on ${t}` }, NONE));
          const cell = h('button', {
            type: 'button', class: `cell ${meta.cls}`,
            'aria-label': `${a.display}, ${t}, ${fmtDay(date)}: ${meta.label}. Open ${a.team ? 'vote' : 'reasoning'}.`,
          }, h('span', { class: 'f' }, meta.label), h('span', { class: 's' }, meta.short));
          cell.addEventListener('click', () => { tip.hide(); openReasoning(a.name, date, t, { from: 'calls' }); });
          attachTip(cell, () => cellTip(a, t, date, rec));
          return h('td', null, cell);
        }));
    };
    const indiv = S.ranked.filter(a => !a.team), teams = S.ranked.filter(a => a.team);
    const body = h('tbody', null, indiv.map(row));
    if (teams.length) {
      body.append(h('tr', { class: 'team-sep', 'aria-hidden': 'true' }, h('td', { colspan: tickers.length + 1 }, h('div'))));
      body.append(...teams.map(row));
    }
    const tbl = h('table', { class: 'matrix' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'muted' }, 'AI')), tickers.map(t => h('th', { scope: 'col' }, t)))), body);
    const scale = h('div', { class: 'scale', 'aria-label': 'Rating colors' },
      SCALE.map(r => h('span', { class: 'scale-item' }, h('span', { class: `swatch ${RATING[r].cls}` }), RATING[r].label)),
      h('span', { class: 'scale-div' }),
      h('span', { class: 'scale-item' }, h('span', { class: 'ico warn', 'aria-hidden': 'true' }, '?'), 'Review: no clear rating, position kept'),
      h('span', { class: 'scale-item' }, h('span', { class: 'swatch r-failed' }), 'Failed: analysis error, position kept'),
      h('span', { class: 'scale-item' }, h('span', { class: 'swatch r-none' }), 'No call'));
    const stocksQuiet = S.callDates.length && universe.some(t => !t.endsWith('-USD')) &&
      ![...S.decisions.values()].some(d => d.some(r => r.date === date && typeof r.ticker === 'string' && !r.ticker.endsWith('-USD')));
    card.replaceChildren(
      h('p', { class: 'chart-sub' }, `Decisions from ${fmtDayWeek(date)}.`, stocksQuiet ? ' Stocks are not analyzed on days the US market is closed; crypto is analyzed every day.' : ''),
      h('div', { class: 'scroll-x' }, tbl), scale);
  }

  function renderWeightsCard(card) {
    const tw = S.summary.team_weights;
    const entries = tw && typeof tw === 'object'
      ? Object.entries(tw).filter(([, v]) => v && isNum(v.weight) && v.weight >= 0) : [];
    if (!entries.length || !S.arms.some(a => a.team)) { card.hidden = true; return; }
    card.hidden = false;
    const total = entries.reduce((s, [, v]) => s + v.weight, 0) || 1;
    const maxShare = Math.max(...entries.map(([, v]) => v.weight / total));
    entries.sort((a, b) => b[1].weight - a[1].weight);
    const rows = entries.map(([name, v]) => {
      const a = S.byName.get(name) || { name, display: nameOf(name), cls: 'c-bench', team: false, dashed: false };
      const share = v.weight / total;
      const fill = h('i');
      fill.style.width = `${(share / maxShare) * 100}%`;
      return h('tr', null,
        td(h('div', { class: 'who' }, keyDot(a), a.display)),
        h('td', { class: 'bar-cell' }, h('div', { class: 'wbar', 'aria-hidden': 'true' }, fill)),
        numTd(pct(share, 1, false)),
        numTd(isNum(v.weight) ? v.weight.toPrecision(3) : NONE),
        numTd(int.format(num(v.graded) || 0)),
        numTd(pts(num(v.earned)), tone(num(v.earned))));
    });
    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'How much say each AI has in the team vote'),
        h('p', null, 'Weights for the next team decision. Each AI\'s weight grows with the summed alpha of its graded calls '
          + '(signed so a correct bearish call counts as positive), graded at the next session\'s close. AIs with no graded calls start at 1.'))),
      table([{ label: 'AI' }, { label: 'Share of the vote' }, { label: 'Share', num: true }, { label: 'Weight', num: true },
        { label: 'Graded calls (n)', num: true }, { label: 'Summed signed alpha', num: true }], rows));
  }

  /* ---------- detail ---------- */
  function renderTabs() {
    const tabs = $('tabs');
    const indiv = S.ranked.filter(a => !a.team), teams = S.ranked.filter(a => a.team);
    const mk = a => {
      const b = h('button', { type: 'button', role: 'tab', class: 'tab', id: `tab-${a.name}`, 'aria-controls': 'panel',
        'aria-selected': 'false', tabindex: '-1', 'data-arm': a.name }, keyDot(a), a.team ? 'Team (ensemble)' : a.display);
      b.addEventListener('click', () => selectArm(a.name));
      return b;
    };
    tabs.replaceChildren(...indiv.map(mk), teams.length ? h('span', { class: 'tab-sep', 'aria-hidden': 'true' }) : null, ...teams.map(mk));
    tabs.addEventListener('keydown', e => {
      const list = [...tabs.querySelectorAll('[role=tab]')];
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
      if (j == null) return;
      e.preventDefault();
      const t = list[(j + list.length) % list.length];
      t.focus();
      selectArm(t.dataset.arm);
    });
  }

  function selectArm(name, opts = {}) {
    const a = S.byName.get(name);
    if (!a) return;
    if (S.selected !== name) {
      S.selected = name;
      for (const t of $('tabs').querySelectorAll('[role=tab]')) {
        const on = t.dataset.arm === name;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        if (on) {
          const strip = t.closest('.tabs-scroll');
          const l = t.offsetLeft - strip.offsetLeft, r = l + t.offsetWidth;
          if (l < strip.scrollLeft) strip.scrollLeft = l - 8;
          else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth + 8;
        }
      }
      $('panel').setAttribute('aria-labelledby', `tab-${name}`);
      renderPanel(a);
    }
    if (!opts.keepHash) setHash({ ai: name });
    if (opts.scroll) $('detail').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function renderPanel(a) {
    const panel = $('panel');
    disposeCharts(panel);
    const tiles = [
      kpi('Portfolio value', money(a.equity), `${pct(a.ret)} since start`),
      kpi(`vs ${benchName()}`, pts(a.excess), a.spyRet != null ? `${benchName()} ${pct(a.spyRet)} over the same dates` : 'No benchmark data yet'),
      kpi('Cash', money(num(a.cash)), num(a.cash) < 0 ? 'Negative: borrowing on margin' : null),
      kpi('Realized P&L', smoney(num(a.realized_pnl)), 'from closed positions'),
      kpi('Costs paid', money(num(a.costs_paid)), 'fees, margin interest, borrow'),
      kpi('Max drawdown', pct(num(a.max_drawdown), 1), `avg leverage ${lev(num(a.avg_gross))}`),
    ];
    if (!a.team) tiles.push(kpi('Tokens used', compact((num(a.tokens_in) || 0) + (num(a.tokens_out) || 0)),
      `${compact(num(a.tokens_in))} in, ${compact(num(a.tokens_out))} out`));
    if (a.busts.length) tiles.push(kpi('Busts', String(a.busts.length), a.busts.map(b => fmtDayShort(b.date)).join(', ')));

    panel.replaceChildren(...[
      h('div', { class: 'panel-head' }, keyDot(a), h('h3', null, a.team ? 'Team (ensemble)' : a.display),
        a.team ? h('span', { class: 'pill' }, 'Ensemble') : null, a.enabled === false ? h('span', { class: 'pill' }, 'Paused') : null,
        h('span', { class: 'models', title: modelsTitle(a) }, a.team ? modelsLine(a) : `Models: ${modelsLine(a)}`)),
      h('div', { class: 'kpis small' }, tiles),
      ratingMix(a),
      chartsCard(a),
      a.team ? (() => { const c = h('div', { class: 'card' }); renderWeightsCard(c); return c.hidden ? null : c; })() : null,
      positionsCard(a),
      pendingCard(a),
      tradesCard(a),
      decisionsCard(a),
      h('div', { class: 'card reasoning', id: 'reasoning' }, reasoningPlaceholder(a))].filter(Boolean));
  }

  function ratingMix(a) {
    const order = [...SCALE, 'REVIEW', 'failed'];
    const counts = order.map(k => [k, num(a.ratings[k]) || 0]).filter(([, n]) => n > 0);
    const total = counts.reduce((s, [, n]) => s + n, 0);
    const card = h('div', { class: 'card' }, h('h3', null, 'How this AI has called it'));
    if (!total) { card.append(h('p', { class: 'empty-inline' }, 'No decisions yet.')); return card; }
    const bar = h('div', { class: 'mix' });
    for (const [k, n] of counts) {
      const seg = h('div', { class: `seg ${RATING[k].cls}` });
      seg.style.flexGrow = String(n);
      attachTip(seg, () => [h('div', { class: 'tip-head' }, RATING[k].label), tipLine('Calls', `${int.format(n)} (${pct(n / total, 0, false)})`)]);
      bar.append(seg);
    }
    card.append(h('p', { class: 'chart-sub' }, `${int.format(total)} decisions across all assets.`), bar,
      h('div', { class: 'mix-legend' }, counts.map(([k, n]) => h('span', { class: 'scale-item' },
        h('span', { class: `swatch ${RATING[k].cls}` }), `${RATING[k].label} `, h('b', null, int.format(n)), ` (${pct(n / total, 0, false)})`))));
    return card;
  }

  function chartsCard(a) {
    const card = h('div', { class: 'card' });
    if (a.series.length < 2) {
      card.append(h('h3', null, 'Value and leverage'), h('p', { class: 'empty-inline' }, 'Not enough history to chart yet. The chart starts after the first orders fill and the next close is recorded.'));
      return card;
    }
    const dom = labDomain();
    const eq = h('div'), levHost = h('div');
    const series = [armSeries(a)];
    if (S.benchLine.length) series.push(benchSeries());
    card.append(
      h('div', { class: 'chart-block' }, h('p', { class: 'chart-title' }, 'Portfolio value'),
        h('p', { class: 'chart-sub' }, `${a.team ? 'Team' : a.display} against ${money(S.cap)} in ${benchName()}. The straight line at ${money(S.cap)} marks the starting value.`), eq),
      h('div', { class: 'chart-block' }, h('p', { class: 'chart-title' }, 'Leverage'),
        h('p', { class: 'chart-sub' }, `Gross exposure (long plus short positions) divided by equity, at each close. The policy caps it at ${lev(num(S.summary.policy && S.summary.policy.gross_cap))}.`), levHost));
    {
      const c = lineChart(eq, { series, height: 260, heightNarrow: 220, endLabels: true, xDomain: dom, yTick: moneyTick,
        tipFmt: v => money(v), refs: [{ v: S.cap }], aria: `${a.display} portfolio value over time` });
      eq.prepend(legend(series, c));
      const levPts = a.series.filter(p => p.gross != null && p.v > 0).map(p => ({ t: p.t, v: p.gross / p.v }));
      const cap = num(S.summary.policy && S.summary.policy.gross_cap);
      if (levPts.length) {
        lineChart(levHost, { series: [{ id: a.name, label: 'Leverage', cls: a.cls, dashed: a.dashed, team: a.team, points: levPts }],
          height: 170, heightNarrow: 150, area: true, yMin: 0, xDomain: dom, yTick: levTick, tipFmt: v => lev(v),
          refs: cap ? [{ v: cap, label: `Cap ${lev(cap)}` }] : [], aria: `${a.display} leverage over time` });
      } else levHost.append(h('p', { class: 'empty-inline' }, 'No exposure data yet.'));
    }
    return card;
  }

  function positionsCard(a) {
    const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Open positions'),
      h('p', null, a.series.length ? `Marked at the ${fmtDay(a.series[a.series.length - 1].date)} close.` : 'Marked at the last close.'))));
    const pos = a.positions.filter(p => p && typeof p.ticker === 'string')
      .sort((x, y) => Math.abs(num(y.value) || 0) - Math.abs(num(x.value) || 0));
    if (!pos.length) { card.append(h('p', { class: 'empty-inline' }, `No open positions. All ${money(num(a.cash) ?? a.equity)} is in cash.`)); return card; }
    const gross = pos.reduce((s, p) => s + Math.abs(num(p.value) || 0), 0);
    const totalUnreal = pos.reduce((s, p) => s + (num(p.unrealized) || 0), 0);
    const rows = pos.map(p => h('tr', null, td(h('strong', null, p.ticker)), td(num(p.qty) < 0 ? 'Short' : 'Long'),
      numTd(qty(num(p.qty))), numTd(money(num(p.avg), 2)), numTd(money(num(p.mark), 2)), numTd(money(num(p.value))),
      numTd(pct(num(p.weight), 1)), numTd(smoney(num(p.unrealized)), tone(num(p.unrealized)))));
    card.append(table(
      [{ label: 'Asset' }, { label: 'Side' }, { label: 'Quantity', num: true }, { label: 'Avg cost', num: true }, { label: 'Last close', num: true },
        { label: 'Value', num: true }, { label: 'Weight', num: true }, { label: 'Unrealized P&L', num: true }],
      rows, { foot: [
        h('tr', null, td('Cash'), td(''), td(''), td(''), td(''), numTd(money(num(a.cash))), numTd(pct(num(a.cash) / a.equity, 1)), td('')),
        h('tr', null, td('Total'), td(''), td(''), td(''), td(''), numTd(money(a.equity)), numTd(''), numTd(smoney(totalUnreal), tone(totalUnreal))),
      ] }),
      h('p', { class: 'footnote' }, `Gross exposure ${money(gross)}, ${lev(gross / a.equity)} equity.`));
    return card;
  }

  function pendingCard(a) {
    const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Orders waiting to fill'),
      h('p', null, 'Each fills at the first market open after its decision day, with slippage.'))));
    const rows = a.pending.filter(o => o && typeof o.ticker === 'string').map(o => h('tr', null,
      td(h('strong', null, o.ticker)), td(num(o.qty) > 0 ? 'Buy' : 'Sell'), numTd(qty(Math.abs(num(o.qty) || 0))),
      numTd(money(num(o.ref_price), 2)), numTd(pct(num(o.target_weight), 1)), td(o.rating !== undefined ? chip(o.rating) : NONE), td(fmtDayShort(o.decided))));
    if (!rows.length) { card.append(h('p', { class: 'empty-inline' }, 'No orders waiting.')); return card; }
    card.append(table([{ label: 'Asset' }, { label: 'Order' }, { label: 'Quantity', num: true }, { label: 'Ref. price', num: true },
      { label: 'Target weight', num: true }, { label: 'Call' }, { label: 'Decided' }], rows));
    return card;
  }

  function tradesCard(a) {
    const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Trade log'),
      h('p', null, 'Simulated fills, newest first. Fill price is the open plus slippage against the trade.'))));
    const body = h('div', null, h('p', { class: 'empty-inline' }, 'Loading trades…'));
    card.append(body);
    const fill = trades => {
      if (S.selected !== a.name) return;
      const list = arr(trades).filter(t => t && typeof t.ticker === 'string')
        .sort((x, y) => String(y.filled).localeCompare(String(x.filled)) || String(x.ticker).localeCompare(String(y.ticker)));
      if (!list.length) { body.replaceChildren(h('p', { class: 'empty-inline' }, 'No trades yet.')); return; }
      const rows = ts => ts.map(t => h('tr', null, td(fmtDayShort(t.filled)), td(h('strong', null, t.ticker)),
        td(t.side === 'buy' ? 'Buy' : t.side === 'sell' ? 'Sell' : String(t.side ?? NONE)), numTd(qty(Math.abs(num(t.qty) || 0))),
        numTd(money(num(t.price), 2)), numTd(money(num(t.open), 2)), numTd(num(t.fee) ? money(num(t.fee), 2) : NONE),
        numTd(Math.abs(num(t.realized_pnl) || 0) > 0.005 ? smoney(num(t.realized_pnl), 2) : NONE, tone(num(t.realized_pnl))),
        td(t.rating !== undefined ? chip(t.rating) : NONE), td(fmtDayShort(t.decided))));
      const tbl = table([{ label: 'Filled' }, { label: 'Asset' }, { label: 'Side' }, { label: 'Quantity', num: true }, { label: 'Fill price', num: true },
        { label: 'Open', num: true }, { label: 'Fee', num: true }, { label: 'Realized P&L', num: true }, { label: 'Call' }, { label: 'Decided' }], []);
      body.replaceChildren(tbl, moreRows(list, 25, rows, tbl));
    };
    if (S.trades.has(a.name)) { fill(S.trades.get(a.name)); S.tradesReady = Promise.resolve(); }
    else S.tradesReady = tryJSON(armFile(a.name, 'trades.json'), []).then(t => { S.trades.set(a.name, t); fill(t); });
    return card;
  }

  function outcomeCells(r) {
    const alphaCell = (alpha, hit) => h('td', { class: 'num' }, isNum(alpha)
      ? [h('span', { class: tone(alpha) }, pct(alpha, 2)), ' ', hitMark(hit)]
      : h('span', { class: 'lown' }, DIRECTIONAL.has(r.rating) ? 'pending' : NONE));
    return [alphaCell(r.alpha_1d, r.hit_1d), numTd(pct(num(r.fwd_return), 2), tone(num(r.fwd_return))),
      numTd(pct(num(r.spy_return), 2)), alphaCell(r.alpha, r.hit)];
  }

  function decisionsCard(a) {
    const all = (S.decisions.get(a.name) || []).filter(r => r && isDay(r.date))
      .sort((x, y) => y.date.localeCompare(x.date) || String(x.ticker).localeCompare(String(y.ticker)));
    const card = h('div', { class: 'card' });
    const head = h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Decision log'),
      h('p', null, `Every call, newest first. Alpha is the asset's return minus ${benchName()}'s, from the first open after the call `
        + 'to the close one session later and five sessions later. Hold, Review and failed calls are not graded.')));
    card.append(head);
    if (!all.length) { card.append(h('p', { class: 'empty-inline' }, 'No decisions yet.')); return card; }
    const tickers = [...new Set(all.map(r => r.ticker).filter(t => typeof t === 'string'))];
    const sel = h('select', { name: 'asset', 'aria-label': 'Filter by asset' }, h('option', { value: '' }, 'All assets'), tickers.map(t => h('option', { value: t }, t)));
    head.append(h('div', { class: 'log-tools' }, h('label', { class: 'field' }, h('span', null, 'Asset'), sel)));
    const cols = [{ label: 'Date' }, { label: 'Asset' }, { label: 'Call' },
      ...(a.team ? [{ label: 'Weighted vote', num: true }, { label: 'Votes', num: true }] : []),
      { label: 'Alpha, next session', num: true }, { label: '5-session return', num: true }, { label: `${benchName()}, 5 sessions`, num: true },
      { label: 'Alpha, 5 sessions', num: true },
      ...(a.team ? [] : [{ label: 'Time', num: true }, { label: 'Tokens', num: true }]), { label: '' }];
    const rows = list => list.map(r => {
      const open = h('button', { type: 'button', class: 'btn small' }, a.team ? 'Vote' : r.detail ? 'Reasoning' : 'Details');
      open.addEventListener('click', () => openReasoning(a.name, r.date, r.ticker, { from: 'log' }));
      return h('tr', null, td(fmtDayShort(r.date)), td(h('strong', null, String(r.ticker ?? NONE))), td(chip(r.rating)),
        a.team ? [numTd(isNum(r.consensus) ? signedNum(r.consensus) : NONE), numTd(r.votes && typeof r.votes === 'object' ? String(Object.keys(r.votes).length) : NONE)] : null,
        outcomeCells(r),
        a.team ? null : [numTd(duration(num(r.secs))), numTd(compact((num(r.tokens_in) || 0) + (num(r.tokens_out) || 0)))],
        td(open));
    });
    const body = h('div');
    const draw = () => {
      const list = sel.value ? all.filter(r => r.ticker === sel.value) : all;
      const tbl = table(cols, []);
      body.replaceChildren(tbl, moreRows(list, 30, rows, tbl));
    };
    sel.addEventListener('change', draw);
    draw();
    card.append(body);
    return card;
  }

  /* ---------- reasoning ---------- */
  function reasoningPlaceholder(a) {
    return [h('h3', null, a.team ? 'Vote detail' : 'Reasoning'),
      h('p', { class: 'empty-inline' }, a.team
        ? 'Select a team call in the decision log or the latest-calls grid to see how each AI voted.'
        : 'Select a call in the decision log or the latest-calls grid to read how the agents reached it.')];
  }

  async function openReasoning(name, date, ticker, opts = {}) {
    const a = S.byName.get(name);
    if (!a || !isDay(date) || typeof ticker !== 'string') return;
    selectArm(name, { keepHash: true });
    const token = ++S.reasonToken;
    const box = $('reasoning');
    const rec = (S.decisions.get(name) || []).filter(r => r.date === date && r.ticker === ticker).pop();
    const title = h('h3', { tabindex: '-1' }, `${a.team ? 'Team vote' : a.display} on ${ticker}`, rec ? chip(rec.rating) : null);
    const metaBits = [fmtDayWeek(date)];
    if (rec && !a.team) {
      if (isNum(rec.secs)) metaBits.push(`took ${duration(rec.secs)}`);
      if (isNum(rec.llm_calls)) metaBits.push(`${int.format(rec.llm_calls)} model calls`);
      if (isNum(rec.tokens_in) || isNum(rec.tokens_out)) metaBits.push(`${compact(num(rec.tokens_in) || 0)} tokens in, ${compact(num(rec.tokens_out) || 0)} out`);
    }
    const back = opts.from === 'calls'
      ? h('button', { type: 'button', class: 'btn small', onclick: () => $('calls').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }) }, 'Back to latest calls') : null;
    const content = h('div', null, h('p', { class: 'empty-inline' }, 'Loading…'));
    box.replaceChildren(...[h('div', { class: 'reason-head' }, h('div', null, title, h('p', { class: 'reason-meta' }, metaBits.join(' · '))), back),
      rec ? outcomeBox(rec) : null, content].filter(Boolean));
    setHash({ ai: name, date, ticker });
    await Promise.race([S.tradesReady, new Promise(r => setTimeout(r, 1500))]);
    if (token !== S.reasonToken) return;
    box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    title.focus({ preventScroll: true });

    if (!rec) { content.replaceChildren(h('p', { class: 'empty-inline' }, 'This decision is not in the log.')); return; }
    const parts = [];
    if (rec.rating == null || rec.error) {
      parts.push(h('div', { class: 'notice' }, h('strong', null, rec.rating == null ? 'This analysis failed. ' : 'Note: '),
        typeof rec.error === 'string' ? rec.error : 'No error message was recorded.', rec.rating == null ? ' The position was left unchanged.' : ''));
    }
    if (a.team) { content.replaceChildren(...parts, voteDetail(a, rec)); return; }
    if (!rec.detail) {
      if (rec.rating != null) parts.push(h('p', { class: 'empty-inline' }, 'The full reasoning was not saved for this decision.'));
      content.replaceChildren(...parts);
      return;
    }
    const key = `${name}/${date}/${ticker}`;
    let run = S.runs.get(key);
    if (!run) {
      run = await getJSON(armFile(name, 'runs', date, `${ticker}.json`)).catch(() => null);
      if (run && typeof run === 'object') S.runs.set(key, run);
    }
    if (token !== S.reasonToken) return;
    if (!run || typeof run !== 'object') {
      content.replaceChildren(...parts, h('p', { class: 'empty-inline' }, 'The reasoning file could not be loaded.'));
      return;
    }
    content.replaceChildren(...parts, ...runSections(run));
  }

  function outcomeBox(r) {
    if (!DIRECTIONAL.has(r.rating)) {
      return h('div', { class: 'outcome' }, h('div', null, h('span', null, 'Outcome: '),
        r.rating === 'Hold' ? 'Hold calls are not graded.' : 'Not graded (no directional call).'));
    }
    const bits = [];
    bits.push(h('div', null, h('span', null, 'Next session: '), isNum(r.alpha_1d) ? [`alpha ${pct(r.alpha_1d, 2)} `, hitMark(r.hit_1d)] : 'not graded yet'));
    bits.push(h('div', null, h('span', null, '5 sessions: '), isNum(r.alpha)
      ? [`return ${pct(r.fwd_return, 2)}, ${benchName()} ${pct(r.spy_return, 2)}, alpha ${pct(r.alpha, 2)} `, hitMark(r.hit)] : 'not graded yet'));
    return h('div', { class: 'outcome' }, bits);
  }

  function runSections(run) {
    const sec = (title, sub, ...body) => h('div', { class: 'r-section' }, h('h4', null, title), sub ? h('p', { class: 'r-sub' }, sub) : null, ...body);
    const out = [];
    out.push(sec('Portfolio Manager: final decision', null, h('div', { class: 'pm' }, md(run.final_trade_decision))));
    out.push(sec("Trader's plan", null, clamp(md(run.trader_investment_plan))));
    const side = (cls, label, text, role) => {
      const turns = splitTurns(text, [role]);
      return h('div', { class: `side ${cls}` }, h('div', { class: 'side-title' }, h('span', { class: 'bar', 'aria-hidden': 'true' }), label),
        turns.length ? clamp(h('div', null, turns.map((t, i) => h('div', { class: 'turn' },
          turns.length > 1 ? h('div', { class: 'turn-label' }, `Round ${i + 1}`) : null, md(t.body))))) : md(''));
    };
    out.push(sec('Research debate', 'A bull and a bear researcher argue from the analyst reports.',
      h('div', { class: 'debate' }, side('bull', 'Bull case', run.bull, 'Bull'), side('bear', 'Bear case', run.bear, 'Bear'))));
    out.push(sec("Research Manager's verdict", null, clamp(md(run.investment_plan))));
    const risk = splitTurns(run.risk_debate, ['Aggressive', 'Conservative', 'Neutral']);
    out.push(sec('Risk debate', 'Aggressive, conservative and neutral risk analysts review the trader\'s plan.',
      risk.length ? risk.map(t => h('div', { class: 'risk-turn' }, t.role ? h('div', { class: 'turn-label' }, `${t.role} analyst`) : null, clamp(md(t.body)))) : md('')));
    out.push(sec('Analyst reports', 'The four reports every later step worked from.',
      ANALYSTS.map(([k, label]) => h('details', { class: 'report' }, h('summary', null, label), md(run[k])))));
    if (typeof run.memory_note === 'string' && run.memory_note.trim()) {
      out.push(sec('Memory note', 'What this AI carried forward from its earlier calls.', h('details', { class: 'report' }, h('summary', null, 'Show note'), md(run.memory_note))));
    }
    return out;
  }

  function voteDetail(team, rec) {
    const votes = rec.votes && typeof rec.votes === 'object' ? rec.votes : {};
    const weights = rec.weights && typeof rec.weights === 'object' ? rec.weights : {};
    const voters = Object.keys(votes).filter(n => VOTE[votes[n]] !== undefined && isNum(weights[n]));
    const total = voters.reduce((s, n) => s + weights[n], 0);
    const rows = voters.sort((x, y) => weights[y] - weights[x]).map(n => {
      const a = S.byName.get(n) || { name: n, display: nameOf(n), cls: 'c-bench' };
      return h('tr', null, td(h('div', { class: 'who' }, keyDot(a), a.display)), td(chip(votes[n])),
        numTd(signOf(VOTE[votes[n]], String(Math.abs(VOTE[votes[n]])))), numTd(weights[n].toPrecision(3)),
        numTd(total ? pct(weights[n] / total, 1, false) : NONE));
    });
    const absent = S.arms.filter(a => !a.team && !voters.includes(a.name)).map(a => {
      const own = (S.decisions.get(a.name) || []).filter(r => r.date === rec.date && r.ticker === rec.ticker).pop();
      return h('tr', null, td(h('div', { class: 'who' }, keyDot(a), a.display)), td(own ? chip(own.rating) : h('span', { class: 'lown' }, 'No call')),
        td(h('span', { class: 'lown' }, 'not counted')), numTd(NONE), numTd(NONE));
    });
    const c = num(rec.consensus);
    const parts = [h('div', { class: 'r-section' }, h('h4', null, 'Weighted vote'),
      h('p', { class: 'r-sub' }, 'Votes: Buy +2, Overweight +1, Hold 0, Underweight −1, Sell −2. The team takes the weighted average and maps it to a rating.'),
      c != null ? gauge(c) : null,
      c != null ? h('p', { class: 'reason-meta' }, `Weighted average ${signedNum(c)} gives `, chip(rec.rating)) : null)];
    parts.push(h('div', { class: 'r-section' }, h('h4', null, 'How each AI voted'),
      table([{ label: 'AI' }, { label: 'Call' }, { label: 'Vote', num: true }, { label: 'Weight', num: true }, { label: 'Share of say', num: true }],
        [...rows, ...absent])));
    return h('div', null, parts);
  }

  function gauge(c) {
    const zones = [['Sell', -2, -1.5], ['Underweight', -1.5, -0.5], ['Hold', -0.5, 0.5], ['Overweight', 0.5, 1.5], ['Buy', 1.5, 2]];
    const track = h('div', { class: 'gauge-track', 'aria-hidden': 'true' });
    const labels = h('div', { class: 'gauge-labels', 'aria-hidden': 'true' });
    for (const [r, lo, hi] of zones) {
      const seg = h('div', { class: `seg ${RATING[r].cls}` });
      seg.style.flexGrow = String(hi - lo);
      track.append(seg);
      const l = h('span', null, RATING[r].short);
      l.style.flexGrow = String(hi - lo);
      l.style.flexBasis = '0';
      labels.append(l);
    }
    const mark = h('div', { class: 'gauge-mark' });
    mark.style.left = `${((Math.max(-2, Math.min(2, c)) + 2) / 4) * 100}%`;
    track.append(mark);
    return h('div', { class: 'gauge', role: 'img', 'aria-label': `Weighted vote ${signedNum(c)} on a scale from minus 2 (Sell) to plus 2 (Buy)` }, track, labels);
  }

  /* ---------- methodology ---------- */
  function renderMethod() {
    const sum = S.summary;
    const pol = sum.policy && typeof sum.policy === 'object' ? sum.policy : {};
    const costs = sum.costs && typeof sum.costs === 'object' ? sum.costs : {};
    const w = pol.weights && typeof pol.weights === 'object' ? pol.weights : {};
    const bps = v => (isNum(v) ? `${v} bps (${(v / 100).toFixed(2)}%)` : NONE);
    const yr = v => (isNum(v) ? `${(v * 100).toFixed(v * 100 % 1 ? 1 : 0)}% a year` : NONE);
    const hold = num(sum.hold_days) || 5;
    const b = benchName();
    const universe = arr(sum.universe).filter(t => typeof t === 'string');
    const card = (title, ...body) => h('div', { class: 'card' }, h('h3', null, title), ...body);
    const llm = S.arms.filter(a => !a.team);
    const out = [];
    out.push(h('div', { class: 'card wide' }, h('h3', null, 'How each AI decides'),
      h('p', null, 'Every AI runs the same TradingAgents pipeline for each asset. Four analysts write reports (price and technicals, social sentiment, news, fundamentals). '
        + 'A bull and a bear researcher debate those reports and a research manager rules on the debate. A trader drafts a plan, three risk analysts '
        + '(aggressive, conservative, neutral) argue over it, and a portfolio manager issues the final rating.'),
      h('p', null, 'Each AI fills every role with its own models: the deep model for the two managers, the quick model for the analysts, debaters and trader.'),
      llm.length ? table([{ label: 'AI' }, { label: 'Deep model (managers)' }, { label: 'Quick model (analysts, debaters, trader)' }],
        llm.map(a => h('tr', null, td(h('div', { class: 'who' }, keyDot(a), a.display, a.enabled === false ? h('span', { class: 'pill' }, 'Paused') : null)),
          td(String(a.deep ?? NONE)), td(String(a.quick ?? NONE))))) : null));
    out.push(card('Assets and schedule',
      h('div', { class: 'chips' }, universe.map(t => h('span', null, t))),
      h('p', null, 'Stocks are analyzed after the close on US trading days. Crypto is analyzed every day. Positions are marked at each day\'s close.')));
    const wRows = [...SCALE].reverse().map(r => h('tr', null, td(chip(r)),
      numTd(r === 'Hold' ? 'keep current weight' : isNum(w[r]) ? pct(w[r], 1) : NONE)));
    wRows.push(h('tr', null, td(chip('REVIEW')), numTd('keep current weight')), h('tr', null, td(chip(null)), numTd('keep current weight')));
    out.push(card('From rating to position',
      h('p', null, 'Each rating sets a target weight for that asset as a share of equity:'),
      table([{ label: 'Rating' }, { label: 'Target weight', num: true }], wRows),
      h('ul', null,
        h('li', null, `Total gross exposure is capped at ${lev(num(pol.gross_cap))} equity. If the targets add up to more, all of them are scaled down in proportion.`),
        h('li', null, `Changes smaller than ${pct(num(pol.min_trade_weight), 0, false)} of equity are skipped. Closing a position always trades.`),
        pol.allow_crypto_short === false ? h('li', null, 'Crypto is long-only: Underweight and Sell close a crypto position instead of shorting it.') : null)));
    out.push(card('Fills and costs',
      h('ul', null,
        h('li', null, 'Orders fill at the first market open after the decision day.'),
        h('li', null, `Slippage, always against the trade: stocks ${bps(costs.stock_slippage_bps)}, crypto ${bps(costs.crypto_slippage_bps)}.`),
        h('li', null, `Crypto trading fee ${bps(costs.crypto_fee_bps)}. Stocks trade commission-free.`),
        h('li', null, `Margin interest ${yr(costs.margin_rate_annual)} on borrowed cash; borrow fee ${yr(costs.borrow_rate_annual)} on short positions. Both accrue daily.`),
        h('li', null, `If a portfolio's equity reaches zero, the bust is recorded and it restarts at ${money(S.cap)}.`)),
      h('p', { class: 'muted' }, 'These costs are assumptions, not quotes from a broker.')));
    out.push(card('Benchmark and scoring',
      h('p', null, `Benchmark: ${money(S.cap)} of ${b} bought at the first open after ${fmtDay(sum.start_date)} and held. "vs ${b}" is a portfolio's return minus ${b}'s over the same dates.`),
      h('p', null, `Directional calls (Buy, Overweight, Underweight, Sell) are graded twice: at the close of the next session and at the close ${hold} sessions later. `
        + `The return runs from the first open after the call to that close. Alpha is that return minus ${b}'s over the same window. `
        + 'A bullish call is a hit when alpha is above zero; a bearish call is a hit when alpha is below zero. Hold, Review and failed calls are not graded.')));
    if (S.arms.some(a => a.team)) {
      out.push(card('The team portfolio',
        h('p', null, 'The team portfolio trades a weighted vote of the individual AIs and follows the same rules and costs. Votes count Buy +2, Overweight +1, Hold 0, Underweight −1 and Sell −2. '
          + 'The weighted average maps to a rating: 1.5 or more is Buy, 0.5 or more Overweight, above −0.5 Hold, above −1.5 Underweight, otherwise Sell.'),
        h('p', null, 'Each AI\'s weight is e raised to (10 × the summed signed alpha of its calls graded at the next close), limited to between e⁻⁵ and e⁵. '
          + 'Calls that beat the benchmark in the called direction raise an AI\'s weight; calls that miss lower it.')));
    }
    out.push(h('div', { class: 'card wide' }, h('h3', null, 'Changes since the start'),
      typeof sum.adaptations === 'string' && sum.adaptations.trim()
        ? md(sum.adaptations.replace(/^\s*#\s[^\n]*\n/, '')) : h('p', { class: 'muted' }, 'No changes so far.')));
    out.push(h('div', { class: 'card wide disclaimer' }, h('h3', null, 'Disclaimer'),
      h('p', null, 'This is a paper-trading experiment run for research. No real money is traded and every fill is simulated, so results will differ from real trading. '
        + 'Nothing on this page is investment advice or a recommendation to buy or sell any security or crypto asset. Simulated past results do not predict future results.')));
    $('method').replaceChildren(...out);
  }

  /* ---------- hash state ---------- */
  function setHash(o) {
    const q = new URLSearchParams(o).toString();
    history.replaceState(null, '', `#${q}`);
  }
  function readHash() {
    const raw = location.hash.slice(1);
    if (!raw.includes('=')) return null;
    const q = new URLSearchParams(raw);
    return { ai: q.get('ai'), date: q.get('date'), ticker: q.get('ticker') };
  }

  /* ---------- boot ---------- */
  function showSections(on) {
    for (const id of ['leaderboard', 'equity', 'calls', 'detail', 'methodology']) $(id).hidden = !on;
  }
  function syncNav() {
    for (const a of document.querySelectorAll('.sections a')) {
      const target = $(a.getAttribute('href').slice(1));
      a.hidden = !target || target.hidden;
    }
    document.querySelector('.sections').hidden = !document.querySelector('.sections a:not([hidden])');
  }

  async function boot() {
    let sum;
    try {
      sum = await getJSON('summary.json');
      if (!sum || typeof sum !== 'object') throw new Error('summary.json is empty');
    } catch (e) {
      $('updated').textContent = 'No results published yet';
      $('notice').replaceChildren(h('div', { class: 'card empty' }, h('h3', null, 'No results published yet'),
        h('p', null, 'The first decisions post after the market close on the experiment\'s first day. Check back after that run.')));
      return;
    }
    normalize(sum);
    const decs = await Promise.all(S.arms.map(a => tryJSON(armFile(a.name, 'decisions.json'), [])));
    S.arms.forEach((a, i) => S.decisions.set(a.name, arr(decs[i]).filter(r => r && typeof r === 'object')));

    renderHeader();
    renderNotices();
    renderMethod();
    $('methodology').hidden = false;
    if (!S.arms.length) return;
    if (hasActivity()) renderKpis();
    renderBoard();
    $('leaderboard').hidden = false;
    if (!hasActivity()) return;
    showSections(true);
    renderEquity();
    renderCallsSection();
    renderTabs();
    const want = readHash();
    const first = want && S.byName.has(want.ai) ? want.ai : S.ranked[0].name;
    selectArm(first, { keepHash: true });
    if (want && want.ai === first && want.date && want.ticker) openReasoning(first, want.date, want.ticker);
  }

  addEventListener('hashchange', () => {
    const want = readHash();
    if (!want || !S.byName.has(want.ai)) return;
    if (want.date && want.ticker) openReasoning(want.ai, want.date, want.ticker);
    else selectArm(want.ai, { keepHash: true });
  });

  const start = () => boot().finally(async () => {
    syncNav();
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && !id.includes('=') ? $(id) : null;
    if (!target || target.hidden) return;
    await S.tradesReady;
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
