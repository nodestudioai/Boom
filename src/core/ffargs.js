// Argumentos de ffmpeg para unir los tramos en un MP4 y sacar la miniatura.
function concatList(paths) {
  return paths
    .map(p => `file '${String(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'\n`)
    .join('');
}

// Chromium no siempre escribe las pistas en el mismo orden (a veces audio primero).
// Antes de unir, cada tramo se reescribe con video primero y audio después. No recodifica.
// maxSec: si el tramo se cerró tarde (hubo que esperar al codificador), se recorta a lo que debía durar.
function normalizeArgs({ inPath, outPath, hasAudio, maxSec }) {
  const cut = Number.isFinite(maxSec) && maxSec > 0 ? ['-t', maxSec.toFixed(3)] : [];
  return ['-y', '-i', inPath, '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : ['-an']), '-c', 'copy', ...cut, '-f', 'matroska', outPath];
}

// overlay: { path, height, margin } pega un logo arriba a la izquierda (obliga a recodificar).
function exportArgs({ listPath, outPath, copyVideo, hasAudio, overlay }) {
  const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p'];
  const video = copyVideo && !overlay ? ['-c:v', 'copy'] : encode;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const audio = hasAudio
    ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
    : ['-an'];
  return [
    '-y', '-fflags', '+genpts',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    ...(overlay
      ? ['-i', overlay.path, '-filter_complex',
        `[1:v]scale=-2:${even(overlay.height)},format=rgba,colorchannelmixer=aa=0.92[wm];[0:v:0][wm]overlay=${Math.round(overlay.margin)}:${Math.round(overlay.margin)}[v]`,
        '-map', '[v]']
      : ['-map', '0:v:0']),
    ...video, ...audio,
    '-movflags', '+faststart',
    outPath,
  ];
}

function thumbArgs({ inPath, outPath, atSec }) {
  return ['-y', '-ss', String(atSec), '-i', inPath, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', outPath];
}

module.exports = { concatList, normalizeArgs, exportArgs, thumbArgs };
