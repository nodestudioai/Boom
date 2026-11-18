const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/core/ffargs');

test('lista de union con barras normales y comillas escapadas', () => {
  const s = f.concatList(['C:\\Users\\a\\seg-1.mkv', "C:\\Users\\o'neil\\seg-2.mkv"]);
  assert.equal(s, "file 'C:/Users/a/seg-1.mkv'\nfile 'C:/Users/o'\\''neil/seg-2.mkv'\n");
});
test('copia el video cuando ya es H.264', () => {
  const a = f.exportArgs({ listPath: 'l.txt', outPath: 'o.mp4', copyVideo: true, hasAudio: true });
  const s = a.join(' ');
  assert.match(s, /-f concat -safe 0 -i l\.txt/);
  assert.match(s, /-c:v copy/);
  assert.match(s, /-c:a aac -b:a 192k -ar 48000/);
  assert.match(s, /-movflags \+faststart/);
  assert.equal(a[a.length - 1], 'o.mp4');
  assert.doesNotMatch(s, /libx264/);
});
test('recodifica en alta calidad cuando no es H.264', () => {
  const s = f.exportArgs({ listPath: 'l.txt', outPath: 'o.mp4', copyVideo: false, hasAudio: true }).join(' ');
  assert.match(s, /-c:v libx264 -preset veryfast -crf 16 -pix_fmt yuv420p/);
});
test('sin audio no agrega pista de audio', () => {
  const s = f.exportArgs({ listPath: 'l.txt', outPath: 'o.mp4', copyVideo: true, hasAudio: false }).join(' ');
  assert.match(s, / -an /);
  assert.doesNotMatch(s, /aac/);
});
test('miniatura en un instante dado', () => {
  const a = f.thumbArgs({ inPath: 'o.mp4', outPath: 't.jpg', atSec: 1.5 });
  assert.deepEqual(a.slice(0, 5), ['-y', '-ss', '1.5', '-i', 'o.mp4']);
  assert.equal(a[a.length - 1], 't.jpg');
});
test('normaliza un tramo: video primero, audio despues, sin recodificar', () => {
  const a = f.normalizeArgs({ inPath: 'in.mkv', outPath: 'out.mkv', hasAudio: true });
  assert.deepEqual(a, ['-y', '-i', 'in.mkv', '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-f', 'matroska', 'out.mkv']);
});
test('normaliza un tramo sin audio', () => {
  const a = f.normalizeArgs({ inPath: 'in.mkv', outPath: 'out.mkv', hasAudio: false });
  assert.deepEqual(a, ['-y', '-i', 'in.mkv', '-map', '0:v:0', '-an', '-c', 'copy', '-f', 'matroska', 'out.mkv']);
});
test('normaliza recortando el sobrante cuando el tramo se cerro tarde', () => {
  const a = f.normalizeArgs({ inPath: 'in.mkv', outPath: 'out.mkv', hasAudio: true, maxSec: 0.442 });
  assert.deepEqual(a, ['-y', '-i', 'in.mkv', '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-t', '0.442', '-f', 'matroska', 'out.mkv']);
});
test('sin limite o con limite invalido no recorta', () => {
  for (const maxSec of [undefined, null, 0, -1, NaN]) {
    assert.ok(!f.normalizeArgs({ inPath: 'i', outPath: 'o', hasAudio: true, maxSec }).includes('-t'));
  }
});
test('con marca de agua pega el logo arriba a la izquierda y recodifica', () => {
  const a = f.exportArgs({ listPath: 'l.txt', outPath: 'o.mp4', copyVideo: true, hasAudio: true, overlay: { path: 'logo.png', height: 53, margin: 23.6 } });
  const s = a.join(' ');
  assert.match(s, /-i l\.txt -i logo\.png -filter_complex /);
  assert.match(s, /scale=-2:54,/, 'el alto del logo debe ser par');
  assert.match(s, /overlay=24:24\[v\] -map \[v\]/);
  assert.match(s, /-c:v libx264/);
  assert.doesNotMatch(s, /-c:v copy/);
  assert.doesNotMatch(s, /-map 0:v:0/);
  assert.match(s, /-map 0:a:0\?/);
});
