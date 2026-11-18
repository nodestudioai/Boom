// Prueba el servidor de links de punta a punta contra `wrangler dev` (local).
// Uso:  (en otra terminal)  cd cloud && npx wrangler dev --port 8787 --local
//       node scripts/cloud-test.js <video.mp4> [miniatura.jpg]
const fs = require('fs');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const uploader = require('../src/main/uploader');

const baseUrl = process.env.BOOM_CLOUD_URL || 'http://127.0.0.1:8787';
const token = process.env.BOOM_CLOUD_TOKEN || 'token-de-prueba-local';
const [filePath, thumbPath] = process.argv.slice(2);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  const original = fs.readFileSync(filePath);

  // 1. Sin token o con token malo no se puede subir.
  await assert.rejects(uploader.ping({ baseUrl, token: 'malo' }), /token no es válido/i);
  const anon = await fetch(baseUrl + '/api/videos', { method: 'POST' });
  assert.equal(anon.status, 401, 'sin token debe dar 401');
  await uploader.ping({ baseUrl, token });
  console.log('ok  el token protege la subida');

  // 2. Subida por partes.
  const seen = [];
  const res = await uploader.upload({
    filePath, thumbPath, baseUrl, token,
    meta: { title: 'Prueba <b>de</b> "Boom" & cía', durationSec: 20, width: 1920, height: 1080, createdAt: new Date().toISOString() },
    onProgress: (p) => seen.push(p),
  });
  assert.match(res.url, /\/v\/[A-Za-z0-9]{8,32}$/);
  assert.ok(seen.length >= 2 && seen[seen.length - 1] === 1, 'el progreso debe llegar a 100% en varias partes: ' + seen);
  console.log(`ok  subido en ${seen.length} partes -> ${res.url}`);

  // 3. La página del link.
  const page = await fetch(res.url);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /<video id="v" controls/);
  assert.ok(html.includes('Prueba &lt;b&gt;de&lt;/b&gt; &quot;Boom&quot; &amp; cía'), 'el título debe ir escapado');
  assert.ok(!html.includes('<b>de</b>'), 'no debe inyectarse HTML del título');
  for (const r of ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2']) assert.ok(html.includes(r), 'falta la velocidad ' + r);
  console.log('ok  la página tiene reproductor, velocidades y título escapado');

  // 4. El video baja idéntico al original.
  const media = `${baseUrl}/media/${res.id}.mp4`;
  const full = await fetch(media);
  const got = Buffer.from(await full.arrayBuffer());
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(got.length, original.length);
  assert.equal(sha(got), sha(original), 'el video descargado debe ser idéntico');
  console.log(`ok  el video se descarga idéntico (${got.length} bytes)`);

  // 5. Saltos dentro del video (Range), incluido uno que cruza el límite entre partes.
  const cut = 10 * 1024 * 1024;
  for (const [a, b] of [[0, 99], [cut - 50, cut + 49], [original.length - 100, original.length - 1]]) {
    const r = await fetch(media, { headers: { range: `bytes=${a}-${b}` } });
    const part = Buffer.from(await r.arrayBuffer());
    assert.equal(r.status, 206, `rango ${a}-${b} debe dar 206`);
    assert.equal(r.headers.get('content-range'), `bytes ${a}-${b}/${original.length}`);
    assert.ok(part.equals(original.subarray(a, b + 1)), `rango ${a}-${b} debe traer los bytes correctos`);
  }
  const open = await fetch(media, { headers: { range: 'bytes=1000-' } });
  assert.equal(open.status, 206);
  assert.equal(open.headers.get('content-range'), `bytes 1000-${original.length - 1}/${original.length}`);
  await open.body.cancel();
  console.log('ok  los saltos dentro del video funcionan');

  // 6. Miniatura y descarga.
  if (thumbPath) {
    const t = await fetch(`${baseUrl}/media/${res.id}.jpg`);
    assert.equal(t.status, 200);
    assert.equal(sha(Buffer.from(await t.arrayBuffer())), sha(fs.readFileSync(thumbPath)));
  }
  const dl = await fetch(media + '?dl=1', { headers: { range: 'bytes=0-0' } });
  assert.match(dl.headers.get('content-disposition') || '', /attachment/);
  await dl.body.cancel();
  console.log('ok  miniatura y descarga');

  // 7. Links que no existen.
  assert.equal((await fetch(`${baseUrl}/v/NoExiste1234`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/media/NoExiste1234.mp4`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/v/../api/ping`)).status, 401);

  if (process.argv.includes('--keep')) { console.log('LINK', res.url); return; }

  // 8. Borrado: sin token no; con token desaparece todo.
  assert.equal((await fetch(`${baseUrl}/api/videos/${res.id}`, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(media, { headers: { range: 'bytes=0-0' } })).status, 206, 'sin token no debe borrarse');
  await uploader.remove({ id: res.id, baseUrl, token });
  assert.equal((await fetch(res.url)).status, 404);
  assert.equal((await fetch(media)).status, 404);
  console.log('ok  el borrado necesita token y elimina página y video');
  console.log('NUBE OK');
})().catch((err) => { console.error(err); process.exit(1); });
