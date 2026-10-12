/* ------------------------------------------------------------------
   Weight Journey - nutrition label scanner

   Takes a photo of a package's Nutrition Facts panel, reads it with
   on-device OCR (Tesseract.js, loaded on demand), and prefills a
   review form: name, calories, protein, carbs, fat. Nothing leaves the
   device; the photo is never uploaded.
   ------------------------------------------------------------------ */
(() => {
  'use strict';

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  // ---------- parsing (pure; also exported for tests) ----------
  const NOISE = /best if|if used|used by|use by|best by|sell by|net wt|net weight|enjoy early|peak freshness|keep refrigerated|keep frozen|contains:|instructions|recycle|distributed|nutrition facts|ingredients|serving|per container|daily value|amount per|\d{1,2}\/\d{1,2}\/\d{2,4}/i;

  function firstInt(text, patterns, max) {
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= max) return n;
    }
    return null;
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
  }

  function guessName(lines) {
    const stop = lines.findIndex((l) => /ingredients/i.test(l));
    const scope = stop > 0 ? lines.slice(0, stop) : lines;
    for (const raw of scope) {
      // Columns from the Nutrition Facts panel bleed into the same OCR line; keep only the first column.
      let l = raw.split(/\s{2,}/)[0];
      if (NOISE.test(l)) continue;
      l = l.replace(/^[^A-Za-z]+/, '').replace(/\s+(nutri\w*|amount|calories|serving)\b.*$/i, '').trim();
      l = l.replace(/[^A-Za-z0-9\s\-'&/]/g, ' ').replace(/\s+/g, ' ').trim();
      const words = l.split(' ');
      if (words.length < 2) continue;
      if (words.some((w) => /[a-z]/.test(w))) continue;          // product names are set in caps on labels
      if (l.replace(/[^A-Za-z]/g, '').length < 10) continue;
      if (words.filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 3).length < 2) continue;
      return titleCase(l).slice(0, 120);
    }
    return '';
  }

  /** Factor-style summary strip: "500 43g 27g" above "CALORIES PROTEIN TOTAL CARBS". */
  function summaryCarbs(lines, calories, protein) {
    const i = lines.findIndex((l) => /calories\s+protein\s+total\s+carbs/i.test(l));
    if (i <= 0) return null;
    let s = lines[i - 1].replace(/[^0-9g]/gi, '').toLowerCase();
    if (calories != null && s.startsWith(String(calories))) s = s.slice(String(calories).length);
    if (protein != null && s.startsWith(String(protein))) {
      s = s.slice(String(protein).length);
      if (s[0] === 'g' || s[0] === '9') s = s.slice(1);
    }
    s = s.replace(/g$/, '');
    if (!/^\d+$/.test(s)) return null;
    let n = parseInt(s, 10);
    if (n > 150 && /9$/.test(s)) n = parseInt(s.slice(0, -1), 10); // a trailing "g" read as "9"
    return n >= 0 && n <= 150 ? n : null;
  }

  function parseLabel(raw) {
    const text = String(raw || '').replace(/\r/g, '');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const calories = firstInt(text, [/calories\s*[:\-]?\s*(\d{2,4})\b/i, /\b(\d{2,4})\s*\n?\s*calories\b/i], 5000);
    const fat = firstInt(text, [/total\s*fat\s*[:\-]?\s*(\d{1,3})\s*g?\b/i, /\b(\d{1,3})\s*g\s*(?:total\s*)?fat\b/i], 300);
    const protein = firstInt(text, [/protein\s*[:\-]?\s*(\d{1,3})\s*g?\b/i, /\b(\d{1,3})\s*g\s*protein\b/i], 300);
    let carbs = firstInt(text, [/total\s*carb\w*\s*[:\-]?\s*(\d{1,3})\s*g?\b/i, /carb\w*\s*[:\-]?\s*(\d{1,3})\s*g?\b/i, /hydrate\s*[:\-]?\s*(\d{1,3})\s*g?\b/i, /\b(\d{1,3})\s*g\s*(?:total\s*)?carbs?\b/i], 300);
    if (carbs == null) carbs = summaryCarbs(lines, calories, protein);
    return { name: guessName(lines), calories, protein, carbs, fat };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { parseLabel };
  if (typeof window === 'undefined' || !window.WJ) return;

  // ---------- browser side ----------
  const WJ = window.WJ;
  const { $, h } = WJ;
  const dialog = $('#scan-dialog');
  const form = $('#scan-form');
  const input = $('#scan-input');
  let tesseractPromise = null;
  let workerPromise = null;
  let previewUrl = null;
  let jobId = 0;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the label reader. Check your connection and try again.'));
      document.head.append(s);
    });
  }
  async function getWorker(onProgress) {
    if (!window.Tesseract) {
      tesseractPromise = tesseractPromise || loadScript(TESSERACT_URL).catch((e) => { tesseractPromise = null; throw e; });
      await tesseractPromise;
    }
    if (!workerPromise) {
      workerPromise = window.Tesseract.createWorker('eng', 1, {
        logger: (m) => { if (m.status === 'recognizing text' && currentProgress) currentProgress(m.progress); },
      }).then(async (w) => { await w.setParameters({ preserve_interword_spaces: '1' }); return w; })
        .catch((e) => { workerPromise = null; throw e; });
    }
    currentProgress = onProgress;
    return workerPromise;
  }
  let currentProgress = null;

  /** Downscale, grayscale and stretch contrast so small label text reads better. */
  async function prepare(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { bmp = await createImageBitmap(file); }
    const maxSide = 2400;
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = g; hist[g]++;
    }
    const total = c.width * c.height;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range)) | 0;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function setStatus(text, progress) {
    $('#scan-status').hidden = text == null;
    if (text != null) $('#scan-status-text').textContent = text;
    $('#scan-progress').style.width = `${Math.round((progress || 0) * 100)}%`;
  }
  function setHint(text) {
    const el = $('#scan-hint');
    el.hidden = !text;
    el.textContent = text || '';
  }
  function fill(parsed) {
    form.name.value = parsed.name || '';
    form.type.value = '';
    for (const k of ['calories', 'protein', 'carbs', 'fat']) form[k].value = parsed[k] != null ? parsed[k] : '';
  }
  function setBusy(busy) {
    for (const el of form.querySelectorAll('input, select, #scan-save, #scan-save-log')) el.disabled = busy;
  }

  function openDialog(file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    $('#scan-preview').src = previewUrl;
    fill({});
    setHint('');
    setStatus('Reading the label…', 0);
    setBusy(true);
    $('#scan-save-log').textContent = `Save preset & log ${WJ.fmtLogDate()}`;
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog() {
    jobId++;
    if (dialog.open) dialog.close();
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    $('#scan-preview').removeAttribute('src');
  }

  async function scan(file) {
    const id = ++jobId;
    openDialog(file);
    try {
      const canvas = await prepare(file);
      if (id !== jobId) return;
      const worker = await getWorker((p) => { if (id === jobId) setStatus('Reading the label…', p); });
      if (id !== jobId) return;
      const { data } = await worker.recognize(canvas);
      if (id !== jobId) return;
      const parsed = parseLabel(data.text);
      window.WJScan.lastText = data.text;
      fill(parsed);
      setStatus(null);
      setBusy(false);
      const missing = ['calories', 'protein', 'carbs', 'fat'].filter((k) => parsed[k] == null);
      const found = 4 - missing.length;
      if (found === 0 && !parsed.name) setHint('Could not read this photo. Fill in the values from the label, or try again with the Nutrition Facts panel flat, well lit, and filling the frame.');
      else if (missing.length) setHint(`Check the values against the label. Could not read: ${missing.join(', ')}.`);
      else setHint('Check the values against the label, then save.');
      (parsed.name ? form.calories : form.name).focus();
    } catch (err) {
      if (id !== jobId) return;
      console.error(err);
      setStatus(null);
      setBusy(false);
      setHint(err.message || 'Could not read this photo. Fill in the values from the label.');
    }
  }

  function readForm() {
    return {
      name: form.name.value.trim(), type: form.type.value,
      calories: WJ.intOrNull(form.calories.value), protein: WJ.intOrNull(form.protein.value),
      carbs: WJ.intOrNull(form.carbs.value), fat: WJ.intOrNull(form.fat.value),
    };
  }
  function savePreset(logToo) {
    const f = readForm();
    if (!f.name) { form.name.focus(); setHint('Give the meal a name.'); return; }
    const preset = WJ.savePreset('mealPresets', f);
    if (logToo) WJ.addMeal({ type: f.type, description: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat });
    closeDialog();
    WJ.render();
    WJ.toast(logToo ? `${preset.name} saved and logged` : `${preset.name} saved as a preset`);
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.scan-btn')) { input.value = ''; input.click(); }
  });
  input.addEventListener('change', () => { const file = input.files && input.files[0]; if (file) scan(file); });
  $('#scan-save').addEventListener('click', () => savePreset(false));
  $('#scan-save-log').addEventListener('click', () => savePreset(true));
  $('#scan-cancel').addEventListener('click', closeDialog);
  $('#scan-close').addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); savePreset(true); });

  window.WJScan = { parseLabel };
})();
