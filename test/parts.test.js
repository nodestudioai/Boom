const test = require('node:test');
const assert = require('node:assert/strict');
const { planParts } = require('../src/core/parts');
const MiB = 1024 * 1024;

test('archivo mas chico que una parte: una sola parte', () => {
  assert.deepEqual(planParts(1234), [{ n: 1, start: 0, end: 1234 }]);
});
test('multiplo exacto no deja una parte vacia al final', () => {
  const p = planParts(20 * MiB);
  assert.equal(p.length, 2);
  assert.deepEqual(p[1], { n: 2, start: 10 * MiB, end: 20 * MiB });
});
test('la ultima parte lleva el resto', () => {
  const p = planParts(25 * MiB + 7);
  assert.equal(p.length, 3);
  assert.equal(p[2].end - p[2].start, 5 * MiB + 7);
  assert.equal(p.reduce((s, x) => s + x.end - x.start, 0), 25 * MiB + 7);
});
test('tamano cero o invalido no genera partes', () => {
  assert.deepEqual(planParts(0), []);
  assert.deepEqual(planParts(-5), []);
  assert.deepEqual(planParts(NaN), []);
});
