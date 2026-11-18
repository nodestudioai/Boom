// Corre Boom en modo de prueba y verifica los videos que produce.
// Uso: npm run smoke   (graba tu pantalla unos segundos en una carpeta temporal y la borra al final)
//      npm run smoke -- --keep   (deja los archivos para mirarlos)
//      npm run smoke -- --exe "dist/win-unpacked/Boom.exe"   (prueba la app empaquetada)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boom-smoke-'));
const report = path.join(tmp, 'reporte.json');
const out = path.join(tmp, 'videos');
const ffmpeg = require('ffmpeg-static');
const keep = process.argv.includes('--keep');

// Con --exe <ruta> prueba la app ya empaquetada en vez de la de desarrollo.
const exeAt = process.argv.indexOf('--exe');
const exe = exeAt > 0 ? process.argv[exeAt + 1] : null;
const shotsAt = process.argv.indexOf('--shots'); // --shots <carpeta>: guarda capturas de las ventanas
if (shotsAt > 0) fs.mkdirSync(path.resolve(process.argv[shotsAt + 1]), { recursive: true });
const run = spawnSync(exe || require('electron'), exe ? [] : ['.'], {
  cwd: root, encoding: 'utf8', timeout: 200000,
  env: {
    ...process.env, BOOM_SMOKE: '1', BOOM_SMOKE_REPORT: report, BOOM_OUT_DIR: out, BOOM_USER_DATA: path.join(tmp, 'datos'), ELECTRON_ENABLE_LOGGING: '1',
    ...(process.argv.includes('--mouse') ? { BOOM_SMOKE_MOUSE: '1' } : {}), // --mouse: mueve el mouse de verdad para probar el botón de la esquina
    ...(process.argv.includes('--killcam') ? { BOOM_SMOKE_KILLCAM: '1' } : {}), // --killcam: corta el servicio de cámaras y comprueba que la burbuja se reconecta
    ...(shotsAt > 0 ? { BOOM_SHOTS: path.resolve(process.argv[shotsAt + 1]) } : {}),
  },
});
fs.writeFileSync(path.join(tmp, 'electron.log'), [run.stdout || '', run.stderr || ''].join(String.fromCharCode(10)));
if (!fs.existsSync(report)) {
  console.error(run.stdout, run.stderr);
  throw new Error('Boom no dejó reporte (código ' + run.status + ')');
}
const r = JSON.parse(fs.readFileSync(report, 'utf8'));
if (r.error) {
  console.error((run.stderr || '').split('\n').filter((l) => /boom|error/i.test(l)).slice(-20).join('\n'));
  throw new Error(r.error);
}

function inspect(file) {
  const i = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const d = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(i);
  // Decodifica el video entero. El "muxer" nulo redondea los tiempos a cuadros fijos y se queja
  // de tiempos repetidos: eso es del comando de prueba, no un error del video, y se descarta.
  const dec = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-i', file, '-fps_mode', 'passthrough', '-f', 'null', '-'], { encoding: 'utf8' });
  const errors = dec.stderr.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('[null @'));
  // Los tiempos de los cuadros tienen que ir siempre hacia adelante.
  const crc = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-i', file, '-map', '0:v', '-c', 'copy', '-f', 'framecrc', '-'], { encoding: 'utf8' });
  const dts = crc.stdout.split(/\r?\n/).filter((l) => /^\d/.test(l)).map((l) => Number(l.split(',')[1]));
  return {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    video: (/Video:\s*([a-z0-9]+).*?(\d{3,5}x\d{3,5})/.exec(i) || []).slice(1, 3).join(' '),
    audio: (/Audio:\s*([a-z0-9]+)[^\n]*?(\d+) Hz/.exec(i) || []).slice(1, 3).join(' '),
    kbps: Number((/bitrate:\s*(\d+) kb\/s/.exec(i) || [])[1]),
    frames: dts.length,
    timeJumpsBack: dts.filter((v, n) => n > 0 && v <= dts[n - 1]).length,
    decodeErrors: errors.length,
    decodeLog: errors.join(' | ').slice(0, 400),
  };
}

// Cuenta los píxeles del celeste del logo de NodeStudio en la esquina de arriba a la izquierda del video.
function logoPixels(file, atSec = 1) {
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const h = Number((/Video:.*?\b\d{3,5}x(\d{3,5})\b/.exec(probe) || [])[1]);
  const side = Math.round(h * 0.09 / 2) * 2;
  const raw = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-vf', `crop=${side}:${side}:0:0`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 }).stdout;
  let n = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const R = raw[i], G = raw[i + 1], Bl = raw[i + 2];
    if (Bl > 140 && Bl - R > 70 && G - R > 30) n++; // azul celeste, aun lavado por la compresión
  }
  return { celeste: n, area: side * side };
}

if (r.engineLog && r.engineLog.length) console.log('avisos del motor:', JSON.stringify(r.engineLog));
if (r.killcam) {
  // Diagnóstico aparte (--killcam): Chromium no vuelve a listar cámaras tras un corte de su servicio
  // hasta reiniciar la app; acá se ve qué pasa y qué mensaje muestra la burbuja.
  console.log('corte del servicio de cámaras:', JSON.stringify(r.killcam, null, 1));
  if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}
const A = r.cases.A, B = r.cases.B, C = r.cases.C, D = r.cases.D;
const fmt = A.start.info;
console.log(`formato: ${fmt.mime} · ${fmt.width}x${fmt.height} · tope ${Math.round(fmt.bitrate / 1e6)} Mbps · micrófono: ${fmt.hasMic} (${fmt.micLabel || 's/n'}) · audio del sistema: ${fmt.hasSystemAudio}`);

for (const [name, c] of Object.entries(r.cases)) {
  const lost = (c.finish && c.finish.dropped) || [];
  assert.equal(lost.length, 0, `${name}: un tramo llegó vacío: ` + JSON.stringify(lost) + ' · pasos: ' + JSON.stringify(r.log));
}
assert.equal(A.finish.ok, true, 'A debe guardar: ' + JSON.stringify(A.finish));
const a = inspect(A.finish.item.file);
console.log('A (3 s + 2 s descartados + 2 s):', JSON.stringify(a), '· tramos:', A.finish.takes, '· recodificado:', A.finish.export.recoded);
assert.equal(A.finish.takes, 2, 'A debe tener 2 tramos');
// La duración tiene que coincidir con el contador (los 2 s descartados no cuentan).
const wantA = (A.expectedMs || 5000) / 1000;
assert.ok(Math.abs(a.duration - wantA) < 1.3, `A debe durar ~${wantA.toFixed(1)} s (lo que marcaba el contador), duró ${a.duration}`);
assert.match(a.video, /^h264 /, 'A debe ser H.264');
assert.match(a.audio, /^aac 48000/, 'A debe tener audio AAC a 48 kHz');
assert.equal(a.decodeErrors, 0, 'A debe decodificar sin errores: ' + a.decodeLog);
assert.equal(a.timeJumpsBack, 0, 'A no debe tener tiempos que retroceden');
// La cantidad exacta depende de cuánto cambie la pantalla; esto solo descarta un video casi vacío.
assert.ok(a.frames > 20, 'A debe tener cuadros de los dos tramos, tiene ' + a.frames);
assert.ok(fs.existsSync(A.finish.item.thumb), 'A debe tener miniatura');
assert.equal(a.video.split(' ')[1], `${fmt.width}x${fmt.height}`, 'A debe conservar la resolución nativa');
assert.equal(A.finish.export.recoded, false, 'A no debe recodificar el video');

// Marca de agua: en A está puesta y en D apagada.
assert.equal(r.watermark.visible, true, 'A: la marca de agua debe estar a la vista mientras se graba');
assert.equal(r.watermarkAfter, false, 'la marca de agua debe esconderse al terminar de grabar');
assert.equal(r.watermarkOff, false, 'D: con la opción apagada no debe haber marca de agua');
const la = logoPixels(A.finish.item.file);
console.log('marca de agua en A:', JSON.stringify(la), '· ventana:', JSON.stringify(r.watermark.bounds));
assert.ok(la.celeste > la.area * 0.03, 'A: el logo debe verse arriba a la izquierda del video');


// Cámara completa: botón de la esquina.
console.log('cámara completa:', JSON.stringify(r.full));
assert.equal(r.full.cornerVisible, true, 'con cámara completa debe aparecer el botón para achicar');
assert.equal(r.full.panelOnTop, true, 'con cámara completa y sin grabar, el panel debe quedar encima');
assert.equal(r.full.shapeAfterClick, 'circle', 'achicar debe volver a la forma anterior');
assert.equal(r.full.cornerVisibleAfter, false, 'al achicar, el botón de la esquina se va');
assert.ok(r.full.bubbleAfter.width < r.full.bubbleBounds.width, 'la cámara debe quedar más chica');
if (r.full.hover) {
  assert.equal(Number(r.full.hiddenBeforeHover), 0, 'el botón debe estar escondido hasta pasar el mouse');
  assert.equal(r.full.hover, 'true|1', 'al pasar el mouse por la esquina el botón debe aparecer: ' + JSON.stringify(r.full));
}

assert.equal(B.finish.ok, false);
assert.equal(B.finish.empty, true, 'B no debe guardar nada');

assert.equal(C.finish.ok, true, 'C debe guardar: ' + JSON.stringify(C.finish));
const c = inspect(C.finish.item.file);
console.log('C (solo cámara, retroceder + deshacer):', JSON.stringify(c), '· tramos:', C.finish.takes);
assert.equal(C.finish.takes, 2, 'C debe conservar los 2 tramos tras deshacer');
assert.ok(c.duration > 2.3 && c.duration < 4.5, 'C debe durar ~3 s, duró ' + c.duration);
assert.equal(c.decodeErrors, 0, 'C debe decodificar sin errores: ' + c.decodeLog);
assert.equal(c.timeJumpsBack, 0);
const lc = logoPixels(C.finish.item.file);
console.log('marca de agua en C (solo cámara, pegada al exportar):', JSON.stringify(lc), '· recodificado:', C.finish.export.recoded);
assert.equal(C.finish.export.recoded, true, 'C: con marca de agua en solo cámara se recodifica');
assert.ok(lc.celeste > lc.area * 0.03, 'C: el logo debe verse arriba a la izquierda');

assert.equal(D.finish.ok, true, 'D debe guardar: ' + JSON.stringify(D.finish));
const d = inspect(D.finish.item.file);
console.log('D (pausa a los 0,4 s + 2 s):', JSON.stringify(d), '· tramos:', D.finish.takes);
assert.equal(D.finish.takes, 2, 'D no debe perder el primer tramo aunque se pause enseguida');
assert.ok(d.duration > 2.2 && d.duration < 3.2, 'D debe durar ~2,4 s, duró ' + d.duration);
assert.equal(d.decodeErrors, 0, 'D debe decodificar sin errores: ' + d.decodeLog);
const ld = logoPixels(D.finish.item.file);
console.log('sin marca de agua en D:', JSON.stringify(ld));
assert.ok(ld.celeste < la.celeste * 0.2, 'D: sin la opción, el logo no debe aparecer');

assert.equal(fs.readdirSync(out).filter((f) => f.endsWith('.mp4')).length, 3, 'solo deben quedar 3 videos');
const left = path.join(tmp, 'datos', 'sesiones');
assert.deepEqual(fs.existsSync(left) ? fs.readdirSync(left) : [], [], 'no deben quedar tramos sueltos');

console.log('burbuja:', JSON.stringify(r.bubble));
if (keep) console.log('archivos en', tmp);
else fs.rmSync(tmp, { recursive: true, force: true });
console.log('PRUEBA OK');
