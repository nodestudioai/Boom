const test = require('node:test');
const assert = require('node:assert/strict');
const { createTakes } = require('../src/core/takes');

test('grabar, pausar, reanudar y terminar deja dos tramos', () => {
  const t = createTakes();
  assert.deepEqual(t.start(0), { opened: 1 });
  assert.equal(t.state, 'recording');
  assert.deepEqual(t.pause(3000), { closed: 1 });
  assert.equal(t.state, 'paused');
  assert.deepEqual(t.resume(10000), { opened: 2, purged: [] });
  assert.deepEqual(t.finish(12000), { closed: 2, purged: [] });
  assert.equal(t.state, 'finished');
  assert.deepEqual(t.kept().map(k => [k.id, k.ms]), [[1, 3000], [2, 2000]]);
  assert.equal(t.totalMs(99999), 5000);
});

test('el tiempo total no cuenta las pausas y avanza mientras graba', () => {
  const t = createTakes();
  t.start(0); t.pause(1000);
  assert.equal(t.totalMs(5000), 1000);
  t.resume(5000);
  assert.equal(t.totalMs(5500), 1500);
});

test('retroceder mientras graba descarta el tramo actual y queda en pausa', () => {
  const t = createTakes();
  t.start(0); t.pause(3000); t.resume(4000);
  assert.deepEqual(t.rewind(9000), { discarded: 2, stopCurrent: true });
  assert.equal(t.state, 'paused');
  assert.deepEqual(t.kept().map(k => k.id), [1]);
  assert.equal(t.totalMs(9000), 3000);
});

test('retroceder en pausa descarta el ultimo tramo guardado', () => {
  const t = createTakes();
  t.start(0); t.pause(1000); t.resume(2000); t.pause(3000);
  assert.deepEqual(t.rewind(4000), { discarded: 2, stopCurrent: false });
  assert.deepEqual(t.rewind(4000), { discarded: 1, stopCurrent: false });
  assert.deepEqual(t.rewind(4000), { discarded: null, stopCurrent: false });
  assert.equal(t.totalMs(4000), 0);
  assert.equal(t.state, 'paused');
});

test('retroceder sin haber empezado no hace nada', () => {
  const t = createTakes();
  assert.deepEqual(t.rewind(0), { discarded: null, stopCurrent: false });
  assert.equal(t.state, 'idle');
});

test('deshacer recupera los tramos descartados en su orden original', () => {
  const t = createTakes();
  t.start(0); t.pause(1000); t.resume(2000);
  t.rewind(5000);            // descarta 2 (el actual)
  t.rewind(5000);            // descarta 1
  assert.equal(t.canUndo(), true);
  assert.deepEqual(t.undo(), { restored: 1 });
  assert.deepEqual(t.undo(), { restored: 2 });
  assert.deepEqual(t.undo(), { restored: null });
  assert.deepEqual(t.kept().map(k => [k.id, k.ms]), [[1, 1000], [2, 3000]]);
});

test('reanudar anula el deshacer y avisa que tramos borrar', () => {
  const t = createTakes();
  t.start(0); t.pause(1000); t.resume(2000);
  t.rewind(3000);
  assert.deepEqual(t.resume(4000), { opened: 3, purged: [2] });
  assert.equal(t.canUndo(), false);
  assert.deepEqual(t.undo(), { restored: null });
});

test('terminar despues de descartar todo no deja tramos', () => {
  const t = createTakes();
  t.start(0);
  t.rewind(2000);
  assert.deepEqual(t.finish(3000), { closed: null, purged: [1] });
  assert.deepEqual(t.kept(), []);
  assert.equal(t.totalMs(3000), 0);
});

test('las acciones fuera de lugar no rompen nada', () => {
  const t = createTakes();
  assert.deepEqual(t.pause(0), { closed: null });
  assert.deepEqual(t.resume(0), { opened: null, purged: [] });
  t.start(0);
  assert.deepEqual(t.start(5), { opened: null });
  assert.deepEqual(t.resume(5), { opened: null, purged: [] });
  t.finish(10);
  assert.deepEqual(t.pause(11), { closed: null });
  assert.deepEqual(t.rewind(11), { discarded: null, stopCurrent: false });
});

test('la foto del estado sirve para pintar la barra', () => {
  const t = createTakes();
  t.start(0); t.pause(1500);
  assert.deepEqual(t.snapshot(2000), { state: 'paused', totalMs: 1500, takes: 1, canUndo: false, canRewind: true });
});
