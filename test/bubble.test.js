const test = require('node:test');
const assert = require('node:assert/strict');
const { bubbleBounds, SHAPES, SIZES } = require('../src/core/bubble');
const display = { x: 0, y: 0, width: 1920, height: 1080 };
const inside = (b, d) => b.x >= d.x && b.y >= d.y && b.x + b.width <= d.x + d.width && b.y + b.height <= d.y + d.height;

test('formas y tamanos disponibles', () => {
  assert.deepEqual(SHAPES, ['circle', 'square', 'rect', 'full']);
  assert.deepEqual(SIZES, ['s', 'm', 'l']);
});
test('circulo mediano es cuadrado de 24% del alto, abajo a la izquierda', () => {
  const b = bubbleBounds({ shape: 'circle', size: 'm', display });
  assert.deepEqual(b, { x: 32, y: 1080 - 259 - 32, width: 259, height: 259 });
});
test('rectangulo es 16:9', () => {
  const b = bubbleBounds({ shape: 'rect', size: 'l', display });
  assert.equal(b.height, 367);
  assert.equal(b.width, Math.round(367 * 16 / 9));
});
test('pantalla completa devuelve el monitor exacto', () => {
  const d = { x: 1920, y: -200, width: 2560, height: 1440 };
  assert.deepEqual(bubbleBounds({ shape: 'full', size: 's', display: d, anchor: { cx: 5, cy: 5 } }), d);
});
test('conserva el centro al cambiar de forma', () => {
  const b = bubbleBounds({ shape: 'square', size: 's', display, anchor: { cx: 960, cy: 540 } });
  assert.ok(Math.abs(b.x + b.width / 2 - 960) <= 1);
  assert.ok(Math.abs(b.y + b.height / 2 - 540) <= 1);
});
test('una burbuja arrastrada fuera queda dentro del monitor', () => {
  for (const anchor of [{ cx: -500, cy: -500 }, { cx: 5000, cy: 5000 }, { cx: 1915, cy: 3 }]) {
    for (const shape of ['circle', 'square', 'rect']) {
      const b = bubbleBounds({ shape, size: 'l', display, anchor });
      assert.ok(inside(b, display), JSON.stringify({ anchor, shape, b }));
    }
  }
});
test('monitor secundario con origen negativo', () => {
  const d = { x: -1280, y: 0, width: 1280, height: 720 };
  const b = bubbleBounds({ shape: 'circle', size: 'm', display: d });
  assert.ok(inside(b, d));
  assert.equal(b.x, -1280 + 32);
});
test('un monitor muy chico no deja la burbuja mas grande que el monitor', () => {
  const d = { x: 0, y: 0, width: 300, height: 600 };
  const b = bubbleBounds({ shape: 'rect', size: 'l', display: d });
  assert.ok(inside(b, d));
});

const b = require('../src/core/bubble');
test('esquinas: el círculo siempre es redondo y lo demás se puede dejar recto', () => {
  assert.equal(b.cornerRadius({ shape: 'circle', rounded: false, w: 200, h: 200 }), 100);
  assert.equal(b.cornerRadius({ shape: 'square', rounded: true, w: 200, h: 200 }), 20);
  assert.equal(b.cornerRadius({ shape: 'square', rounded: false, w: 200, h: 200 }), 0);
  assert.equal(b.cornerRadius({ shape: 'rect', rounded: true, w: 320, h: 180, dpr: 2 }), 44);
  assert.equal(b.cornerRadius({ shape: 'rect', rounded: false, w: 320, h: 180 }), 0);
  assert.equal(b.cornerRadius({ shape: 'full', rounded: true, w: 1920, h: 1080 }), 0);
});
test('marco: sin marco mide 0, y en cámara completa no se dibuja', () => {
  assert.equal(b.frameWidth({ shape: 'circle', frame: 'none', w: 300, h: 300 }), 0);
  assert.equal(b.frameWidth({ shape: 'circle', frame: 'no-existe', w: 300, h: 300 }), 0);
  assert.equal(b.frameWidth({ shape: 'circle', frame: 'blue', w: 300, h: 300 }), 7);
  assert.equal(b.frameWidth({ shape: 'square', frame: 'white', w: 60, h: 60 }), 3);
  assert.equal(b.frameWidth({ shape: 'full', frame: 'blue', w: 1920, h: 1080 }), 0);
  assert.equal(b.FRAMES.blue, '#2068D7');
});
test('marca de agua arriba a la izquierda y botón de achicar arriba a la derecha', () => {
  const display = { x: 1920, y: 0, width: 1920, height: 1080 };
  const w = b.watermarkBounds({ display });
  assert.deepEqual(w, { x: 1920 + 24, y: 24, width: 59, height: 54 });
  const c = b.cornerBounds({ display });
  assert.equal(c.x + c.width, 1920 + 1920 - 10);
  assert.equal(c.y, 10);
});
