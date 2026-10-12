/* ------------------------------------------------------------------
   Weight Journey - account & cloud sync (Supabase)

   Offline-first: the browser copy in localStorage is always the working
   set. When signed in, changes are queued (dirty keys + tombstones) and
   pushed, then the full server copy is pulled and becomes the local
   copy. Conflicts on the same row resolve by newest updated_at.
   ------------------------------------------------------------------ */
(() => {
  'use strict';

  const WJ = window.WJ;
  const cfg = window.WJ_CONFIG;
  const META_KEY = 'weight-journey.sync.v1';
  const { h, $, clear } = WJ;

  const KINDS = ['weights', 'meals', 'exercise', 'mealPresets', 'exercisePresets'];
  const emptyKeys = () => Object.fromEntries(KINDS.map((k) => [k, []]));
  const defaultMeta = () => ({ dirty: emptyKeys(), tomb: emptyKeys(), settings: false, all: false, wipe: false, lastSync: 0 });

  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      const m = raw ? JSON.parse(raw) : null;
      return m && typeof m === 'object' ? { ...defaultMeta(), ...m, dirty: { ...emptyKeys(), ...(m.dirty || {}) }, tomb: { ...emptyKeys(), ...(m.tomb || {}) } } : defaultMeta();
    } catch { return defaultMeta(); }
  }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (err) { console.warn(err); } }

  let meta = loadMeta();
  let sb = null;
  let session = null;
  let status = 'off';        // off | synced | syncing | offline | error | unconfigured
  let lastError = '';
  let syncing = false;
  let pendingRun = false;
  let timer = null;
  let ui = { mode: 'signin', busy: false, message: '' }; // signin | signup | reset | recovery

  // ---------- change tracking ----------
  const addKey = (arr, key) => { if (!arr.includes(key)) arr.push(key); };
  const dropKey = (arr, key) => { const i = arr.indexOf(key); if (i >= 0) arr.splice(i, 1); };

  WJ.onChange((kind, op, key) => {
    if (kind === 'settings' && op === 'render') { renderAccountCard(); return; }
    if (kind === 'all') {
      if (op === 'wipe') { meta.wipe = true; meta.dirty = emptyKeys(); meta.tomb = emptyKeys(); }
      meta.all = true; meta.settings = true;
    } else if (kind === 'settings') {
      meta.settings = true;
    } else if (op === 'delete') {
      dropKey(meta.dirty[kind], key); addKey(meta.tomb[kind], key);
    } else {
      dropKey(meta.tomb[kind], key); addKey(meta.dirty[kind], key);
    }
    saveMeta();
    scheduleSync(1500);
  });

  function scheduleSync(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => { sync(); }, delay);
  }

  // ---------- status ----------
  function setStatus(s, err) {
    status = s;
    lastError = err || '';
    renderStatusPill();
    renderAccountCard();
  }

  function timeAgo(ts) {
    if (!ts) return 'never';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ts).toLocaleString();
  }

  const STATUS_TEXT = {
    unconfigured: 'Sync unavailable',
    off: 'Sign in to sync',
    synced: 'Synced',
    syncing: 'Syncing…',
    offline: 'Offline',
    error: 'Sync error',
  };

  function renderStatusPill() {
    const pill = $('#sync-status');
    if (!pill) return;
    pill.dataset.state = status;
    pill.hidden = status === 'unconfigured';
    $('.sync-pill__text', pill).textContent = STATUS_TEXT[status] || status;
    pill.title = status === 'error' ? lastError : status === 'synced' ? `Last synced ${timeAgo(meta.lastSync)}` : '';
  }

  // ---------- account card (Settings view) ----------
  function renderAccountCard() {
    const card = $('#account-card');
    if (!card) return;
    clear(card);
    if (status === 'unconfigured') {
      card.append(h('h2', { class: 'card__title' }, 'Account & sync'),
        h('p', { class: 'card__sub' }, 'Cloud sync is not configured for this build. Data stays on this device.'));
      return;
    }
    if (session) {
      const line = status === 'syncing' ? 'Syncing…'
        : status === 'offline' ? 'Offline. Changes are saved here and will sync when you reconnect.'
        : status === 'error' ? `Could not sync: ${lastError}`
        : `Last synced ${timeAgo(meta.lastSync)}.`;
      card.append(
        h('div', { class: 'card__head' },
          h('div', null, h('h2', { class: 'card__title' }, 'Account & sync'),
            h('p', { class: 'card__sub' }, 'Signed in as ', h('strong', null, session.user.email || 'you'))),
          h('span', { class: 'status-dot', dataset: { state: status } })),
        h('p', { class: `account__line${status === 'error' ? ' account__line--error' : ''}` }, line),
        h('div', { class: 'form__actions' },
          h('button', { type: 'button', class: 'btn', disabled: status === 'syncing' || null, onclick: () => sync(true) }, 'Sync now'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: signOut }, 'Sign out')),
      );
      return;
    }

    // signed out
    const title = ui.mode === 'signup' ? 'Create an account' : ui.mode === 'reset' ? 'Reset your password' : ui.mode === 'recovery' ? 'Choose a new password' : 'Sign in to sync';
    const intro = ui.mode === 'recovery'
      ? 'Enter a new password for your account.'
      : 'Sign in to keep your journal in sync across your phone and computers. Everything already on this device is uploaded when you sign in.';
    const form = h('form', { class: 'form', onsubmit: onAuthSubmit, novalidate: true });
    if (ui.mode !== 'recovery') {
      form.append(h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Email'),
        h('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com', value: ui.email || '' })));
    }
    if (ui.mode !== 'reset') {
      form.append(h('label', { class: 'field' }, h('span', { class: 'field__label' }, ui.mode === 'recovery' ? 'New password' : 'Password'),
        h('input', { type: 'password', name: 'password', autocomplete: ui.mode === 'signin' ? 'current-password' : 'new-password', required: true, minlength: 6, placeholder: 'At least 6 characters' })));
    }
    const primary = ui.mode === 'signup' ? 'Create account' : ui.mode === 'reset' ? 'Send reset email' : ui.mode === 'recovery' ? 'Save password' : 'Sign in';
    const actions = h('div', { class: 'form__actions' }, h('button', { type: 'submit', class: 'btn btn--primary', disabled: ui.busy || null }, ui.busy ? 'Please wait…' : primary));
    if (ui.mode === 'signin') {
      actions.append(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => setMode('signup') }, 'Create account'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => setMode('reset') }, 'Forgot password?'));
    } else if (ui.mode !== 'recovery') {
      actions.append(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => setMode('signin') }, 'Back to sign in'));
    }
    form.append(actions);
    if (ui.message) form.append(h('p', { class: `account__line${ui.messageIsError ? ' account__line--error' : ''}`, role: 'alert' }, ui.message));

    card.append(h('h2', { class: 'card__title' }, title), h('p', { class: 'card__sub' }, intro), form);
  }

  function setMode(mode) { ui = { ...ui, mode, message: '', messageIsError: false }; renderAccountCard(); }
  function setMessage(message, isError) { ui = { ...ui, message, messageIsError: !!isError, busy: false }; renderAccountCard(); }

  function appUrl() { return location.origin + location.pathname; }

  async function onAuthSubmit(e) {
    e.preventDefault();
    const f = e.target;
    const email = f.email ? f.email.value.trim() : '';
    const password = f.password ? f.password.value : '';
    if (ui.mode !== 'recovery' && !email) { setMessage('Enter your email address.', true); return; }
    if (ui.mode !== 'reset' && password.length < 6) { setMessage('Password must be at least 6 characters.', true); return; }
    ui = { ...ui, email, busy: true, message: '' };
    renderAccountCard();
    try {
      if (ui.mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        meta.all = true; meta.settings = true; saveMeta();
        ui = { ...ui, busy: false, message: '' };
        WJ.toast('Signed in');
      } else if (ui.mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
        if (error) throw error;
        if (data.session) { meta.all = true; meta.settings = true; saveMeta(); ui = { ...ui, busy: false }; WJ.toast('Account created'); }
        else { ui.mode = 'signin'; setMessage('Check your email for a confirmation link, then sign in here.'); }
      } else if (ui.mode === 'reset') {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
        if (error) throw error;
        ui.mode = 'signin'; setMessage('If an account exists for that email, a reset link is on its way.');
      } else if (ui.mode === 'recovery') {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        ui.mode = 'signin'; ui.busy = false; ui.message = '';
        WJ.toast('Password updated');
        renderAccountCard();
      }
    } catch (err) {
      setMessage(friendlyError(err), true);
    }
  }

  function friendlyError(err) {
    const msg = (err && err.message) || String(err);
    if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/email not confirmed/i.test(msg)) return 'Confirm your email first. Check your inbox for the link.';
    if (/already registered/i.test(msg)) return 'That email already has an account. Try signing in.';
    if (/failed to fetch|network/i.test(msg)) return 'Could not reach the server. Check your connection.';
    return msg;
  }

  async function signOut() {
    const wipeLocal = confirm('Sign out.\n\nOK = also remove the journal from this device (recommended on a shared computer)\nCancel = sign out but keep a copy here');
    try { await sb.auth.signOut(); } catch (err) { console.warn(err); }
    session = null;
    meta = defaultMeta(); saveMeta();
    if (wipeLocal) WJ.clearLocal();
    setStatus('off');
    WJ.toast('Signed out');
  }

  // ---------- sync ----------
  async function fetchAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select('*').range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }
  async function upsertRows(table, rows, onConflict) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict });
      if (error) throw error;
    }
  }
  async function deleteKeys(table, column, keys) {
    for (let i = 0; i < keys.length; i += 500) {
      const { error } = await sb.from(table).delete().in(column, keys.slice(i, i + 500));
      if (error) throw error;
    }
  }

  const iso = (ms) => new Date(ms || 0).toISOString();
  const ms = (s) => (s ? Date.parse(s) : 0);
  const round2 = (n) => Math.round(n * 100) / 100;

  const toRemote = {
    weights: (uid, w) => ({ user_id: uid, date: w.date, kg: round2(w.kg), note: w.note || '', updated_at: iso(w.updatedAt) }),
    meals: (uid, m) => ({ id: m.id, user_id: uid, date: m.date, type: m.type, description: m.description, calories: m.calories, protein_g: m.protein, carbs_g: m.carbs, fat_g: m.fat, created_at: iso(m.createdAt), updated_at: iso(m.updatedAt) }),
    exercise: (uid, x) => ({ id: x.id, user_id: uid, date: x.date, activity: x.activity, minutes: x.minutes, calories: x.calories, notes: x.notes || '', created_at: iso(x.createdAt), updated_at: iso(x.updatedAt) }),
    mealPresets: (uid, p) => ({ id: p.id, user_id: uid, name: p.name, type: p.type || '', calories: p.calories, protein_g: p.protein, carbs_g: p.carbs, fat_g: p.fat, updated_at: iso(p.updatedAt) }),
    exercisePresets: (uid, p) => ({ id: p.id, user_id: uid, name: p.name, minutes: p.minutes, calories: p.calories, updated_at: iso(p.updatedAt) }),
  };
  const fromRemote = {
    weights: (r) => ({ id: WJ.uid(), date: r.date, kg: Number(r.kg), note: r.note || '', updatedAt: ms(r.updated_at) }),
    meals: (r) => ({ id: r.id, date: r.date, type: r.type, description: r.description, calories: r.calories, protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) }),
    exercise: (r) => ({ id: r.id, date: r.date, activity: r.activity, minutes: r.minutes, calories: r.calories, notes: r.notes || '', createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) }),
    mealPresets: (r) => ({ id: r.id, name: r.name, type: r.type || '', calories: r.calories, protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g, updatedAt: ms(r.updated_at) }),
    exercisePresets: (r) => ({ id: r.id, name: r.name, minutes: r.minutes, calories: r.calories, updatedAt: ms(r.updated_at) }),
  };
  const TABLE = { weights: 'weigh_ins', meals: 'meals', exercise: 'exercise', mealPresets: 'meal_presets', exercisePresets: 'exercise_presets' };
  const KEYCOL = { weights: 'date', meals: 'id', exercise: 'id', mealPresets: 'id', exercisePresets: 'id' };
  const keyOf = { weights: (w) => w.date, meals: (m) => m.id, exercise: (x) => x.id, mealPresets: (p) => p.id, exercisePresets: (p) => p.id };
  const CONFLICT = { weights: 'user_id,date', meals: 'id', exercise: 'id', mealPresets: 'id', exercisePresets: 'id' };

  async function sync(manual) {
    if (!sb || !session) { setStatus(sb ? 'off' : 'unconfigured'); return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    if (syncing) { pendingRun = true; return; }
    syncing = true;
    setStatus('syncing');

    // Take the queue; anything that changes during the run lands in a fresh queue.
    const job = { dirty: meta.dirty, tomb: meta.tomb, settings: meta.settings, all: meta.all, wipe: meta.wipe };
    meta.dirty = emptyKeys(); meta.tomb = emptyKeys(); meta.settings = false; meta.all = false; meta.wipe = false;
    saveMeta();

    try {
      const uid = session.user.id;
      const local = WJ.getState();

      if (job.wipe) {
        for (const t of [...Object.values(TABLE), 'user_settings']) {
          const { error } = await sb.from(t).delete().eq('user_id', uid);
          if (error) throw error;
        }
      }
      for (const kind of KINDS) {
        if (job.tomb[kind].length) await deleteKeys(TABLE[kind], KEYCOL[kind], job.tomb[kind]);
      }

      const remote = {};
      const [rs] = await Promise.all([
        sb.from('user_settings').select('*').maybeSingle().then(({ data, error }) => { if (error) throw error; return data; }),
        ...KINDS.map((kind) => fetchAll(TABLE[kind]).then((rows) => { remote[kind] = rows; })),
      ]);
      const merged = {};

      for (const kind of KINDS) {
        const remoteMap = new Map(remote[kind].map((r) => [r[KEYCOL[kind]], r]));
        const candidates = job.all ? local[kind].map(keyOf[kind]) : job.dirty[kind];
        const push = [];
        for (const key of new Set(candidates)) {
          const L = local[kind].find((x) => keyOf[kind](x) === key);
          if (!L) continue;
          const R = remoteMap.get(key);
          if (!R || L.updatedAt >= ms(R.updated_at)) push.push(L);
        }
        if (push.length) await upsertRows(TABLE[kind], push.map((x) => toRemote[kind](uid, x)), CONFLICT[kind]);
        const out = new Map(remote[kind].map((r) => [r[KEYCOL[kind]], fromRemote[kind](r)]));
        push.forEach((x) => out.set(keyOf[kind](x), x));
        // Keep edits that arrived while this run was in flight; they sync on the next pass.
        meta.dirty[kind].forEach((key) => { const L = WJ.getState()[kind].find((x) => keyOf[kind](x) === key); if (L) out.set(key, L); });
        meta.tomb[kind].forEach((key) => out.delete(key));
        merged[kind] = [...out.values()];
      }

      // settings: unit + goal sync; theme stays per device
      let settings = { unit: local.settings.unit, goalWeightKg: local.settings.goalWeightKg, updatedAt: local.settings.updatedAt };
      const pushSettings = (job.settings || job.all) && (!rs || local.settings.updatedAt >= ms(rs.updated_at));
      if (pushSettings) {
        const { error } = await sb.from('user_settings').upsert({ user_id: uid, unit: settings.unit, goal_weight_kg: settings.goalWeightKg == null ? null : round2(settings.goalWeightKg), updated_at: iso(settings.updatedAt) }, { onConflict: 'user_id' });
        if (error) throw error;
      } else if (rs) {
        settings = { unit: rs.unit, goalWeightKg: rs.goal_weight_kg == null ? null : Number(rs.goal_weight_kg), updatedAt: ms(rs.updated_at) };
      }

      meta.lastSync = Date.now(); saveMeta();
      WJ.replaceData({ ...merged, settings });
      setStatus('synced');
      if (manual) WJ.toast('Up to date');
    } catch (err) {
      console.error('Sync failed', err);
      // Put the job back so nothing is lost.
      for (const kind of KINDS) {
        job.dirty[kind].forEach((k) => { if (!meta.tomb[kind].includes(k)) addKey(meta.dirty[kind], k); });
        job.tomb[kind].forEach((k) => { dropKey(meta.dirty[kind], k); addKey(meta.tomb[kind], k); });
      }
      meta.settings = meta.settings || job.settings; meta.all = meta.all || job.all; meta.wipe = meta.wipe || job.wipe;
      saveMeta();
      setStatus(navigator.onLine ? 'error' : 'offline', friendlyError(err));
      if (manual) WJ.toast('Sync failed');
    } finally {
      syncing = false;
      if (pendingRun) { pendingRun = false; scheduleSync(200); }
    }
  }

  // ---------- init ----------
  function init() {
    if (!cfg || !cfg.url || !cfg.key || !window.supabase) {
      setStatus('unconfigured');
      return;
    }
    sb = window.supabase.createClient(cfg.url, cfg.key);

    sb.auth.onAuthStateChange((event, s) => {
      const had = !!session;
      session = s;
      if (event === 'PASSWORD_RECOVERY') { setMode('recovery'); }
      if (s) {
        if (!had) { renderAccountCard(); }
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') scheduleSync(0);
      } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        setStatus('off');
      }
      renderStatusPill();
    });

    window.addEventListener('online', () => scheduleSync(0));
    window.addEventListener('offline', () => { if (session) setStatus('offline'); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) scheduleSync(0); });
    setInterval(() => { if (status === 'synced') renderStatusPill(); }, 60000);
  }

  init();
})();
