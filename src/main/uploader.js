// Sube un video al Worker de Cloudflare, de a partes.
const fs = require('fs');
const { planParts } = require('../core/parts');

async function call(baseUrl, token, method, route, body, headers = {}) {
  const res = await fetch(baseUrl + route, {
    method,
    headers: { authorization: 'Bearer ' + token, ...headers },
    body,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no era JSON */ }
  if (!res.ok) {
    const why = (json && json.error) || text.slice(0, 200) || res.statusText;
    throw new Error(res.status === 401 ? 'El token no es válido' : `El servidor respondió ${res.status}: ${why}`);
  }
  return json || {};
}

async function upload({ filePath, thumbPath, meta, baseUrl, token, onProgress = () => {} }) {
  const size = fs.statSync(filePath).size;
  const parts = planParts(size);
  if (!parts.length) throw new Error('El archivo está vacío');

  const { id, uploadId } = await call(baseUrl, token, 'POST', '/api/videos', JSON.stringify(meta || {}), {
    'content-type': 'application/json',
  });
  const fh = await fs.promises.open(filePath, 'r');
  const done = [];
  try {
    let sent = 0;
    for (const p of parts) {
      const buf = Buffer.alloc(p.end - p.start);
      await fh.read(buf, 0, buf.length, p.start);
      let r = null;
      for (let attempt = 1; ; attempt++) {
        try {
          r = await call(baseUrl, token, 'PUT',
            `/api/videos/${id}/parts/${p.n}?uploadId=${encodeURIComponent(uploadId)}`, buf,
            { 'content-type': 'application/octet-stream' });
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
          await new Promise((ok) => setTimeout(ok, 800 * attempt));
        }
      }
      done.push({ partNumber: p.n, etag: r.etag });
      sent += buf.length;
      onProgress(sent / size);
    }
  } finally {
    await fh.close();
  }
  const fin = await call(baseUrl, token, 'POST', `/api/videos/${id}/complete`,
    JSON.stringify({ uploadId, parts: done, meta: meta || {} }), { 'content-type': 'application/json' });

  if (thumbPath && fs.existsSync(thumbPath)) {
    await call(baseUrl, token, 'PUT', `/api/videos/${id}/thumb`, fs.readFileSync(thumbPath),
      { 'content-type': 'image/jpeg' }).catch(() => {}); // la miniatura es opcional
  }
  return { id, url: fin.url || `${baseUrl}/v/${id}` };
}

async function remove({ id, baseUrl, token }) {
  await call(baseUrl, token, 'DELETE', `/api/videos/${id}`);
}

// Cambia el nombre que se ve en la página del link.
async function rename({ id, title, baseUrl, token }) {
  return call(baseUrl, token, 'PATCH', `/api/videos/${id}`, JSON.stringify({ title }), { 'content-type': 'application/json' });
}

// Transcribe un pedazo de audio (MP3) con Whisper en el Worker.
async function transcribe({ id, audio, language, prompt, baseUrl, token }) {
  return call(baseUrl, token, 'POST', `/api/videos/${id}/transcribe`,
    JSON.stringify({ audio: audio.toString('base64'), language: language || undefined, prompt: prompt || undefined }),
    { 'content-type': 'application/json' });
}

async function putCaptions({ id, vtt, language, baseUrl, token }) {
  const q = language ? `?lang=${encodeURIComponent(language)}` : '';
  return call(baseUrl, token, 'PUT', `/api/videos/${id}/captions${q}`, vtt, { 'content-type': 'text/vtt; charset=utf-8' });
}

async function deleteCaptions({ id, baseUrl, token }) {
  return call(baseUrl, token, 'DELETE', `/api/videos/${id}/captions`);
}

async function ping({ baseUrl, token }) {
  return call(baseUrl, token, 'GET', '/api/ping');
}

module.exports = { upload, remove, ping, rename, transcribe, putCaptions, deleteCaptions };
