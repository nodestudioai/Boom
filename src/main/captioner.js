// Genera los subtítulos de un video ya compartido: saca el audio con ffmpeg, lo manda de a
// pedazos a Whisper (en el Worker de Cloudflare del usuario) y sube el WebVTT resultante.
const fs = require('fs');
const path = require('path');
const { run, probe } = require('./exporter');
const uploader = require('./uploader');
const { chunkPlan, parseSilences, offsetSegments, buildCues, toVtt } = require('../core/captions');

async function makeCaptions({ filePath, id, baseUrl, token, language, workDir, onProgress = () => {} }) {
  const info = await probe(filePath);
  if (!info.audioCodec) throw new Error('El video no tiene sonido');
  fs.mkdirSync(workDir, { recursive: true });
  try {
    onProgress(0.02);
    // Dónde hay silencios, para cortar el audio sin partir palabras.
    const sil = await run(['-i', filePath, '-vn', '-af', 'silencedetect=noise=-35dB:d=0.4', '-f', 'null', '-']);
    const plan = chunkPlan(info.durationSec, parseSilences(sil.stderr));
    const all = [];
    let lang = language && language !== 'auto' ? language : null;
    let prompt = '';
    for (let i = 0; i < plan.length; i++) {
      const { start, end } = plan[i];
      const mp3 = path.join(workDir, `audio-${i + 1}.mp3`);
      const r = await run(['-y', '-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', filePath,
        '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', mp3]);
      if (r.code !== 0 || !fs.existsSync(mp3)) throw new Error('ffmpeg no pudo sacar el audio');
      let res = null;
      for (let attempt = 1; ; attempt++) {
        try {
          res = await uploader.transcribe({ id, audio: fs.readFileSync(mp3), language: lang, prompt, baseUrl, token });
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
          await new Promise((ok) => setTimeout(ok, 1500 * attempt));
        }
      }
      // El idioma que detecta en el primer pedazo se mantiene en los demás.
      if (!lang && res.language) lang = res.language;
      const segs = offsetSegments(res.segments || [], start);
      all.push(...segs);
      prompt = segs.slice(-2).map((s) => s.text).join(' ').slice(-300);
      onProgress(0.05 + 0.9 * ((i + 1) / plan.length));
    }
    const cues = buildCues(all);
    if (!cues.length) throw new Error('No se escuchó ninguna voz en el video');
    await uploader.putCaptions({ id, vtt: toVtt(cues), language: lang, baseUrl, token });
    onProgress(1);
    return { cues: cues.length, language: lang };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { makeCaptions };
