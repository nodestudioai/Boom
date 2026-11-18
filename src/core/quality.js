// Calidad de video: cuántos bits por segundo y en qué formato grabar.
const PRESETS = { max: 0.20, high: 0.12, light: 0.07 }; // bits por píxel por cuadro
const MIN_BPS = 4_000_000;
const MAX_BPS = 60_000_000;
const AUDIO_BPS = 256_000;

function videoBitrate({ width, height, fps, preset }) {
  const bpp = PRESETS[preset] || PRESETS.max;
  const w = Number(width) || 1920;
  const h = Number(height) || 1080;
  const f = Number(fps) || 30;
  const raw = Math.round(w * h * f * bpp);
  return Math.min(MAX_BPS, Math.max(MIN_BPS, raw));
}

// En orden de preferencia. H.264 primero: se une al MP4 final sin recodificar.
const MIME_CANDIDATES = [
  'video/x-matroska;codecs=avc1.640034,opus',
  'video/x-matroska;codecs=avc1,opus',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const isH264 = (mime) => /avc1|h264/i.test(String(mime || ''));
const extFor = (mime) => (/matroska/i.test(String(mime || '')) ? 'mkv' : 'webm');

module.exports = { PRESETS, MIN_BPS, MAX_BPS, AUDIO_BPS, videoBitrate, MIME_CANDIDATES, isH264, extFor };
