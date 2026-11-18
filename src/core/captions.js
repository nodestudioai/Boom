// Subtítulos: de lo que devuelve Whisper (frases con palabras y tiempos) a un archivo WebVTT
// con renglones cortos, como los de Loom: hasta dos líneas, que cambian con las pausas.

const MAX_CHARS = 84;   // por subtítulo (dos líneas de ~42)
const LINE_CHARS = 42;
const MAX_SEC = 6;      // un subtítulo no queda más de esto en pantalla
const PAUSE_SEC = 0.7;  // una pausa así corta el subtítulo
const MIN_SEC = 0.8;

// Corta el audio en pedazos de ~target segundos, en silencios si los hay cerca.
// silences: [{ start, end }] (de "silencedetect" de ffmpeg). Devuelve [{ start, end }].
function chunkPlan(durationSec, silences = [], target = 240, slack = 40) {
  const D = Number(durationSec) || 0;
  if (D <= 0) return [];
  const cuts = [];
  let from = 0;
  while (D - from > target + slack) {
    const ideal = from + target;
    let best = null;
    for (const s of silences) {
      const mid = (s.start + s.end) / 2;
      if (mid <= from + 1 || Math.abs(mid - ideal) > slack) continue;
      if (!best || Math.abs(mid - ideal) < Math.abs(best - ideal)) best = mid;
    }
    const cut = best ?? ideal;
    cuts.push(cut);
    from = cut;
  }
  const edges = [0, ...cuts, D];
  return edges.slice(1).map((end, i) => ({ start: round3(edges[i]), end: round3(end) }));
}

// Lee los silencios de la salida de ffmpeg -af silencedetect.
function parseSilences(stderr) {
  const out = [];
  let open = null;
  for (const m of String(stderr).matchAll(/silence_(start|end): (-?\d+(?:\.\d+)?)/g)) {
    const t = Math.max(0, Number(m[2]));
    if (m[1] === 'start') open = t;
    else if (open != null) { out.push({ start: open, end: t }); open = null; }
  }
  return out;
}

const round3 = (n) => Math.round(n * 1000) / 1000;

// Corre los tiempos de un pedazo para que queden en el lugar del video completo.
function offsetSegments(segments, offset) {
  return (segments || []).map((s) => ({
    ...s,
    start: round3(s.start + offset),
    end: round3(s.end + offset),
    words: s.words ? s.words.map((w) => ({ ...w, start: round3(w.start + offset), end: round3(w.end + offset) })) : undefined,
  }));
}

// Arma los subtítulos (cues) a partir de las palabras.
function buildCues(segments) {
  const cues = [];
  let cur = null;
  const flush = () => { if (cur && cur.text) cues.push(cur); cur = null; };
  for (const seg of segments || []) {
    const words = seg.words && seg.words.length
      ? seg.words.map((w) => ({ start: w.start, end: w.end, word: String(w.word).trim() })).filter((w) => w.word)
      : splitEvenly(seg);
    for (const w of words) {
      if (cur) {
        const text = cur.text + ' ' + w.word;
        const pause = w.start - cur.end;
        const endsSentence = /[.!?…]$/.test(cur.text) && cur.text.length >= LINE_CHARS * 0.6;
        if (text.length > MAX_CHARS || w.end - cur.start > MAX_SEC || pause > PAUSE_SEC || endsSentence) flush();
      }
      if (!cur) cur = { start: w.start, end: w.end, text: w.word };
      else { cur.text += ' ' + w.word; cur.end = w.end; }
    }
    flush(); // cada frase de Whisper arranca un subtítulo nuevo
  }
  // Que no se pisen y que no duren un parpadeo.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const limit = next ? next.start : Infinity;
    if (cues[i].end - cues[i].start < MIN_SEC) cues[i].end = Math.min(cues[i].start + MIN_SEC, limit);
    if (cues[i].end > limit) cues[i].end = limit;
    cues[i].start = round3(cues[i].start);
    cues[i].end = round3(Math.max(cues[i].end, cues[i].start + 0.05));
  }
  return cues;
}

// Una frase sin palabras sueltas: se reparte el tiempo entre sus palabras.
function splitEvenly(seg) {
  const parts = String(seg.text || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const step = (seg.end - seg.start) / parts.length;
  return parts.map((word, i) => ({ start: seg.start + i * step, end: seg.start + (i + 1) * step, word }));
}

// Parte un texto largo en dos renglones parejos.
function wrap(text) {
  if (text.length <= LINE_CHARS) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best < 0 ? text : text.slice(0, best) + '\n' + text.slice(best + 1);
}

function vttTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms % 1000, 3)}`;
}

function toVtt(cues) {
  const body = cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${wrap(c.text.replace(/-->/g, '→'))}\n`);
  return 'WEBVTT\n\n' + body.join('\n');
}

module.exports = { chunkPlan, parseSilences, offsetSegments, buildCues, wrap, vttTime, toVtt };
