// Motor de grabación: abre pantalla, cámara y micrófono, y graba un archivo por tramo.
const B = window.boom;
const gum = (c) => navigator.mediaDevices.getUserMedia(c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START_WAIT_MS = 12000; // cuánto esperar a que el codificador arranque antes de cerrar un tramo

// La cámara puede estar ocupada un instante (por ejemplo, la burbuja la está reabriendo): se reintenta.
async function gumRetry(c, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await gum(c); }
    catch (err) { if (i >= tries) throw err; await sleep(400); }
  }
}

// Abre la cámara para "solo cámara". Insiste unos segundos: el servicio de cámaras del sistema puede
// estar reiniciándose (por un instante no figura ninguna), o la burbuja la está reabriendo.
// Si la elegida ya no está pero hay otra conectada, usa esa y avisa.
async function openCamera(c, warnings) {
  const want = (deviceId) => ({
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: c.fps },
    },
  });
  const deadline = Date.now() + 9000;
  for (;;) {
    let lastErr;
    try { return await gum(want(c.cameraId)); } catch (err) { lastErr = err; }
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (c.cameraId && cams.length && !cams.some((d) => d.deviceId === c.cameraId)) {
      try {
        const other = await gum(want(''));
        warnings.push('No encontré la cámara elegida; uso la que está conectada.');
        return other;
      } catch (err) { lastErr = err; }
    }
    if (Date.now() > deadline) {
      if (!cams.length) throw new Error('no encuentro ninguna cámara. Si recién funcionaba, cerrá y volvé a abrir Boom');
      throw lastErr;
    }
    await sleep(500);
  }
}

let sources = [];        // streams abiertos (para soltarlos al terminar)
let audioCtx = null;
let stream = null;       // lo que se graba: 1 pista de video + 0/1 de audio
let candidates = [];
let mimeIndex = 0;
let gotData = false;     // ya salió algún dato del grabador con el formato actual
let current = null;      // { id, rec, chain, stopped }
let watchdog = null;
let monoTimer = null;    // vigila los dos canales del micrófono (ver mixMic)

const mime = () => candidates[mimeIndex];
const nextMime = () => { if (mimeIndex + 1 < candidates.length) { mimeIndex++; return true; } return false; };

async function release() {
  clearTimeout(watchdog);
  clearInterval(monoTimer);
  if (current) { try { if (current.rec.state !== 'inactive') current.rec.stop(); } catch { /* ya estaba */ } current = null; }
  for (const s of sources) s.getTracks().forEach((t) => t.stop());
  sources = [];
  stream = null;
  if (audioCtx) { await audioCtx.close().catch(() => {}); audioCtx = null; }
  return {};
}

async function prepare(c) {
  await release();
  const warnings = [];
  let videoTrack = null;
  let systemStream = null;

  if (c.mode === 'cam') {
    const cam = await openCamera(c, warnings);
    sources.push(cam);
    videoTrack = cam.getVideoTracks()[0];
  } else {
    const video = {
      mandatory: {
        chromeMediaSource: 'desktop', chromeMediaSourceId: c.sourceId,
        minWidth: c.width, maxWidth: c.width, minHeight: c.height, maxHeight: c.height,
        maxFrameRate: c.fps,
      },
    };
    let screen = null;
    if (c.systemAudio) {
      try { screen = await gum({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video }); }
      catch { warnings.push('No pude tomar el audio del sistema; se graba sin él.'); }
    }
    if (!screen) screen = await gum({ audio: false, video });
    sources.push(screen);
    videoTrack = screen.getVideoTracks()[0];
    if (screen.getAudioTracks().length) systemStream = screen;
  }

  let micStream = null;
  let micLabel = '';
  if (c.micId !== 'none') {
    const audio = (deviceId) => ({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, autoGainControl: false,
        noiseSuppression: !!c.noiseSuppression,
        channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 },
      },
    });
    try {
      micStream = await gumRetry(audio(c.micId), 2);
    } catch {
      // El micrófono elegido no está (por ejemplo, uno USB desenchufado). Si volvió a enchufarse
      // en otro puerto cambia de identificador: se lo busca por nombre. Si no, se usa el predeterminado.
      if (c.micId) {
        const same = c.micLabel
          ? (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label === c.micLabel)
          : null;
        try {
          micStream = await gum(audio(same ? same.deviceId : ''));
          if (!same) warnings.push(`No encontré el micrófono elegido${c.micLabel ? ' (' + c.micLabel + ')' : ''}; uso el predeterminado del sistema.`);
        } catch { /* tampoco hay predeterminado */ }
      }
      if (!micStream) warnings.push('No pude abrir ningún micrófono; se graba sin micrófono.');
    }
    if (micStream) {
      sources.push(micStream);
      micLabel = micStream.getAudioTracks()[0].label || '';
      micStream.getAudioTracks()[0].addEventListener('ended', () => B.send('boom:engineError', 'se desconectó el micrófono'));
    }
  }

  // Micrófono + audio del sistema mezclados en una sola pista a 48 kHz.
  let audioTrack = null;
  const withAudio = [micStream, systemStream].filter(Boolean);
  if (withAudio.length) {
    audioCtx = new AudioContext({ sampleRate: 48000 });
    const dest = audioCtx.createMediaStreamDestination();
    for (const s of withAudio) {
      const src = audioCtx.createMediaStreamSource(new MediaStream(s.getAudioTracks()));
      if (s === micStream && c.micMono !== false) mixMic(src, dest, s.getAudioTracks()[0].getSettings().channelCount);
      else src.connect(dest);
    }
    await audioCtx.resume().catch(() => {});
    audioTrack = dest.stream.getAudioTracks()[0];
  }

  videoTrack.contentHint = c.mode === 'cam' ? 'motion' : 'detail';
  videoTrack.addEventListener('ended', () => B.send('boom:engineError', 'se cortó la captura de video'));
  stream = new MediaStream([videoTrack, ...(audioTrack ? [audioTrack] : [])]);

  candidates = (c.candidates || []).filter((m) => MediaRecorder.isTypeSupported(m));
  if (!candidates.length) candidates = ['video/webm'];
  mimeIndex = 0;
  gotData = false;

  const st = videoTrack.getSettings();
  return {
    width: st.width || c.width, height: st.height || c.height, fps: st.frameRate || c.fps,
    mime: mime(), hasAudio: !!audioTrack, hasMic: !!micStream, micLabel, hasSystemAudio: !!systemStream, warnings,
  };
}

// La voz, igual en los dos oídos. Algunos micrófonos (los inalámbricos USB en modo estéreo)
// mandan la voz por un solo canal y el otro en silencio: grabado así, se escucha de un solo lado.
// Se mezclan los dos canales en uno; si uno resulta estar mudo, se usa el otro a volumen completo.
function mixMic(src, dest, channels) {
  const split = audioCtx.createChannelSplitter(2);
  const gains = [audioCtx.createGain(), audioCtx.createGain()];
  const meters = [audioCtx.createAnalyser(), audioCtx.createAnalyser()];
  const mono = audioCtx.createGain();
  mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
  src.connect(split);
  // Un micrófono de un solo canal llega entero por el izquierdo: va a volumen completo desde el arranque.
  let mode = channels === 1 ? 'left' : 'both';
  gains.forEach((g, i) => {
    g.gain.value = mode === 'left' ? (i === 0 ? 1 : 0) : 0.5;
    meters[i].fftSize = 2048;
    split.connect(g, i); split.connect(meters[i], i);
    g.connect(mono);
  });
  mono.connect(dest);

  const energy = [0, 0];
  const buf = new Float32Array(2048);
  const set = (next, a, b) => {
    if (mode === next) return;
    mode = next;
    gains[0].gain.setTargetAtTime(a, audioCtx.currentTime, 0.08);
    gains[1].gain.setTargetAtTime(b, audioCtx.currentTime, 0.08);
  };
  clearInterval(monoTimer);
  monoTimer = setInterval(() => {
    meters.forEach((m, i) => {
      m.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      energy[i] = energy[i] * 0.9 + (sum / buf.length) * 0.1; // promedio de los últimos segundos
    });
    const [l, r] = energy;
    if (Math.max(l, r) < 1e-7) return;           // silencio total: todavía no se sabe
    if (r < l * 0.001) set('left', 1, 0);        // el derecho está mudo (60 dB por debajo)
    else if (l < r * 0.001) set('right', 0, 1);  // el izquierdo está mudo
    else set('both', 0.5, 0.5);
  }, 200);
}

function begin(p) {
  const rec = new MediaRecorder(stream, {
    mimeType: mime(), videoBitsPerSecond: p.videoBitsPerSecond, audioBitsPerSecond: p.audioBitsPerSecond,
  });
  const me = { id: p.id, rec, chain: Promise.resolve(), stopped: null, params: p };
  // Bitácora corta del tramo (ms desde que se pidió grabar): sirve para diagnosticar.
  const t0 = performance.now();
  me.events = [];
  const ev = (name, extra) => { if (me.events.length < 40) me.events.push([Math.round(performance.now() - t0), name, extra]); };
  me.stopped = new Promise((resolve) => { rec.onstop = () => { ev('stop'); resolve(); }; });
  me.hasStarted = false;
  me.started = new Promise((resolve) => { rec.onstart = () => { me.hasStarted = true; ev('start'); resolve(); }; });
  rec.ondataavailable = (e) => {
    ev('data', e.data ? e.data.size : -1);
    if (!e.data || !e.data.size) return;
    gotData = true;
    // Encadenado para que los trozos lleguen al disco en orden.
    me.chain = me.chain.then(() => e.data.arrayBuffer()).then((buf) => B.send('boom:chunk', p.id, buf));
  };
  rec.onerror = (e) => {
    ev('error', String((e.error && e.error.name) || e.error));
    const msg = (e.error && e.error.message) || 'falló el codificador';
    if (!gotData && current === me && fallback(me)) return;
    B.send('boom:engineError', msg);
  };
  rec.start(1000);
  current = me;
}

// Si el formato elegido no produce nada (codificador no disponible), prueba el siguiente.
function fallback(me) {
  if (!nextMime()) return false;
  try { if (me.rec.state !== 'inactive') me.rec.stop(); } catch { /* nada */ }
  try { begin(me.params); arm(); return true; } catch { return fallback(current || me); }
}
function arm() {
  clearTimeout(watchdog);
  if (gotData) return;
  const me = current;
  watchdog = setTimeout(() => {
    if (!gotData && current === me && !fallback(me)) B.send('boom:engineError', 'el grabador no está produciendo video');
  }, 8000); // el codificador puede tardar varios segundos en arrancar la primera vez
}

async function startSegment(p) {
  if (!stream) throw new Error('no hay nada preparado para grabar');
  for (;;) {
    try { begin(p); break; }
    catch (err) { if (gotData || !nextMime()) throw err; }
  }
  arm();
  return { mime: mime() };
}

async function stopSegment({ id }) {
  clearTimeout(watchdog);
  const me = current;
  if (!me || me.id !== id) return { mime: mime() };
  current = null;
  let late = false;
  if (me.rec.state !== 'inactive') {
    // El codificador tarda en arrancar (1,5 s o más la primera vez). Si se corta antes,
    // Chromium descarta todo el tramo. Por eso se sigue grabando hasta que arranque y recién
    // ahí se cierra; el sobrante se recorta al exportar ("late"). Pausar el grabador mientras
    // tanto no sirve: sin cuadros nuevos, el codificador puede no arrancar nunca.
    if (!me.hasStarted) {
      late = true;
      await Promise.race([me.started, sleep(START_WAIT_MS)]);
    }
    if (me.rec.state !== 'inactive') me.rec.stop();
  }
  await Promise.race([me.stopped, sleep(5000)]);
  await me.chain;
  return { mime: mime(), events: me.events, late };
}

const api = { prepare, startSegment, stopSegment, release };

B.on('engine:call', async ({ id, method, payload }) => {
  try {
    const result = await api[method](payload || {});
    B.send('boom:engineReply', { id, ok: true, result });
  } catch (err) {
    B.send('boom:engineReply', { id, ok: false, error: (err && err.message) || String(err) });
  }
});
