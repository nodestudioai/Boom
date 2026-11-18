// Boom — proceso principal: ventanas, grabación por tramos, exportación y links.
const { app, ipcMain, screen, desktopCapturer, globalShortcut, session, shell, clipboard, dialog, protocol, net, Menu, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { createTakes } = require('../core/takes');
const { videoBitrate, MIME_CANDIDATES, AUDIO_BPS, isH264 } = require('../core/quality');
const { bubbleBounds, watermarkBounds, cornerBounds } = require('../core/bubble');
const { createSettings } = require('./settings');
const { createLibrary } = require('./library');
const { createSessionFiles } = require('./session');
const exporter = require('./exporter');
const uploader = require('./uploader');
const captioner = require('./captioner');
const W = require('./windows');

const SMOKE = process.env.BOOM_SMOKE === '1';
const MAC = process.platform === 'darwin';
const LINUX = process.platform === 'linux';
// En Linux con Wayland la pantalla se graba a través de PipeWire.
if (LINUX) app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
if (process.env.BOOM_USER_DATA) app.setPath('userData', process.env.BOOM_USER_DATA);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (SMOKE) {
  // Cámara y micrófono de prueba de Chromium, para la prueba automática.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const RENDERER = path.join(__dirname, '..', 'renderer');
const CORE = path.join(__dirname, '..', 'core');
const MIN_SEGMENT_BYTES = 2048;
const GUIDE_URL = 'https://github.com/nodestudioai/Boom/blob/main/cloud/README.md';

let settings, library;
const wins = { panel: null, engine: null, bubble: null, control: null, countdown: null, corner: null, watermark: null };
let rec = null;          // grabación en curso
let starting = false;
let anchor = null;       // centro de la burbuja elegido por el usuario
let prevShape = 'circle'; // última forma chica: a ella se vuelve al achicar la cámara completa
let stackTimer = null;
let previewUntil = 0;    // la marca de agua se muestra un momento al activarla, para verla
let quitting = false;

const alive = (w) => w && !w.isDestroyed();
const sendTo = (w, channel, ...args) => { if (alive(w)) w.webContents.send(channel, ...args); };
const toast = (text, kind = 'info') => sendTo(wins.panel, 'boom:toast', { text, kind });
const outDir = () => process.env.BOOM_OUT_DIR || path.join(app.getPath('videos'), 'Boom');

// ---------- Pantallas ----------
function displays() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    primary: d.id === primary,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    label: `Pantalla ${i + 1}${d.id === primary ? ' (principal)' : ''}`,
  }));
}
function pickDisplay() {
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === settings.get().displayId) || screen.getPrimaryDisplay();
}

// ---------- Burbuja de cámara ----------
function wantedBubbleBounds() {
  const s = settings.get();
  const d = pickDisplay();
  return bubbleBounds({
    shape: s.shape, size: s.size,
    display: s.shape === 'full' ? d.bounds : d.workArea,
    anchor,
  });
}
function syncBubble() {
  const s = settings.get();
  const show = s.mode !== 'screen';
  if (!show) {
    if (alive(wins.bubble)) wins.bubble.hide();
    syncOverlays();
    return;
  }
  const b = wantedBubbleBounds();
  if (!alive(wins.bubble)) {
    wins.bubble = W.createBubble(b);
    wins.bubble.on('moved', () => {
      if (settings.get().shape === 'full' || !alive(wins.bubble)) return;
      const r = wins.bubble.getBounds();
      anchor = { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
    // Al hacer clic en la cámara, Windows la sube por encima de todo: se vuelve a acomodar,
    // para que la barra de control y el botón de achicar nunca queden tapados.
    wins.bubble.on('focus', restack);
    wins.bubble.webContents.on('did-finish-load', () => {
      sendTo(wins.bubble, 'boom:settings', settings.get());
      wins.bubble.showInactive();
      syncOverlays();
    });
  } else {
    wins.bubble.setBounds(b);
    sendTo(wins.bubble, 'boom:settings', settings.get());
    if (!wins.bubble.isVisible()) wins.bubble.showInactive();
  }
  syncOverlays();
}

// Lo que va encima de la cámara: la marca de agua (sale en el video), y el botón de achicar
// y la barra de control (no salen). Se reacomodan cada vez que cambia algo.
function syncOverlays() {
  const s = settings.get();
  const d = pickDisplay();
  const camOn = s.mode !== 'screen';
  const full = camOn && s.shape === 'full';
  const busy = !!rec || starting;

  // Marca de agua: mientras se graba la pantalla (en "solo cámara" se pega al exportar).
  // La ventana se prepara de antes y queda escondida, así al mostrarla ya está pintada.
  const wantMark = s.watermark && s.mode !== 'cam' && (busy || Date.now() < previewUntil);
  if (s.watermark) {
    const b = watermarkBounds({ display: d.bounds });
    const w = ensureOverlay('watermark', () => W.createWatermark(b));
    w.setBounds(b);
    if (wantMark && !w.isVisible()) w.showInactive();
    else if (!wantMark && w.isVisible()) w.hide();
  } else if (alive(wins.watermark)) {
    wins.watermark.destroy();
    wins.watermark = null;
  }

  // Botón para achicar la cámara completa (también preparado de antes).
  if (camOn) {
    const b = cornerBounds({ display: d.bounds });
    const w = ensureOverlay('corner', () => W.createCorner(b));
    w.setBounds(b);
    if (full && !w.isVisible()) { w.showInactive(); sendTo(w, 'boom:hint'); }
    else if (!full && w.isVisible()) w.hide();
  } else if (alive(wins.corner) && wins.corner.isVisible()) {
    wins.corner.hide();
  }

  // Sin grabar y con la cámara completa, el panel queda encima para poder seguir usándolo.
  if (alive(wins.panel)) wins.panel.setAlwaysOnTop(full && !busy, 'screen-saver');
  restack();
  // Con la cámara tapando toda la pantalla, quedar debajo es quedar sin salida: se revisa cada tanto.
  // Lo mismo mientras se graba con la marca de agua: tiene que estar siempre a la vista.
  clearInterval(stackTimer);
  stackTimer = full || wantMark ? setInterval(restack, 1000) : null;
}

// Crea (una sola vez) una ventana de encima y recuerda cuándo terminó de pintarse.
const painted = {};
function ensureOverlay(name, create) {
  if (!alive(wins[name])) {
    const w = create();
    wins[name] = w;
    painted[name] = new Promise((resolve) => w.once('ready-to-show', resolve));
  }
  return wins[name];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function restack() {
  const s = settings.get();
  const idleFull = s.mode !== 'screen' && s.shape === 'full' && !rec && !starting;
  for (const w of [wins.watermark, idleFull ? wins.panel : null, wins.corner, wins.control]) {
    if (alive(w) && w.isVisible()) w.moveTop();
  }
}

function applySettings(patch) {
  const before = settings.get();
  const s = settings.set(patch);
  if (before.displayId !== s.displayId) anchor = null; // otra pantalla: vuelve a su esquina
  if (s.shape !== 'full') prevShape = s.shape;
  if (s.watermarkPath !== before.watermarkPath && alive(wins.watermark)) wins.watermark.webContents.reload();
  if (s.watermark && (!before.watermark || s.watermarkPath !== before.watermarkPath) && !rec) {
    previewUntil = Date.now() + 3500;
    setTimeout(syncOverlays, 3600);
  }
  syncBubble();
  for (const w of [wins.panel, wins.control]) sendTo(w, 'boom:settings', s);
  return s;
}

// ---------- Motor de grabación (ventana oculta) ----------
let rpcSeq = 0;
const pending = new Map();
function engineCall(method, payload = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!alive(wins.engine)) return reject(new Error('El motor de grabación no está disponible'));
    const id = ++rpcSeq;
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`El motor de grabación no respondió (${method})`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    wins.engine.webContents.send('engine:call', { id, method, payload });
  });
}

// ---------- Estado para la interfaz ----------
function status() {
  if (!rec) return { state: starting ? 'starting' : 'idle', totalMs: 0, takes: 0, canUndo: false, canRewind: false };
  return rec.takes.snapshot(Date.now());
}
function pushStatus() {
  const st = status();
  sendTo(wins.control, 'boom:status', st);
  sendTo(wins.panel, 'boom:status', st);
}

// Las acciones se ejecutan de a una, en orden.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch((err) => {
    console.error('[boom]', err);
    toast(err.message || String(err), 'error');
  });
  return run;
}

// ---------- Grabación ----------
function countdown(display, seconds) {
  return new Promise((resolve) => {
    wins.countdown = W.createCountdown(display, seconds);
    setTimeout(() => {
      if (alive(wins.countdown)) wins.countdown.destroy();
      wins.countdown = null;
      resolve();
    }, seconds * 1000);
  });
}

async function startRecording() {
  if (rec || starting) return { ok: false, error: 'Ya hay una grabación en curso' };
  starting = true;
  pushStatus();
  try {
    const s = settings.get();
    syncOverlays(); // la marca de agua tiene que estar puesta antes de que empiece la captura
    const display = pickDisplay();
    const phys = {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    };
    let sourceId = null;
    if (MAC && s.mode !== 'cam' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      // Pedir las pantallas hace que macOS anote a Boom en la lista de "Grabación de pantalla".
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => {});
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      throw new Error('macOS necesita tu permiso: activá Boom en Privacidad y seguridad → Grabación de pantalla y volvé a abrir Boom.');
    }
    if (s.mode !== 'cam') {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const src = sources.find((x) => x.display_id === String(display.id)) || sources[0];
      if (!src) throw new Error('No encontré ninguna pantalla para grabar');
      sourceId = src.id;
    }
    if (alive(wins.panel) && !SMOKE) wins.panel.hide();

    // La marca de agua tiene que estar pintada antes del primer cuadro del video.
    const markReady = alive(wins.watermark) && wins.watermark.isVisible()
      ? Promise.race([painted.watermark, sleep(5000)]).then(() => sleep(250))
      : Promise.resolve();
    const wait = Promise.all([SMOKE ? Promise.resolve() : countdown(display, 3), markReady]);
    const info = await engineCall('prepare', {
      mode: s.mode, sourceId, width: phys.width, height: phys.height, fps: s.fps,
      micId: s.micId, micLabel: s.micLabel, micMono: s.micMono, cameraId: s.cameraId, systemAudio: s.systemAudio && process.platform === 'win32',
      noiseSuppression: s.noiseSuppression, candidates: MIME_CANDIDATES,
    });
    await wait;

    const id = `${Date.now()}`;
    const files = createSessionFiles(path.join(app.getPath('userData'), 'sesiones', id));
    const bitrate = videoBitrate({ width: info.width, height: info.height, fps: s.fps, preset: s.preset });
    rec = { id, mode: s.mode, takes: createTakes(), files, info, bitrate, mime: info.mime, display, startedAt: new Date(), ticker: null, stats: {}, t0: Date.now() };
    for (const w of info.warnings || []) toast(w, 'warn');

    const { opened } = rec.takes.start(Date.now());
    files.open(opened);
    const r = await engineCall('startSegment', { id: opened, videoBitsPerSecond: bitrate, audioBitsPerSecond: AUDIO_BPS });
    rec.mime = r.mime || rec.mime;

    wins.control = W.createControl(display);
    wins.control.webContents.on('did-finish-load', () => {
      sendTo(wins.control, 'boom:settings', settings.get());
      pushStatus();
    });
    wins.control.once('show', restack);
    rec.ticker = setInterval(pushStatus, 250);
    pushStatus();
    return { ok: true, info: { ...info, mime: rec.mime, bitrate } };
  } catch (err) {
    await engineCall('release').catch(() => {});
    if (rec) { await rec.files.closeAll(); rec.files.destroy(); rec = null; }
    if (alive(wins.panel)) wins.panel.show();
    toast('No se pudo empezar a grabar: ' + (err.message || err), 'error');
    return { ok: false, error: err.message || String(err) };
  } finally {
    starting = false;
    pushStatus();
    syncOverlays();
  }
}

async function stopSegment(id) {
  const r = await engineCall('stopSegment', { id });
  if (r && r.mime) rec.mime = r.mime;
  // Bitácora del tramo (también si no llegó ningún dato: ahí es donde más hace falta).
  const st = rec.stats[id] || (rec.stats[id] = { chunks: 0, bytes: 0, firstMs: null });
  if (r && r.events) st.events = r.events;
  if (r && r.late) st.late = true; // se cerró tarde: al exportar se recorta a su duración real
  await rec.files.close(id);
}

const pause = () => enqueue(async () => {
  if (!rec) return;
  const r = rec.takes.pause(Date.now());
  if (r.closed != null) await stopSegment(r.closed);
  pushStatus();
});

const resume = () => enqueue(async () => {
  if (!rec) return;
  const r = rec.takes.resume(Date.now());
  if (r.opened == null) return;
  r.purged.forEach((id) => rec.files.remove(id));
  rec.files.open(r.opened);
  await engineCall('startSegment', { id: r.opened, videoBitsPerSecond: rec.bitrate, audioBitsPerSecond: AUDIO_BPS });
  pushStatus();
});

const togglePause = () => (rec && rec.takes.state === 'recording' ? pause() : resume());

// Retroceder: descarta lo grabado desde la última pausa.
const rewind = () => enqueue(async () => {
  if (!rec) return;
  const r = rec.takes.rewind(Date.now());
  if (r.stopCurrent) await stopSegment(r.discarded); // el archivo queda por si se deshace
  pushStatus();
});

const undo = () => enqueue(async () => {
  if (!rec) return;
  rec.takes.undo();
  pushStatus();
});

function endSessionUi() {
  if (rec && rec.ticker) clearInterval(rec.ticker);
  if (alive(wins.control)) wins.control.destroy();
  wins.control = null;
}

// El logo de la marca de agua: el que eligió el usuario o, si no eligió ninguno, el de Boom.
function watermarkSource() {
  const custom = settings.get().watermarkPath;
  return custom && fs.existsSync(custom) ? custom : path.join(RENDERER, 'img', 'boom.png');
}
// ffmpeg no puede leer dentro del paquete de la app: el logo se copia afuera.
function watermarkFile() {
  const src = watermarkSource();
  const out = path.join(app.getPath('userData'), 'marca-de-agua' + (path.extname(src).toLowerCase() || '.png'));
  fs.writeFileSync(out, fs.readFileSync(src));
  return out;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

const finish = () => enqueue(async () => {
  if (!rec) return { ok: false, error: 'No hay grabación' };
  const cur = rec;
  const r = cur.takes.finish(Date.now());
  if (r.closed != null) await stopSegment(r.closed);
  r.purged.forEach((id) => cur.files.remove(id));
  await engineCall('release').catch(() => {});
  endSessionUi();
  rec = null;
  pushStatus();
  if (alive(wins.panel)) { wins.panel.show(); wins.panel.focus(); }
  syncOverlays();

  const kept = cur.takes.kept();
  const good = kept.filter((k) => cur.files.size(k.id) >= MIN_SEGMENT_BYTES);
  const segments = good.map((k) => ({
    path: cur.files.pathOf(k.id),
    maxSec: cur.stats[k.id] && cur.stats[k.id].late ? k.ms / 1000 : undefined,
  }));
  // Un tramo que debía entrar al video pero llegó vacío no se pierde en silencio.
  const dropped = kept.filter((k) => !good.includes(k) && k.ms > 300).map((k) => ({ id: k.id, ms: k.ms, stats: cur.stats[k.id] || null }));
  if (dropped.length) {
    console.error('[boom] tramos vacíos:', JSON.stringify(dropped));
    toast(`Atención: ${dropped.length === 1 ? 'un tramo no llegó' : dropped.length + ' tramos no llegaron'} a grabarse (el codificador de video no respondió).`, 'error');
  }
  if (!segments.length) {
    cur.files.destroy();
    if (!dropped.length) toast('No quedó nada para guardar: descartaste todos los tramos.', 'warn');
    return { ok: false, empty: true, dropped };
  }

  sendTo(wins.panel, 'boom:busy', 'Armando tu video…');
  try {
    const title = `Boom ${stamp(cur.startedAt)}`;
    const out = await exporter.exportRecording({
      segments,
      outPath: path.join(outDir(), `${title}.mp4`),
      copyVideo: isH264(cur.mime),
      hasAudio: !!cur.info.hasAudio,
      // En "solo cámara" no hay pantalla donde poner el logo: se pega al armar el video.
      overlay: cur.mode === 'cam' && settings.get().watermark
        ? { path: watermarkFile(), height: cur.info.height * 0.05, margin: cur.info.height * 0.022 }
        : undefined,
    });
    if (cur.mode === 'cam' && settings.get().watermark && !out.overlayApplied) {
      toast('No pude pegar el logo en este video (se guardó sin logo).', 'warn');
    }
    const item = library.add({
      id: cur.id, title, file: out.outPath, thumb: out.thumbPath,
      durationSec: out.durationSec, width: out.width, height: out.height,
      createdAt: cur.startedAt.toISOString(), share: null,
    });
    if (!process.env.BOOM_KEEP_SEGMENTS) cur.files.destroy();
    sendTo(wins.panel, 'boom:library', library.list());
    sendTo(wins.panel, 'boom:done', item);
    return { ok: true, item, export: out, takes: segments.length, dropped, mime: cur.mime, stats: cur.stats };
  } catch (err) {
    // Los tramos quedan en disco: no se pierde la grabación.
    toast(`No pude armar el video. Los tramos quedaron en ${cur.files.dir}`, 'error');
    return { ok: false, error: err.message || String(err), dir: cur.files.dir };
  } finally {
    sendTo(wins.panel, 'boom:busy', null);
  }
});

const cancel = () => enqueue(async () => {
  if (!rec) return;
  const cur = rec;
  const r = cur.takes.finish(Date.now());
  if (r.closed != null) await stopSegment(r.closed).catch(() => {});
  await engineCall('release').catch(() => {});
  endSessionUi();
  rec = null;
  await cur.files.closeAll();
  cur.files.destroy();
  pushStatus();
  if (alive(wins.panel)) wins.panel.show();
  syncOverlays();
  toast('Grabación descartada.', 'info');
});

// ---------- Compartir ----------
async function share(id) {
  const item = library.get(id);
  if (!item) return { ok: false, error: 'No encontré esa grabación' };
  if (item.share && item.share.url) {
    clipboard.writeText(item.share.url);
    return { ok: true, url: item.share.url, copied: true };
  }
  const { baseUrl, token } = settings.get().cloud;
  if (!baseUrl || !token) return { ok: false, needsSetup: true };
  if (!fs.existsSync(item.file)) return { ok: false, error: 'El archivo de video ya no está en tu PC' };
  try {
    const res = await uploader.upload({
      filePath: item.file, thumbPath: item.thumb, baseUrl, token,
      meta: { title: item.title, durationSec: item.durationSec, width: item.width, height: item.height, createdAt: item.createdAt },
      onProgress: (p) => sendTo(wins.panel, 'boom:progress', { id, p }),
    });
    library.update(id, { share: { ...res, title: item.title } });
    clipboard.writeText(res.url);
    sendTo(wins.panel, 'boom:library', library.list());
    // Los subtítulos se hacen después: el link ya funciona mientras tanto.
    if (settings.get().captions) {
      addCaptions(id).then((r) => {
        if (r.ok) toast('Subtítulos listos: ya se ven en el link.', 'ok');
        else if (!r.noAudio) toast('El link anda, pero no pude hacer los subtítulos: ' + r.error, 'warn');
      });
    }
    return { ok: true, url: res.url, copied: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    sendTo(wins.panel, 'boom:progress', { id, p: null });
  }
}

// ---------- Subtítulos y nombre en el link ----------
const captioning = new Map(); // id del video -> avance (0..1) mientras se hacen sus subtítulos
const pushCaptioning = () => sendTo(wins.panel, 'boom:captioning', Object.fromEntries(captioning));

async function addCaptions(id) {
  const item = library.get(id);
  if (!item || !item.share || !item.share.id) return { ok: false, error: 'Primero compartí el video' };
  if (captioning.has(id)) return { ok: false, error: 'Ya estoy haciendo los subtítulos de este video' };
  const { baseUrl, token } = settings.get().cloud;
  if (!baseUrl || !token) return { ok: false, needsSetup: true };
  if (!fs.existsSync(item.file)) return { ok: false, error: 'El archivo de video ya no está en tu PC' };
  captioning.set(id, 0);
  pushCaptioning();
  try {
    const r = await captioner.makeCaptions({
      filePath: item.file, id: item.share.id, baseUrl, token,
      language: settings.get().captionsLang,
      workDir: path.join(app.getPath('userData'), 'subtitulos', id),
      onProgress: (p) => { captioning.set(id, p); pushCaptioning(); },
    });
    const cur = library.get(id);
    if (cur && cur.share) library.update(id, { share: { ...cur.share, captions: true, captionsLang: r.language } });
    sendTo(wins.panel, 'boom:library', library.list());
    return { ok: true, ...r };
  } catch (err) {
    console.error('[boom] subtítulos:', err);
    const msg = err.message || String(err);
    return { ok: false, error: msg, noAudio: /no tiene sonido/.test(msg) };
  } finally {
    captioning.delete(id);
    pushCaptioning();
  }
}

async function removeCaptions(id) {
  const item = library.get(id);
  if (!item || !item.share || !item.share.id) return { ok: false };
  const { baseUrl, token } = settings.get().cloud;
  try {
    await uploader.deleteCaptions({ id: item.share.id, baseUrl, token });
    library.update(id, { share: { ...item.share, captions: false } });
    sendTo(wins.panel, 'boom:library', library.list());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// Lleva el nombre del video a la página del link (al renombrar, y al abrir Boom si quedó alguno atrasado).
async function syncTitle(id, { quiet = false } = {}) {
  const item = library.get(id);
  if (!item || !item.share || !item.share.id || item.share.title === item.title) return;
  const { baseUrl, token } = settings.get().cloud;
  if (!baseUrl || !token) return;
  try {
    await uploader.rename({ id: item.share.id, title: item.title, baseUrl, token });
    const cur = library.get(id);
    if (cur && cur.share) library.update(id, { share: { ...cur.share, title: item.title } });
  } catch (err) {
    if (!quiet) toast('El nombre cambió en Boom, pero no en el link: ' + (err.message || err), 'warn');
  }
}

// ---------- Juntar videos ----------
// Arma un video nuevo con varios de la biblioteca, en el orden elegido. Los originales quedan como están.
let merging = false;
async function mergeItems(ids) {
  if (merging) return { ok: false, error: 'Ya estoy juntando videos' };
  const items = (Array.isArray(ids) ? ids : []).map((id) => library.get(id));
  if (items.length < 2 || items.some((i) => !i)) return { ok: false, error: 'Elegí al menos dos videos' };
  const gone = items.find((i) => !fs.existsSync(i.file));
  if (gone) return { ok: false, error: `El archivo de "${gone.title}" ya no está en tu PC` };

  merging = true;
  const id = `${Date.now()}`;
  const now = new Date();
  const title = `Boom unido ${stamp(now)}`;
  let outPath = path.join(outDir(), `${title}.mp4`);
  for (let n = 2; fs.existsSync(outPath); n++) outPath = path.join(outDir(), `${title} (${n}).mp4`);
  const workDir = path.join(app.getPath('userData'), 'uniones', id);
  const label = `Juntando ${items.length} videos…`;
  sendTo(wins.panel, 'boom:busy', label);
  try {
    const out = await exporter.mergeVideos({
      inputs: items.map((i) => i.file), outPath, workDir,
      onProgress: (p) => sendTo(wins.panel, 'boom:busy', `${label} ${Math.round(p * 100)}%`),
    });
    const item = library.add({
      id, title, file: out.outPath, thumb: out.thumbPath,
      durationSec: out.durationSec, width: out.width, height: out.height,
      createdAt: now.toISOString(), share: null, mergedFrom: items.map((i) => i.id),
    });
    sendTo(wins.panel, 'boom:library', library.list());
    return { ok: true, item, copied: out.copied };
  } catch (err) {
    console.error('[boom] juntar:', err);
    return { ok: false, error: err.message || String(err) };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    merging = false;
    sendTo(wins.panel, 'boom:busy', null);
  }
}

async function removeItem(id) {
  const item = library.get(id);
  if (!item) return { ok: false };
  const shared = !!(item.share && item.share.id);
  const res = await dialog.showMessageBox(wins.panel, {
    type: 'question', buttons: ['Borrar', 'Cancelar'], defaultId: 1, cancelId: 1,
    title: 'Borrar grabación', message: `¿Borrar "${item.title}"?`,
    detail: 'El video va a la papelera de reciclaje.',
    checkboxLabel: shared ? 'Borrar también el link compartido' : undefined,
    checkboxChecked: shared,
  });
  if (res.response !== 0) return { ok: false, cancelled: true };
  if (shared && res.checkboxChecked) {
    const { baseUrl, token } = settings.get().cloud;
    await uploader.remove({ id: item.share.id, baseUrl, token })
      .catch((err) => toast('No pude borrar el link: ' + err.message, 'warn'));
  }
  for (const f of [item.file, item.thumb]) {
    if (f && fs.existsSync(f)) await shell.trashItem(f).catch(() => {});
  }
  library.remove(id);
  sendTo(wins.panel, 'boom:library', library.list());
  return { ok: true };
}

// ---------- Canales ----------
function wireIpc() {
  ipcMain.on('boom:engineReply', (_e, { id, ok, result, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (ok) p.resolve(result); else p.reject(new Error(error));
  });
  ipcMain.on('boom:chunk', (_e, segId, buf) => {
    if (!rec) return;
    const b = Buffer.from(buf);
    rec.files.write(segId, b);
    const st = rec.stats[segId] || (rec.stats[segId] = { chunks: 0, bytes: 0, firstMs: Date.now() - rec.t0 });
    st.chunks += 1; st.bytes += b.length;
  });
  ipcMain.on('boom:engineError', (_e, message) => {
    toast('Problema al grabar: ' + message, 'error');
    if (rec && rec.takes.state === 'recording') pause(); // se guarda lo grabado hasta acá
  });

  ipcMain.handle('boom:getState', () => ({
    settings: settings.get(), displays: displays(), library: library.list(), status: status(),
    outDir: outDir(), version: app.getVersion(), platform: process.platform,
  }));
  ipcMain.handle('boom:setSettings', (_e, patch) => applySettings(patch || {}));
  ipcMain.handle('boom:shrinkCamera', () => applySettings({ shape: prevShape }));
  ipcMain.handle('boom:start', () => startRecording());
  ipcMain.handle('boom:pause', () => pause());
  ipcMain.handle('boom:resume', () => resume());
  ipcMain.handle('boom:togglePause', () => togglePause());
  ipcMain.handle('boom:rewind', () => rewind());
  ipcMain.handle('boom:undo', () => undo());
  ipcMain.handle('boom:finish', () => finish());
  ipcMain.handle('boom:cancel', () => cancel());

  ipcMain.handle('boom:lib:open', (_e, id) => { const i = library.get(id); return i ? shell.openPath(i.file) : ''; });
  ipcMain.handle('boom:lib:reveal', (_e, id) => { const i = library.get(id); if (i) shell.showItemInFolder(i.file); });
  ipcMain.handle('boom:lib:rename', (_e, id, title) => {
    const t = String(title || '').trim().slice(0, 120);
    if (t) { library.update(id, { title: t }); syncTitle(id); }
    return library.list();
  });
  ipcMain.handle('boom:lib:share', (_e, id) => share(id));
  ipcMain.handle('boom:lib:captions', async (_e, id, on) => {
    if (!on) return removeCaptions(id);
    const r = await addCaptions(id);
    if (r.ok) toast('Subtítulos listos: ya se ven en el link.', 'ok');
    return r;
  });
  ipcMain.handle('boom:lib:openLink', (_e, id) => { const i = library.get(id); if (i && i.share) shell.openExternal(i.share.url); });
  ipcMain.handle('boom:lib:delete', (_e, id) => removeItem(id));
  ipcMain.handle('boom:lib:merge', (_e, ids) => mergeItems(ids));
  ipcMain.handle('boom:pickWatermark', async () => {
    const r = await dialog.showOpenDialog(wins.panel, {
      title: 'Elegí tu logo', properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (r.canceled || !r.filePaths[0]) return settings.get();
    return applySettings({ watermarkPath: r.filePaths[0], watermark: true });
  });
  ipcMain.handle('boom:openGuide', () => shell.openExternal(GUIDE_URL));
  ipcMain.handle('boom:clearWatermark', () => applySettings({ watermarkPath: '' }));
  ipcMain.handle('boom:openOutDir', () => { fs.mkdirSync(outDir(), { recursive: true }); return shell.openPath(outDir()); });
  ipcMain.handle('boom:cloud:test', async () => {
    const { baseUrl, token } = settings.get().cloud;
    if (!baseUrl || !token) return { ok: false, error: 'Faltan la dirección o el token' };
    try { await uploader.ping({ baseUrl, token }); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

function wireShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+B', () => (rec ? finish() : startRecording()));
  globalShortcut.register('Alt+Shift+P', () => { if (rec) togglePause(); });
  globalShortcut.register('Alt+Shift+Z', () => { if (rec) rewind(); });
}

function serveApp() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel.startsWith('_thumb/')) {
      const item = library.get(rel.slice('_thumb/'.length));
      if (item && item.thumb && fs.existsSync(item.thumb)) return net.fetch(pathToFileURL(item.thumb).toString());
      return new Response('', { status: 404 });
    }
    if (rel === '_watermark') return net.fetch(pathToFileURL(watermarkSource()).toString());
    if (rel.startsWith('_core/')) {
      // Lógica compartida (geometría de la cámara) que también usa la ventana de la burbuja.
      const name = path.basename(rel);
      if (!/^[a-z]+\.js$/.test(name)) return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(path.join(CORE, name)).toString());
    }
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER + path.sep)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Cámara, micrófono y pantalla: solo para las páginas propias de Boom.
  const own = (wc) => { try { return new URL(wc.getURL()).protocol === 'app:'; } catch { return false; } };
  session.defaultSession.setPermissionRequestHandler((wc, _perm, cb) => cb(own(wc)));
  session.defaultSession.setPermissionCheckHandler((wc) => !!wc && own(wc));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (alive(wins.panel)) { wins.panel.show(); wins.panel.focus(); } });
  app.whenReady().then(async () => {
    // En Mac hace falta el menú de la app para que anden copiar, pegar y salir con el teclado.
    if (MAC) Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    if (MAC && !SMOKE) {
      for (const kind of ['camera', 'microphone']) systemPreferences.askForMediaAccess(kind).catch(() => {});
    }
    settings = createSettings(path.join(app.getPath('userData'), 'ajustes.json'));
    library = createLibrary(path.join(app.getPath('userData'), 'grabaciones.json'));
    if (settings.get().shape !== 'full') prevShape = settings.get().shape;
    serveApp();
    wireIpc();
    // Nombres cambiados mientras no había conexión (o antes de que existiera esta función).
    setTimeout(() => library.list().forEach((i) => syncTitle(i.id, { quiet: true })), 3000);
    wins.engine = W.createEngine();
    wins.panel = W.createPanel();
    wins.panel.on('close', (e) => {
      if (rec && !quitting) { e.preventDefault(); wins.panel.hide(); } // no cortar una grabación en curso
    });
    wins.panel.on('closed', () => { wins.panel = null; if (!rec) app.quit(); });
    syncBubble();
    if (!SMOKE) wireShortcuts();
    screen.on('display-removed', () => { anchor = null; syncBubble(); });
    if (SMOKE) require('./smoke').run({ startRecording, pause, resume, rewind, undo, finish, applySettings, status, wins, app, screen, settings });
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
