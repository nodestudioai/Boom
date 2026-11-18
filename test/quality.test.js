const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../src/core/quality');

test('bitrate de 1080p a 30 fps en maxima', () => {
  assert.equal(q.videoBitrate({ width: 1920, height: 1080, fps: 30, preset: 'max' }), 12441600);
});
test('4K a 60 fps queda en el tope de 60 Mbps', () => {
  assert.equal(q.videoBitrate({ width: 3840, height: 2160, fps: 60, preset: 'max' }), 60000000);
});
test('una captura chica no baja del minimo de 4 Mbps', () => {
  assert.equal(q.videoBitrate({ width: 640, height: 360, fps: 30, preset: 'light' }), 4000000);
});
test('los presets ordenan de mayor a menor', () => {
  const b = p => q.videoBitrate({ width: 2560, height: 1440, fps: 30, preset: p });
  assert.ok(b('max') > b('high') && b('high') > b('light'));
});
test('un preset desconocido usa maxima', () => {
  assert.equal(q.videoBitrate({ width: 1920, height: 1080, fps: 30, preset: 'cualquiera' }), 12441600);
});
test('monitor con escala rara: datos invalidos no devuelven NaN', () => {
  const v = q.videoBitrate({ width: 2879.5, height: 1619.5, fps: undefined, preset: 'max' });
  assert.ok(Number.isInteger(v) && v >= 4000000 && v <= 60000000);
});
test('H.264 va primero en la lista de formatos', () => {
  assert.ok(q.isH264(q.MIME_CANDIDATES[0]));
  assert.equal(q.isH264('video/webm;codecs=vp9,opus'), false);
  assert.equal(q.isH264('video/webm;codecs=h264,opus'), true);
  assert.ok(q.MIME_CANDIDATES.some(m => /vp9/.test(m)) && q.MIME_CANDIDATES.some(m => /vp8/.test(m)));
});
test('extension segun el formato', () => {
  assert.equal(q.extFor('video/x-matroska;codecs=avc1,opus'), 'mkv');
  assert.equal(q.extFor('video/webm;codecs=vp9,opus'), 'webm');
});
