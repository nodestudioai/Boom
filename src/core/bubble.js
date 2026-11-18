// Geometría de la burbuja de cámara: dónde va y cuánto mide según forma y tamaño.
// Se usa desde el proceso principal (require) y desde la ventana de la cámara (<script>).
(function (root) {
const SHAPES = ['circle', 'square', 'rect', 'full'];
const SIZES = ['s', 'm', 'l'];
const FACTOR = { s: 0.16, m: 0.24, l: 0.34 }; // fracción del alto del monitor
const MARGIN = 32;
// Marcos opcionales de la cámara (color del borde). 'none' = sin marco.
const FRAMES = { none: null, blue: '#2068D7', cyan: '#00BAF4', white: '#FFFFFF', navy: '#0B1F44' };

// Radio de las esquinas y grosor del marco, en píxeles del lienzo de w × h.
function cornerRadius({ shape, rounded, w, h, dpr = 1 }) {
  if (shape === 'circle') return Math.min(w, h) / 2;
  if (!rounded || shape === 'full') return 0;
  return shape === 'square' ? Math.min(w, h) * 0.10 : 22 * dpr;
}
function frameWidth({ shape, frame, w, h }) {
  if (!FRAMES[frame] || shape === 'full') return 0;
  return Math.max(3, Math.round(Math.min(w, h) * 0.022));
}

function bubbleBounds({ shape, size, display, anchor }) {
  if (shape === 'full') return { x: display.x, y: display.y, width: display.width, height: display.height };

  let height = Math.round(display.height * (FACTOR[size] || FACTOR.m));
  let width = shape === 'rect' ? Math.round(height * 16 / 9) : height;

  // Nunca más grande que el monitor (menos el margen).
  const maxW = Math.max(40, display.width - MARGIN * 2);
  const maxH = Math.max(40, display.height - MARGIN * 2);
  const k = Math.min(1, maxW / width, maxH / height);
  if (k < 1) { width = Math.floor(width * k); height = Math.floor(height * k); }

  let x, y;
  if (anchor && Number.isFinite(anchor.cx) && Number.isFinite(anchor.cy)) {
    x = Math.round(anchor.cx - width / 2);
    y = Math.round(anchor.cy - height / 2);
  } else {
    x = display.x + MARGIN;
    y = display.y + display.height - height - MARGIN;
  }
  x = Math.min(Math.max(x, display.x), display.x + display.width - width);
  y = Math.min(Math.max(y, display.y), display.y + display.height - height);
  return { x, y, width, height };
}

// Logo de marca de agua: arriba a la izquierda del monitor, chico.
function watermarkBounds({ display, aspect = 300 / 273 }) {
  const height = Math.max(28, Math.round(display.height * 0.05));
  const margin = Math.round(display.height * 0.022);
  return { x: display.x + margin, y: display.y + margin, width: Math.round(height * aspect), height };
}

// Botón para achicar la cámara completa: arriba a la derecha.
function cornerBounds({ display, width = 196, height = 60 }) {
  return { x: display.x + display.width - width - 10, y: display.y + 10, width, height };
}

const api = { SHAPES, SIZES, FACTOR, MARGIN, FRAMES, bubbleBounds, cornerRadius, frameWidth, watermarkBounds, cornerBounds };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.BoomBubble = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
