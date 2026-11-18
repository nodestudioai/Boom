// Une los tramos en un MP4 con ffmpeg y saca una miniatura.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { concatList, normalizeArgs, exportArgs, thumbArgs } = require('../core/ffargs');
const { h264ParamSets, canCopyJoin, mergeCopyArgs, encodeTarget, mergeEncodeArgs, progressSec } = require('../core/merge');

function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    const real = p && p.replace('app.asar', 'app.asar.unpacked');
    if (real && fs.existsSync(real)) return real;
  } catch { /* no está incluido */ }
  return 'ffmpeg'; // el del sistema
}

function run(args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', ...args], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-20000); if (onStderr) onStderr(String(d)); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr: err }));
  });
}

// Duración y tamaño leídos de la salida de "ffmpeg -i".
async function probe(file) {
  const { stderr } = await run(['-i', file]);
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const v = /Video:\s*([a-z0-9]+).*?\b(\d{2,5})x(\d{2,5})\b/.exec(stderr);
  const a = /Audio:\s*([a-z0-9]+)[^\n]*/.exec(stderr);
  const vLine = v ? (/Video:[^\n]*/.exec(stderr) || [''])[0] : '';
  const fps = /(\d+(?:\.\d+)?) fps/.exec(vLine);
  const hz = a ? /(\d+) Hz/.exec(a[0]) : null;
  const ch = a ? /Hz, (mono|stereo|(\d+) channels)/.exec(a[0]) : null;
  return {
    durationSec: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    videoCodec: v ? v[1] : null,
    width: v ? Number(v[2]) : 0,
    height: v ? Number(v[3]) : 0,
    fps: fps ? Number(fps[1]) : 0,
    audioCodec: a ? a[1] : null,
    sampleRate: hz ? Number(hz[1]) : 0,
    channels: !ch ? 0 : ch[1] === 'mono' ? 1 : ch[1] === 'stereo' ? 2 : Number(ch[2]),
  };
}

// SPS y PPS del H.264 del video: si coinciden, los videos se pueden pegar sin recodificar.
function paramSets(file) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy',
      '-bsf:v', 'h264_mp4toannexb', '-frames:v', '1', '-f', 'h264', 'pipe:1'], { windowsHide: true });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', (d) => { if (size < 8e6) { chunks.push(d); size += d.length; } });
    child.stderr.on('data', () => {});
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(h264ParamSets(Buffer.concat(chunks))));
  });
}

async function exportRecording({ segments, outPath, copyVideo, hasAudio, overlay }) {
  if (!segments.length) throw new Error('No hay tramos para unir');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Paso 1: cada tramo con las pistas en el mismo orden (si no, al unir se cruzan audio y video).
  const ordered = [];
  for (const item of segments) {
    // Cada tramo es una ruta, o { path, maxSec } si hay que recortarle el final.
    const seg = typeof item === 'string' ? item : item.path;
    const maxSec = typeof item === 'string' ? undefined : item.maxSec;
    const norm = seg.replace(/\.mkv$/i, '') + '.ordenado.mkv';
    const r = await run(normalizeArgs({ inPath: seg, outPath: norm, hasAudio, maxSec }));
    if (r.code !== 0 || !fs.existsSync(norm)) {
      throw new Error('ffmpeg no pudo leer un tramo: ' + r.stderr.split(/\r?\n/).slice(-4).join(' | '));
    }
    ordered.push(norm);
  }

  // Paso 2: unirlos.
  const listPath = path.join(path.dirname(ordered[0]), 'tramos.txt');
  fs.writeFileSync(listPath, concatList(ordered));

  // Intentos, del mejor al último recurso. Con marca de agua hay que recodificar; si eso falla
  // (por ejemplo, sin memoria para un video 4K) el video se guarda igual, sin el logo.
  const attempts = [
    ...(overlay ? [{ copy: false, overlay }] : []),
    ...(copyVideo ? [{ copy: true }] : []),
    { copy: false },
  ];
  let info = null;
  let recoded = !copyVideo;
  let overlayApplied = false;
  let lastError = '';
  for (const a of attempts) {
    const r = await run(exportArgs({ listPath, outPath, copyVideo: a.copy, hasAudio, overlay: a.overlay }));
    lastError = r.stderr;
    if (r.code === 0 && fs.existsSync(outPath)) {
      info = await probe(outPath);
      if (info.durationSec > 0 && info.width > 0) { recoded = !a.copy; overlayApplied = !!a.overlay; break; }
    }
    info = null; // este intento no sirvió: se prueba el siguiente
  }
  if (!info) throw new Error('ffmpeg no pudo unir los tramos:\n' + lastError.split('\n').slice(-6).join('\n'));

  const thumbPath = outPath.replace(/\.mp4$/i, '.jpg');
  const at = Math.min(1, info.durationSec / 2);
  const t = await run(thumbArgs({ inPath: outPath, outPath: thumbPath, atSec: at.toFixed(2) }));
  return {
    outPath,
    thumbPath: t.code === 0 && fs.existsSync(thumbPath) ? thumbPath : null,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    recoded,
    overlayApplied,
  };
}

// Junta varios videos terminados en uno solo, en el orden dado. Los originales no se tocan.
// onProgress(0..1) mientras trabaja. "copied" dice si se pegaron tal cual (sin recodificar).
async function mergeVideos({ inputs, outPath, workDir, onProgress = () => {} }) {
  if (!inputs || inputs.length < 2) throw new Error('Hacen falta al menos dos videos');
  for (const f of inputs) if (!fs.existsSync(f)) throw new Error('No encontré el video ' + path.basename(f));
  if (fs.existsSync(outPath)) throw new Error('Ya existe ' + path.basename(outPath));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  const infos = [];
  for (const f of inputs) {
    const info = await probe(f);
    if (!info.width || !info.durationSec) throw new Error('ffmpeg no pudo leer ' + path.basename(f));
    info.paramSets = info.videoCodec === 'h264' ? await paramSets(f) : '';
    infos.push(info);
  }
  const total = infos.reduce((n, x) => n + x.durationSec, 0);
  const hasAudio = infos.some((x) => !!x.audioCodec);
  const tick = (chunk) => { const t = progressSec(chunk); if (t != null && total > 0) onProgress(Math.min(0.99, t / total)); };
  // El resultado tiene que durar lo que suman los originales (con un margen por los bordes de cada uno).
  const check = async () => {
    if (!fs.existsSync(outPath)) return null;
    const info = await probe(outPath);
    return info.width > 0 && Math.abs(info.durationSec - total) <= Math.max(2, inputs.length * 0.5) ? info : null;
  };

  let info = null;
  let copied = false;
  let lastError = '';
  if (canCopyJoin(infos)) {
    const listPath = path.join(workDir, 'videos.txt');
    fs.writeFileSync(listPath, concatList(inputs));
    const r = await run(mergeCopyArgs({ listPath, outPath, hasAudio }), { onStderr: tick });
    lastError = r.stderr;
    if (r.code === 0) { info = await check(); copied = !!info; }
  }
  if (!info) {
    const { width, height, fps } = encodeTarget(infos);
    const r = await run(mergeEncodeArgs({
      inputs: inputs.map((p, i) => ({ path: p, hasAudio: !!infos[i].audioCodec, durationSec: infos[i].durationSec })),
      width, height, fps, outPath,
    }), { onStderr: tick });
    lastError = r.stderr;
    if (r.code === 0) info = await check();
  }
  if (!info) {
    fs.rmSync(outPath, { force: true });
    throw new Error('ffmpeg no pudo juntar los videos:\n' + lastError.split('\n').slice(-6).join('\n'));
  }
  onProgress(1);

  const thumbPath = outPath.replace(/\.mp4$/i, '.jpg');
  const at = Math.min(1, info.durationSec / 2);
  const t = await run(thumbArgs({ inPath: outPath, outPath: thumbPath, atSec: at.toFixed(2) }));
  return {
    outPath,
    thumbPath: t.code === 0 && fs.existsSync(thumbPath) ? thumbPath : null,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    copied,
  };
}

module.exports = { ffmpegPath, run, probe, paramSets, exportRecording, mergeVideos };
