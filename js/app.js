/* ------------------------------------------------------------------
   Weight Journey - application script
   Plain JavaScript, no build step. All data is stored in localStorage
   under a single versioned key. Weights are stored in kilograms and
   converted for display according to the unit setting.
   ------------------------------------------------------------------ */
(() => {
  'use strict';

  const STORAGE_KEY = 'weight-journey.v1';
  const LB_PER_KG = 2.2046226218;
  const VIEWS = ['dashboard', 'log', 'history', 'settings'];

  // ---------- state ----------
  const defaultState = () => ({
    version: 1,
    settings: { unit: 'lb', goalWeightKg: null, theme: 'system', updatedAt: 0 },
    weights: [],   // { id, date: 'YYYY-MM-DD', kg: number, note: string, updatedAt }
    meals: [],     // { id, date, type, description, calories: number|null, createdAt, updatedAt }
    exercise: [],  // { id, date, activity, minutes, calories: number|null, notes, createdAt, updatedAt }
    mealPresets: [],     // { id, name, type: ''|Breakfast|..., calories: number|null, updatedAt }
    exercisePresets: [], // { id, name, minutes: number|null, calories: number|null, updatedAt }
  });

  function normalize(p) {
    const d = defaultState();
    if (!p || typeof p !== 'object') return d;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const id = (v) => (isUuid(v) ? v : uid());
    const stamp = (x) => num(x.updatedAt) || num(x.createdAt) || 0;
    const s = p.settings || {};
    return {
      version: 1,
      settings: {
        unit: s.unit === 'kg' ? 'kg' : 'lb',
        goalWeightKg: num(s.goalWeightKg),
        theme: ['light', 'dark', 'system'].includes(s.theme) ? s.theme : 'system',
        updatedAt: num(s.updatedAt) || 0,
      },
      weights: (Array.isArray(p.weights) ? p.weights : [])
        .filter((w) => w && date(w.date) && num(w.kg) > 0)
        .map((w) => ({ id: id(w.id), date: w.date, kg: w.kg, note: str(w.note, 140), updatedAt: stamp(w) })),
      meals: (Array.isArray(p.meals) ? p.meals : [])
        .filter((m) => m && date(m.date) && typeof m.description === 'string')
        .map((m) => ({
          id: id(m.id), date: m.date, type: str(m.type, 20) || 'Snack',
          description: str(m.description, 200), calories: num(m.calories),
          protein: num(m.protein), carbs: num(m.carbs), fat: num(m.fat),
          createdAt: num(m.createdAt) || 0, updatedAt: stamp(m),
        })),
      exercise: (Array.isArray(p.exercise) ? p.exercise : [])
        .filter((e) => e && date(e.date) && typeof e.activity === 'string')
        .map((e) => ({
          id: id(e.id), date: e.date, activity: str(e.activity, 120),
          minutes: Math.max(0, num(e.minutes) || 0), calories: num(e.calories), notes: str(e.notes, 200),
          createdAt: num(e.createdAt) || 0, updatedAt: stamp(e),
        })),
      mealPresets: (Array.isArray(p.mealPresets) ? p.mealPresets : [])
        .filter((x) => x && typeof x.name === 'string' && x.name.trim())
        .map((x) => ({
          id: id(x.id), name: str(x.name, 120).trim(), type: str(x.type, 20), calories: num(x.calories),
          protein: num(x.protein), carbs: num(x.carbs), fat: num(x.fat), updatedAt: stamp(x),
        })),
      exercisePresets: (Array.isArray(p.exercisePresets) ? p.exercisePresets : [])
        .filter((x) => x && typeof x.name === 'string' && x.name.trim())
        .map((x) => ({ id: id(x.id), name: str(x.name, 120).trim(), minutes: num(x.minutes), calories: num(x.calories), updatedAt: stamp(x) })),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : defaultState();
    } catch (err) {
      console.warn('Could not read saved data', err);
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error(err);
      toast('Could not save. Your browser storage may be full or blocked.');
    }
  }

  let state = load();
  let currentView = 'dashboard';
  let logDate = todayISO();
  let chartRange = '30';
  let historyTab = 'weights';

  // ---------- helpers ----------
  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const hx = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}`;
  }
  function isUuid(v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }

  // ---------- change notifications (js/sync.js subscribes) ----------
  const listeners = [];
  function notify(kind, op, key) {
    for (const fn of listeners) { try { fn(kind, op, key); } catch (err) { console.error(err); } }
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISODate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function todayISO() { return toISODate(new Date()); }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISODate(d); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  function fmtDate(iso, opts) { return parseISO(iso).toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric' }); }
  function fmtDateLong(iso) {
    return parseISO(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function relDay(iso) {
    const diff = daysBetween(iso, todayISO());
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff === -1) return 'Tomorrow';
    return fmtDateLong(iso);
  }

  const unit = () => state.settings.unit;
  function toDisplay(kg) { return unit() === 'lb' ? kg * LB_PER_KG : kg; }
  function fromDisplay(v) { return unit() === 'lb' ? v / LB_PER_KG : v; }
  function fmtW(kg, withUnit = true) { return toDisplay(kg).toFixed(1) + (withUnit ? ` ${unit()}` : ''); }
  function fmtDelta(kg, withUnit = true) {
    const v = toDisplay(kg);
    const r = Math.round(v * 10) / 10;
    const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
    return sign + Math.abs(r).toFixed(1) + (withUnit ? ` ${unit()}` : '');
  }
  function fmtInt(n) { return n.toLocaleString(); }
  function fmtMinutes(m) {
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  function intOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Math.max(0, Math.round(Number(v)));
    return Number.isFinite(n) ? n : null;
  }
  /** "43g protein · 27g carbs · 27g fat" for any object with protein/carbs/fat (nulls skipped). */
  function macroLine(x) {
    return [x.protein != null ? `${fmtInt(x.protein)}g protein` : null, x.carbs != null ? `${fmtInt(x.carbs)}g carbs` : null, x.fat != null ? `${fmtInt(x.fat)}g fat` : null]
      .filter(Boolean).join(' · ');
  }
  /** Sum a numeric field across items, or null when no item has it. */
  function sumOrNull(items, field) {
    const vals = items.map((i) => i[field]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }

  // DOM creation helper: h(tag, attrs, ...children). Text children use textContent.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v; // only used with trusted static markup
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- data access ----------
  const sortedWeights = () => [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const weightOn = (date) => state.weights.find((w) => w.date === date);
  const mealsOn = (date) => state.meals.filter((m) => m.date === date).sort((a, b) => a.createdAt - b.createdAt);
  const exerciseOn = (date) => state.exercise.filter((e) => e.date === date).sort((a, b) => a.createdAt - b.createdAt);

  /** Trailing 7-day average (by calendar date) for each weigh-in. */
  function withMovingAverage(ws) {
    return ws.map((w, i) => {
      const from = addDays(w.date, -6);
      let sum = 0, n = 0;
      for (let j = i; j >= 0 && ws[j].date >= from; j--) { sum += ws[j].kg; n++; }
      return { ...w, avg: sum / n };
    });
  }

  // ---------- theme ----------
  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  // ---------- routing ----------
  function viewFromHash() {
    const v = location.hash.replace('#', '');
    return VIEWS.includes(v) ? v : 'dashboard';
  }
  function showView(v) {
    currentView = v;
    $$('.view').forEach((s) => { s.hidden = s.dataset.view !== v; });
    $$('.nav__link').forEach((a) => a.classList.toggle('is-active', a.dataset.view === v));
    render();
    window.scrollTo({ top: 0 });
  }

  // ---------- render dispatcher ----------
  function render() {
    $$('.unit-label').forEach((el) => { el.textContent = unit(); });
    if (currentView === 'dashboard') renderDashboard();
    else if (currentView === 'log') renderLog();
    else if (currentView === 'history') renderHistory();
    else if (currentView === 'settings') renderSettings();
  }

  // ================================================================
  // DASHBOARD
  // ================================================================
  function renderDashboard() {
    const ws = sortedWeights();
    $('#dash-empty').hidden = ws.length > 0;
    $('#dash-content').hidden = ws.length === 0;
    $('#dash-subtitle').textContent = ws.length
      ? `${ws.length} weigh-in${ws.length === 1 ? '' : 's'} since ${fmtDate(ws[0].date, { month: 'long', day: 'numeric', year: 'numeric' })}`
      : 'Your progress at a glance';
    if (!ws.length) return;

    renderTiles(ws);
    renderChart(ws);
    renderWeekTiles();
  }

  function deltaEl(kg, label) {
    // Losing weight is the goal: a negative change is good.
    const r = Math.round(toDisplay(kg) * 10) / 10;
    const cls = r < 0 ? 'tile__delta tile__delta--good' : r > 0 ? 'tile__delta tile__delta--bad' : 'tile__delta';
    const icon = r < 0 ? '▼' : r > 0 ? '▲' : '•';
    return h('div', { class: cls }, h('span', { 'aria-hidden': 'true' }, icon), `${fmtDelta(kg)} ${label}`);
  }

  function tile(label, valueText, unitText, extra) {
    return h('div', { class: 'tile' },
      h('div', { class: 'tile__label' }, label),
      h('div', { class: 'tile__value' }, valueText, unitText ? h('small', null, unitText) : null),
      extra || null);
  }

  function renderTiles(ws) {
    const tiles = $('#tiles');
    clear(tiles);
    const current = ws[ws.length - 1];
    const first = ws[0];
    const prev = ws.length > 1 ? ws[ws.length - 2] : null;

    // Current weight
    tiles.append(tile('Current weight', fmtW(current.kg, false), unit(),
      prev ? deltaEl(current.kg - prev.kg, `since ${fmtDate(prev.date)}`)
        : h('div', { class: 'tile__delta' }, `Logged ${relDay(current.date).toLowerCase()}`)));

    // Total change
    tiles.append(tile('Total change', fmtDelta(current.kg - first.kg, false), unit(),
      h('div', { class: 'tile__delta' }, `Started at ${fmtW(first.kg)} on ${fmtDate(first.date)}`)));

    // 7-day change: compare to the most recent weigh-in at least 7 days before the current one.
    const cutoff = addDays(current.date, -7);
    const weekAgo = [...ws].reverse().find((w) => w.date <= cutoff);
    tiles.append(tile('7-day change', weekAgo ? fmtDelta(current.kg - weekAgo.kg, false) : '—', weekAgo ? unit() : '',
      h('div', { class: 'tile__delta' }, weekAgo ? `vs ${fmtDate(weekAgo.date)}` : 'Needs a weigh-in from a week ago')));

    // Goal
    const goal = state.settings.goalWeightKg;
    if (goal) {
      const remaining = current.kg - goal;
      const totalToLose = first.kg - goal;
      const lost = first.kg - current.kg;
      const pct = totalToLose > 0 ? Math.max(0, Math.min(100, (lost / totalToLose) * 100)) : (remaining <= 0 ? 100 : 0);
      const reached = remaining <= 0;
      tiles.append(tile(reached ? 'Goal reached' : 'To goal', reached ? '🎉' : Math.abs(toDisplay(remaining)).toFixed(1), reached ? '' : unit(),
        h('div', null,
          h('div', { class: 'tile__delta' }, reached ? `You are at or below ${fmtW(goal)}` : `${Math.round(pct)}% of the way to ${fmtW(goal)}`),
          h('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
            h('div', { class: 'meter__fill', style: `width:${pct}%` })))));
    } else {
      tiles.append(tile('Goal', '—', '',
        h('div', { class: 'tile__delta' }, h('a', { href: '#settings' }, 'Set a goal weight'))));
    }
  }

  function renderWeekTiles() {
    const wrap = $('#week-tiles');
    clear(wrap);
    const today = todayISO();
    const from = addDays(today, -6);
    const meals = state.meals.filter((m) => m.date >= from && m.date <= today);
    const ex = state.exercise.filter((e) => e.date >= from && e.date <= today);
    const minutes = ex.reduce((s, e) => s + e.minutes, 0);
    const burned = ex.reduce((s, e) => s + (e.calories || 0), 0);
    const daysWithMeals = new Set(meals.map((m) => m.date)).size;
    const withCal = meals.filter((m) => m.calories != null);
    const calDays = new Set(withCal.map((m) => m.date)).size;
    const avgCal = calDays ? Math.round(withCal.reduce((s, m) => s + m.calories, 0) / calDays) : null;
    const weighDays = state.weights.filter((w) => w.date >= from && w.date <= today).length;

    wrap.append(
      tile('Weigh-ins', `${weighDays}`, 'of 7 days'),
      tile('Workouts', `${ex.length}`, ex.length ? fmtMinutes(minutes) : ''),
      tile('Meals logged', `${meals.length}`, daysWithMeals ? `across ${daysWithMeals} day${daysWithMeals === 1 ? '' : 's'}` : ''),
      tile(avgCal != null ? 'Avg calories / day' : 'Calories burned', avgCal != null ? fmtInt(avgCal) : (burned ? fmtInt(burned) : '—'),
        avgCal != null ? 'kcal' : (burned ? 'kcal' : '')),
    );
  }

  // ---------- chart ----------
  const chart = { points: [], active: -1, geom: null };

  function rangeStart(range, ws) {
    if (range === 'all') return ws[0].date;
    return addDays(todayISO(), -(Number(range) - 1));
  }

  function niceStep(span, target) {
    const raw = span / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) { if (raw <= m * mag) return m * mag; }
    return 10 * mag;
  }

  function renderChart(allWs) {
    $$('#range-filter button').forEach((b) => b.classList.toggle('is-active', b.dataset.range === chartRange));
    const start = rangeStart(chartRange, allWs);
    const ws = withMovingAverage(allWs).filter((w) => w.date >= start);
    const svg = $('#chart-svg');
    const tooltip = $('#chart-tooltip');
    const legend = $('#chart-legend');
    clear(svg);
    tooltip.hidden = true;
    chart.points = ws;
    chart.active = -1;

    const label = chartRange === 'all' ? 'All time' : `Last ${chartRange} days`;
    $('#chart-sub').textContent = ws.length
      ? `${label} · ${ws.length} weigh-in${ws.length === 1 ? '' : 's'}${ws.length > 1 ? ` · ${fmtDelta(ws[ws.length - 1].kg - ws[0].kg)}` : ''}`
      : label;

    renderChartTable(ws);

    if (ws.length < 2) {
      svg.style.display = 'none';
      $('#chart-empty').hidden = false;
      legend.hidden = true;
      return;
    }
    svg.style.display = '';
    $('#chart-empty').hidden = true;
    legend.hidden = false;

    const goal = state.settings.goalWeightKg;
    const showAvg = ws.length >= 3;
    $('#legend-avg').hidden = !showAvg;
    $('#legend-goal').hidden = !goal;

    const W = Math.max(280, $('#chart').clientWidth);
    const H = 280;
    const m = { top: 18, right: 64, bottom: 28, left: 44 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('aria-label', `Weight trend, ${label.toLowerCase()}. Table view available below.`);

    // scales
    const t0 = parseISO(ws[0].date).getTime();
    const t1 = parseISO(ws[ws.length - 1].date).getTime();
    const tspan = Math.max(t1 - t0, 86400000);
    const x = (iso) => m.left + ((parseISO(iso).getTime() - t0) / tspan) * iw;

    let vals = ws.flatMap((w) => [toDisplay(w.kg), toDisplay(w.avg)]);
    if (goal) vals.push(toDisplay(goal));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const padV = Math.max((hi - lo) * 0.12, unit() === 'lb' ? 1 : 0.5);
    lo -= padV; hi += padV;
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const y = (v) => m.top + ih - ((v - lo) / (hi - lo)) * ih;

    const ns = 'http://www.w3.org/2000/svg';
    const s = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
      return el;
    };

    // gridlines + y ticks
    const grid = s('g', { class: 'grid' });
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const yy = y(v);
      grid.append(s('line', { x1: m.left, x2: m.left + iw, y1: yy, y2: yy }));
      const t = s('text', { class: 'tick-label', x: m.left - 8, y: yy + 4, 'text-anchor': 'end' });
      t.textContent = Number.isInteger(step) ? String(Math.round(v)) : v.toFixed(1);
      grid.append(t);
    }
    svg.append(grid);
    svg.append(s('line', { class: 'axis-base', x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih }));

    // x ticks: spread ~5 labels, dedupe by pixel distance
    const nTicks = Math.min(ws.length, Math.max(2, Math.floor(iw / 90)));
    let lastX = -Infinity;
    for (let i = 0; i < nTicks; i++) {
      const idx = Math.round((i / (nTicks - 1)) * (ws.length - 1));
      const xx = x(ws[idx].date);
      if (xx - lastX < 60) continue;
      lastX = xx;
      const anchor = i === 0 ? 'start' : i === nTicks - 1 ? 'end' : 'middle';
      const t = s('text', { class: 'tick-label', x: xx, y: H - 8, 'text-anchor': anchor });
      t.textContent = fmtDate(ws[idx].date, chartRange === 'all' && daysBetween(ws[0].date, ws[ws.length - 1].date) > 365
        ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });
      svg.append(t);
    }

    // goal line
    if (goal) {
      const gy = y(toDisplay(goal));
      svg.append(s('line', { class: 'goal-line', x1: m.left, x2: m.left + iw, y1: gy, y2: gy }));
      const gl = s('text', { class: 'goal-label', x: m.left + iw + 6, y: gy + 4 });
      gl.textContent = `Goal ${fmtW(goal, false)}`;
      svg.append(gl);
    }

    // area + line
    const pts = ws.map((w) => [x(w.date), y(toDisplay(w.kg))]);
    const lineD = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const base = m.top + ih;
    svg.append(s('path', { class: 'series-area', d: `${lineD} L${pts[pts.length - 1][0].toFixed(1)},${base} L${pts[0][0].toFixed(1)},${base} Z` }));
    if (showAvg) {
      const avgD = ws.map((w, i) => `${i ? 'L' : 'M'}${x(w.date).toFixed(1)},${y(toDisplay(w.avg)).toFixed(1)}`).join(' ');
      svg.append(s('path', { class: 'avg-line', d: avgD }));
    }
    svg.append(s('path', { class: 'series-line', d: lineD }));

    // crosshair (hidden until hover)
    const cross = s('line', { class: 'crosshair', x1: 0, x2: 0, y1: m.top, y2: m.top + ih, visibility: 'hidden' });
    svg.append(cross);

    // markers
    const dots = s('g');
    pts.forEach((p) => dots.append(s('circle', { class: 'dot', cx: p[0], cy: p[1], r: 4 })));
    svg.append(dots);

    // end label (latest value), placed so it clears the goal label if they collide
    const last = pts[pts.length - 1];
    const endLabel = s('text', { class: 'end-label', x: last[0] + 10, y: last[1] + 4 });
    endLabel.textContent = fmtW(ws[ws.length - 1].kg, false);
    if (goal && Math.abs(y(toDisplay(goal)) - last[1]) < 14) endLabel.setAttribute('y', last[1] + (last[1] < y(toDisplay(goal)) ? -8 : 16));
    svg.append(endLabel);

    // hit layer
    const hit = s('rect', { class: 'hit', x: m.left, y: m.top, width: iw, height: ih });
    svg.append(hit);
    chart.geom = { pts, cross, dots, tooltip, W, H, m, iw };

    const nearest = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const px = ((clientX - rect.left) / rect.width) * W;
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.abs(p[0] - px); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    hit.addEventListener('pointermove', (e) => setActive(nearest(e.clientX)));
    hit.addEventListener('pointerdown', (e) => setActive(nearest(e.clientX)));
    hit.addEventListener('pointerleave', () => setActive(-1));
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); setActive(Math.min(pts.length - 1, chart.active < 0 ? pts.length - 1 : chart.active + 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setActive(Math.max(0, chart.active < 0 ? pts.length - 1 : chart.active - 1)); }
      else if (e.key === 'Escape') setActive(-1);
    });
    svg.addEventListener('focus', () => { if (chart.active < 0) setActive(pts.length - 1); });
    svg.addEventListener('blur', () => setActive(-1));
  }

  function setActive(i) {
    const g = chart.geom;
    if (!g) return;
    chart.active = i;
    Array.from(g.dots.children).forEach((c, k) => c.classList.toggle('is-active', k === i));
    if (i < 0) { g.cross.setAttribute('visibility', 'hidden'); g.tooltip.hidden = true; return; }
    const p = g.pts[i], w = chart.points[i];
    g.cross.setAttribute('x1', p[0]); g.cross.setAttribute('x2', p[0]);
    g.cross.setAttribute('visibility', 'visible');

    const tip = g.tooltip;
    clear(tip);
    tip.append(h('div', { class: 'tooltip__date' }, fmtDate(w.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })));
    tip.append(h('div', { class: 'tooltip__row' },
      h('span', null, h('span', { class: 'tooltip__key', style: 'background:var(--series-1)' }), 'Weigh-in'),
      h('span', { class: 'tooltip__val' }, fmtW(w.kg))));
    if (chart.points.length >= 3) {
      tip.append(h('div', { class: 'tooltip__row' },
        h('span', null, h('span', { class: 'tooltip__key', style: 'background:var(--series-2)' }), '7-day avg'),
        h('span', { class: 'tooltip__val' }, fmtW(w.avg))));
    }
    if (i > 0) {
      tip.append(h('div', { class: 'tooltip__row' },
        h('span', null, 'Change'), h('span', { class: 'tooltip__val' }, fmtDelta(w.kg - chart.points[i - 1].kg))));
    }
    if (w.note) tip.append(h('div', { class: 'tooltip__row' }, h('span', { class: 'muted' }, w.note)));
    tip.hidden = false;

    const box = $('#chart').getBoundingClientRect();
    const scale = box.width / g.W;
    const px = p[0] * scale, py = p[1] * scale;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = px + 14;
    if (left + tw > box.width - 4) left = px - tw - 14;
    let top = py - th / 2;
    top = Math.max(4, Math.min(box.height - th - 4, top));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function renderChartTable(ws) {
    const table = $('#chart-table');
    clear(table);
    if (!ws.length) return;
    const showAvg = ws.length >= 3;
    const head = h('tr', null,
      h('th', null, 'Date'), h('th', { class: 'num' }, `Weight (${unit()})`),
      showAvg ? h('th', { class: 'num' }, '7-day avg') : null,
      h('th', { class: 'num' }, 'Change'), h('th', null, 'Note'));
    table.append(h('thead', null, head));
    const body = h('tbody');
    [...ws].reverse().forEach((w, k, arr) => {
      const prev = arr[k + 1];
      const d = prev ? w.kg - prev.kg : null;
      const cls = d == null ? 'num muted' : d < 0 ? 'num delta-good' : d > 0 ? 'num delta-bad' : 'num';
      body.append(h('tr', null,
        h('td', null, fmtDate(w.date, { month: 'short', day: 'numeric', year: 'numeric' })),
        h('td', { class: 'num' }, fmtW(w.kg, false)),
        showAvg ? h('td', { class: 'num' }, fmtW(w.avg, false)) : null,
        h('td', { class: cls }, d == null ? '—' : fmtDelta(d, false)),
        h('td', { class: 'wrap muted' }, w.note || '')));
    });
    table.append(body);
  }

  // ================================================================
  // LOG
  // ================================================================
  function defaultMealType() {
    const hr = new Date().getHours();
    if (hr < 10) return 'Breakfast';
    if (hr < 14) return 'Lunch';
    if (hr < 16) return 'Snack';
    if (hr < 21) return 'Dinner';
    return 'Snack';
  }

  function renderLog() {
    $('#log-date').value = logDate;
    $('#log-date').max = addDays(todayISO(), 1);
    $('#log-date-label').textContent = relDay(logDate) === fmtDateLong(logDate) ? fmtDateLong(logDate) : `${relDay(logDate)} · ${fmtDateLong(logDate)}`;
    $('#log-today').hidden = logDate === todayISO();

    // weigh-in
    const w = weightOn(logDate);
    const wf = $('#weight-form');
    wf.weight.value = w ? toDisplay(w.kg).toFixed(1) : '';
    wf.note.value = w ? w.note : '';
    $('#weight-save').textContent = w ? 'Update weigh-in' : 'Save weigh-in';
    $('#weight-delete').hidden = !w;
    const status = $('#weigh-status');
    if (w) {
      const prev = sortedWeights().filter((x) => x.date < logDate).pop();
      status.textContent = prev ? `${fmtDelta(w.kg - prev.kg)} vs ${fmtDate(prev.date)}` : 'First weigh-in';
    } else status.textContent = '';

    // meals
    const meals = mealsOn(logDate);
    const ml = $('#meals-list');
    clear(ml);
    meals.forEach((mm) => ml.append(entryRow({
      badge: mm.type, title: mm.description, sub: macroLine(mm), meta: mm.calories != null ? `${fmtInt(mm.calories)} kcal` : '',
      onDelete: () => { if (confirm(`Remove "${mm.description}"?`)) { state.meals = state.meals.filter((x) => x.id !== mm.id); save(); notify('meals', 'delete', mm.id); render(); } },
    })));
    const kcal = meals.reduce((s2, mm) => s2 + (mm.calories || 0), 0);
    $('#meals-total').textContent = meals.length ? `${meals.length} meal${meals.length === 1 ? '' : 's'}${kcal ? ` · ${fmtInt(kcal)} kcal` : ''}` : '';
    if (!$('#meal-form').description.value) $('#meal-form').type.value = defaultMealType();

    // exercise
    const ex = exerciseOn(logDate);
    const el = $('#exercise-list');
    clear(el);
    ex.forEach((e) => el.append(entryRow({
      badge: fmtMinutes(e.minutes), title: e.activity, sub: e.notes, meta: e.calories != null ? `${fmtInt(e.calories)} kcal` : '',
      onDelete: () => { if (confirm(`Remove "${e.activity}"?`)) { state.exercise = state.exercise.filter((x) => x.id !== e.id); save(); notify('exercise', 'delete', e.id); render(); } },
    })));
    const mins = ex.reduce((s2, e) => s2 + e.minutes, 0);
    const burned = ex.reduce((s2, e) => s2 + (e.calories || 0), 0);
    $('#exercise-total').textContent = ex.length ? `${fmtMinutes(mins)}${burned ? ` · ${fmtInt(burned)} kcal` : ''}` : '';

    renderPresetChips();

    // day tiles
    const dt = $('#day-tiles');
    clear(dt);
    const macros = macroLine({ protein: sumOrNull(meals, 'protein'), carbs: sumOrNull(meals, 'carbs'), fat: sumOrNull(meals, 'fat') });
    dt.append(
      tile('Weight', w ? fmtW(w.kg, false) : '—', w ? unit() : ''),
      tile('Eaten', kcal ? fmtInt(kcal) : (meals.length ? `${meals.length}` : '—'), kcal ? 'kcal' : (meals.length ? 'meals' : ''),
        macros ? h('div', { class: 'tile__delta' }, macros) : null),
      tile('Exercise', mins ? fmtMinutes(mins) : '—', ''),
      tile('Burned', burned ? fmtInt(burned) : '—', burned ? 'kcal' : ''),
    );
  }

  function entryRow({ badge, title, sub, meta, onDelete }) {
    return h('li', { class: 'entry' },
      h('span', { class: 'entry__badge' }, badge),
      h('div', { class: 'entry__main' }, h('span', { class: 'entry__title' }, title), sub ? h('span', { class: 'entry__sub' }, sub) : null),
      h('span', { class: 'entry__meta' }, meta || ''),
      h('button', { class: 'entry__del', type: 'button', 'aria-label': `Remove ${title}`, onclick: onDelete }, '×'));
  }

  function bindLog() {
    $('#log-date').addEventListener('change', (e) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { logDate = e.target.value; render(); }
    });
    $('#log-prev').addEventListener('click', () => { logDate = addDays(logDate, -1); render(); });
    $('#log-next').addEventListener('click', () => { logDate = addDays(logDate, 1); render(); });
    $('#log-today').addEventListener('click', () => { logDate = todayISO(); render(); });

    // Typing in the meal or activity box filters the preset strip.
    $('#meal-form').description.addEventListener('input', renderPresetChips);
    $('#exercise-form').activity.addEventListener('input', renderPresetChips);
    $('#meal-macros-toggle').addEventListener('click', () => {
      const f = $('#meal-form');
      f.classList.toggle('show-macros');
      if (f.classList.contains('show-macros')) f.protein.focus();
    });

    $('#weight-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const v = parseFloat(f.weight.value);
      if (!Number.isFinite(v) || v <= 0) { toast('Enter a valid weight.'); return; }
      const kg = fromDisplay(v);
      const existing = weightOn(logDate);
      if (existing) { existing.kg = kg; existing.note = f.note.value.trim(); existing.updatedAt = Date.now(); }
      else state.weights.push({ id: uid(), date: logDate, kg, note: f.note.value.trim(), updatedAt: Date.now() });
      save(); notify('weights', 'upsert', logDate); render();
      toast(existing ? 'Weigh-in updated' : 'Weigh-in saved');
    });
    $('#weight-delete').addEventListener('click', () => {
      if (!confirm('Remove this weigh-in?')) return;
      state.weights = state.weights.filter((w) => w.date !== logDate);
      save(); notify('weights', 'delete', logDate); render(); toast('Weigh-in removed');
    });

    $('#meal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const desc = f.description.value.trim();
      if (!desc) return;
      const meal = addMeal({ type: f.type.value, description: desc, calories: f.calories.value, protein: f.protein.value, carbs: f.carbs.value, fat: f.fat.value });
      const presetSaved = f.savePreset.checked && savePreset('mealPresets', { name: desc, type: f.type.value, calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat });
      ['description', 'calories', 'protein', 'carbs', 'fat'].forEach((k) => { f[k].value = ''; });
      f.savePreset.checked = false;
      f.classList.remove('show-macros');
      render(); toast(presetSaved ? 'Meal added and saved as a preset' : 'Meal added');
      f.description.focus();
    });

    $('#exercise-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const activity = f.activity.value.trim();
      const minutes = Math.round(Number(f.minutes.value));
      if (!activity || !Number.isFinite(minutes) || minutes <= 0) { toast('Enter an activity and minutes.'); return; }
      const cal = f.calories.value === '' ? null : Math.max(0, Math.round(Number(f.calories.value)));
      const session = { id: uid(), date: logDate, activity, minutes, calories: Number.isFinite(cal) ? cal : null, notes: f.notes.value.trim(), createdAt: Date.now(), updatedAt: Date.now() };
      state.exercise.push(session);
      const presetSaved = f.savePreset.checked && savePreset('exercisePresets', { name: activity, minutes, calories: session.calories });
      f.activity.value = ''; f.minutes.value = ''; f.calories.value = ''; f.notes.value = ''; f.savePreset.checked = false;
      save(); notify('exercise', 'upsert', session.id); render(); toast(presetSaved ? 'Exercise added and saved as a preset' : 'Exercise added');
      f.activity.focus();
    });
  }

  // ================================================================
  // HISTORY
  // ================================================================
  function renderHistory() {
    $$('#history-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === historyTab)));
    const table = $('#history-table');
    const empty = $('#history-empty');
    clear(table);
    const dateCell = (iso) => h('td', null, h('a', { href: '#log', onclick: () => { logDate = iso; } }, fmtDate(iso, { month: 'short', day: 'numeric', year: 'numeric' })));
    const delBtn = (label, fn) => h('td', { class: 'actions' }, h('button', { class: 'btn btn--small btn--danger-ghost', type: 'button', 'aria-label': label, onclick: fn }, 'Remove'));

    if (historyTab === 'weights') {
      const ws = withMovingAverage(sortedWeights()).reverse();
      empty.hidden = ws.length > 0;
      empty.textContent = 'No weigh-ins yet.';
      if (!ws.length) return;
      table.append(h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', { class: 'num' }, `Weight (${unit()})`), h('th', { class: 'num' }, 'Change'), h('th', null, 'Note'), h('th'))));
      const body = h('tbody');
      ws.forEach((w, k) => {
        const prev = ws[k + 1];
        const d = prev ? w.kg - prev.kg : null;
        const cls = d == null ? 'num muted' : d < 0 ? 'num delta-good' : d > 0 ? 'num delta-bad' : 'num';
        body.append(h('tr', null, dateCell(w.date), h('td', { class: 'num' }, fmtW(w.kg, false)),
          h('td', { class: cls }, d == null ? '—' : fmtDelta(d, false)), h('td', { class: 'wrap muted' }, w.note || ''),
          delBtn(`Remove weigh-in on ${w.date}`, () => { if (confirm('Remove this weigh-in?')) { state.weights = state.weights.filter((x) => x.id !== w.id); save(); notify('weights', 'delete', w.date); render(); } })));
      });
      table.append(body);
    } else if (historyTab === 'meals') {
      const ms = [...state.meals].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      empty.hidden = ms.length > 0;
      empty.textContent = 'No meals logged yet.';
      if (!ms.length) return;
      table.append(h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Meal'), h('th', null, 'Description'), h('th', { class: 'num' }, 'Calories'), h('th', { class: 'num' }, 'P / C / F (g)'), h('th'))));
      const body = h('tbody');
      const g = (v) => (v != null ? fmtInt(v) : '–');
      ms.forEach((mm) => body.append(h('tr', null, dateCell(mm.date), h('td', null, mm.type), h('td', { class: 'wrap' }, mm.description),
        h('td', { class: mm.calories != null ? 'num' : 'num muted' }, mm.calories != null ? fmtInt(mm.calories) : '—'),
        h('td', { class: macroLine(mm) ? 'num' : 'num muted' }, macroLine(mm) ? `${g(mm.protein)} / ${g(mm.carbs)} / ${g(mm.fat)}` : '—'),
        delBtn(`Remove ${mm.description}`, () => { if (confirm(`Remove "${mm.description}"?`)) { state.meals = state.meals.filter((x) => x.id !== mm.id); save(); notify('meals', 'delete', mm.id); render(); } }))));
      table.append(body);
    } else {
      const es = [...state.exercise].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      empty.hidden = es.length > 0;
      empty.textContent = 'No exercise logged yet.';
      if (!es.length) return;
      table.append(h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Activity'), h('th', { class: 'num' }, 'Minutes'), h('th', { class: 'num' }, 'Calories'), h('th', null, 'Notes'), h('th'))));
      const body = h('tbody');
      es.forEach((e) => body.append(h('tr', null, dateCell(e.date), h('td', { class: 'wrap' }, e.activity), h('td', { class: 'num' }, fmtInt(e.minutes)),
        h('td', { class: e.calories != null ? 'num' : 'num muted' }, e.calories != null ? fmtInt(e.calories) : '—'), h('td', { class: 'wrap muted' }, e.notes || ''),
        delBtn(`Remove ${e.activity}`, () => { if (confirm(`Remove "${e.activity}"?`)) { state.exercise = state.exercise.filter((x) => x.id !== e.id); save(); notify('exercise', 'delete', e.id); render(); } }))));
      table.append(body);
    }
  }

  /** Add a meal to a date (default: the selected log date). Saves and queues sync. Caller renders. */
  function addMeal(fields, date = logDate) {
    const meal = {
      id: uid(), date, type: fields.type || defaultMealType(), description: String(fields.description || '').trim().slice(0, 200),
      calories: intOrNull(fields.calories), protein: intOrNull(fields.protein), carbs: intOrNull(fields.carbs), fat: intOrNull(fields.fat),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    if (!meal.description) return null;
    state.meals.push(meal);
    save(); notify('meals', 'upsert', meal.id);
    return meal;
  }

  // ================================================================
  // PRESETS - one-tap meals and configured exercises
  // ================================================================
  /** Create or update a preset by name (case-insensitive). Returns the preset. Caller renders. */
  function savePreset(kind, fields) {
    const name = (fields.name || '').trim();
    if (!name) return null;
    const existing = state[kind].find((p) => p.name.toLowerCase() === name.toLowerCase());
    const p = existing || { id: uid() };
    Object.assign(p, fields, { name, updatedAt: Date.now() });
    if (!existing) state[kind].push(p);
    save(); notify(kind, 'upsert', p.id);
    return p;
  }
  function removePreset(kind, id) {
    state[kind] = state[kind].filter((p) => p.id !== id);
    save(); notify(kind, 'delete', id); render();
  }
  const sortedPresets = (kind) => [...state[kind]].sort((a, b) => a.name.localeCompare(b.name));
  const exerciseMeta = (p) => [p.minutes != null ? `${p.minutes} min` : null, p.calories != null ? `${fmtInt(p.calories)} kcal` : null].filter(Boolean).join(' · ');

  function chip(label, meta, title, onclick) {
    return h('button', { type: 'button', class: 'chip', title, onclick },
      h('span', { class: 'chip__name' }, label), meta ? h('span', { class: 'chip__meta' }, meta) : null);
  }

  const CHIP_LIMIT = 6;
  const chipsExpanded = { mealPresets: false, exercisePresets: false };

  /** How often each preset name was logged in the last 60 days, so the strip leads with what you use. */
  function presetUsage(kind) {
    const from = addDays(todayISO(), -60);
    const src = kind === 'mealPresets' ? state.meals : state.exercise;
    const field = kind === 'mealPresets' ? 'description' : 'activity';
    const counts = new Map();
    for (const x of src) {
      if (x.date < from) continue;
      const k = x[field].toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }
  function rankedPresets(kind) {
    const u = presetUsage(kind);
    const n = (p) => u.get(p.name.toLowerCase()) || 0;
    return [...state[kind]].sort((a, b) => n(b) - n(a) || a.name.localeCompare(b.name));
  }

  /** A compact strip: top presets, a "more" chip for the rest, and live filtering by the text typed in the form. */
  function renderChipStrip(container, kind, query, { metaOf, title, onPick }) {
    clear(container);
    const all = rankedPresets(kind);
    container.hidden = !all.length;
    if (!all.length) return;
    const q = query.trim().toLowerCase();
    const matches = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
    const expanded = chipsExpanded[kind] || !!q;
    const shown = expanded ? matches : matches.slice(0, CHIP_LIMIT);
    container.append(h('span', { class: 'chips__label' }, q ? 'Matching' : 'Quick add'));
    shown.forEach((p) => container.append(chip(p.name, metaOf(p), title, () => onPick(p))));
    if (q && !matches.length) container.append(h('span', { class: 'chips__empty' }, 'No preset matches'));
    if (!expanded && matches.length > CHIP_LIMIT) {
      container.append(h('button', { type: 'button', class: 'chip chip--more', onclick: () => { chipsExpanded[kind] = true; renderPresetChips(); } }, `${matches.length - CHIP_LIMIT} more`));
    } else if (chipsExpanded[kind] && !q && all.length > CHIP_LIMIT) {
      container.append(h('button', { type: 'button', class: 'chip chip--more', onclick: () => { chipsExpanded[kind] = false; renderPresetChips(); } }, 'Show fewer'));
    }
  }

  function renderPresetChips() {
    renderChipStrip($('#meal-presets'), 'mealPresets', $('#meal-form').description.value, {
      metaOf: (p) => (p.calories != null ? `${fmtInt(p.calories)} kcal` : ''),
      title: 'Log this meal now',
      onPick: (p) => {
        addMeal({ type: p.type, description: p.name, calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat });
        $('#meal-form').description.value = '';
        render(); toast(`${p.name} logged`);
      },
    });
    renderChipStrip($('#exercise-presets'), 'exercisePresets', $('#exercise-form').activity.value, {
      metaOf: exerciseMeta,
      title: 'Fill in this exercise',
      onPick: (p) => {
        const f = $('#exercise-form');
        f.activity.value = p.name;
        f.minutes.value = p.minutes != null ? p.minutes : '';
        f.calories.value = p.calories != null ? p.calories : '';
        renderPresetChips();
        f.minutes.focus(); f.minutes.select();
      },
    });
  }

  function presetRow(kind, p) {
    const badge = kind === 'mealPresets' ? (p.type || 'Any meal') : (p.minutes != null ? `${p.minutes} min` : 'Any length');
    return h('li', { class: 'entry' },
      h('span', { class: 'entry__badge' }, badge),
      h('div', { class: 'entry__main' }, h('span', { class: 'entry__title' }, p.name),
        kind === 'mealPresets' && macroLine(p) ? h('span', { class: 'entry__sub' }, macroLine(p)) : null),
      h('span', { class: 'entry__meta' }, p.calories != null ? `${fmtInt(p.calories)} kcal` : ''),
      h('button', { class: 'entry__del', type: 'button', 'aria-label': `Remove preset ${p.name}`, onclick: () => { if (confirm(`Remove preset "${p.name}"?`)) removePreset(kind, p.id); } }, '×'));
  }

  function renderPresetLists() {
    const ml = $('#meal-preset-list');
    clear(ml);
    sortedPresets('mealPresets').forEach((p) => ml.append(presetRow('mealPresets', p)));
    $('#meal-preset-empty').hidden = state.mealPresets.length > 0;
    const xl = $('#exercise-preset-list');
    clear(xl);
    sortedPresets('exercisePresets').forEach((p) => xl.append(presetRow('exercisePresets', p)));
    $('#exercise-preset-empty').hidden = state.exercisePresets.length > 0;
  }

  function bindPresets() {
    $('#meal-preset-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const name = f.preset_name.value.trim();
      if (!name) return;
      savePreset('mealPresets', { name, type: f.type.value, calories: intOrNull(f.calories.value), protein: intOrNull(f.protein.value), carbs: intOrNull(f.carbs.value), fat: intOrNull(f.fat.value) });
      ['preset_name', 'calories', 'protein', 'carbs', 'fat', 'type'].forEach((k) => { f[k].value = ''; });
      render(); toast('Meal preset saved'); f.preset_name.focus();
    });
    $('#exercise-preset-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const name = f.preset_name.value.trim();
      if (!name) return;
      savePreset('exercisePresets', { name, minutes: intOrNull(f.minutes.value), calories: intOrNull(f.calories.value) });
      f.preset_name.value = ''; f.minutes.value = ''; f.calories.value = '';
      render(); toast('Exercise preset saved'); f.preset_name.focus();
    });
  }

  // ================================================================
  // SETTINGS
  // ================================================================
  function renderSettings() {
    renderPresetLists();
    const f = $('#settings-form');
    f.unit.value = unit();
    f.goalWeight.value = state.settings.goalWeightKg ? toDisplay(state.settings.goalWeightKg).toFixed(1) : '';
    f.theme.value = state.settings.theme;
    const n = (k) => state[k].length;
    $('#data-summary').textContent = `${n('weights')} weigh-ins, ${n('meals')} meals, ${n('exercise')} exercise sessions on this device.`;
    notify('settings', 'render');
  }

  function bindSettings() {
    const f = $('#settings-form');
    // Live unit switch so the goal field converts as you toggle.
    f.unit.forEach((r) => r.addEventListener('change', () => {
      const newUnit = f.unit.value;
      const gv = parseFloat(f.goalWeight.value);
      if (Number.isFinite(gv)) {
        const kg = unit() === 'lb' ? gv / LB_PER_KG : gv;
        f.goalWeight.value = (newUnit === 'lb' ? kg * LB_PER_KG : kg).toFixed(1);
      }
      state.settings.unit = newUnit;
      $$('.unit-label').forEach((el) => { el.textContent = newUnit; });
    }));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      state.settings.unit = f.unit.value === 'kg' ? 'kg' : 'lb';
      const gv = parseFloat(f.goalWeight.value);
      state.settings.goalWeightKg = Number.isFinite(gv) && gv > 0 ? fromDisplay(gv) : null;
      state.settings.theme = f.theme.value;
      state.settings.updatedAt = Date.now();
      applyTheme(); save(); notify('settings', 'upsert'); render(); toast('Settings saved');
    });
    f.theme.addEventListener('change', () => { state.settings.theme = f.theme.value; applyTheme(); });

    $('#export-btn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `weight-journey-${todayISO()}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Backup downloaded');
    });

    $('#import-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const incoming = normalize(parsed);
        const total = incoming.weights.length + incoming.meals.length + incoming.exercise.length;
        if (!total) { toast('That file has no entries to import.'); return; }
        const mode = state.weights.length + state.meals.length + state.exercise.length
          ? (confirm(`Import ${total} entries.\n\nOK = merge with your existing data\nCancel = replace everything with the backup`) ? 'merge' : 'replace')
          : 'replace';
        if (mode === 'replace') {
          state = incoming;
          notify('all', 'wipe');
        } else {
          const byDate = new Map(state.weights.map((w) => [w.date, w]));
          incoming.weights.forEach((w) => byDate.set(w.date, w));
          state.weights = [...byDate.values()];
          const ids = new Set([...state.meals, ...state.exercise].map((x) => x.id));
          state.meals.push(...incoming.meals.filter((m) => !ids.has(m.id)));
          state.exercise.push(...incoming.exercise.filter((x) => !ids.has(x.id)));
          for (const kind of ['mealPresets', 'exercisePresets']) {
            const names = new Set(state[kind].map((p) => p.name.toLowerCase()));
            state[kind].push(...incoming[kind].filter((p) => !names.has(p.name.toLowerCase())));
          }
          state.settings = { ...state.settings, ...incoming.settings };
        }
        state.settings.updatedAt = Date.now();
        applyTheme(); save(); notify('all', 'upsert'); render();
        toast(mode === 'replace' ? 'Backup restored' : 'Backup merged');
      } catch (err) {
        console.error(err);
        toast('Could not read that file.');
      }
    });

    $('#clear-btn').addEventListener('click', () => {
      if (!confirm('Delete ALL weigh-ins, meals, and exercise? If you are signed in, this also deletes them from your account. This cannot be undone.')) return;
      if (!confirm('Really delete everything? Consider exporting a backup first.')) return;
      const theme = state.settings.theme, u = state.settings.unit;
      state = defaultState();
      state.settings.theme = theme; state.settings.unit = u;
      save(); notify('all', 'wipe'); render(); toast('All data deleted');
    });
  }

  // ================================================================
  // PUBLIC API for js/sync.js
  // ================================================================
  window.WJ = {
    getState: () => state,
    /** Replace data from the server. Keeps the local theme. Re-renders only if something changed. */
    replaceData: ({ settings, ...collections }) => {
      const next = normalize({ ...state, ...collections, settings: { ...state.settings, ...settings, theme: state.settings.theme } });
      const changed = JSON.stringify(next) !== JSON.stringify(state);
      state = next;
      if (changed) { save(); applyTheme(); render(); }
      return changed;
    },
    clearLocal: () => { const theme = state.settings.theme; state = defaultState(); state.settings.theme = theme; save(); render(); },
    onChange: (fn) => listeners.push(fn),
    addMeal, savePreset, defaultMealType, intOrNull,
    getLogDate: () => logDate,
    fmtLogDate: () => (logDate === todayISO() ? 'today' : `on ${fmtDate(logDate)}`),
    render, toast, uid, isUuid, h, $, $$, clear, todayISO,
  };

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    applyTheme();
    bindLog();
    bindPresets();
    bindSettings();

    $('#range-filter').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-range]');
      if (!b) return;
      chartRange = b.dataset.range;
      renderDashboard();
    });
    $('#history-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      historyTab = b.dataset.tab;
      renderHistory();
    });

    window.addEventListener('hashchange', () => showView(viewFromHash()));
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (currentView === 'dashboard') renderDashboard(); }, 120);
    });
    // Pick up changes made in another tab.
    window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { state = load(); applyTheme(); render(); } });

    showView(viewFromHash());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
