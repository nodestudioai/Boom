// La página que ve quien abre un link de Boom. Paleta del logo: azul #2068D7 y blanco.
import { LOGO_PNG_BASE64 } from './assets.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDur = (sec) => {
  const t = Math.round(sec || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};

let logoBytes = null;
export function logoResponse() {
  if (!logoBytes) logoBytes = Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0));
  return new Response(logoBytes, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' } });
}

// Estilos compartidos por la página del video y las páginas de aviso.
const BASE_CSS = `
  :root { --blue:#2068D7; --blue-d:#1953B4; --blue-l:#E8F0FD; --bg:#F3F6FC; --card:#FFFFFF; --line:#D9E2F1; --text:#14274D; --dim:#5D6C88;
          --shadow: 0 1px 2px rgba(11,31,68,.06), 0 10px 30px rgba(11,31,68,.10); color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#081429; --card:#0F2145; --line:#22386A; --text:#EEF3FC; --dim:#9FB0D0; --blue-l:#16306A; --blue-d:#7FB0FF;
            --shadow: 0 10px 30px rgba(0,0,0,.35); }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text);
               font: 15px/1.45 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif; }
  body { background: linear-gradient(180deg, var(--blue-l) 0, var(--bg) 340px) no-repeat var(--bg); }
  .top { display: flex; align-items: center; gap: 10px; max-width: 1100px; margin: 0 auto; padding: 14px 16px; }
  .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); font-weight: 700; font-size: 21px; letter-spacing: -.3px; }
  .brand img { display: block; width: 34px; height: 34px; border-radius: 9px; box-shadow: 0 3px 10px rgba(32,104,215,.35); }
  .grow { flex: 1; }
  button, a.btn { font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; border-radius: 10px; padding: 9px 14px; border: 1.5px solid var(--line);
                  background: var(--card); color: var(--text); transition: border-color .12s, background .12s, filter .12s; }
  button:hover, a.btn:hover { border-color: var(--blue); }
  a.btn.primary { background: var(--blue); border-color: var(--blue); color: #fff; box-shadow: 0 4px 14px rgba(32,104,215,.35); }
  a.btn.primary:hover { filter: brightness(1.08); }
`;

export function page(meta, origin) {
  const title = esc(meta.title);
  const video = `${origin}/media/${meta.id}.mp4`;
  const poster = `${origin}/media/${meta.id}.jpg`;
  const ratio = meta.width && meta.height ? `${meta.width} / ${meta.height}` : '16 / 9';
  const cc = !!meta.captions;
  const ccLang = /^[a-z]{2}$/.test(meta.captionsLang || '') ? meta.captionsLang : 'es';
  // ?v= cambia cuando se rehacen los subtítulos, para que el navegador no use los viejos.
  const track = cc ? `<track id="cc" kind="captions" srclang="${ccLang}" label="Subtítulos" src="${origin}/media/${meta.id}.vtt?v=${esc(meta.captionsAt || '1')}">` : '';
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#2068D7">
<link rel="icon" type="image/png" href="/logo.png">
<title>${title} · Boom</title>
<meta property="og:title" content="${title}">
<meta property="og:site_name" content="Boom">
<meta property="og:type" content="video.other">
<meta property="og:image" content="${poster}">
<meta property="og:video" content="${video}">
<meta property="og:video:type" content="video/mp4">
${meta.width ? `<meta property="og:video:width" content="${meta.width}"><meta property="og:video:height" content="${meta.height}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<style>${BASE_CSS}
  main { max-width: 1100px; margin: 0 auto; padding: 4px 16px 28px; }
  .player { position: relative; container-type: inline-size; background: #000; border-radius: 16px; overflow: hidden; box-shadow: var(--shadow); border: 1px solid var(--line); }
  /* Subtítulos al estilo Loom: abajo al centro, letra blanca sobre una caja oscura. */
  .subs { position: absolute; left: 50%; bottom: calc(5% + 34px); transform: translateX(-50%); width: max-content; max-width: 94%; text-align: center; pointer-events: none;
          color: #fff; background: rgba(0,0,0,.78); border-radius: .4em; padding: .25em .6em .3em; white-space: pre-line;
          font: 600 clamp(10px, 3.1cqw, 28px)/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; letter-spacing: .1px; }
  .subs:empty, .subs.off { display: none; }
  video::cue { color: #fff; background: rgba(0,0,0,.78); font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  #ccBtn { display: inline-flex; align-items: center; gap: 7px; }
  #ccBtn svg { width: 20px; height: 20px; }
  #ccBtn.on { background: var(--blue); border-color: var(--blue); color: #fff; box-shadow: 0 1px 4px rgba(32,104,215,.4); }
  video { width: 100%; aspect-ratio: ${ratio}; max-height: 76vh; background: #000; display: block; }
  h1 { font-size: 23px; line-height: 1.25; margin: 18px 0 3px; overflow-wrap: anywhere; letter-spacing: -.2px; }
  .meta { color: var(--dim); font-size: 13.5px; }
  .bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 16px; }
  .speeds { display: flex; flex-wrap: wrap; align-items: center; background: var(--card); border: 1.5px solid var(--line); border-radius: 12px; padding: 3px; gap: 2px; }
  .speeds span { color: var(--dim); font-size: 13px; padding: 0 8px 0 10px; }
  .speeds button { border: 0; background: none; border-radius: 8px; padding: 7px 10px; color: var(--text); }
  .speeds button:hover:not(.on) { background: var(--blue-l); }
  .speeds button.on { background: var(--blue); color: #fff; box-shadow: 0 1px 4px rgba(32,104,215,.4); }
  .keys { color: var(--dim); font-size: 12.5px; margin-top: 14px; }
  footer { max-width: 1100px; margin: 0 auto; padding: 6px 16px 34px; color: var(--dim); font-size: 12.5px; display: flex; align-items: center; gap: 7px; }
  footer img { width: 18px; height: 18px; border-radius: 5px; }
  @media (max-width: 560px) {
    .keys { display: none; } h1 { font-size: 19px; } .brand { font-size: 19px; } .player { border-radius: 12px; }
    .speeds { width: 100%; flex-wrap: nowrap; } .speeds span { display: none; }
    .speeds button { flex: 1; padding: 8px 2px; font-size: 13px; }
    .bar .grow { display: none; } .bar a.btn.primary { width: 100%; text-align: center; padding: 12px; }
  }
</style></head>
<body>
<header class="top">
  <a class="brand" href="/"><img src="/logo.png" alt="">Boom</a>
  <span class="grow"></span>
  <button id="copy">Copiar link</button>
</header>
<main>
<div class="player"><video id="v" controls playsinline preload="metadata" poster="${poster}" src="${video}">${track}</video><div class="subs" id="subs"></div></div>
<h1>${title}</h1>
<div class="meta"><span id="when" data-iso="${esc(meta.createdAt)}"></span>${meta.durationSec ? fmtDur(meta.durationSec) : ''}</div>
<div class="bar">
  <div class="speeds" id="speeds"><span>Velocidad</span></div>
  ${cc ? `<button id="ccBtn" title="Subtítulos (tecla C)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6"/></svg>Subtítulos</button>` : ''}
  <span class="grow"></span>
  <a class="btn primary" href="/media/${meta.id}.mp4?dl=1">Descargar</a>
</div>
<p class="keys">Teclas: espacio pausa · ← → saltan 5 s · &lt; &gt; cambian la velocidad${cc ? ' · C prende o apaga los subtítulos' : ''}</p>
</main>
<footer><img src="/logo.png" alt="">Grabado con Boom</footer>
<script>
  const v = document.getElementById('v');
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const box = document.getElementById('speeds');
  let saved = 1;
  try { saved = Number(localStorage.getItem('boom-velocidad')) || 1; } catch (e) {}
  function setRate(r) {
    v.playbackRate = r;
    try { localStorage.setItem('boom-velocidad', String(r)); } catch (e) {}
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.r) === r));
  }
  for (const r of RATES) {
    const b = document.createElement('button');
    b.dataset.r = r; b.textContent = r + '×'; b.onclick = () => setRate(r);
    box.appendChild(b);
  }
  setRate(RATES.includes(saved) ? saved : 1);
  // Algunos navegadores reinician la velocidad al cargar el video: se vuelve a aplicar.
  v.addEventListener('loadedmetadata', () => { const on = box.querySelector('button.on'); if (on) v.playbackRate = Number(on.dataset.r); });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = RATES.indexOf(v.playbackRate);
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 5); }
    else if (e.key === '>' || e.key === '.') setRate(RATES[Math.min(RATES.length - 1, i + 1)]);
    else if (e.key === '<' || e.key === ',') setRate(RATES[Math.max(0, i - 1)]);
    else if ((e.key === 'c' || e.key === 'C') && ccBtn) setCC(!ccOn);
  });

  // Subtítulos: se dibujan encima del video (como Loom). En pantalla completa del navegador
  // se usan los del propio reproductor, porque ahí no se ve nada que esté por fuera del video.
  const ccBtn = document.getElementById('ccBtn');
  const subs = document.getElementById('subs');
  const tr = v.textTracks && v.textTracks[0];
  let ccOn = false;
  function fullscreenVideo() { return document.fullscreenElement === v || document.webkitFullscreenElement === v || v.webkitDisplayingFullscreen; }
  function paintCC() {
    if (!tr) return;
    const native = ccOn && fullscreenVideo();
    tr.mode = native ? 'showing' : ccOn ? 'hidden' : 'disabled';
    subs.classList.toggle('off', !ccOn || native);
    const cue = ccOn && tr.activeCues && tr.activeCues[0];
    subs.textContent = cue ? cue.text : '';
  }
  function setCC(on) {
    ccOn = on;
    try { localStorage.setItem('boom-subtitulos', on ? '1' : '0'); } catch (e) {}
    ccBtn.classList.toggle('on', on);
    ccBtn.setAttribute('aria-pressed', String(on));
    paintCC();
  }
  if (ccBtn && tr) {
    let pref = null;
    try { pref = localStorage.getItem('boom-subtitulos'); } catch (e) {}
    tr.addEventListener('cuechange', paintCC);
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, paintCC));
    v.addEventListener('webkitbeginfullscreen', () => { if (ccOn) tr.mode = 'showing'; });
    v.addEventListener('webkitendfullscreen', paintCC);
    ccBtn.onclick = () => setCC(!ccOn);
    setCC(pref !== '0'); // prendidos salvo que esta persona los haya apagado antes
  }
  // La fecha se muestra en el idioma y la hora de quien mira.
  const when = document.getElementById('when');
  const d = new Date(when.dataset.iso);
  if (!isNaN(d)) when.textContent = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) + ' · ';
  const copy = document.getElementById('copy');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(location.href.split('?')[0]); copy.textContent = '¡Copiado!'; }
    catch (e) { copy.textContent = 'No se pudo copiar'; }
    setTimeout(() => { copy.textContent = 'Copiar link'; }, 1800);
  };
</script>
</body></html>`;
}

export const simplePage = (title, text, status) =>
  new Response(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="theme-color" content="#2068D7">
<link rel="icon" type="image/png" href="/logo.png">
<title>${esc(title)} · Boom</title>
<style>${BASE_CSS}
  body { display: grid; place-items: center; min-height: 100vh; text-align: center; padding: 24px; }
  .box img { width: 84px; height: 84px; border-radius: 22px; box-shadow: 0 10px 30px rgba(32,104,215,.4); }
  h1 { font-size: 24px; margin: 22px 0 6px; letter-spacing: -.2px; }
  p { color: var(--dim); margin: 0; }
</style></head>
<body><div class="box"><img src="/logo.png" alt="Boom"><h1>${esc(title)}</h1><p>${esc(text)}</p></div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
