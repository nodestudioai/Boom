// Preferencias del usuario, guardadas en un JSON.
const fs = require('fs');
const path = require('path');
const { SHAPES, SIZES, FRAMES } = require('../core/bubble');
const { PRESETS } = require('../core/quality');

const DEFAULTS = {
  mode: 'screen_cam',        // screen_cam | screen | cam
  displayId: null,
  cameraId: '',
  micId: '',                 // '' = predeterminado, 'none' = sin micrófono
  micLabel: '',              // nombre del micrófono elegido (para reconocerlo si se desenchufa y vuelve)
  micMono: true,             // la voz se escucha igual en los dos oídos
  systemAudio: true,
  noiseSuppression: true,
  shape: 'circle',
  size: 'm',
  mirror: true,
  rounded: true,             // esquinas redondeadas en cuadrado y rectángulo
  frame: 'none',             // marco de la cámara: none | blue | cyan | white | navy
  watermark: false,          // logo chiquito arriba a la izquierda del video
  watermarkPath: '',         // imagen elegida para ese logo ('' = el de Boom)
  fps: 30,
  preset: 'max',
  cloud: { baseUrl: '', token: '' },
  captions: true,            // al compartir, generar subtítulos automáticos para el link
  captionsLang: 'auto',      // idioma de los subtítulos: auto (lo detecta) o un código de 2 letras
};

const CAPTION_LANGS = ['auto', 'es', 'en', 'pt', 'fr', 'it', 'de'];

function sanitize(s) {
  const out = { ...DEFAULTS, ...s, cloud: { ...DEFAULTS.cloud, ...(s && s.cloud) } };
  if (!['screen_cam', 'screen', 'cam'].includes(out.mode)) out.mode = DEFAULTS.mode;
  if (!SHAPES.includes(out.shape)) out.shape = DEFAULTS.shape;
  if (!SIZES.includes(out.size)) out.size = DEFAULTS.size;
  if (!PRESETS[out.preset]) out.preset = DEFAULTS.preset;
  if (!(out.frame in FRAMES)) out.frame = DEFAULTS.frame;
  for (const k of ['rounded', 'watermark', 'captions', 'micMono', 'mirror', 'systemAudio', 'noiseSuppression']) out[k] = !!out[k];
  if (!CAPTION_LANGS.includes(out.captionsLang)) out.captionsLang = DEFAULTS.captionsLang;
  out.watermarkPath = String(out.watermarkPath || '');
  out.micLabel = String(out.micLabel || '').slice(0, 200);
  out.fps = Number(out.fps) === 60 ? 60 : 30;
  out.cloud.baseUrl = String(out.cloud.baseUrl || '').trim().replace(/\/+$/, '');
  out.cloud.token = String(out.cloud.token || '').trim();
  return out;
}

function createSettings(file) {
  let data = sanitize({});
  try { data = sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* primera vez */ }
  return {
    get: () => data,
    set(patch) {
      data = sanitize({ ...data, ...patch, cloud: { ...data.cloud, ...(patch && patch.cloud) } });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      return data;
    },
  };
}

module.exports = { DEFAULTS, CAPTION_LANGS, sanitize, createSettings };
