// La burbuja: dibuja la cámara elegida con la forma elegida.
// Lee los cuadros de la cámara uno por uno y los pinta en un lienzo, recortando la forma al pintar.
const B = window.boom;
const canvas = document.getElementById('c');
const msg = document.getElementById('msg');
const ctx = canvas.getContext('2d');

let stream = null;
let openedFor = null;
const G = window.BoomBubble; // geometría compartida con el proceso principal
let shape = 'circle';
let mirror = true;
let rounded = true;
let frame = 'none';
let last = null;      // último cuadro recibido (se guarda para repintar al cambiar forma o tamaño)
let pumpId = 0;
let lastPaintAt = 0;

async function pump(track) {
  const id = ++pumpId;
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (id !== pumpId) { value.close(); break; }
      if (last) last.close();
      last = value;
      // Una cámara 4K da cuadros muy pesados: la vista previa se pinta como mucho ~15 veces por segundo.
      const heavy = value.displayWidth * value.displayHeight > 2600000;
      const now = performance.now();
      if (heavy && now - lastPaintAt < 66) continue;
      lastPaintAt = now;
      paint();
    }
  } catch { /* la cámara se cerró */ }
  reader.cancel().catch(() => {});
}

async function openCamera(cameraId, maxRes) {
  const key = cameraId + '|' + (maxRes ? 'max' : 'hd');
  if (openedFor === key && stream && stream.active) return;
  openedFor = key;
  pumpId++;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  // Con pantalla + cámara alcanza 1080p (la burbuja es chica y pintar 4K la frena).
  // En "solo cámara" se pide el máximo: es la misma cámara que se graba y Chromium la abre una sola vez.
  const base = maxRes
    ? { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } }
    : { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...base, deviceId: cameraId ? { exact: cameraId } : undefined } });
    } catch (err) {
      if (!cameraId) throw err;
      stream = await navigator.mediaDevices.getUserMedia({ video: base }); // la elegida ya no está: usa la que haya
    }
    document.body.classList.remove('nocam');
    hadCamera = true;
    const mine = stream;
    const track = stream.getVideoTracks()[0];
    // Si la cámara se corta sola (se desenchufó, o el sistema reinició su servicio), se reconecta.
    track.addEventListener('ended', () => { if (stream === mine) reconnect(); });
    pump(track);
  } catch (err) {
    document.body.classList.add('nocam');
    // Si la cámara venía andando y de golpe no figura ninguna, Windows cortó el servicio de cámaras:
    // no vuelve hasta reiniciar la app.
    msg.textContent = err && err.name === 'NotReadableError'
      ? 'Otra app está usando la cámara'
      : (hadCamera ? 'Se perdió la cámara. Cerrá y volvé a abrir Boom.' : 'No encontré ninguna cámara');
    openedFor = null;
  }
}

let hadCamera = false;
let reconnecting = 0;
function reconnect(tries = 12) {
  const id = ++reconnecting;
  const attempt = async (left) => {
    if (id !== reconnecting || (stream && stream.active)) return;
    openedFor = null;
    const st = await B.invoke('boom:getState');
    if (st.settings.mode === 'screen') return;
    await openCamera(st.settings.cameraId || '', st.settings.mode === 'cam');
    if (!(stream && stream.active) && left > 1) setTimeout(() => attempt(left - 1), 1000);
  };
  setTimeout(() => attempt(tries), 600);
}

// Traza la forma sobre el lienzo de w × h píxeles.
function tracePath(w, h, dpr) {
  ctx.beginPath();
  const r = G.cornerRadius({ shape, rounded, w, h, dpr });
  if (shape === 'circle') ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
  else if (r > 0) ctx.roundRect(0, 0, w, h, r);
  else ctx.rect(0, 0, w, h);
}

function paint() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(window.innerWidth * dpr));
  const h = Math.max(1, Math.round(window.innerHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (!last) return;
  const vw = last.displayWidth, vh = last.displayHeight;
  if (!vw || !vh) return;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  tracePath(w, h, dpr);
  ctx.clip();
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  // Recorte centrado para llenar la forma sin deformar la imagen.
  let sw = vw, sh = vh, sx = 0, sy = 0;
  if (vw / vh > w / h) { sw = vh * (w / h); sx = (vw - sw) / 2; } else { sh = vw / (w / h); sy = (vh - sh) / 2; }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(last, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();

  // Marco opcional: una línea del color elegido por dentro del borde de la forma.
  const fw = G.frameWidth({ shape, frame, w, h });
  if (fw > 0) {
    ctx.save();
    tracePath(w, h, dpr);
    ctx.clip();
    ctx.strokeStyle = G.FRAMES[frame];
    ctx.lineWidth = fw * 2; // la mitad de afuera queda recortada
    tracePath(w, h, dpr);
    ctx.stroke();
    ctx.restore();
  }
}
window.addEventListener('resize', paint);

B.on('boom:settings', (s) => {
  shape = s.shape;
  mirror = !!s.mirror;
  rounded = s.rounded !== false;
  frame = s.frame || 'none';
  const keep = document.body.classList.contains('nocam') ? ' nocam' : '';
  document.body.className = shape + (rounded ? '' : ' sharp') + keep;
  paint();
  openCamera(s.cameraId || '', s.mode === 'cam');
});

navigator.mediaDevices.addEventListener('devicechange', () => {
  if (stream && stream.active) return;
  openedFor = null;
  B.invoke('boom:getState').then((st) => openCamera(st.settings.cameraId || '', st.settings.mode === 'cam'));
});
