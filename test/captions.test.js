const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/core/captions');

test('un video corto va en un solo pedazo', () => {
  assert.deepEqual(c.chunkPlan(100), [{ start: 0, end: 100 }]);
  assert.deepEqual(c.chunkPlan(0), []);
});
test('un video largo se corta en el silencio mas cercano a cada 4 minutos', () => {
  const plan = c.chunkPlan(600, [{ start: 100, end: 101 }, { start: 230, end: 231 }, { start: 470, end: 472 }]);
  assert.deepEqual(plan, [{ start: 0, end: 230.5 }, { start: 230.5, end: 471 }, { start: 471, end: 600 }]);
});
test('sin silencios cerca corta justo en los 4 minutos', () => {
  assert.deepEqual(c.chunkPlan(500), [{ start: 0, end: 240 }, { start: 240, end: 500 }]);
});
test('lee los silencios de ffmpeg', () => {
  const s = '[silencedetect @ 0x1] silence_start: 1.5\n[silencedetect @ 0x1] silence_end: 2.25 | silence_duration: 0.75\nsilence_start: 9\n';
  assert.deepEqual(c.parseSilences(s), [{ start: 1.5, end: 2.25 }]);
});
test('corre los tiempos de un pedazo', () => {
  const [s] = c.offsetSegments([{ start: 1, end: 2, text: 'hola', words: [{ start: 1, end: 2, word: ' hola' }] }], 240);
  assert.equal(s.start, 241);
  assert.equal(s.words[0].end, 242);
});

const w = (start, end, word) => ({ start, end, word: ' ' + word });
test('una frase corta es un solo subtitulo', () => {
  const cues = c.buildCues([{ start: 0, end: 2.7, text: 'Hola, esta es una prueba.', words: [w(0, 0.3, 'Hola,'), w(0.6, 1, 'esta'), w(1, 1.2, 'es'), w(1.2, 1.4, 'una'), w(1.4, 2.7, 'prueba.')] }]);
  assert.deepEqual(cues, [{ start: 0, end: 2.7, text: 'Hola, esta es una prueba.' }]);
});
test('una pausa larga corta el subtitulo', () => {
  const cues = c.buildCues([{ start: 0, end: 5, text: 'uno dos', words: [w(0, 1, 'uno'), w(3, 5, 'dos')] }]);
  assert.deepEqual(cues.map((x) => x.text), ['uno', 'dos']);
});
test('una frase larga se parte en subtitulos de hasta dos renglones', () => {
  const words = Array.from({ length: 40 }, (_, i) => w(i * 0.3, i * 0.3 + 0.25, 'palabra'));
  const cues = c.buildCues([{ start: 0, end: 12, text: '', words }]);
  assert.ok(cues.length >= 3);
  for (const q of cues) {
    assert.ok(q.text.length <= 84, q.text);
    assert.ok(q.end - q.start <= 6.01);
  }
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end, 'no se pisan');
});
test('sin palabras sueltas reparte el tiempo de la frase', () => {
  const cues = c.buildCues([{ start: 10, end: 12, text: 'hola che' }]);
  assert.deepEqual(cues, [{ start: 10, end: 12, text: 'hola che' }]);
});
test('un subtitulo muy corto dura al menos lo minimo, sin pisar al siguiente', () => {
  const cues = c.buildCues([
    { start: 0, end: 0.2, text: 'Sí.', words: [w(0, 0.2, 'Sí.')] },
    { start: 0.5, end: 1, text: 'Dale.', words: [w(0.5, 1, 'Dale.')] },
  ]);
  assert.deepEqual(cues.map((x) => [x.start, x.end]), [[0, 0.5], [0.5, 1.3]]);
});

test('parte en dos renglones parejos', () => {
  assert.equal(c.wrap('corto'), 'corto');
  const t = 'Vamos a ver si la inteligencia artificial entiende lo que digo';
  const [a, b] = c.wrap(t).split('\n');
  assert.equal(a + ' ' + b, t);
  assert.ok(Math.abs(a.length - b.length) < 12);
});
test('archivo WebVTT', () => {
  assert.equal(c.vttTime(3723.4567), '01:02:03.457');
  const v = c.toVtt([{ start: 0, end: 1.5, text: 'Hola' }, { start: 2, end: 3, text: 'a --> b' }]);
  assert.equal(v, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nHola\n\n2\n00:00:02.000 --> 00:00:03.000\na → b\n');
});
