// Panel principal: elegir qué y cómo grabar, ver los videos y configurar los links.
const B = window.boom;
const $ = (id) => document.getElementById(id);
let state = null;
let settings = null;
let newest = null;
const progress = {};
let knownMics = null;   // nombres de los micrófonos vistos, para avisar cuando se enchufa uno
const TOGGLES = ['systemAudio', 'noiseSuppression', 'mirror', 'rounded', 'watermark', 'micMono', 'captions'];
let captioning = {};    // videos a los que se les están haciendo subtítulos: id -> avance

// ---------- utilidades ----------
function toast(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 9000 : 5000);
}
const fmtDur = (sec) => {
  const t = Math.round(sec || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
const fmtDate = (iso) => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const set = (patch) => B.invoke('boom:setSettings', patch).then((s) => { settings = s; paint(); });

function segmented(id, key, cast = (v) => v) {
  $(id).querySelectorAll('button').forEach((b) => { b.onclick = () => set({ [key]: cast(b.dataset.v) }); });
}
function paintSeg(id, value) {
  $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(value)));
}
function fillSelect(sel, options, value) {
  sel.innerHTML = '';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = options.some((o) => o.value === value) ? value : (options[0] ? options[0].value : '');
}

// ---------- pintar ----------
function paint() {
  const s = settings;
  paintSeg('mode', s.mode); paintSeg('shape', s.shape); paintSeg('size', s.size);
  paintSeg('preset', s.preset); paintSeg('fps', s.fps); paintSeg('frame', s.frame);
  for (const k of TOGGLES) $(k).checked = !!s[k];
  const cam = s.mode !== 'screen', scr = s.mode !== 'cam';
  $('rowCamera').classList.toggle('off', !cam);
  $('cardCam').classList.toggle('off', !cam);
  $('rowSize').classList.toggle('dim', s.shape === 'full');
  $('rowFrame').classList.toggle('dim', s.shape === 'full');
  $('swRounded').classList.toggle('dim', s.shape === 'circle' || s.shape === 'full');
  // El audio de la PC solo se puede grabar en Windows (Mac y Linux no lo permiten sin programas extra).
  $('chkSystem').classList.toggle('off', !scr || state.platform !== 'win32');
  $('logoPick').classList.toggle('off', !s.watermark);
  $('logoName').textContent = s.watermarkPath ? s.watermarkPath.split(/[\\/]/).pop() : 'Logo de Boom';
  $('clearLogo').style.display = s.watermarkPath ? '' : 'none';
  $('markHint').textContent = scr
    ? 'Chiquito, arriba a la izquierda del video.'
    : 'Chiquito, arriba a la izquierda. En solo cámara se agrega al armar el video (tarda un poco más).';

  const d = state.displays.find((x) => x.id === Number($('display').value)) || state.displays[0];
  const bpp = { max: 0.20, high: 0.12, light: 0.07 }[s.preset];
  if (scr && d) {
    const mbps = Math.min(60, Math.max(4, d.width * d.height * s.fps * bpp / 1e6));
    $('qualityHint').textContent = `${d.width}×${d.height} a ${s.fps} fps · unos ${Math.round(mbps * 7.5)} MB por minuto`;
  } else {
    $('qualityHint').textContent = 'Se graba a la mayor resolución que dé tu cámara.';
  }
  $('captionsLang').value = s.captionsLang;
  $('captionsLang').closest('.row').classList.toggle('dim', !s.captions);
  $('baseUrl').value = s.cloud.baseUrl; $('token').value = s.cloud.token;
  const ready = !!(s.cloud.baseUrl && s.cloud.token);
  $('cloudState').classList.toggle('ready', ready);
  $('cloudState').textContent = ready
    ? 'Listo: el botón "Copiar link" de cada video lo sube y te copia el link.'
    : 'Sin configurar: por ahora Boom guarda los videos solo en tu PC.';
}

// Juntar videos: "picking" es la lista de los elegidos, en el orden en que se tocaron.
let picking = null;
function startPick() { picking = []; newest = null; paintLibrary(state.library); }
function stopPick() { if (!picking) return; picking = null; paintLibrary(state.library); }
function togglePick(id) {
  const i = picking.indexOf(id);
  if (i >= 0) picking.splice(i, 1); else picking.push(id);
  paintLibrary(state.library);
}
function paintPickBar(items) {
  const n = picking ? picking.length : 0;
  const sec = (picking || []).reduce((t, id) => t + ((items.find((x) => x.id === id) || {}).durationSec || 0), 0);
  $('pickCount').textContent = n === 0 ? 'Elegí el primer video' : n === 1 ? '1 video: elegí el siguiente' : `${n} videos en un solo video`;
  $('pickDur').textContent = n ? `Va a durar ${fmtDur(sec)}` : '';
  $('pickGo').disabled = n < 2;
}
async function doMerge() {
  if (!picking || picking.length < 2) return;
  $('pickGo').disabled = true;
  const r = await B.invoke('boom:lib:merge', picking.slice());
  if (!r.ok) { $('pickGo').disabled = false; toast('No pude juntar los videos: ' + r.error, 'error'); return; }
  picking = null;
  newest = r.item.id;
  paintLibrary(state.library);
  document.querySelector('main').scrollTop = 0;
  toast(`¡Listo! Quedó un solo video de ${fmtDur(r.item.durationSec)}, arriba de todo. Los originales siguen en la lista.`, 'ok');
}

function paintLibrary(items) {
  state.library = items;
  if (picking) picking = picking.filter((id) => items.some((x) => x.id === id && !x.missing));
  $('videos').classList.toggle('picking', !!picking);
  $('count').textContent = items.length ? `${items.length} video${items.length > 1 ? 's' : ''}` : '';
  $('empty').style.display = items.length ? 'none' : 'block';
  $('mergeBtn').classList.toggle('off', items.filter((x) => !x.missing).length < 2);
  paintPickBar(items);
  const list = $('list');
  list.innerHTML = '';
  for (const it of items) {
    const el = document.createElement('div');
    const order = picking ? picking.indexOf(it.id) : -1;
    el.className = 'item' + (it.id === newest ? ' new' : '') + (order >= 0 ? ' picked' : '') + (picking && it.missing ? ' nopick' : '');
    // Un doble clic cuenta como uno solo (si no, marca y desmarca).
    if (picking && !it.missing) el.onclick = (e) => { if (e.detail <= 1) togglePick(it.id); };
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (it.thumb) thumb.style.backgroundImage = `url("app://boom/_thumb/${encodeURIComponent(it.id)}")`;
    thumb.innerHTML = `<span class="pick">${order >= 0 ? order + 1 : ''}</span><b>${fmtDur(it.durationSec)}</b>`;
    thumb.onclick = (e) => { if (picking) return; e.stopPropagation(); B.invoke('boom:lib:open', it.id); };
    const body = document.createElement('div');
    const title = document.createElement('input');
    title.className = 'title'; title.value = it.title; title.spellcheck = false;
    title.disabled = !!picking;
    title.onchange = () => B.invoke('boom:lib:rename', it.id, title.value);
    title.onkeydown = (e) => { if (e.key === 'Enter') title.blur(); };
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${fmtDate(it.createdAt)} · ${it.width}×${it.height}`;
    if (it.share) {
      const sh = document.createElement('span');
      sh.className = 'shared'; sh.textContent = ' · con link';
      meta.appendChild(sh);
    }
    const btns = document.createElement('div');
    btns.className = 'btns';
    const btn = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.textContent = label; b.className = cls; b.onclick = () => fn(b);
      btns.appendChild(b); return b;
    };
    if (it.missing) {
      const gone = document.createElement('span');
      gone.className = 'gone'; gone.textContent = 'El archivo ya no está en tu PC';
      btns.appendChild(gone);
    } else {
      btn('Ver', () => B.invoke('boom:lib:open', it.id));
      btn('Carpeta', () => B.invoke('boom:lib:reveal', it.id));
    }
    const p = progress[it.id];
    const shareBtn = btn(p != null ? `Subiendo ${Math.round(p * 100)}%` : 'Copiar link', (b) => doShare(it, b), 'go');
    shareBtn.disabled = p != null || (it.missing && !it.share);
    shareBtn.dataset.share = it.id;
    if (it.share) btn('Abrir link', () => B.invoke('boom:lib:openLink', it.id));
    if (it.share && it.share.id) {
      const c = captioning[it.id];
      if (c != null) btn(`Subtítulos ${Math.round(c * 100)}%`, () => {}).disabled = true;
      else if (it.share.captions) btn('Quitar subtítulos', () => doCaptions(it, false));
      else if (!it.missing) btn('Agregar subtítulos', () => doCaptions(it, true));
    }
    btn('Borrar', () => B.invoke('boom:lib:delete', it.id), 'danger');
    body.append(title, meta, btns);
    el.append(thumb, body);
    list.appendChild(el);
  }
}

async function doCaptions(it, on) {
  if (on) { captioning[it.id] = 0; paintLibrary(state.library); }
  const r = await B.invoke('boom:lib:captions', it.id, on);
  if (!r.ok) {
    delete captioning[it.id];
    paintLibrary(state.library);
    if (r.needsSetup) { showTab('compartir'); toast('Primero configurá dónde se suben los videos.', 'warn'); }
    else toast((on ? 'No pude hacer los subtítulos: ' : 'No pude quitar los subtítulos: ') + r.error, 'error');
  } else if (!on) toast('Listo: el link ya no muestra subtítulos.', 'ok');
}

async function doShare(it, b) {
  b.disabled = true;
  const r = await B.invoke('boom:lib:share', it.id);
  b.disabled = false;
  if (r.ok) toast('Link copiado: ' + r.url, 'ok');
  else if (r.needsSetup) { showTab('compartir'); toast('Primero configurá dónde se suben los videos.', 'warn'); }
  else toast('No pude compartir: ' + r.error, 'error');
}

function showTab(name) {
  if (name !== 'videos') stopPick();
  $('foot').classList.toggle('off', name !== 'grabar');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === name));
}

// ---------- dispositivos ----------
let primed = false;
async function loadDevices() {
  // Pedir acceso una vez hace que el sistema muestre los nombres de los dispositivos.
  if (!primed) {
    primed = true;
    for (const c of [{ audio: true, video: true }, { audio: true }, { video: true }]) {
      try { (await navigator.mediaDevices.getUserMedia(c)).getTracks().forEach((t) => t.stop()); break; } catch { /* probar el siguiente */ }
    }
  }
  const devs = await navigator.mediaDevices.enumerateDevices();
  const cams = devs.filter((d) => d.kind === 'videoinput');
  const mics = devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications' && d.deviceId !== 'default');
  fillSelect($('camera'),
    cams.length ? cams.map((d, i) => ({ value: d.deviceId, label: d.label || `Cámara ${i + 1}` })) : [{ value: '', label: 'No hay cámaras conectadas' }],
    settings.cameraId);
  // Si la cámara guardada ya no existe, se guarda la que quedó elegida.
  if (cams.length && $('camera').value !== settings.cameraId) await set({ cameraId: $('camera').value });

  // Micrófono. Uno USB (por ejemplo, un inalámbrico) puede no estar enchufado ahora: la elección
  // se conserva, y si vuelve en otro puerto (cambia de identificador) se lo reconoce por el nombre.
  let micId = settings.micId;
  const chosen = micId && micId !== 'none';
  let found = chosen ? mics.find((d) => d.deviceId === micId) : null;
  if (chosen && !found && settings.micLabel) {
    found = mics.find((d) => d.label === settings.micLabel) || null;
    if (found) { micId = found.deviceId; await set({ micId }); }
  }
  if (found && found.label && found.label !== settings.micLabel) await set({ micLabel: found.label });
  const missing = chosen && !found;
  const def = devs.find((d) => d.kind === 'audioinput' && d.deviceId === 'default');
  const defName = def && def.label ? def.label.replace(/^[^-]+ - /, '') : '';
  fillSelect($('mic'), [
    { value: '', label: 'Predeterminado del sistema' + (defName ? ` · ${defName}` : '') },
    ...mics.map((d, i) => ({ value: d.deviceId, label: d.label || `Micrófono ${i + 1}` })),
    ...(missing ? [{ value: micId, label: `${settings.micLabel || 'Micrófono elegido'} (desconectado)` }] : []),
    { value: 'none', label: 'Sin micrófono' },
  ], micId);
  $('micNote').textContent = missing
    ? 'Ese micrófono no está conectado. Si grabás así, Boom usa el predeterminado del sistema.'
    : '';

  // Aviso cuando se enchufa un micrófono nuevo.
  const names = new Set(mics.map((d) => d.label).filter(Boolean));
  if (knownMics) {
    for (const n of names) {
      if (knownMics.has(n)) continue;
      toast(n === settings.micLabel ? `Volvió tu micrófono: ${n}` : `Micrófono conectado: ${n}. Elegilo en "Micrófono" para usarlo.`, 'ok');
    }
  }
  knownMics = names;
  meter();
}

// Medidor de nivel del micrófono elegido.
let meterStream = null, meterCtx = null, meterRaf = 0;
async function meter() {
  cancelAnimationFrame(meterRaf);
  if (meterStream) meterStream.getTracks().forEach((t) => t.stop());
  if (meterCtx) meterCtx.close().catch(() => {});
  meterStream = meterCtx = null;
  $('level').style.width = '0';
  if (settings.micId === 'none') return;
  try {
    meterStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: settings.micId ? { exact: settings.micId } : undefined } });
    meterCtx = new AudioContext();
    const an = meterCtx.createAnalyser();
    an.fftSize = 512;
    meterCtx.createMediaStreamSource(meterStream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      $('level').style.width = Math.min(100, Math.round(Math.sqrt(peak) * 100)) + '%';
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* sin micrófono disponible */ }
}

// ---------- arranque ----------
async function init() {
  state = await B.invoke('boom:getState');
  settings = state.settings;
  fillSelect($('display'), state.displays.map((d) => ({ value: String(d.id), label: `${d.label} · ${d.width}×${d.height}` })),
    String(settings.displayId ?? (state.displays.find((d) => d.primary) || state.displays[0] || {}).id));
  paint();
  paintLibrary(state.library);
  await loadDevices();

  segmented('mode', 'mode'); segmented('shape', 'shape'); segmented('size', 'size');
  segmented('preset', 'preset'); segmented('fps', 'fps', Number);
  $('display').onchange = () => set({ displayId: Number($('display').value) });
  $('camera').onchange = () => set({ cameraId: $('camera').value });
  $('mic').onchange = () => {
    const opt = $('mic').selectedOptions[0];
    const real = $('mic').value && $('mic').value !== 'none' && !/\(desconectado\)$/.test(opt.textContent);
    return set({ micId: $('mic').value, ...(real ? { micLabel: opt.textContent } : $('mic').value ? {} : { micLabel: '' }) }).then(loadDevices);
  };
  for (const k of TOGGLES) $(k).onchange = () => set({ [k]: $(k).checked });
  segmented('frame', 'frame');
  $('ver').textContent = 'v' + state.version;
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });
  $('openDir').onclick = () => B.invoke('boom:openOutDir');
  $('captionsLang').onchange = () => set({ captionsLang: $('captionsLang').value });
  $('openGuide').onclick = () => B.invoke('boom:openGuide');
  $('pickLogo').onclick = () => B.invoke('boom:pickWatermark').then((s) => { settings = s; paint(); });
  $('clearLogo').onclick = () => B.invoke('boom:clearWatermark').then((s) => { settings = s; paint(); });
  if (state.platform === 'darwin') {
    $('keys').innerHTML = '<kbd>⌘⇧B</kbd> graba y termina · <kbd>⌥⇧P</kbd> pausa · <kbd>⌥⇧Z</kbd> retrocede';
  }
  $('mergeBtn').onclick = startPick;
  $('pickCancel').onclick = stopPick;
  $('pickGo').onclick = doMerge;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopPick(); });

  $('start').onclick = async () => {
    $('start').disabled = true;
    // Se suelta el micrófono del medidor para que el grabador lo tome limpio.
    if (meterStream) meterStream.getTracks().forEach((t) => t.stop());
    await B.invoke('boom:start');
    $('start').disabled = false;
  };
  $('saveCloud').onclick = async () => {
    await set({ cloud: { baseUrl: $('baseUrl').value, token: $('token').value } });
    toast('Guardado.', 'ok');
  };
  $('testCloud').onclick = async () => {
    await set({ cloud: { baseUrl: $('baseUrl').value, token: $('token').value } });
    const r = await B.invoke('boom:cloud:test');
    toast(r.ok ? 'Conexión correcta.' : 'No conecta: ' + r.error, r.ok ? 'ok' : 'error');
  };
  navigator.mediaDevices.addEventListener('devicechange', loadDevices);
}

B.on('boom:toast', ({ text, kind }) => toast(text, kind));
B.on('boom:settings', (s) => { settings = s; if (state) paint(); });
B.on('boom:library', (items) => { if (state) paintLibrary(items); });
let lastState = 'idle';
B.on('boom:status', (st) => {
  if (st.state === 'idle' && lastState !== 'idle' && state) meter(); // al terminar, vuelve el medidor
  lastState = st.state;
});
B.on('boom:busy', (text) => { $('busy').classList.toggle('on', !!text); $('busyText').textContent = text || ''; });
B.on('boom:done', (item) => {
  newest = item.id;
  showTab('videos');
  paintLibrary(state.library);
  toast('¡Video listo! Quedó guardado en tu carpeta Videos\\Boom.', 'ok');
});
// Mientras se escribe un nombre no se redibuja la lista (se perdería lo escrito).
const editing = () => document.activeElement && document.activeElement.classList.contains('title');
B.on('boom:captioning', (map) => { captioning = map || {}; if (state && !picking && !editing()) paintLibrary(state.library); });
B.on('boom:progress', ({ id, p }) => {
  if (p == null) delete progress[id]; else progress[id] = p;
  const b = document.querySelector(`[data-share="${CSS.escape(id)}"]`);
  if (b && p != null) { b.textContent = `Subiendo ${Math.round(p * 100)}%`; b.disabled = true; }
});

init().catch((err) => toast('Error al iniciar: ' + err.message, 'error'));
