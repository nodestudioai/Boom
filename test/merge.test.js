const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/core/merge');

const SPS = [0x67, 0x64, 0x00, 0x29, 0xac];
const PPS = [0x68, 0xee, 0x3c, 0xb0];
const annexb = (...nals) => Buffer.concat(nals.map((n, i) => Buffer.from([...(i % 2 ? [0, 0, 1] : [0, 0, 0, 1]), ...n])));

test('saca SPS y PPS del primer cuadro e ignora el resto', () => {
  const b = annexb([0x09, 0x10], SPS, PPS, [0x6e, 0xc0], [0x65, 0x88, 0x80]);
  assert.equal(m.h264ParamSets(b), '67640029ac|68ee3cb0');
});
test('sin datos no hay parametros', () => {
  assert.equal(m.h264ParamSets(Buffer.alloc(0)), '');
  assert.equal(m.h264ParamSets(null), '');
});

const base = { videoCodec: 'h264', paramSets: 'abc|def', width: 1920, height: 1080, audioCodec: 'aac', sampleRate: 48000, channels: 2 };
test('mismos parametros: se pegan tal cual', () => {
  assert.equal(m.canCopyJoin([base, { ...base }, { ...base, fps: 60 }]), true);
});
test('cualquier diferencia obliga a rearmarlos', () => {
  for (const diff of [{ paramSets: 'otro' }, { paramSets: '' }, { width: 1280 }, { height: 720 }, { videoCodec: 'vp9' },
    { audioCodec: null }, { sampleRate: 44100 }, { channels: 1 }]) {
    assert.equal(m.canCopyJoin([base, { ...base, ...diff }]), false, JSON.stringify(diff));
  }
  assert.equal(m.canCopyJoin([]), false);
});
test('todos sin audio tambien se pegan tal cual', () => {
  const s = { ...base, audioCodec: null, sampleRate: 0, channels: 0 };
  assert.equal(m.canCopyJoin([s, { ...s }]), true);
});

test('pegar tal cual: concat sin recodificar', () => {
  const s = m.mergeCopyArgs({ listPath: 'l.txt', outPath: 'o.mp4', hasAudio: true }).join(' ');
  assert.equal(s, '-y -f concat -safe 0 -i l.txt -map 0:v:0 -map 0:a:0 -c copy -movflags +faststart o.mp4');
  assert.match(m.mergeCopyArgs({ listPath: 'l.txt', outPath: 'o.mp4', hasAudio: false }).join(' '), / -an -c copy /);
});

test('formato comun: tamano del primero (par) y 30 o 60 fps', () => {
  assert.deepEqual(m.encodeTarget([{ width: 1921, height: 1081, fps: 31.5 }, { width: 1280, height: 720, fps: 30 }]), { width: 1922, height: 1082, fps: 30 });
  assert.equal(m.encodeTarget([{ width: 1920, height: 1080, fps: 30 }, { width: 1920, height: 1080, fps: 59.9 }]).fps, 60);
});

test('rearmar: mismo tamano para todos y silencio donde falta audio', () => {
  const a = m.mergeEncodeArgs({
    inputs: [{ path: 'a.mp4', hasAudio: true, durationSec: 10 }, { path: 'b.mp4', hasAudio: false, durationSec: 4.5 }, { path: 'c.mp4', hasAudio: true, durationSec: 3 }],
    width: 1920, height: 1080, fps: 30, outPath: 'o.mp4',
  });
  const s = a.join(' ');
  assert.match(s, /^-y -i a\.mp4 -i b\.mp4 -i c\.mp4 -f lavfi -t 4\.500 -i anullsrc=r=48000:cl=stereo -filter_complex /);
  const fc = a[a.indexOf('-filter_complex') + 1];
  assert.match(fc, /\[1:v:0\]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080/);
  assert.match(fc, /\[3:a:0\]aresample=48000.*\[a1\]/, 'el silencio ocupa el lugar del audio de b');
  assert.match(fc, /\[v0\]\[a0\]\[v1\]\[a1\]\[v2\]\[a2\]concat=n=3:v=1:a=1\[v\]\[a\]$/);
  assert.match(s, /-map \[v\] -map \[a\] -c:a aac/);
  assert.match(s, /-c:v libx264 -preset veryfast -crf 16 -pix_fmt yuv420p -movflags \+faststart o\.mp4$/);
});
test('rearmar sin ningun audio', () => {
  const a = m.mergeEncodeArgs({ inputs: [{ path: 'a.mp4' }, { path: 'b.mp4' }], width: 640, height: 360, fps: 30, outPath: 'o.mp4' });
  const s = a.join(' ');
  assert.doesNotMatch(s, /anullsrc|aresample|-map \[a\]/);
  assert.match(s, /concat=n=2:v=1:a=0\[v\] -map \[v\] -an /);
});

test('progreso: el ultimo tiempo que informo ffmpeg', () => {
  assert.equal(m.progressSec('frame= 10 time=00:00:01.50 bitrate\rframe= 20 time=00:01:02.25 bitrate'), 62.25);
  assert.equal(m.progressSec('nada'), null);
});
