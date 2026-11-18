// Boom en la nube — guarda videos en R2 y sirve la página de cada link.
//
// Con token (solo la app de Boom):
//   GET    /api/ping
//   POST   /api/videos                      -> { id, uploadId }
//   PUT    /api/videos/:id/parts/:n?uploadId=...   (cuerpo: bytes de la parte)
//   POST   /api/videos/:id/complete         { uploadId, parts, meta }
//   PUT    /api/videos/:id/thumb            (cuerpo: JPEG)
//   PATCH  /api/videos/:id                  { title }  cambia el nombre que se ve en el link
//   POST   /api/videos/:id/transcribe       { audio (base64), language? } -> { segments, language }
//   PUT    /api/videos/:id/captions?lang=es (cuerpo: WebVTT)
//   DELETE /api/videos/:id/captions
//   DELETE /api/videos/:id
// Público (quien tenga el link):
//   GET /v/:id            página con el reproductor
//   GET /media/:id.mp4    el video (admite saltos con Range)
//   GET /media/:id.jpg    la miniatura
//   GET /media/:id.vtt    los subtítulos
//   GET /logo.png         el logo de Boom

import { page, simplePage, logoResponse } from './page.js';

const ID = /^[A-Za-z0-9]{8,32}$/;
const videoKey = (id) => `videos/${id}.mp4`;
const thumbKey = (id) => `thumbs/${id}.jpg`;
const metaKey = (id) => `meta/${id}.json`;
const captionsKey = (id) => `captions/${id}.vtt`;
const WHISPER = '@cf/openai/whisper-large-v3-turbo';

async function readMeta(env, id) {
  const obj = await env.BUCKET.get(metaKey(id));
  return obj ? obj.json() : null;
}
const writeMeta = (env, meta) =>
  env.BUCKET.put(metaKey(meta.id), JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } });

// Pasa un pedazo de audio por Whisper (Workers AI) y devuelve frases con sus tiempos.
async function transcribe(env, body) {
  const audio = body && typeof body.audio === 'string' ? body.audio : '';
  if (!audio || audio.length > 12 * 1024 * 1024) throw Object.assign(new Error('Audio inválido'), { status: 400 });
  const input = { audio, task: 'transcribe', vad_filter: true };
  if (body.language && /^[a-z]{2}$/.test(body.language)) input.language = body.language;
  if (body.prompt) input.initial_prompt = String(body.prompt).slice(0, 500);
  const out = await env.AI.run(WHISPER, input);
  const segments = (out.segments || []).map((s) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text || '').trim(),
    words: Array.isArray(s.words)
      ? s.words.map((w) => ({ start: Number(w.start) || 0, end: Number(w.end) || 0, word: String(w.word || '') }))
      : undefined,
  })).filter((s) => s.text);
  return { segments, language: (out.transcription_info && out.transcription_info.language) || input.language || null };
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

function newId() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}

// Comparación en tiempo constante, para no filtrar el token por tiempos de respuesta.
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

async function authorized(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return !!env.TOKEN && !!token && sameSecret(token, env.TOKEN);
}

async function api(request, env, url) {
  if (!env.TOKEN) return json({ error: 'Falta configurar el secreto TOKEN en el Worker' }, 500);
  if (!(await authorized(request, env))) return json({ error: 'Token inválido' }, 401);

  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'videos', id, ...]
  const method = request.method;
  if (parts[1] === 'ping' && method === 'GET') return json({ ok: true });
  if (parts[1] !== 'videos') return json({ error: 'No existe' }, 404);

  if (parts.length === 2 && method === 'POST') {
    const id = newId();
    const mpu = await env.BUCKET.createMultipartUpload(videoKey(id), { httpMetadata: { contentType: 'video/mp4' } });
    return json({ id, uploadId: mpu.uploadId });
  }

  const id = parts[2];
  if (!ID.test(id || '')) return json({ error: 'Identificador inválido' }, 400);

  if (parts[3] === 'parts' && method === 'PUT') {
    const n = Number(parts[4]);
    const uploadId = url.searchParams.get('uploadId');
    if (!Number.isInteger(n) || n < 1 || n > 10000 || !uploadId) return json({ error: 'Parte inválida' }, 400);
    const body = await request.arrayBuffer();
    if (!body.byteLength) return json({ error: 'La parte está vacía' }, 400);
    const mpu = env.BUCKET.resumeMultipartUpload(videoKey(id), uploadId);
    const part = await mpu.uploadPart(n, body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  }

  if (parts[3] === 'complete' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !body.uploadId || !Array.isArray(body.parts) || !body.parts.length) return json({ error: 'Faltan datos' }, 400);
    const mpu = env.BUCKET.resumeMultipartUpload(videoKey(id), body.uploadId);
    const obj = await mpu.complete(body.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
    const m = body.meta || {};
    const meta = {
      id,
      title: String(m.title || 'Video').slice(0, 200),
      durationSec: Number(m.durationSec) || 0,
      width: Number(m.width) || 0,
      height: Number(m.height) || 0,
      createdAt: String(m.createdAt || new Date().toISOString()).slice(0, 40),
      size: obj.size,
    };
    await env.BUCKET.put(metaKey(id), JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } });
    return json({ id, url: `${url.origin}/v/${id}`, size: obj.size });
  }

  if (parts[3] === 'thumb' && method === 'PUT') {
    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > 5 * 1024 * 1024) return json({ error: 'Miniatura inválida' }, 400);
    await env.BUCKET.put(thumbKey(id), body, { httpMetadata: { contentType: 'image/jpeg' } });
    return json({ ok: true });
  }

  if (parts.length === 3 && method === 'GET') {
    const meta = await readMeta(env, id);
    return meta ? json(meta) : json({ error: 'No existe' }, 404);
  }

  if (parts.length === 3 && method === 'PATCH') {
    const body = await request.json().catch(() => null);
    const meta = await readMeta(env, id);
    if (!meta) return json({ error: 'No existe' }, 404);
    const title = body && String(body.title || '').trim().slice(0, 200);
    if (!title) return json({ error: 'Falta el nombre' }, 400);
    meta.title = title;
    await writeMeta(env, meta);
    return json(meta);
  }

  if (parts[3] === 'transcribe' && method === 'POST') {
    if (!env.AI) return json({ error: 'Falta activar Workers AI en el Worker (binding "AI")' }, 501);
    try {
      return json(await transcribe(env, await request.json().catch(() => null)));
    } catch (err) {
      return json({ error: 'No pude transcribir: ' + ((err && err.message) || err) }, err.status || 502);
    }
  }

  if (parts[3] === 'captions' && (method === 'PUT' || method === 'DELETE')) {
    const meta = await readMeta(env, id);
    if (!meta) return json({ error: 'No existe' }, 404);
    if (method === 'DELETE') {
      await env.BUCKET.delete(captionsKey(id));
      meta.captions = false;
    } else {
      const text = await request.text();
      if (!text.startsWith('WEBVTT') || text.length > 3 * 1024 * 1024) return json({ error: 'Subtítulos inválidos' }, 400);
      await env.BUCKET.put(captionsKey(id), text, { httpMetadata: { contentType: 'text/vtt; charset=utf-8' } });
      meta.captions = true;
      const lang = url.searchParams.get('lang');
      meta.captionsLang = lang && /^[a-z]{2}$/.test(lang) ? lang : null;
      meta.captionsAt = Date.now();
    }
    await writeMeta(env, meta);
    return json({ ok: true, captions: meta.captions });
  }

  if (parts.length === 3 && method === 'DELETE') {
    await env.BUCKET.delete([videoKey(id), thumbKey(id), metaKey(id), captionsKey(id)]);
    return json({ ok: true });
  }

  return json({ error: 'No existe' }, 404);
}

// Sirve un objeto de R2 respetando Range (para poder saltar dentro del video).
async function media(request, env, key, { download, filename } = {}) {
  const wantsRange = request.headers.has('range');
  let obj;
  try {
    obj = await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
  } catch {
    return new Response('Rango inválido', { status: 416 });
  }
  if (!obj) return new Response('No encontrado', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=3600');
  if (download) headers.set('content-disposition', `attachment; filename="${filename}"`);
  if (!obj.body) return new Response(null, { status: 304, headers }); // no cambió

  if (wantsRange && obj.range && obj.range.length != null) {
    const start = obj.range.offset || 0;
    const end = start + obj.range.length - 1;
    headers.set('content-range', `bytes ${start}-${end}/${obj.size}`);
    headers.set('content-length', String(obj.range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Método no permitido', { status: 405 });

      let m = /^\/v\/([A-Za-z0-9]{8,32})\/?$/.exec(url.pathname);
      if (m) {
        const obj = await env.BUCKET.get(metaKey(m[1]));
        if (!obj) return simplePage('Este video no existe', 'Puede que el link esté mal o que lo hayan borrado.', 404);
        return new Response(page(await obj.json(), url.origin), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
        });
      }
      m = /^\/media\/([A-Za-z0-9]{8,32})\.(mp4|jpg|vtt)$/.exec(url.pathname);
      if (m) {
        if (m[2] === 'jpg') return await media(request, env, thumbKey(m[1]));
        if (m[2] === 'vtt') return await media(request, env, captionsKey(m[1]));
        return await media(request, env, videoKey(m[1]), { download: url.searchParams.has('dl'), filename: `boom-${m[1]}.mp4` });
      }
      if (url.pathname === '/logo.png' || url.pathname === '/favicon.ico') return logoResponse();
      if (url.pathname === '/') return simplePage('Boom', 'Acá viven los videos compartidos con Boom.', 200);
      return simplePage('No encontrado', 'Esa dirección no existe.', 404);
    } catch (err) {
      return json({ error: (err && err.message) || 'Error interno' }, 500);
    }
  },
};
