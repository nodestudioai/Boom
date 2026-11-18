// Juntar varios videos de Boom en uno solo, en el orden elegido.
// Si todos salieron con el mismo formato, se pegan tal cual (al instante y sin perder calidad).
// Si no (otro tamaño, otra cámara, sin audio), se rearman todos con un mismo formato.

// Los "parámetros" del H.264 (SPS y PPS) del primer cuadro, en hexadecimal.
// buf es la salida de ffmpeg con -bsf:v h264_mp4toannexb -frames:v 1 -f h264.
function h264ParamSets(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const starts = [];
  for (let i = 0; i + 3 <= b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      starts.push({ at: i + 3, from: i > 0 && b[i - 1] === 0 ? i - 1 : i });
      i += 2;
    }
  }
  const sets = [];
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].from : b.length;
    const type = b[s.at] & 0x1f;
    if (type === 7 || type === 8) sets.push(b.subarray(s.at, end).toString('hex'));
  });
  return sets.join('|');
}

// ¿Se pueden pegar sin recodificar? Todos H.264 con los mismos parámetros, mismo tamaño,
// y el mismo audio (o ninguno sin audio).
function canCopyJoin(infos) {
  if (!infos.length) return false;
  const a = infos[0];
  return infos.every((x) =>
    x.videoCodec === 'h264' && !!x.paramSets && x.paramSets === a.paramSets &&
    x.width === a.width && x.height === a.height &&
    (x.audioCodec || null) === (a.audioCodec || null) &&
    (x.sampleRate || 0) === (a.sampleRate || 0) && (x.channels || 0) === (a.channels || 0));
}

function mergeCopyArgs({ listPath, outPath, hasAudio }) {
  return [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : ['-an']),
    '-c', 'copy', '-movflags', '+faststart', outPath,
  ];
}

// Formato común para rearmarlos: el tamaño del primero y 30 o 60 cuadros por segundo.
function encodeTarget(infos) {
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const first = infos[0];
  return {
    width: even(first.width || 1920),
    height: even(first.height || 1080),
    fps: infos.some((x) => (x.fps || 0) > 45) ? 60 : 30,
  };
}

// inputs: [{ path, hasAudio, durationSec }]. Los que no tienen audio llevan silencio,
// así el sonido de los demás no se corre.
function mergeEncodeArgs({ inputs, width, height, fps, outPath }) {
  const anyAudio = inputs.some((x) => x.hasAudio);
  const args = ['-y'];
  inputs.forEach((x) => args.push('-i', x.path));
  const silent = [];
  if (anyAudio) {
    inputs.forEach((x, i) => {
      if (x.hasAudio) return;
      silent[i] = inputs.length + silent.filter((v) => v != null).length;
      args.push('-f', 'lavfi', '-t', Math.max(0.1, x.durationSec || 0).toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
    });
  }
  const parts = [];
  let joined = '';
  inputs.forEach((x, i) => {
    parts.push(`[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${i}]`);
    joined += `[v${i}]`;
    if (anyAudio) {
      const src = x.hasAudio ? `${i}:a:0` : `${silent[i]}:a:0`;
      parts.push(`[${src}]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`);
      joined += `[a${i}]`;
    }
  });
  parts.push(`${joined}concat=n=${inputs.length}:v=1:a=${anyAudio ? 1 : 0}[v]${anyAudio ? '[a]' : ''}`);
  return [
    ...args,
    '-filter_complex', parts.join(';'),
    '-map', '[v]', ...(anyAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', outPath,
  ];
}

// Segundos ya procesados según lo último que escribió ffmpeg ("time=00:01:23.45").
function progressSec(stderrChunk) {
  const all = [...String(stderrChunk).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!all.length) return null;
  const m = all[all.length - 1];
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

module.exports = { h264ParamSets, canCopyJoin, mergeCopyArgs, encodeTarget, mergeEncodeArgs, progressSec };
